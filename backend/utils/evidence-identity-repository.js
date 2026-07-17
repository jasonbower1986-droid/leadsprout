const {
  LIFECYCLE_STATES,
  EvidenceIdentityError,
  assertLifecycleTransition,
  validateEvidenceIdentity
} = require('./evidence-identity');

function parseRecord(row) {
  if (!row) return null;
  let parentEvidenceIds;
  try {
    parentEvidenceIds = JSON.parse(row.parent_evidence_ids_json || '[]');
  } catch (_) {
    throw new EvidenceIdentityError('PERSISTED_IDENTITY_INVALID', 'Persisted parent Evidence Identity data is malformed.');
  }
  if (!Array.isArray(parentEvidenceIds)) {
    throw new EvidenceIdentityError('PERSISTED_IDENTITY_INVALID', 'Persisted parent Evidence Identity data is not an array.');
  }
  return {
    evidence_id: row.evidence_id,
    schema_version: row.schema_version,
    standard_version: Number(row.standard_version),
    item_kind: row.item_kind,
    subject_business_id: row.subject_business_id,
    source_namespace: row.source_namespace,
    source_locator: row.source_locator,
    observed_at: row.observed_at,
    content_sha256: row.content_sha256,
    fragment_locator: row.fragment_locator || '',
    parent_evidence_ids: parentEvidenceIds,
    derivation_profile: row.derivation_profile || '',
    canonical_payload_digest: row.canonical_payload_digest,
    provenance_record_id: row.provenance_record_id,
    source_profile_version: row.source_profile_version,
    derivation_profile_version: row.derivation_profile_version || null,
    lifecycle_state: row.lifecycle_state,
    supersedes_evidence_id: row.supersedes_evidence_id || null,
    superseded_by_evidence_id: row.superseded_by_evidence_id || null,
    created_at: row.created_at
  };
}

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

class EvidenceIdentityRepository {
  constructor(dbQuery, identityContext = {}) {
    this.dbQuery = dbQuery;
    this.identityContext = identityContext;
  }

  async findById(evidenceId) {
    return parseRecord(await this.dbQuery.get('SELECT * FROM evidence_identities WHERE evidence_id = ?', [evidenceId]));
  }

  async findByPayloadDigest(digest) {
    return parseRecord(await this.dbQuery.get('SELECT * FROM evidence_identities WHERE canonical_payload_digest = ?', [digest]));
  }

  async lifecycleHistory(evidenceId) {
    return this.dbQuery.all(
      'SELECT evidence_id, from_state, to_state, reason, responsible_authority, occurred_at FROM evidence_identity_lifecycle_events WHERE evidence_id = ? ORDER BY event_id',
      [evidenceId]
    );
  }

  async recordAuthorisationEvidence(contractId, snapshots) {
    if (typeof contractId !== 'string' || !contractId || !Array.isArray(snapshots)) {
      throw new EvidenceIdentityError('AUTHORISATION_EVIDENCE_INVALID', 'A contract identity and Evidence Identity snapshots are required.');
    }
    for (const snapshot of snapshots) {
      const record = await this.findById(snapshot.evidenceId);
      if (!record) throw new EvidenceIdentityError('IDENTITY_NOT_FOUND', `Evidence Identity ${snapshot.evidenceId} does not exist.`);
      if (record.lifecycle_state !== snapshot.lifecycleState) {
        throw new EvidenceIdentityError('EVIDENCE_LIFECYCLE_MISMATCH', 'Evidence lifecycle snapshot does not match the evaluated identity state.');
      }
    }
    if (snapshots.length === 0) return [];
    const statements = snapshots.map(snapshot => `INSERT OR IGNORE INTO evidence_authorisation_evidence_identities
      (contract_id, evidence_id, lifecycle_state_at_decision) VALUES
      (${sqlValue(contractId)}, ${sqlValue(snapshot.evidenceId)}, ${sqlValue(snapshot.lifecycleState)});`).join('\n');
    await this.dbQuery.exec(`BEGIN IMMEDIATE;\n${statements}\nCOMMIT;`);
    return snapshots;
  }

