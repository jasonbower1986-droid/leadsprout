const crypto = require('crypto');
const {
  LIFECYCLE_STATES,
  EvidenceIdentityError,
  assertLifecycleTransition,
  validateEvidenceIdentity
} = require('./evidence-identity');

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function identityBaseline(record) {
  return sha256([
    record.evidence_id, record.schema_version, record.standard_version, record.item_kind,
    record.subject_business_id, record.source_namespace, record.source_locator, record.observed_at,
    record.content_sha256, record.fragment_locator, record.parent_evidence_ids,
    record.derivation_profile, record.canonical_payload_digest, record.provenance_record_id,
    record.source_profile_version, record.derivation_profile_version, record.supersedes_evidence_id,
    record.created_at
  ]);
}

function lifecycleBaseline(event) {
  return sha256([
    event.evidence_id, event.from_state || null, event.to_state, event.reason,
    event.responsible_authority, event.occurred_at
  ]);
}

function authorisationBaseline(link) {
  return sha256([link.contract_id, link.evidence_id, link.lifecycle_state_at_decision]);
}

const integritySchema = `
  CREATE TABLE IF NOT EXISTS evidence_identity_integrity_state (
    store_id TEXT PRIMARY KEY CHECK (store_id = 'EVIDENCE_IDENTITY'),
    identity_count INTEGER NOT NULL,
    lifecycle_event_count INTEGER NOT NULL,
    authorisation_link_count INTEGER NOT NULL,
    initialized_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS evidence_identity_record_baselines (
    evidence_id TEXT PRIMARY KEY,
    immutable_digest TEXT NOT NULL UNIQUE,
    provenance_record_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS evidence_identity_lifecycle_baselines (
    event_digest TEXT PRIMARY KEY,
    evidence_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS evidence_identity_authorisation_baselines (
    contract_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    snapshot_digest TEXT NOT NULL UNIQUE,
    PRIMARY KEY (contract_id, evidence_id)
  );`;

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

function integrityFailure(findings) {
  const codes = [...new Set(findings)].sort();
  return new EvidenceIdentityError(
    'PERSISTENCE_INTEGRITY_VIOLATION',
    'Evidence Identity persistence integrity verification failed.',
    codes
  );
}

/**
 * Mechanism-neutral integrity verification for the Evidence Identity store.
 * Findings deliberately contain invariant codes only; canonical evidence
 * inputs and protected payloads are never included in diagnostics.
 */
