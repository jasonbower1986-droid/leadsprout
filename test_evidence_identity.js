const assert = require('assert');
const crypto = require('crypto');
const sqlite3 = require('./backend/node_modules/sqlite3');
const {
  ITEM_KINDS,
  LIFECYCLE_STATES,
  canonicaliseIdentityInput,
  serializeCanonicalPayload,
  generateEvidenceId,
  validateEvidenceIdentity,
  normaliseWebLocator
} = require('./backend/utils/evidence-identity');
const { EvidenceIdentityRepository, integritySchema } = require('./backend/utils/evidence-identity-repository');
const { EvidenceIdentityService } = require('./backend/utils/evidence-identity-service');
const { createEvidenceIdentityObserver } = require('./backend/utils/evidence-identity-observability');
const { classifyLegacyEvidence, backfillLegacyEvidence } = require('./backend/utils/evidence-identity-backfill');
const { MANIFEST_VERSION, STORE_ID, canonicalJson, digest } = require('./backend/utils/evidence-integrity-authority');

function fixtureIntegrityGate() {
  let sequence = 0;
  return {
    async verify() { return Object.freeze({ status: 'VERIFIED', sequence }); },
    async attest() { sequence += 1; return Object.freeze({ checkpoint_id: `fixture-${sequence}`, sequence }); }
  };
}

function database() {
  const db = new sqlite3.Database(':memory:');
  return {
    db,
    exec(sql) { return new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve({ changes: 1 }))); },
    get(sql, params = []) { return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null))); },
    all(sql, params = []) { return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows))); },
    close() { return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())); }
  };
}

