const assert = require('assert');
const crypto = require('crypto');
const sqlite3 = require('./backend/node_modules/sqlite3');
const { createEvidenceIdentityRecord, EvidenceIdentityError } = require('./backend/utils/evidence-identity');
const { EvidenceIdentityRepository, integritySchema } = require('./backend/utils/evidence-identity-repository');
const {
  MANIFEST_VERSION, STORE_ID, canonicalJson, digest, IndependentEvidenceIntegrityGate
} = require('./backend/utils/evidence-integrity-authority');

function database() {
  const db = new sqlite3.Database(':memory:');
  return {
    run(sql, params = []) { return new Promise((resolve, reject) => db.run(sql, params, function (error) {
      if (error) reject(error); else resolve({ lastID: this.lastID, changes: this.changes });
    })); },
    get(sql, params = []) { return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null))); },
    all(sql, params = []) { return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows))); },
    exec(sql) { return new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve())); },
    close() { return new Promise(resolve => db.close(resolve)); }
  };
}

class TestAuthority {
  constructor(now) {
    this.now = now;
    this.attestations = [];
    this.keys = new Map();
    this.rotate('key-1');
  }
  rotate(id) {
    const pair = crypto.generateKeyPairSync('ed25519');
    this.keyId = id;
    this.privateKey = pair.privateKey;
    this.keys.set(id, pair.publicKey);
  }
  async latest() { return this.attestations.at(-1) || null; }
  async checkpoint(id) { return this.attestations.find(item => item.checkpoint_id === id) || null; }
  async publicKey(id) { return this.keys.get(id); }
  async attest({ manifest, manifest_digest, previous_checkpoint_id }) {
    const sequence = this.attestations.length + 1;
    const body = {
      checkpoint_id: `checkpoint-${sequence}`, store_id: STORE_ID,
      manifest_version: MANIFEST_VERSION, manifest_digest, previous_checkpoint_id,
      sequence, authority_time: new Date(this.now()).toISOString(), key_id: this.keyId,
      genesis_authorised: sequence === 1
    };
    body.signature = crypto.sign(null, Buffer.from(canonicalJson(body)), this.privateKey).toString('base64');
    this.attestations.push(Object.freeze(body));
    return body;
  }
}

function provenanceRecord() {
  return {
    provenance_record_id: 'PRV-001', subject_business_id: 'BUS-001', source_namespace: 'web',
    source_locator: 'https://example.com/', observed_at: '2026-07-18T08:00:00.000Z',
    content_sha256: crypto.createHash('sha256').update('evidence').digest('hex'),
    source_profile_version: '1.0', derivation_profile_version: null
  };
}

function record(provenance) {
  return createEvidenceIdentityRecord({
    standard_version: 1, item_kind: 'SOURCE', subject_business_id: provenance.subject_business_id,
    source_namespace: provenance.source_namespace, source_locator: provenance.source_locator,
    observed_at: provenance.observed_at, content_sha256: provenance.content_sha256,
    provenance_record_id: provenance.provenance_record_id
  }, { provenanceRecord: provenance, businessIdentityResolved: true, parentRecords: [] },
  { createdAt: '2026-07-18T08:00:01.000Z' });
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error instanceof EvidenceIdentityError && error.code === code);
}

async function setup(now = Date.parse('2026-07-18T08:00:02.000Z')) {
  const db = database();
  await db.exec(`PRAGMA foreign_keys = ON;
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
      responsible_authority TEXT NOT NULL, occurred_at TEXT NOT NULL
    );
    CREATE TABLE evidence_authorisations (contract_id TEXT PRIMARY KEY);
    CREATE TABLE evidence_authorisation_evidence_identities (
      contract_id TEXT NOT NULL, evidence_id TEXT NOT NULL, lifecycle_state_at_decision TEXT NOT NULL,
      PRIMARY KEY (contract_id, evidence_id));
    ${integritySchema}
    INSERT INTO evidence_identity_integrity_state
      (store_id, identity_count, lifecycle_event_count, authorisation_link_count, initialized_at)
      VALUES ('EVIDENCE_IDENTITY', 0, 0, 0, '2026-07-18T08:00:00.000Z');`);
  const provenance = provenanceRecord();
  const resolver = { async resolve(id) { return id === provenance.provenance_record_id ? { ...provenance } : null; } };
  const authority = new TestAuthority(() => now);
  const gate = new IndependentEvidenceIntegrityGate({ authority, provenanceResolver: resolver, now: () => now });
  return { db, provenance, resolver, authority, gate, now };
}