async function verifyEvidenceIdentityIntegrity(dbQuery, identityContext = {}, options = {}) {
  const [identityRows, events, links] = await Promise.all([
    dbQuery.all('SELECT * FROM evidence_identities ORDER BY evidence_id'),
    dbQuery.all('SELECT event_id, evidence_id, from_state, to_state, reason, responsible_authority, occurred_at FROM evidence_identity_lifecycle_events ORDER BY evidence_id, event_id'),
    dbQuery.all('SELECT contract_id, evidence_id, lifecycle_state_at_decision FROM evidence_authorisation_evidence_identities ORDER BY contract_id, evidence_id')
  ]);
  const findings = [];
  const identities = new Map();
  const digests = new Set();

  for (const row of identityRows) {
    let record;
    try {
      record = parseRecord(row);
      const validation = validateEvidenceIdentity(record, identityContext);
      if (!validation.valid) findings.push(...validation.errors.map(code => `identity_${code}`));
    } catch (_) {
      findings.push('identity_record_malformed');
      continue;
    }
    if (identities.has(record.evidence_id)) findings.push('identity_ownership_duplicate');
    if (digests.has(record.canonical_payload_digest)) findings.push('payload_ownership_duplicate');
    identities.set(record.evidence_id, record);
    digests.add(record.canonical_payload_digest);
  }

  const eventsByIdentity = new Map();
  for (const event of events) {
    if (!identities.has(event.evidence_id)) findings.push('lifecycle_identity_missing');
    const history = eventsByIdentity.get(event.evidence_id) || [];
    history.push(event);
    eventsByIdentity.set(event.evidence_id, history);
  }

  for (const [evidenceId, record] of identities) {
    const history = eventsByIdentity.get(evidenceId) || [];
    if (history.length === 0) {
      findings.push('lifecycle_history_missing');
    } else {
      let prior = null;
      for (let index = 0; index < history.length; index += 1) {
        const event = history[index];
        if (event.from_state !== prior) findings.push('lifecycle_order_invalid');
        if (index === 0) {
          if (event.from_state !== null || event.to_state !== LIFECYCLE_STATES.ACTIVE) findings.push('lifecycle_issuance_invalid');
        } else {
          try { assertLifecycleTransition(prior, event.to_state); } catch (_) { findings.push('lifecycle_transition_invalid'); }
        }
        prior = event.to_state;
      }
      if (prior !== record.lifecycle_state) findings.push('lifecycle_state_mismatch');
    }

    if (record.supersedes_evidence_id) {
      const predecessor = identities.get(record.supersedes_evidence_id);
      if (!predecessor || predecessor.superseded_by_evidence_id !== evidenceId || predecessor.subject_business_id !== record.subject_business_id) {
        findings.push('supersession_predecessor_invalid');
      }
    }
    if (record.superseded_by_evidence_id) {
      const successor = identities.get(record.superseded_by_evidence_id);
      if (!successor || successor.supersedes_evidence_id !== evidenceId || successor.subject_business_id !== record.subject_business_id) {
        findings.push('supersession_successor_invalid');
      }
    }
    for (const parentId of record.parent_evidence_ids) {
      if (!identities.has(parentId)) findings.push('parent_identity_missing');
    }
  }

  for (const link of links) {
    if (!identities.has(link.evidence_id)) findings.push('authorisation_identity_missing');
    if (!Object.values(LIFECYCLE_STATES).includes(link.lifecycle_state_at_decision)) findings.push('authorisation_snapshot_invalid');
  }

  if (options.requireBaseline !== false) {
    let state;
    let recordBaselines;
    let lifecycleBaselines;
    let authorisationBaselines;
    try {
      [state, recordBaselines, lifecycleBaselines, authorisationBaselines] = await Promise.all([
        dbQuery.get("SELECT * FROM evidence_identity_integrity_state WHERE store_id = 'EVIDENCE_IDENTITY'"),
        dbQuery.all('SELECT * FROM evidence_identity_record_baselines ORDER BY evidence_id'),
        dbQuery.all('SELECT * FROM evidence_identity_lifecycle_baselines ORDER BY event_digest'),
        dbQuery.all('SELECT * FROM evidence_identity_authorisation_baselines ORDER BY contract_id, evidence_id')
      ]);
    } catch (_) {
      findings.push('integrity_baseline_unavailable');
    }
    if (!state) {
      findings.push('integrity_baseline_missing');
    } else {
      if (state.identity_count !== identityRows.length) findings.push('identity_deletion_or_insertion_detected');
      if (state.lifecycle_event_count !== events.length) findings.push('lifecycle_deletion_or_insertion_detected');
      if (state.authorisation_link_count !== links.length) findings.push('authorisation_deletion_or_insertion_detected');

      const recordBaselineMap = new Map((recordBaselines || []).map(row => [row.evidence_id, row]));
      for (const record of identities.values()) {
        const baseline = recordBaselineMap.get(record.evidence_id);
        if (!baseline) findings.push('identity_baseline_missing');
        else {
          if (baseline.immutable_digest !== identityBaseline(record)) findings.push('identity_immutable_input_changed');
          if (baseline.provenance_record_id !== record.provenance_record_id) findings.push('provenance_link_changed');
        }
      }
      if (recordBaselineMap.size !== identities.size) findings.push('identity_baseline_orphaned');

      const eventDigests = new Set(events.map(lifecycleBaseline));
      const baselineEventDigests = new Set((lifecycleBaselines || []).map(row => row.event_digest));
      if (eventDigests.size !== events.length || baselineEventDigests.size !== events.length ||
          [...eventDigests].some(digest => !baselineEventDigests.has(digest))) {
        findings.push('lifecycle_history_rewritten');
      }

      const linkDigests = new Set(links.map(authorisationBaseline));
      const baselineLinkDigests = new Set((authorisationBaselines || []).map(row => row.snapshot_digest));
      if (linkDigests.size !== links.length || baselineLinkDigests.size !== links.length ||
          [...linkDigests].some(digest => !baselineLinkDigests.has(digest))) {
        findings.push('authorisation_snapshot_rewritten');
      }
    }
  }

  if (findings.length) throw integrityFailure(findings);
  return Object.freeze({
    status: 'VERIFIED',
    identity_count: identities.size,
    lifecycle_event_count: events.length,
    authorisation_link_count: links.length
  });
}

