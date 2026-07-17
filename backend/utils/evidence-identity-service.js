const crypto = require('crypto');
const {
  ITEM_KINDS,
  LIFECYCLE_STATES,
  EvidenceIdentityError,
  createEvidenceIdentityRecord,
  validateEvidenceIdentity,
  isEvidenceId
} = require('./evidence-identity');
const { EVENT_NAMES, createEvidenceIdentityObserver } = require('./evidence-identity-observability');

class EvidenceIdentityService {
  constructor({ repository, provenanceResolver, businessIdentityResolver, observer, clock, issuanceEnabled = true, identityContext = {} } = {}) {
    if (!repository) throw new Error('Evidence Identity repository is required.');
    this.repository = repository;
    this.provenanceResolver = provenanceResolver;
    this.businessIdentityResolver = businessIdentityResolver;
    this.observer = observer || createEvidenceIdentityObserver();
    this.clock = clock || (() => new Date().toISOString());
    this.issuanceEnabled = issuanceEnabled;
    this.identityContext = identityContext;
  }

  emit(name, input, context, resultCategory, evidenceId, lifecycleState) {
    return this.observer.emit(name, {
      correlation_id: context.correlation_id,
      evidence_id: evidenceId,
      item_kind: input && input.item_kind,
      source_namespace: input && input.source_namespace,
      standard_version: 1,
      profile_version: context.profile_version || null,
      lifecycle_state: lifecycleState || null,
      result_category: resultCategory
    });
  }

  async issue(input, context = {}) {
    this.emit(EVENT_NAMES.ISSUANCE_REQUESTED, input, context, 'REQUESTED');
    try {
      if (!this.issuanceEnabled) {
        throw new EvidenceIdentityError('ISSUANCE_DISABLED', 'New Evidence Identity issuance is disabled for rollback.');
      }
      if (!this.provenanceResolver || !this.businessIdentityResolver) {
        throw new EvidenceIdentityError('AUTHORITY_RESOLVER_UNAVAILABLE', 'Identity issuance requires provenance and business identity authorities.');
      }
      if (!Buffer.isBuffer(context.evidenceBytes)) {
        throw new EvidenceIdentityError('EVIDENCE_BYTES_MISSING', 'Exact immutable evidence bytes are required for identity issuance.');
      }
      const actualDigest = crypto.createHash('sha256').update(context.evidenceBytes).digest('hex');
      if (actualDigest !== input.content_sha256) {
        throw new EvidenceIdentityError('CONTENT_DIGEST_MISMATCH', 'content_sha256 does not match the supplied immutable evidence bytes.');
      }

      const [provenanceRecord, businessIdentityResolved, parentRecords] = await Promise.all([
        this.provenanceResolver(input.provenance_record_id),
        this.businessIdentityResolver(input.subject_business_id),
        Promise.all((input.parent_evidence_ids || []).map(id => this.repository.findById(id)))
      ]);
      if (parentRecords.some(parent => !parent)) {
        throw new EvidenceIdentityError('PARENT_RELATIONSHIP_INVALID', 'Every parent Evidence Identity must resolve.');
      }
      this.validateTemporalRules(input, parentRecords);
      await this.assertAcyclicParents(input, parentRecords);

      const record = createEvidenceIdentityRecord(input, {
        provenanceRecord,
        businessIdentityResolved: Boolean(businessIdentityResolved),
        parentRecords
      }, { ...this.identityContext, createdAt: this.clock() });
      const result = await this.repository.issue(record, {
        reason: context.reason || 'Evidence Identity issued.',
        responsible_authority: context.responsible_authority || 'Evidence Identity Service',
        occurred_at: this.clock()
      });
      this.emit(
        result.created ? EVENT_NAMES.ISSUED : EVENT_NAMES.EXISTING_RETURNED,
        input, context, result.created ? 'ISSUED' : 'IDEMPOTENT_REUSE', record.evidence_id, record.lifecycle_state
      );
      return result;
    } catch (error) {
      const name = error.code === 'PROVENANCE_MISMATCH' ? EVENT_NAMES.PROVENANCE_MISMATCH
        : error.code === 'IDENTITY_COLLISION' ? EVENT_NAMES.CONFLICT
          : EVENT_NAMES.VALIDATION_FAILED;
      this.emit(name, input, context, error.code || 'ISSUANCE_FAILED');
      error.correlation_id = context.correlation_id || 'unassigned';
      throw error;
    }
  }