async function run() {
  const context = await setup();
  const { db, provenance, authority, gate } = context;
  const repository = new EvidenceIdentityRepository(db, {}, gate);

  await gate.attest(db); // controlled, explicit genesis checkpoint
  assert.strictEqual((await gate.verify(db)).sequence, 1);
  const emptyGolden = digest(await gate.manifest(db, null));
  assert.strictEqual(emptyGolden, '16ce9c0b25c6c93989f8786f308bcb9211bc0ec5374a44898e02b00157cbc791');

  const issued = record(provenance);
  await repository.issue(issued, {
    reason: 'Fixture issuance.', responsible_authority: 'test', occurred_at: '2026-07-18T08:00:01.000Z'
  });
  assert.strictEqual((await gate.verify(db)).sequence, 2);
  assert.strictEqual((await repository.findById(issued.evidence_id)).evidence_id, issued.evidence_id);

  // A coordinated rewrite of the protected row and its local baseline still fails independently.
  await db.run('UPDATE evidence_identities SET source_locator = ? WHERE evidence_id = ?', ['https://attacker.invalid/', issued.evidence_id]);
  await expectCode(gate.verify(db), 'PROVENANCE_AUTHORITY_MISMATCH');
  await db.run('UPDATE evidence_identities SET source_locator = ? WHERE evidence_id = ?', [provenance.source_locator, issued.evidence_id]);

  const validLatest = authority.attestations.at(-1);
  authority.attestations[authority.attestations.length - 1] = { ...validLatest, signature: Buffer.alloc(64).toString('base64') };
  await expectCode(gate.verify(db), 'INTEGRITY_ATTESTATION_SIGNATURE_INVALID');
  authority.attestations[authority.attestations.length - 1] = validLatest;

  authority.attestations[authority.attestations.length - 1] = { ...validLatest, sequence: validLatest.sequence + 2 };
  await expectCode(gate.verify(db), 'INTEGRITY_ATTESTATION_SEQUENCE_INVALID');
  authority.attestations[authority.attestations.length - 1] = validLatest;

  const originalKey = authority.keys.get(validLatest.key_id);
  const wrongKey = crypto.generateKeyPairSync('ed25519').publicKey;
  authority.keys.set(validLatest.key_id, wrongKey);
  await expectCode(gate.verify(db), 'INTEGRITY_ATTESTATION_SIGNATURE_INVALID');
  authority.keys.set(validLatest.key_id, originalKey);

  const staleGate = new IndependentEvidenceIntegrityGate({
    authority, provenanceResolver: context.resolver, now: () => Date.parse('2026-07-18T09:00:00.000Z')
  });
  await expectCode(staleGate.verify(db), 'INTEGRITY_ATTESTATION_STALE');

  const unavailable = new IndependentEvidenceIntegrityGate({
    authority: { latest: async () => { throw new Error('offline'); }, publicKey: async () => null, attest: async () => null },
    provenanceResolver: context.resolver, now: () => context.now
  });
  await expectCode(unavailable.verify(db), 'INTEGRITY_AUTHORITY_UNAVAILABLE');

  const missingProvenance = new IndependentEvidenceIntegrityGate({
    authority, provenanceResolver: { resolve: async () => null }, now: () => context.now
  });
  await expectCode(missingProvenance.verify(db), 'PROVENANCE_AUTHORITY_AMBIGUOUS');

  authority.rotate('key-2');
  await gate.attest(db);
  assert.strictEqual((await gate.verify(db)).sequence, 3);
  assert.ok(authority.keys.has('key-1') && authority.keys.has('key-2'), 'historical and current public keys retained');
  assert.ok(!JSON.stringify(gate).includes('PRIVATE KEY'), 'application gate contains no private signing key');

  const genesis = await setup();
  const manifest = await genesis.gate.manifest(genesis.db, null);
  const validGenesis = await genesis.authority.attest({ manifest, manifest_digest: digest(manifest), previous_checkpoint_id: null });
  const invalidGenesis = { ...validGenesis, genesis_authorised: false };
  await expectCode(genesis.gate.verifyAttestation(invalidGenesis, manifest), 'INTEGRITY_GENESIS_NOT_AUTHORISED');
  await genesis.db.close();
  await db.close();
  console.log('Evidence Integrity Authority verification: PASS');
}

run().catch(error => { console.error(error); process.exit(1); });