async function initialiseEvidenceIdentityIntegrity(dbQuery, initializedAt = new Date().toISOString()) {
  await dbQuery.exec(integritySchema);
  const state = await dbQuery.get("SELECT * FROM evidence_identity_integrity_state WHERE store_id = 'EVIDENCE_IDENTITY'");
  if (state) return verifyEvidenceIdentityIntegrity(dbQuery);

  // Existing stores are accepted as a bootstrap source only after all legacy
  // invariants have passed. The independent baselines are then established in
  // one transaction and become mandatory for every subsequent read/write.
  await verifyEvidenceIdentityIntegrity(dbQuery, {}, { requireBaseline: false });
  const [rows, events, links] = await Promise.all([
    dbQuery.all('SELECT * FROM evidence_identities ORDER BY evidence_id'),
    dbQuery.all('SELECT evidence_id, from_state, to_state, reason, responsible_authority, occurred_at FROM evidence_identity_lifecycle_events ORDER BY evidence_id, event_id'),
    dbQuery.all('SELECT contract_id, evidence_id, lifecycle_state_at_decision FROM evidence_authorisation_evidence_identities ORDER BY contract_id, evidence_id')
  ]);
  const statements = [];
  for (const row of rows) {
    const record = parseRecord(row);
    statements.push(`INSERT INTO evidence_identity_record_baselines (evidence_id, immutable_digest, provenance_record_id) VALUES (${sqlValue(record.evidence_id)}, ${sqlValue(identityBaseline(record))}, ${sqlValue(record.provenance_record_id)});`);
  }
  for (const event of events) statements.push(`INSERT INTO evidence_identity_lifecycle_baselines (event_digest, evidence_id) VALUES (${sqlValue(lifecycleBaseline(event))}, ${sqlValue(event.evidence_id)});`);
  for (const link of links) statements.push(`INSERT INTO evidence_identity_authorisation_baselines (contract_id, evidence_id, snapshot_digest) VALUES (${sqlValue(link.contract_id)}, ${sqlValue(link.evidence_id)}, ${sqlValue(authorisationBaseline(link))});`);
  statements.push(`INSERT INTO evidence_identity_integrity_state (store_id, identity_count, lifecycle_event_count, authorisation_link_count, initialized_at) VALUES ('EVIDENCE_IDENTITY', ${rows.length}, ${events.length}, ${links.length}, ${sqlValue(initializedAt)});`);
  await executeTransaction(dbQuery, `BEGIN IMMEDIATE;\n${statements.join('\n')}\nCOMMIT;`);
  return verifyEvidenceIdentityIntegrity(dbQuery);
}

async function executeTransaction(dbQuery, sql) {
  try {
    await dbQuery.exec(sql);
  } catch (error) {
    // The team-db adapter does not consistently roll back an explicit
    // transaction when a later statement fails. Always close the failed
    // transaction so partial identity or lifecycle mutations cannot remain.
    try {
      await dbQuery.exec('ROLLBACK;');
    } catch (_rollbackError) {
      // Preserve the originating database failure. A rollback error normally
      // means the adapter had already closed the transaction.
    }
    throw error;
  }
}