  validateTemporalRules(input, parents) {
    if (input.item_kind === ITEM_KINDS.FRAGMENT && parents.length === 1 && input.observed_at !== parents[0].observed_at) {
      throw new EvidenceIdentityError('FRAGMENT_OBSERVATION_MISMATCH', 'A fragment must inherit its parent observation time.');
    }
    if (input.item_kind === ITEM_KINDS.DERIVED && parents.length) {
      const latest = parents.map(parent => parent.observed_at).sort().at(-1);
      if (input.observed_at !== latest) {
        throw new EvidenceIdentityError('DERIVED_OBSERVATION_MISMATCH', 'Derived evidence must use the latest parent observation time.');
      }
    }
  }

  async assertAcyclicParents(input, parents) {
    if (!parents.length) return;
    const targetId = input.evidence_id;
    const visited = new Set();
    const visit = async record => {
      if (!record || visited.has(record.evidence_id)) return;
      if (targetId && record.evidence_id === targetId) {
        throw new EvidenceIdentityError('PARENT_CYCLE', 'Evidence Identity parent relationships cannot form a cycle.');
      }
      visited.add(record.evidence_id);
      for (const parentId of record.parent_evidence_ids || []) await visit(await this.repository.findById(parentId));
    };
    for (const parent of parents) await visit(parent);
  }

  async read(evidenceId) {
    if (!isEvidenceId(evidenceId)) throw new EvidenceIdentityError('IDENTIFIER_FORMAT_INVALID', 'A complete Evidence Identity is required.');
    const record = await this.repository.findById(evidenceId);
    if (!record) throw new EvidenceIdentityError('IDENTITY_NOT_FOUND', 'Evidence Identity does not exist.');
    const validation = validateEvidenceIdentity(record, this.identityContext);
    if (!validation.valid) throw new EvidenceIdentityError('PERSISTED_IDENTITY_INVALID', 'Persisted Evidence Identity failed reconstruction.', validation.errors);
    const [provenance, businessResolved, parents, history] = await Promise.all([
      this.provenanceResolver(record.provenance_record_id),
      this.businessIdentityResolver(record.subject_business_id),
      Promise.all(record.parent_evidence_ids.map(id => this.repository.findById(id))),
      this.repository.lifecycleHistory(evidenceId)
    ]);
    if (!provenance) throw new EvidenceIdentityError('PROVENANCE_MISSING', 'Persisted Evidence Identity provenance no longer resolves.');
    if (!businessResolved) throw new EvidenceIdentityError('SUBJECT_BUSINESS_UNRESOLVED', 'Persisted Evidence Identity subject no longer resolves.');
    const duplicatedFields = ['subject_business_id', 'source_namespace', 'source_locator', 'observed_at', 'content_sha256'];
    if (duplicatedFields.some(field => provenance[field] !== record[field])) {
      throw new EvidenceIdentityError('PROVENANCE_MISMATCH', 'Persisted Evidence Identity does not match authoritative provenance.');
    }
    if (provenance.source_profile_version !== record.source_profile_version ||
        (provenance.derivation_profile_version || null) !== record.derivation_profile_version) {
      throw new EvidenceIdentityError('PROVENANCE_MISMATCH', 'Persisted Evidence Identity profile versions do not match authoritative provenance.');
    }
    if (parents.some(parent => !parent || parent.subject_business_id !== record.subject_business_id)) {
      throw new EvidenceIdentityError('PARENT_RELATIONSHIP_INVALID', 'Persisted Evidence Identity parent relationship is invalid.');
    }
    if (history.length === 0 || history[0].from_state !== null || history[0].to_state !== LIFECYCLE_STATES.ACTIVE) {
      throw new EvidenceIdentityError('LIFECYCLE_HISTORY_INVALID', 'Persisted Evidence Identity lifecycle history is incomplete.');
    }
    let state = LIFECYCLE_STATES.ACTIVE;
    for (const event of history.slice(1)) {
      if (event.from_state !== state) throw new EvidenceIdentityError('LIFECYCLE_HISTORY_INVALID', 'Persisted lifecycle events are not contiguous.');
      state = event.to_state;
    }
    if (state !== record.lifecycle_state) throw new EvidenceIdentityError('LIFECYCLE_HISTORY_INVALID', 'Persisted lifecycle history does not match current state.');
    return { ...record, lifecycle_event_history: history };
  }