  async issue(record, event) {
    const existingById = await this.findById(record.evidence_id);
    const existingByDigest = await this.findByPayloadDigest(record.canonical_payload_digest);
    const existing = existingById || existingByDigest;
    if (existing) {
      if (existing.evidence_id !== record.evidence_id || existing.canonical_payload_digest !== record.canonical_payload_digest) {
        throw new EvidenceIdentityError('IDENTITY_COLLISION', 'Evidence Identity conflicts with an existing canonical payload.');
      }
      return { record: existing, created: false };
    }

    const validation = validateEvidenceIdentity(record, this.identityContext);
    if (!validation.valid) throw new EvidenceIdentityError('PERSISTENCE_RECORD_INVALID', 'Invalid Evidence Identity cannot be persisted.', validation.errors);

    const columns = [
      'evidence_id', 'schema_version', 'standard_version', 'item_kind', 'subject_business_id',
      'source_namespace', 'source_locator', 'observed_at', 'content_sha256', 'fragment_locator',
      'parent_evidence_ids_json', 'derivation_profile', 'canonical_payload_digest', 'provenance_record_id',
      'source_profile_version', 'derivation_profile_version', 'lifecycle_state', 'supersedes_evidence_id',
      'superseded_by_evidence_id', 'created_at'
    ];
    const values = [
      record.evidence_id, record.schema_version, record.standard_version, record.item_kind, record.subject_business_id,
      record.source_namespace, record.source_locator, record.observed_at, record.content_sha256, record.fragment_locator,
      JSON.stringify(record.parent_evidence_ids), record.derivation_profile, record.canonical_payload_digest, record.provenance_record_id,
      record.source_profile_version, record.derivation_profile_version, record.lifecycle_state, record.supersedes_evidence_id,
      record.superseded_by_evidence_id, record.created_at
    ];
    const transaction = `BEGIN IMMEDIATE;
      INSERT INTO evidence_identities (${columns.join(', ')}) VALUES (${values.map(sqlValue).join(', ')});
      INSERT INTO evidence_identity_lifecycle_events
        (evidence_id, from_state, to_state, reason, responsible_authority, occurred_at)
      VALUES (${sqlValue(record.evidence_id)}, NULL, ${sqlValue(LIFECYCLE_STATES.ACTIVE)}, ${sqlValue(event.reason)}, ${sqlValue(event.responsible_authority)}, ${sqlValue(event.occurred_at)});
      COMMIT;`;
    try {
      await this.dbQuery.exec(transaction);
      return { record, created: true };
    } catch (error) {
      // A concurrent identical issuance may win after the initial read. The
      // unique constraints remain authoritative; only exact identity reuse is
      // treated as idempotent success.
      const concurrent = await this.findById(record.evidence_id);
      if (concurrent && concurrent.canonical_payload_digest === record.canonical_payload_digest) {
        return { record: concurrent, created: false };
      }
      throw error;
    }
  }

  async transition(evidenceId, toState, event) {
    const current = await this.findById(evidenceId);
    if (!current) throw new EvidenceIdentityError('IDENTITY_NOT_FOUND', 'Evidence Identity does not exist.');
    assertLifecycleTransition(current.lifecycle_state, toState);
    const transaction = `BEGIN IMMEDIATE;
      UPDATE evidence_identities SET lifecycle_state = ${sqlValue(toState)}
        WHERE evidence_id = ${sqlValue(evidenceId)} AND lifecycle_state = ${sqlValue(current.lifecycle_state)};
      CREATE TEMP TABLE _evidence_identity_transition_guard (changed INTEGER CHECK (changed = 1));
      INSERT INTO _evidence_identity_transition_guard VALUES (changes());
      INSERT INTO evidence_identity_lifecycle_events
        (evidence_id, from_state, to_state, reason, responsible_authority, occurred_at)
      VALUES (${sqlValue(evidenceId)}, ${sqlValue(current.lifecycle_state)}, ${sqlValue(toState)}, ${sqlValue(event.reason)}, ${sqlValue(event.responsible_authority)}, ${sqlValue(event.occurred_at)});
      DROP TABLE _evidence_identity_transition_guard;
      COMMIT;`;
    await this.dbQuery.exec(transaction);
    return { ...current, lifecycle_state: toState };
  }