class EvidenceIdentityRepository {
  constructor(dbQuery, identityContext = {}, integrityGate) {
    if (!integrityGate || typeof integrityGate.verify !== 'function' || typeof integrityGate.attest !== 'function') {
      throw new EvidenceIdentityError('INTEGRITY_AUTHORITY_REQUIRED', 'Evidence Identity repository requires the independent integrity authority.');
    }
    this.dbQuery = dbQuery;
    this.identityContext = identityContext;
    this.integrityGate = integrityGate;
  }

  async verifyIndependentAuthority() {
    return this.integrityGate.verify(this.dbQuery);
  }

  async attestIndependentAuthority() {
    return this.integrityGate.attest(this.dbQuery);
  }

  async findById(evidenceId) {
    await this.verifyIndependentAuthority();
    return this.findByIdRaw(evidenceId);
  }

  async findByIdRaw(evidenceId) {
    return parseRecord(await this.dbQuery.get('SELECT * FROM evidence_identities WHERE evidence_id = ?', [evidenceId]));
  }

  async findByPayloadDigest(digest) {
    await this.verifyIndependentAuthority();
    return this.findByPayloadDigestRaw(digest);
  }

  async findByPayloadDigestRaw(digest) {
    return parseRecord(await this.dbQuery.get('SELECT * FROM evidence_identities WHERE canonical_payload_digest = ?', [digest]));
  }

  async lifecycleHistory(evidenceId) {
    await this.verifyIndependentAuthority();
    return this.lifecycleHistoryRaw(evidenceId);
  }

  async lifecycleHistoryRaw(evidenceId) {
    return this.dbQuery.all(
      'SELECT evidence_id, from_state, to_state, reason, responsible_authority, occurred_at FROM evidence_identity_lifecycle_events WHERE evidence_id = ? ORDER BY event_id',
      [evidenceId]
    );
  }

  async verifyIntegrity() {
    const local = await verifyEvidenceIdentityIntegrity(this.dbQuery, this.identityContext);
    const independent = await this.verifyIndependentAuthority();
    return Object.freeze({ ...local, independent_authority: independent });
  }

  async assertWriteBoundary() {
    return this.verifyIntegrity();
  }

  rejectCanonicalMutation() {
    throw new EvidenceIdentityError('IMMUTABLE_IDENTITY_MUTATION_REJECTED', 'Evidence Identity canonical inputs are immutable.');
  }

  rejectDeletion() {
    throw new EvidenceIdentityError('EVIDENCE_IDENTITY_DELETE_REJECTED', 'Issued Evidence Identities cannot be deleted.');
  }

  rejectLifecycleMutation() {
    throw new EvidenceIdentityError('LIFECYCLE_HISTORY_MUTATION_REJECTED', 'Evidence Identity lifecycle history is append-only.');
  }

  async updateCanonicalIdentity() {
    await this.assertWriteBoundary();
    return this.rejectCanonicalMutation();
  }

  async deleteIdentity() {
    await this.assertWriteBoundary();
    return this.rejectDeletion();
  }

  async updateLifecycleEvent() {
    await this.assertWriteBoundary();
    return this.rejectLifecycleMutation();
  }

  async deleteLifecycleEvent() {
    await this.assertWriteBoundary();
    return this.rejectLifecycleMutation();
  }