  async readContract(evidenceId, { allowSourceLocator = false } = {}) {
    const record = await this.read(evidenceId);
    return {
      evidence_id: record.evidence_id,
      standard_version: record.standard_version,
      schema_version: record.schema_version,
      item_kind: record.item_kind,
      subject_business_id: record.subject_business_id,
      lifecycle_state: record.lifecycle_state,
      provenance_record_id: record.provenance_record_id,
      source_namespace: record.source_namespace,
      source_locator: allowSourceLocator ? record.source_locator : null,
      observed_at: record.observed_at,
      content_sha256: record.content_sha256,
      parent_evidence_ids: record.parent_evidence_ids,
      supersedes_evidence_id: record.supersedes_evidence_id,
      superseded_by_evidence_id: record.superseded_by_evidence_id,
      source_profile_version: record.source_profile_version,
      derivation_profile: record.derivation_profile,
      derivation_profile_version: record.derivation_profile_version,
      lifecycle_event_history: record.lifecycle_event_history
    };
  }

  async transition(evidenceId, toState, context = {}) {
    const record = await this.repository.transition(evidenceId, toState, {
      reason: context.reason || 'Evidence Identity lifecycle updated.',
      responsible_authority: context.responsible_authority || 'Evidence Identity Service',
      occurred_at: this.clock()
    });
    const eventName = toState === LIFECYCLE_STATES.INVALIDATED ? EVENT_NAMES.INVALIDATED : EVENT_NAMES.LIFECYCLE_TRANSITIONED;
    this.emit(eventName, record, context, 'TRANSITIONED', evidenceId, toState);
    return record;
  }

  async supersede(predecessorId, successorInput, context = {}) {
    const [provenanceRecord, businessIdentityResolved, parentRecords] = await Promise.all([
      this.provenanceResolver(successorInput.provenance_record_id),
      this.businessIdentityResolver(successorInput.subject_business_id),
      Promise.all((successorInput.parent_evidence_ids || []).map(id => this.repository.findById(id)))
    ]);
    if (!Buffer.isBuffer(context.evidenceBytes) || crypto.createHash('sha256').update(context.evidenceBytes).digest('hex') !== successorInput.content_sha256) {
      throw new EvidenceIdentityError('CONTENT_DIGEST_MISMATCH', 'Successor content digest does not match supplied evidence bytes.');
    }
    if (parentRecords.some(parent => !parent)) {
      throw new EvidenceIdentityError('PARENT_RELATIONSHIP_INVALID', 'Every successor parent Evidence Identity must resolve.');
    }
    this.validateTemporalRules(successorInput, parentRecords);
    await this.assertAcyclicParents(successorInput, parentRecords);
    const successor = createEvidenceIdentityRecord({ ...successorInput, supersedes_evidence_id: predecessorId }, {
      provenanceRecord, businessIdentityResolved: Boolean(businessIdentityResolved), parentRecords
    }, { ...this.identityContext, createdAt: this.clock() });
    const stored = await this.repository.supersede(predecessorId, successor, {
      reason: context.reason || 'Evidence Identity superseded.',
      responsible_authority: context.responsible_authority || 'Evidence Identity Service',
      occurred_at: this.clock()
    });
    this.emit(EVENT_NAMES.SUPERSEDED, successorInput, context, 'SUPERSEDED', predecessorId, LIFECYCLE_STATES.SUPERSEDED);
    return stored;
  }

  async validateClaimEvidence(evidenceIds, { subjectBusinessId, authorisedEvidenceIds, correlation_id } = {}) {
    const allowed = new Set(authorisedEvidenceIds || []);
    if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) {
      this.emit(EVENT_NAMES.DOWNSTREAM_REJECTED, null, { correlation_id }, 'CLAIM_EVIDENCE_MISSING');
      return { valid: false, errors: ['claim_evidence_missing'] };
    }
    const errors = [];
    for (const evidenceId of evidenceIds) {
      if (!isEvidenceId(evidenceId)) { errors.push('evidence_id_malformed'); continue; }
      const record = await this.repository.findById(evidenceId);
      if (!record) errors.push('evidence_id_unknown');
      else if (record.lifecycle_state === LIFECYCLE_STATES.INVALIDATED) errors.push('evidence_id_invalidated');
      else if (record.subject_business_id !== subjectBusinessId) errors.push('evidence_subject_mismatch');
      if (!allowed.has(evidenceId)) errors.push('evidence_not_authorised');
    }
    if (errors.length) this.emit(EVENT_NAMES.DOWNSTREAM_REJECTED, null, { correlation_id }, errors[0]);
    return { valid: errors.length === 0, errors: [...new Set(errors)] };
  }
}

module.exports = { EvidenceIdentityService };