  async supersede(predecessorId, successorRecord, event) {
    const predecessor = await this.findById(predecessorId);
    if (!predecessor) throw new EvidenceIdentityError('IDENTITY_NOT_FOUND', 'Predecessor Evidence Identity does not exist.');
    assertLifecycleTransition(predecessor.lifecycle_state, LIFECYCLE_STATES.SUPERSEDED);
    if (predecessor.subject_business_id !== successorRecord.subject_business_id || predecessorId === successorRecord.evidence_id) {
      throw new EvidenceIdentityError('SUPERSESSION_INVALID', 'Supersession requires distinct identities for the same subject business.');
    }
    const successorExists = await this.findById(successorRecord.evidence_id);
    if (successorExists) throw new EvidenceIdentityError('SUPERSESSION_INVALID', 'Successor is already persisted.');

    const columns = [
      'evidence_id', 'schema_version', 'standard_version', 'item_kind', 'subject_business_id', 'source_namespace',
      'source_locator', 'observed_at', 'content_sha256', 'fragment_locator', 'parent_evidence_ids_json',
      'derivation_profile', 'canonical_payload_digest', 'provenance_record_id', 'source_profile_version',
      'derivation_profile_version', 'lifecycle_state', 'supersedes_evidence_id', 'superseded_by_evidence_id', 'created_at'
    ];
    const successor = { ...successorRecord, supersedes_evidence_id: predecessorId };
    const successorValidation = validateEvidenceIdentity(successor, this.identityContext);
    if (!successorValidation.valid) {
      throw new EvidenceIdentityError('PERSISTENCE_RECORD_INVALID', 'Invalid successor Evidence Identity cannot be persisted.', successorValidation.errors);
    }
    const values = columns.map(column => column === 'parent_evidence_ids_json'
      ? JSON.stringify(successor.parent_evidence_ids)
      : successor[column]);
    const transaction = `BEGIN IMMEDIATE;
      UPDATE evidence_identities SET lifecycle_state = ${sqlValue(LIFECYCLE_STATES.SUPERSEDED)}, superseded_by_evidence_id = ${sqlValue(successor.evidence_id)}
        WHERE evidence_id = ${sqlValue(predecessorId)} AND lifecycle_state = ${sqlValue(LIFECYCLE_STATES.ACTIVE)};
      CREATE TEMP TABLE _evidence_identity_supersession_guard (changed INTEGER CHECK (changed = 1));
      INSERT INTO _evidence_identity_supersession_guard VALUES (changes());
      INSERT INTO evidence_identities (${columns.join(', ')}) VALUES (${values.map(sqlValue).join(', ')});
      INSERT INTO evidence_identity_lifecycle_events (evidence_id, from_state, to_state, reason, responsible_authority, occurred_at)
        VALUES (${sqlValue(predecessorId)}, ${sqlValue(LIFECYCLE_STATES.ACTIVE)}, ${sqlValue(LIFECYCLE_STATES.SUPERSEDED)}, ${sqlValue(event.reason)}, ${sqlValue(event.responsible_authority)}, ${sqlValue(event.occurred_at)});
      INSERT INTO evidence_identity_lifecycle_events (evidence_id, from_state, to_state, reason, responsible_authority, occurred_at)
        VALUES (${sqlValue(successor.evidence_id)}, NULL, ${sqlValue(LIFECYCLE_STATES.ACTIVE)}, ${sqlValue(event.reason)}, ${sqlValue(event.responsible_authority)}, ${sqlValue(event.occurred_at)});
      DROP TABLE _evidence_identity_supersession_guard;
      COMMIT;`;
    await this.dbQuery.exec(transaction);
    return successor;
  }
}

module.exports = { EvidenceIdentityRepository, parseRecord, sqlValue };