  async recordAuthorisationEvidence(contractId, snapshots) {
    await this.assertWriteBoundary();
    if (typeof contractId !== 'string' || !contractId || !Array.isArray(snapshots)) {
      throw new EvidenceIdentityError('AUTHORISATION_EVIDENCE_INVALID', 'A contract identity and Evidence Identity snapshots are required.');
    }
    for (const snapshot of snapshots) {
      const record = await this.findByIdRaw(snapshot.evidenceId);
      if (!record) throw new EvidenceIdentityError('IDENTITY_NOT_FOUND', `Evidence Identity ${snapshot.evidenceId} does not exist.`);
      if (record.lifecycle_state !== snapshot.lifecycleState) {
        throw new EvidenceIdentityError('EVIDENCE_LIFECYCLE_MISMATCH', 'Evidence lifecycle snapshot does not match the evaluated identity state.');
      }
    }
    if (snapshots.length === 0) return [];
    const statements = snapshots.map(snapshot => {
      const link = { contract_id: contractId, evidence_id: snapshot.evidenceId, lifecycle_state_at_decision: snapshot.lifecycleState };
      return `INSERT OR IGNORE INTO evidence_authorisation_evidence_identities
      (contract_id, evidence_id, lifecycle_state_at_decision) VALUES
      (${sqlValue(contractId)}, ${sqlValue(snapshot.evidenceId)}, ${sqlValue(snapshot.lifecycleState)});
      INSERT OR IGNORE INTO evidence_identity_authorisation_baselines (contract_id, evidence_id, snapshot_digest)
      VALUES (${sqlValue(contractId)}, ${sqlValue(snapshot.evidenceId)}, ${sqlValue(authorisationBaseline(link))});`;
    }).join('\n');
    await executeTransaction(this.dbQuery, `BEGIN IMMEDIATE;\n${statements}\nUPDATE evidence_identity_integrity_state SET authorisation_link_count = (SELECT COUNT(*) FROM evidence_authorisation_evidence_identities) WHERE store_id = 'EVIDENCE_IDENTITY';\nCOMMIT;`);
    await this.attestIndependentAuthority();
    await this.verifyIntegrity();
    return snapshots;
  }

  async issue(record, event) {
    await this.assertWriteBoundary();
    const existingById = await this.findByIdRaw(record.evidence_id);
    const existingByDigest = await this.findByPayloadDigestRaw(record.canonical_payload_digest);
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
      INSERT INTO evidence_identity_record_baselines (evidence_id, immutable_digest, provenance_record_id)
        VALUES (${sqlValue(record.evidence_id)}, ${sqlValue(identityBaseline(record))}, ${sqlValue(record.provenance_record_id)});
      INSERT INTO evidence_identity_lifecycle_events
        (evidence_id, from_state, to_state, reason, responsible_authority, occurred_at)
      VALUES (${sqlValue(record.evidence_id)}, NULL, ${sqlValue(LIFECYCLE_STATES.ACTIVE)}, ${sqlValue(event.reason)}, ${sqlValue(event.responsible_authority)}, ${sqlValue(event.occurred_at)});
      INSERT INTO evidence_identity_lifecycle_baselines (event_digest, evidence_id)
        VALUES (${sqlValue(lifecycleBaseline({ evidence_id: record.evidence_id, from_state: null, to_state: LIFECYCLE_STATES.ACTIVE, ...event }))}, ${sqlValue(record.evidence_id)});
      UPDATE evidence_identity_integrity_state SET identity_count = identity_count + 1, lifecycle_event_count = lifecycle_event_count + 1 WHERE store_id = 'EVIDENCE_IDENTITY';
      COMMIT;`;
    try {
      await executeTransaction(this.dbQuery, transaction);
    } catch (error) {
      // A concurrent identical issuance may win after the initial read. The
      // unique constraints remain authoritative; only exact identity reuse is
      // treated as idempotent success.
      const concurrent = await this.findByIdRaw(record.evidence_id);
      if (concurrent && concurrent.canonical_payload_digest === record.canonical_payload_digest) {
        return { record: concurrent, created: false };
      }
      throw error;
    }
    await this.attestIndependentAuthority();
    await this.verifyIntegrity();
    return { record, created: true };
  }

  async transition(evidenceId, toState, event) {
    await this.assertWriteBoundary();
    const current = await this.findByIdRaw(evidenceId);
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
      INSERT INTO evidence_identity_lifecycle_baselines (event_digest, evidence_id)
        VALUES (${sqlValue(lifecycleBaseline({ evidence_id: evidenceId, from_state: current.lifecycle_state, to_state: toState, ...event }))}, ${sqlValue(evidenceId)});
      UPDATE evidence_identity_integrity_state SET lifecycle_event_count = lifecycle_event_count + 1 WHERE store_id = 'EVIDENCE_IDENTITY';
      DROP TABLE _evidence_identity_transition_guard;
      COMMIT;`;
    await executeTransaction(this.dbQuery, transaction);
    await this.attestIndependentAuthority();
    await this.verifyIntegrity();
    return { ...current, lifecycle_state: toState };
  }