const schema = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE evidence_identities (
    evidence_id TEXT PRIMARY KEY, schema_version TEXT NOT NULL, standard_version INTEGER NOT NULL,
    item_kind TEXT NOT NULL, subject_business_id TEXT NOT NULL, source_namespace TEXT NOT NULL,
    source_locator TEXT NOT NULL, observed_at TEXT NOT NULL, content_sha256 TEXT NOT NULL,
    fragment_locator TEXT NOT NULL, parent_evidence_ids_json TEXT NOT NULL, derivation_profile TEXT NOT NULL,
    canonical_payload_digest TEXT NOT NULL UNIQUE, provenance_record_id TEXT NOT NULL,
    source_profile_version TEXT NOT NULL, derivation_profile_version TEXT, lifecycle_state TEXT NOT NULL,
    supersedes_evidence_id TEXT, superseded_by_evidence_id TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE evidence_identity_lifecycle_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT, evidence_id TEXT NOT NULL,
    from_state TEXT, to_state TEXT NOT NULL, reason TEXT NOT NULL,
    responsible_authority TEXT NOT NULL, occurred_at TEXT NOT NULL,
    FOREIGN KEY (evidence_id) REFERENCES evidence_identities(evidence_id)
  );
  CREATE TABLE evidence_authorisations (contract_id TEXT PRIMARY KEY);
  CREATE TABLE evidence_authorisation_evidence_identities (
    contract_id TEXT NOT NULL, evidence_id TEXT NOT NULL, lifecycle_state_at_decision TEXT NOT NULL,
    PRIMARY KEY (contract_id, evidence_id),
    FOREIGN KEY (contract_id) REFERENCES evidence_authorisations(contract_id) ON DELETE RESTRICT,
    FOREIGN KEY (evidence_id) REFERENCES evidence_identities(evidence_id) ON DELETE RESTRICT
  );
  ${integritySchema}
  INSERT INTO evidence_identity_integrity_state
    (store_id, identity_count, lifecycle_event_count, authorisation_link_count, initialized_at)
    VALUES ('EVIDENCE_IDENTITY', 0, 0, 0, '2026-07-17T00:00:00.000Z');`;

const vectorBytes = Buffer.from('LeadSprout evidence', 'utf8');
const vectorDigest = crypto.createHash('sha256').update(vectorBytes).digest('hex');
const vectorInput = {
  standard_version: 1,
  item_kind: ITEM_KINDS.SOURCE,
  source_namespace: 'web',
  subject_business_id: 'BUS-001',
  source_locator: 'https://example.com/',
  observed_at: '2026-07-17T10:15:30.000Z',
  content_sha256: vectorDigest,
  fragment_locator: '',
  parent_evidence_ids: [],
  derivation_profile: '',
  provenance_record_id: 'PROV-001'
};
const expectedId = 'EVI-1-GMIVNAM7YNKE7ROS74HXN3C6OXU7UNHCP4QWQZK4WYJ66MNDVIWQ';

function provenance(input, id = input.provenance_record_id) {
  return {
    provenance_record_id: id,
    subject_business_id: input.subject_business_id,
    source_namespace: input.source_namespace,
    source_locator: input.source_locator,
    observed_at: input.observed_at,
    content_sha256: input.content_sha256,
    source_profile_version: '1.0'
  };
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error && error.code === code);
}

async function main() {
  const canonical = canonicaliseIdentityInput(vectorInput);
  await test('normative content digest matches ENG-REF-001', () => assert.equal(vectorDigest, '353047021238dde1ccbd2d5ad09cb8021e289510456bde79a03d77ba8589e88f'));
  await test('normative payload uses exact field order and final LF', () => {
    const payload = serializeCanonicalPayload(canonical);
    assert(payload.endsWith('\n'));
    assert.equal(payload.split('\n')[0], 'standard_version=1');
    assert.equal(payload.split('\n')[9], 'derivation_profile=');
  });
  await test('normative vector produces exact Evidence Identity', () => assert.equal(generateEvidenceId(canonical), expectedId));
  await test('identifier is uppercase Base32 without padding', () => assert.match(expectedId, /^EVI-1-[A-Z2-7]{52}$/));
  await test('web locators normalise scheme, host, default port and fragment', () => {
    assert.equal(normaliseWebLocator('HTTPS://EXAMPLE.COM:443/a/../#private'), 'https://example.com/');
  });
  await test('web locators uppercase percent-encoding without reordering query parameters', () => {
    assert.equal(normaliseWebLocator('https://EXAMPLE.com/%7euser?z=2&a=1'), 'https://example.com/%7Euser?z=2&a=1');
  });
  await test('parent identifiers are deduplicated and sorted', () => {
    const value = canonicaliseIdentityInput({ ...vectorInput, item_kind: 'FRAGMENT', source_locator: '', fragment_locator: 'bytes:0-4', parent_evidence_ids: [expectedId, expectedId] });
    assert.deepEqual(value.parent_evidence_ids, [expectedId]);
  });
  await test('lowercase content digests are mandatory', () => assert.throws(() => canonicaliseIdentityInput({ ...vectorInput, content_sha256: vectorDigest.toUpperCase() }), /content_sha256/));
  await test('observation timestamps require exact millisecond UTC form', () => assert.throws(() => canonicaliseIdentityInput({ ...vectorInput, observed_at: '2026-07-17T10:15:30Z' }), /INVALID_OBSERVATION_TIME/));
  await test('unregistered namespaces fail closed', () => assert.throws(() => canonicaliseIdentityInput({ ...vectorInput, source_namespace: 'unknown' }), /source_profile_unregistered/));
  await test('unsupported standard versions fail closed', () => assert.throws(() => canonicaliseIdentityInput({ ...vectorInput, standard_version: 2 }), /standard_version/));
  await test('control characters in canonical text inputs fail closed', () => assert.throws(() => canonicaliseIdentityInput({ ...vectorInput, subject_business_id: 'BUS-001\n' }), /control_character/));
  await test('SOURCE rejects parent and derivation fields', () => assert.throws(() => canonicaliseIdentityInput({ ...vectorInput, parent_evidence_ids: [expectedId] }), /source_relationship_fields/));
  await test('FRAGMENT requires exactly one parent', () => assert.throws(() => canonicaliseIdentityInput({ ...vectorInput, item_kind: 'FRAGMENT', source_locator: '', fragment_locator: 'bytes:0-1' }), /fragment_parent_count/));
  await test('DERIVED rejects unregistered derivation profiles', () => assert.throws(() => canonicaliseIdentityInput({ ...vectorInput, item_kind: 'DERIVED', source_locator: '', parent_evidence_ids: [expectedId], derivation_profile: 'unknown/1' }), /derivation_profile_unregistered/));

  const adapter = database();
  await adapter.exec(schema);
  const identityContext = { derivationProfiles: { 'aggregate.sha256/1.0': { id: 'aggregate.sha256/1.0', version: '1.0', active: true } } };
  const repository = new EvidenceIdentityRepository(adapter, identityContext, fixtureIntegrityGate());
  const provenanceRecords = new Map([['PROV-001', provenance(vectorInput)]]);
  const events = [];
  const observer = createEvidenceIdentityObserver((label, event) => events.push({ label, event }));
  let tick = 0;
  const service = new EvidenceIdentityService({
    repository,
    provenanceResolver: async id => provenanceRecords.get(id) || null,
    businessIdentityResolver: async id => id === 'BUS-001',
    observer,
    clock: () => `2026-07-17T11:00:0${tick++}.000Z`
  });

  await test('empty persistence baseline passes integrity verification', async () => {
    const result = await repository.verifyIntegrity();
    assert.equal(result.status, 'VERIFIED');
    assert.equal(result.identity_count, 0);
  });

  const first = await service.issue(vectorInput, { evidenceBytes: vectorBytes, correlation_id: 'COR-1', responsible_authority: 'fixture' });
  await test('issuance persists an ACTIVE immutable identity', () => {
    assert.equal(first.created, true);
    assert.equal(first.record.evidence_id, expectedId);
    assert.equal(first.record.lifecycle_state, LIFECYCLE_STATES.ACTIVE);
  });
  await test('repeated canonical issuance is idempotent', async () => {
    const repeated = await service.issue(vectorInput, { evidenceBytes: vectorBytes, correlation_id: 'COR-2' });
    assert.equal(repeated.created, false);
    assert.equal(repeated.record.evidence_id, expectedId);
  });
  await test('identity and initial lifecycle event persist atomically', async () => {
    const history = await repository.lifecycleHistory(expectedId);
    assert.equal(history.length, 1);
    assert.equal(history[0].to_state, LIFECYCLE_STATES.ACTIVE);
  });
  await test('historical reconstruction recalculates identity', async () => {
    const reconstructed = await service.read(expectedId);
    assert.equal(validateEvidenceIdentity(reconstructed).valid, true);
    assert.equal(reconstructed.lifecycle_event_history.length, 1);
  });
  await test('internal read contract protects source locator by default', async () => {
    const contract = await service.readContract(expectedId);
    assert.equal(contract.source_locator, null);
    assert.equal(contract.evidence_id, expectedId);
    assert.equal(Object.hasOwn(contract, 'canonical_payload_digest'), false);
  });
  await test('internal read contract exposes source locator only with authority', async () => {
    const contract = await service.readContract(expectedId, { allowSourceLocator: true });
    assert.equal(contract.source_locator, 'https://example.com/');
  });
  const fragmentBytes = Buffer.from('Lead', 'utf8');
  const fragmentInput = {
    ...vectorInput,
    item_kind: ITEM_KINDS.FRAGMENT,
    source_locator: '',
    content_sha256: crypto.createHash('sha256').update(fragmentBytes).digest('hex'),
    fragment_locator: 'utf8-bytes:0-4',
    parent_evidence_ids: [expectedId],
    provenance_record_id: 'PROV-FRAGMENT'
  };
  provenanceRecords.set('PROV-FRAGMENT', provenance(fragmentInput));
  await test('FRAGMENT issuance preserves its exact parent and observation time', async () => {
    const fragment = await service.issue(fragmentInput, { evidenceBytes: fragmentBytes });
    assert.deepEqual(fragment.record.parent_evidence_ids, [expectedId]);
    assert.equal(fragment.record.observed_at, vectorInput.observed_at);
  });
  await test('FRAGMENT issuance rejects an observation time different from its parent', async () => {
    const invalid = { ...fragmentInput, observed_at: '2026-07-17T10:15:31.000Z', provenance_record_id: 'PROV-FRAGMENT-LATE' };
    provenanceRecords.set('PROV-FRAGMENT-LATE', provenance(invalid));
    await expectCode(service.issue(invalid, { evidenceBytes: fragmentBytes }), 'FRAGMENT_OBSERVATION_MISMATCH');
  });
  const derivedRepository = new EvidenceIdentityRepository(adapter, identityContext, fixtureIntegrityGate());
  const derivedService = new EvidenceIdentityService({
    repository: derivedRepository,
    provenanceResolver: async id => provenanceRecords.get(id) || null,
    businessIdentityResolver: async id => id === 'BUS-001',
    observer,
    identityContext
  });
  const derivedBytes = Buffer.from('derived LeadSprout evidence', 'utf8');
  const derivedInput = {
    ...vectorInput,
    item_kind: ITEM_KINDS.DERIVED,
    source_locator: '',
    content_sha256: crypto.createHash('sha256').update(derivedBytes).digest('hex'),
    parent_evidence_ids: [expectedId],
    derivation_profile: 'aggregate.sha256/1.0',
    provenance_record_id: 'PROV-DERIVED'
  };
  provenanceRecords.set('PROV-DERIVED', { ...provenance(derivedInput), derivation_profile_version: '1.0' });
  await test('registered deterministic DERIVED evidence preserves profile and parent identity', async () => {
    const derived = await derivedService.issue(derivedInput, { evidenceBytes: derivedBytes });
    assert.equal(derived.record.derivation_profile_version, '1.0');
    assert.deepEqual(derived.record.parent_evidence_ids, [expectedId]);
  });
  await test('exact evidence bytes are mandatory', () => expectCode(service.issue({ ...vectorInput, provenance_record_id: 'PROV-001' }, { correlation_id: 'COR-3' }), 'EVIDENCE_BYTES_MISSING'));
  await test('content digest mismatch fails closed', () => expectCode(service.issue(vectorInput, { evidenceBytes: Buffer.from('different') }), 'CONTENT_DIGEST_MISMATCH'));
  await test('fail-closed errors retain their correlation reference', async () => {
    await assert.rejects(service.issue(vectorInput, { evidenceBytes: Buffer.from('different'), correlation_id: 'COR-FAIL' }), error => {
      assert.equal(error.code, 'CONTENT_DIGEST_MISMATCH');
      assert.equal(error.correlation_id, 'COR-FAIL');
      return true;
    });
  });
  await test('missing provenance fails closed', () => expectCode(service.issue({ ...vectorInput, provenance_record_id: 'PROV-MISSING' }, { evidenceBytes: vectorBytes }), 'PROVENANCE_MISSING'));
  await test('unresolved business identity fails closed', async () => {
    const input = { ...vectorInput, subject_business_id: 'BUS-UNKNOWN', provenance_record_id: 'PROV-UNKNOWN' };
    provenanceRecords.set('PROV-UNKNOWN', provenance(input));
    await expectCode(service.issue(input, { evidenceBytes: vectorBytes }), 'SUBJECT_BUSINESS_UNRESOLVED');
  });
  await test('provenance mismatch fails closed', async () => {
    provenanceRecords.set('PROV-BAD', { ...provenance(vectorInput, 'PROV-BAD'), source_locator: 'https://other.example/' });
    await expectCode(service.issue({ ...vectorInput, provenance_record_id: 'PROV-BAD' }, { evidenceBytes: vectorBytes }), 'PROVENANCE_MISMATCH');
  });
  await test('observability excludes raw evidence and protected payloads', () => {
    const serialized = JSON.stringify(events);
    assert(!serialized.includes('LeadSprout evidence'));
    assert(!serialized.includes('content_sha256'));
    assert(events.some(item => item.event.event === 'identity_issued'));
    assert(events.some(item => item.event.event === 'existing_identity_returned'));
  });
  await test('metrics distinguish issuance, reuse and validation failure categories', async () => {
    const metrics = observer.metricSnapshot();
    assert(metrics['identity_issued:ISSUED'] >= 1);
    assert.equal(metrics['existing_identity_returned:IDEMPOTENT_REUSE'], 1);
    assert(Object.keys(metrics).some(key => key.startsWith('identity_validation_failed:')));
  });
  await test('claim validation accepts authorised same-subject ACTIVE evidence', async () => {
    const result = await service.validateClaimEvidence([expectedId], { subjectBusinessId: 'BUS-001', authorisedEvidenceIds: [expectedId] });
    assert.equal(result.valid, true);
  });
  await test('claim validation rejects unapproved local references', async () => {
    const result = await service.validateClaimEvidence(['local-key'], { subjectBusinessId: 'BUS-001', authorisedEvidenceIds: [] });
    assert.equal(result.valid, false);
    assert(result.errors.includes('evidence_id_malformed'));
  });
  await test('claim validation rejects evidence outside the authorisation snapshot', async () => {
    const result = await service.validateClaimEvidence([expectedId], { subjectBusinessId: 'BUS-001', authorisedEvidenceIds: [] });
    assert(result.errors.includes('evidence_not_authorised'));
  });
  await adapter.exec("INSERT INTO evidence_authorisations (contract_id) VALUES ('EAC-001');");
  await test('Evidence Authorisation persists exact identity and lifecycle snapshots', async () => {
    await repository.recordAuthorisationEvidence('EAC-001', [{ evidenceId: expectedId, lifecycleState: 'ACTIVE' }]);
    const links = await adapter.all('SELECT * FROM evidence_authorisation_evidence_identities');
    assert.deepEqual(links, [{ contract_id: 'EAC-001', evidence_id: expectedId, lifecycle_state_at_decision: 'ACTIVE' }]);
  });
  await test('supported deletion route rejects before state changes', async () => {
    const before = await adapter.all('SELECT * FROM evidence_identities ORDER BY evidence_id');
    await expectCode(repository.deleteIdentity(expectedId), 'EVIDENCE_IDENTITY_DELETE_REJECTED');
    assert.deepEqual(await adapter.all('SELECT * FROM evidence_identities ORDER BY evidence_id'), before);
  });
  await test('supported canonical mutation route rejects before state changes', async () => {
    const before = await repository.findById(expectedId);
    await expectCode(repository.updateCanonicalIdentity(expectedId, { subject_business_id: 'BUS-TAMPERED' }), 'IMMUTABLE_IDENTITY_MUTATION_REJECTED');
    assert.deepEqual(await repository.findById(expectedId), before);
  });
  await test('supported lifecycle update and deletion routes reject before state changes', async () => {
    const before = await repository.lifecycleHistory(expectedId);
    await expectCode(repository.updateLifecycleEvent(1, {}), 'LIFECYCLE_HISTORY_MUTATION_REJECTED');
    await expectCode(repository.deleteLifecycleEvent(1), 'LIFECYCLE_HISTORY_MUTATION_REJECTED');
    assert.deepEqual(await repository.lifecycleHistory(expectedId), before);
  });

  const successorBytes = Buffer.from('LeadSprout evidence updated', 'utf8');
  const successorInput = {
    ...vectorInput,
    observed_at: '2026-07-17T12:00:00.000Z',
    content_sha256: crypto.createHash('sha256').update(successorBytes).digest('hex'),
    provenance_record_id: 'PROV-002'
  };
  provenanceRecords.set('PROV-002', provenance(successorInput));
  const successor = await service.supersede(expectedId, successorInput, { evidenceBytes: successorBytes, responsible_authority: 'fixture' });
  await test('supersession creates a distinct successor identity', () => assert.notEqual(successor.evidence_id, expectedId));
  await test('supersession atomically links predecessor and successor', async () => {
    const predecessor = await repository.findById(expectedId);
    const storedSuccessor = await repository.findById(successor.evidence_id);
    assert.equal(predecessor.lifecycle_state, LIFECYCLE_STATES.SUPERSEDED);
    assert.equal(predecessor.superseded_by_evidence_id, successor.evidence_id);
    assert.equal(storedSuccessor.supersedes_evidence_id, expectedId);
  });
  await test('superseded identity remains historically reconstructable', async () => {
    const reconstructed = await service.read(expectedId);
    assert.equal(reconstructed.lifecycle_state, LIFECYCLE_STATES.SUPERSEDED);
    assert.equal(reconstructed.superseded_by_evidence_id, successor.evidence_id);
  });
  await test('SUPERSEDED evidence may transition to INVALIDATED', async () => {
    const invalidated = await service.transition(expectedId, LIFECYCLE_STATES.INVALIDATED, { responsible_authority: 'fixture', reason: 'Provenance withdrawn.' });
    assert.equal(invalidated.lifecycle_state, LIFECYCLE_STATES.INVALIDATED);
  });
  await test('INVALIDATED lifecycle is terminal', () => expectCode(service.transition(expectedId, LIFECYCLE_STATES.SUPERSEDED), 'INVALID_LIFECYCLE_TRANSITION'));
  await test('invalidated evidence is rejected for new claims', async () => {
    const result = await service.validateClaimEvidence([expectedId], { subjectBusinessId: 'BUS-001', authorisedEvidenceIds: [expectedId] });
    assert(result.errors.includes('evidence_id_invalidated'));
  });
  await test('lifecycle history remains append-only', async () => {
    const history = await repository.lifecycleHistory(expectedId);
    assert.deepEqual(history.map(event => event.to_state), ['ACTIVE', 'SUPERSEDED', 'INVALIDATED']);
  });
  await test('legacy evidence without canonical inputs remains explicitly unmapped', () => {
    const result = classifyLegacyEvidence({ legacy_reference: 'legacy-1', source_locator: 'https://example.com/' });
    assert.equal(result.status, 'UNMAPPED_LEGACY_EVIDENCE');
    assert(result.missing.includes('evidence_bytes'));
  });
  await test('controlled backfill never infers missing legacy identity inputs', async () => {
    const result = await backfillLegacyEvidence([{ legacy_reference: 'legacy-1' }], service);
    assert.equal(result[0].status, 'UNMAPPED_LEGACY_EVIDENCE');
  });
  await test('complete legacy evidence passes through canonical validation', async () => {
    const result = await backfillLegacyEvidence([{ ...successorInput, evidence_bytes: successorBytes, legacy_reference: 'legacy-2' }], service);
    assert.equal(result[0].status, 'EXISTING');
    assert.equal(result[0].evidence_id, successor.evidence_id);
  });
  await test('rollback mode disables new issuance while preserving historical reads', async () => {
    const rollbackService = new EvidenceIdentityService({
      repository,
      provenanceResolver: async id => provenanceRecords.get(id) || null,
      businessIdentityResolver: async id => id === 'BUS-001',
      observer,
      issuanceEnabled: false
    });
    await expectCode(rollbackService.issue(successorInput, { evidenceBytes: successorBytes }), 'ISSUANCE_DISABLED');
    const historical = await rollbackService.read(successor.evidence_id);
    assert.equal(historical.evidence_id, successor.evidence_id);
  });

  await test('post-operation integrity verification confirms reconstructability', async () => {
    const result = await repository.verifyIntegrity();
    assert.equal(result.status, 'VERIFIED');
    assert(result.identity_count >= 3);
    assert(result.lifecycle_event_count >= result.identity_count);
  });

  await adapter.close();

  await test('concurrent identical issuance remains idempotent and unique', async () => {
    const concurrentAdapter = database();
    await concurrentAdapter.exec(schema);
    const concurrentRepository = new EvidenceIdentityRepository(concurrentAdapter, {}, fixtureIntegrityGate());
    const concurrentService = new EvidenceIdentityService({
      repository: concurrentRepository,
      provenanceResolver: async () => provenance(vectorInput),
      businessIdentityResolver: async () => true,
      clock: () => '2026-07-17T13:00:00.000Z'
    });
    const results = await Promise.all([
      concurrentService.issue(vectorInput, { evidenceBytes: vectorBytes }),
      concurrentService.issue(vectorInput, { evidenceBytes: vectorBytes })
    ]);
    assert.equal(results.filter(result => result.created).length, 1);
    const rows = await concurrentAdapter.all('SELECT evidence_id FROM evidence_identities');
    assert.deepEqual(rows, [{ evidence_id: expectedId }]);
    await concurrentAdapter.close();
  });

  await test('injected transaction failure leaves no partial identity or lifecycle state', async () => {
    const failureAdapter = database();
    await failureAdapter.exec(schema);
    const originalExec = failureAdapter.exec;
    failureAdapter.exec = async sql => {
      if (sql.includes('INSERT INTO evidence_identities')) throw new Error('injected_transaction_failure');
      return originalExec.call(failureAdapter, sql);
    };
    const failureRepository = new EvidenceIdentityRepository(failureAdapter, {}, fixtureIntegrityGate());
    const failureService = new EvidenceIdentityService({
      repository: failureRepository,
      provenanceResolver: async () => provenance(vectorInput),
      businessIdentityResolver: async () => true,
      clock: () => '2026-07-17T13:30:00.000Z'
    });
    await assert.rejects(failureService.issue(vectorInput, { evidenceBytes: vectorBytes }), /injected_transaction_failure/);
    assert.equal((await failureAdapter.all('SELECT * FROM evidence_identities')).length, 0);
    assert.equal((await failureAdapter.all('SELECT * FROM evidence_identity_lifecycle_events')).length, 0);
    await failureAdapter.close();
  });

  await test('injected supersession failure rolls back predecessor, successor and lifecycle changes', async () => {
    const failureAdapter = database();
    await failureAdapter.exec(schema);
    const failureRepository = new EvidenceIdentityRepository(failureAdapter, {}, fixtureIntegrityGate());
    const failureService = new EvidenceIdentityService({
      repository: failureRepository,
      provenanceResolver: async id => id === 'PROV-002' ? provenance(successorInput) : provenance(vectorInput),
      businessIdentityResolver: async () => true,
      clock: () => '2026-07-17T13:40:00.000Z'
    });
    await failureService.issue(vectorInput, { evidenceBytes: vectorBytes });
    const originalExec = failureAdapter.exec;
    failureAdapter.exec = async sql => originalExec.call(
      failureAdapter,
      sql.includes('_evidence_identity_supersession_guard')
        ? sql.replace('INSERT INTO evidence_identity_record_baselines', 'INSERT INTO missing_injected_table')
        : sql
    );
    await assert.rejects(
      failureService.supersede(expectedId, successorInput, { evidenceBytes: successorBytes }),
      /missing_injected_table/
    );
    const predecessor = await failureRepository.findById(expectedId);
    assert.equal(predecessor.lifecycle_state, LIFECYCLE_STATES.ACTIVE);
    assert.equal(predecessor.superseded_by_evidence_id, null);
    assert.equal(await failureRepository.findById(generateEvidenceId(canonicaliseIdentityInput(successorInput))), null);
    assert.equal((await failureRepository.lifecycleHistory(expectedId)).length, 1);
    await failureRepository.verifyIntegrity();
    await failureAdapter.close();
  });

  await test('concurrent supersession permits one atomic winner without split ownership', async () => {
    const concurrentAdapter = database();
    await concurrentAdapter.exec(schema);
    const concurrentRepository = new EvidenceIdentityRepository(concurrentAdapter, {}, fixtureIntegrityGate());
    const thirdBytes = Buffer.from('LeadSprout evidence third', 'utf8');
    const thirdInput = {
      ...successorInput,
      observed_at: '2026-07-17T12:01:00.000Z',
      content_sha256: crypto.createHash('sha256').update(thirdBytes).digest('hex'),
      provenance_record_id: 'PROV-003'
    };
    const concurrentService = new EvidenceIdentityService({
      repository: concurrentRepository,
      provenanceResolver: async id => id === 'PROV-002' ? provenance(successorInput) : id === 'PROV-003' ? provenance(thirdInput) : provenance(vectorInput),
      businessIdentityResolver: async () => true,
      clock: () => '2026-07-17T13:50:00.000Z'
    });
    await concurrentService.issue(vectorInput, { evidenceBytes: vectorBytes });
    const outcomes = await Promise.allSettled([
      concurrentService.supersede(expectedId, successorInput, { evidenceBytes: successorBytes }),
      concurrentService.supersede(expectedId, thirdInput, { evidenceBytes: thirdBytes })
    ]);
    assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(item => item.status === 'rejected').length, 1);
    const predecessor = await concurrentRepository.findById(expectedId);
    const identities = await concurrentAdapter.all('SELECT evidence_id, supersedes_evidence_id FROM evidence_identities ORDER BY evidence_id');
    assert.equal(identities.length, 2);
    assert.equal(identities.filter(item => item.supersedes_evidence_id === expectedId).length, 1);
    assert.equal(predecessor.lifecycle_state, LIFECYCLE_STATES.SUPERSEDED);
    assert.equal(predecessor.superseded_by_evidence_id, identities.find(item => item.supersedes_evidence_id === expectedId).evidence_id);
    await concurrentRepository.verifyIntegrity();
    await concurrentAdapter.close();
  });

  await test('out-of-band canonical tampering is detected and blocks the next write', async () => {
    const tamperAdapter = database();
    await tamperAdapter.exec(schema);
    const tamperRepository = new EvidenceIdentityRepository(tamperAdapter, {}, fixtureIntegrityGate());
    const tamperService = new EvidenceIdentityService({
      repository: tamperRepository,
      provenanceResolver: async () => provenance(vectorInput),
      businessIdentityResolver: async () => true,
      clock: () => '2026-07-17T14:00:00.000Z'
    });
    await tamperService.issue(vectorInput, { evidenceBytes: vectorBytes });
    await tamperAdapter.exec(`UPDATE evidence_identities SET subject_business_id = 'BUS-TAMPERED' WHERE evidence_id = '${expectedId}';`);
    await expectCode(tamperRepository.verifyIntegrity(), 'PERSISTENCE_INTEGRITY_VIOLATION');
    await expectCode(tamperService.issue(vectorInput, { evidenceBytes: vectorBytes }), 'PERSISTENCE_INTEGRITY_VIOLATION');
    await tamperAdapter.close();
  });

  await test('out-of-band coherent deletion is distinguished from an empty valid store', async () => {
    const deletionAdapter = database();
    await deletionAdapter.exec(schema);
    const deletionRepository = new EvidenceIdentityRepository(deletionAdapter, {}, fixtureIntegrityGate());
    const deletionService = new EvidenceIdentityService({
      repository: deletionRepository,
      provenanceResolver: async () => provenance(vectorInput),
      businessIdentityResolver: async () => true,
      clock: () => '2026-07-17T14:10:00.000Z'
    });
    await deletionService.issue(vectorInput, { evidenceBytes: vectorBytes });
    await deletionAdapter.exec('PRAGMA foreign_keys = OFF; DELETE FROM evidence_identity_lifecycle_events; DELETE FROM evidence_identities; PRAGMA foreign_keys = ON;');
    await assert.rejects(
      deletionRepository.verifyIntegrity(),
      error => error && error.code === 'PERSISTENCE_INTEGRITY_VIOLATION' && error.details.includes('identity_deletion_or_insertion_detected')
    );
    await deletionAdapter.close();
  });

  await test('production database initialisation uses team-db without CREATE TRIGGER', async () => {
    const childProcess = require('child_process');
    const originalSpawnSync = childProcess.spawnSync;
    const databaseModulePath = require.resolve('./backend/database');
    const calls = [];
    let integrityStateCreated = false;
    childProcess.spawnSync = (command, args) => {
      calls.push({ command, sql: args[0] });
      if (args[0].startsWith('ALTER TABLE leads')) {
        return { status: 1, stdout: '', stderr: 'duplicate column name: evidence_state' };
      }
      if (args[0].includes('INSERT INTO evidence_identity_integrity_state')) {
        integrityStateCreated = true;
      }
      if (args[0].includes('SELECT * FROM evidence_identity_integrity_state')) {
        return {
          status: 0,
          stdout: JSON.stringify(integrityStateCreated ? [{
            singleton: 1,
            identity_count: 0,
            lifecycle_event_count: 0,
            authorisation_link_count: 0
          }] : []),
          stderr: ''
        };
      }
      return { status: 0, stdout: '[]', stderr: '' };
    };
    delete require.cache[databaseModulePath];
    try {
      const { initializeSchema } = require('./backend/database');
      const pair = crypto.generateKeyPairSync('ed25519');
      const manifest = {
        manifest_version: MANIFEST_VERSION,
        store_id: STORE_ID,
        schema_contract: 'ENG-REF-001/1.0',
        previous_checkpoint_id: null,
        identities: [], lifecycle: [], authorisations: [], provenance: [],
        counts: { identities: 0, lifecycle: 0, authorisations: 0 }
      };
      const manifestDigest = digest(manifest);
      const genesisBody = {
        store_id: STORE_ID, manifest_digest: manifestDigest, key_id: 'production-fixture-key',
        write_quiesced: true, engineering_baseline_verified: true,
        environment: 'production-fixture', repository_revision: 'fixture-revision',
        authority_time: '2026-07-18T08:00:00.000Z'
      };
      const genesisAuthorization = {
        ...genesisBody,
        signature: crypto.sign(null, Buffer.from(canonicalJson(genesisBody)), pair.privateKey).toString('base64')
      };
      const attestationBody = {
        checkpoint_id: 'production-fixture-genesis', store_id: STORE_ID,
        manifest_version: MANIFEST_VERSION, manifest_digest: manifestDigest,
        previous_checkpoint_id: null, sequence: 1, authority_time: '2026-07-18T08:00:00.000Z',
        key_id: 'production-fixture-key', genesis_authorization: genesisAuthorization, key_transition: null
      };
      const attestation = {
        ...attestationBody,
        signature: crypto.sign(null, Buffer.from(canonicalJson(attestationBody)), pair.privateKey).toString('base64')
      };
      const authority = {
        latest: async () => attestation,
        publicKey: async id => id === 'production-fixture-key' ? pair.publicKey : null,
        attest: async () => { throw new Error('fixture does not write'); }
      };
      await initializeSchema({
        authority,
        provenanceResolver: { resolve: async () => null },
        now: () => Date.parse('2026-07-18T08:00:01.000Z')
      });
      assert(calls.length > 0);
      assert(calls.every(call => call.command === 'team-db'));
      assert(calls.every(call => !call.sql.includes('CREATE TRIGGER')));
      assert(calls.some(call => call.sql.includes('CREATE TABLE IF NOT EXISTS evidence_identities')));
    } finally {
      childProcess.spawnSync = originalSpawnSync;
      delete require.cache[databaseModulePath];
    }
  });
  console.log(`\n${passed} canonical Evidence Identity tests passed.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