  async supersede(predecessorId, successorRecord, event) {
    await this.assertWriteBoundary();
    const predecessor = await this.findByIdRaw(predecessorId);
    if (!predecessor) throw new EvidenceIdentityError('IDENTITY_NOT_FOUND', 'Predecessor Evidence Identity does not exist.');
    assertLifecycleTransition(predecessor.lifecycle_state, LIFECYCLE_STATES.SUPERSEDED);
    if (predecessor.subject_business_id !== successorRecord.subject_business_id || predecessorId === successorRecord.evidence_id) {
      throw new EvidenceIdentityError('SUPERSESSION_INVALID', 'Supersession requires distinct identities for the same subject business.');
    }
    const successorExists = await this.findByIdRaw(successorRecord.evidence_id);
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
      INSERT INTO evidence_identity_record_baselines (evidence_id, immutable_digest, provenance_record_id)
        VALUES (${sqlValue(successor.evidence_id)}, ${sqlValue(identityBaseline(successor))}, ${sqlValue(successor.provenance_record_id)});
      INSERT INTO evidence_identity_lifecycle_events (evidence_id, from_state, to_state, reason, responsible_authority, occurred_at)
        VALUES (${sqlValue(predecessorId)}, ${sqlValue(LIFECYCLE_STATES.ACTIVE)}, ${sqlValue(LIFECYCLE_STATES.SUPERSEDED)}, ${sqlValue(event.reason)}, ${sqlValue(event.responsible_authority)}, ${sqlValue(event.occurred_at)});
      INSERT INTO evidence_identity_lifecycle_events (evidence_id, from_state, to_state, reason, responsible_authority, occurred_at)
        VALUES (${sqlValue(successor.evidence_id)}, NULL, ${sqlValue(LIFECYCLE_STATES.ACTIVE)}, ${sqlValue(event.reason)}, ${sqlValue(event.responsible_authority)}, ${sqlValue(event.occurred_at)});
      INSERT INTO evidence_identity_lifecycle_baselines (event_digest, evidence_id) VALUES
        (${sqlValue(lifecycleBaseline({ evidence_id: predecessorId, from_state: LIFECYCLE_STATES.ACTIVE, to_state: LIFECYCLE_STATES.SUPERSEDED, ...event }))}, ${sqlValue(predecessorId)}),
        (${sqlValue(lifecycleBaseline({ evidence_id: successor.evidence_id, from_state: null, to_state: LIFECYCLE_STATES.ACTIVE, ...event }))}, ${sqlValue(successor.evidence_id)});
      UPDATE evidence_identity_integrity_state SET identity_count = identity_count + 1, lifecycle_event_count = lifecycle_event_count + 2 WHERE store_id = 'EVIDENCE_IDENTITY';
      DROP TABLE _evidence_identity_supersession_guard;
      COMMIT;`;
    await executeTransaction(this.dbQuery, transaction);
    await this.attestIndependentAuthority();
    await this.verifyIntegrity();
    return successor;
  }
}

module.exports = {
  EvidenceIdentityRepository,
  verifyEvidenceIdentityIntegrity,
  initialiseEvidenceIdentityIntegrity,
  integritySchema,
  parseRecord,
  sqlValue
};
