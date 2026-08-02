const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function writeJson(filename, value) {
  fs.writeFileSync(filename, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

function fileSha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leadsprout-integrity-'));
  const authorityFile = path.join(directory, 'authority.json');
  const provenanceFile = path.join(directory, 'provenance.json');
  const teamDbFile = path.join(directory, 'team-db');
  fs.writeFileSync(teamDbFile, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  let attestation = {
    checkpoint_id: 'checkpoint-1',
    store_id: 'EVIDENCE_IDENTITY',
    manifest_version: 'ENG-DET-001/1',
    manifest_digest: 'a'.repeat(64),
    previous_checkpoint_id: null,
    sequence: 1,
    authority_time: '2026-08-02T12:00:00.000Z',
    key_id: 'production-key-1',
    genesis_authorization: {},
    key_transition: null,
    signature: Buffer.alloc(64).toString('base64')
  };
  writeJson(authorityFile, {
    profile: 'LEADSPROUT_EVIDENCE_AUTHORITY_V1',
    store_id: 'EVIDENCE_IDENTITY',
    public_keys: [{ key_id: 'production-key-1', public_key_pem: publicKeyPem }],
    attestations: [attestation]
  });
  const provenance = {
    provenance_record_id: 'PRV-001',
    subject_business_id: 'BUS-001',
    source_namespace: 'web',
    source_locator: 'https://example.com/',
    observed_at: '2026-08-02T11:00:00.000Z',
    content_sha256: crypto.createHash('sha256').update('evidence').digest('hex'),
    source_profile_version: '1.0',
    derivation_profile_version: null
  };
  writeJson(provenanceFile, {
    profile: 'LEADSPROUT_PROVENANCE_AUTHORITY_V1',
    records: [provenance]
  });

  process.env.EVIDENCE_INTEGRITY_AUTHORITY_STORE = authorityFile;
  process.env.EVIDENCE_INTEGRITY_AUTHORITY_STORE_SHA256 = fileSha256(authorityFile);
  process.env.EVIDENCE_PROVENANCE_AUTHORITY_STORE = provenanceFile;
  process.env.EVIDENCE_PROVENANCE_AUTHORITY_STORE_SHA256 = fileSha256(provenanceFile);
  const { authority, loadSnapshot } = require('./backend/integrations/evidence-authority-file');
  const { provenanceResolver, loadRecords } = require('./backend/integrations/evidence-provenance-file');
  const {
    IndependentEvidenceIntegrityGate, MANIFEST_VERSION, STORE_ID, canonicalJson, digest
  } = require('./backend/utils/evidence-integrity-authority');

  const authorityTime = '2026-08-02T12:00:00.000Z';
  const gate = new IndependentEvidenceIntegrityGate({
    authority,
    provenanceResolver,
    now: () => Date.parse(authorityTime)
  });
  const emptyQuery = { async all() { return []; } };
  const manifest = await gate.manifest(emptyQuery, null);
  const manifestDigest = digest(manifest);
  const genesisBody = {
    store_id: STORE_ID,
    manifest_digest: manifestDigest,
    key_id: 'production-key-1',
    write_quiesced: true,
    engineering_baseline_verified: true,
    environment: 'synthetic-test',
    repository_revision: 'synthetic-revision',
    authority_time: authorityTime
  };
  const genesisAuthorization = {
    ...genesisBody,
    signature: crypto.sign(null, Buffer.from(canonicalJson(genesisBody)), pair.privateKey).toString('base64')
  };
  const attestationBody = {
    checkpoint_id: 'checkpoint-1',
    store_id: STORE_ID,
    manifest_version: MANIFEST_VERSION,
    manifest_digest: manifestDigest,
    previous_checkpoint_id: null,
    sequence: 1,
    authority_time: authorityTime,
    key_id: 'production-key-1',
    genesis_authorization: genesisAuthorization,
    key_transition: null
  };
  attestation = {
    ...attestationBody,
    signature: crypto.sign(null, Buffer.from(canonicalJson(attestationBody)), pair.privateKey).toString('base64')
  };
  writeJson(authorityFile, {
    profile: 'LEADSPROUT_EVIDENCE_AUTHORITY_V1',
    store_id: STORE_ID,
    public_keys: [{ key_id: 'production-key-1', public_key_pem: publicKeyPem }],
    attestations: [attestation]
  });
  process.env.EVIDENCE_INTEGRITY_AUTHORITY_STORE_SHA256 = fileSha256(authorityFile);

  assert.deepStrictEqual(await authority.latest('EVIDENCE_IDENTITY'), attestation);
  assert.deepStrictEqual(await authority.checkpoint('checkpoint-1'), attestation);
  assert.strictEqual((await authority.publicKey('production-key-1')).type, 'public');
  await assert.rejects(authority.attest({}), error => error.code === 'INTEGRITY_AUTHORITY_READ_ONLY');
  assert.deepStrictEqual(await provenanceResolver.resolve('PRV-001'), provenance);
  assert.strictEqual(await provenanceResolver.resolve('PRV-MISSING'), null);
  assert.strictEqual((await gate.verify(emptyQuery)).status, 'VERIFIED');

  const frontendIndex = path.join(directory, 'index.html');
  fs.writeFileSync(frontendIndex, '<!doctype html>\n');
  const { verifyDeploymentConfig } = require('./backend/scripts/verify_deployment_config');
  const deployment = verifyDeploymentConfig({
    frontendIndex,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      OPPORTUNITY_WORKSPACE_ENABLED: 'false',
      JWT_SECRET: 'synthetic-test-secret-that-is-long-enough',
      STRIPE_SECRET_KEY: 'sk_test_synthetic_only',
      STRIPE_WEBHOOK_SECRET: 'whsec_synthetic_only',
      BASE_URL: 'https://leadsprout.example/',
      EVIDENCE_INTEGRITY_AUTHORITY_STORE: authorityFile,
      EVIDENCE_INTEGRITY_AUTHORITY_STORE_SHA256: fileSha256(authorityFile),
      EVIDENCE_PROVENANCE_AUTHORITY_STORE: provenanceFile,
      EVIDENCE_PROVENANCE_AUTHORITY_STORE_SHA256: fileSha256(provenanceFile),
      LEADSPROUT_TEAM_DB_EXECUTABLE: teamDbFile,
      LEADSPROUT_TEAM_DB_EXECUTABLE_SHA256: fileSha256(teamDbFile)
    }
  });
  assert.strictEqual(deployment.status, 'DEPLOYMENT_CONFIGURATION_VERIFIED');
  assert.strictEqual(deployment.authority_checkpoint, 'checkpoint-1');
  assert.strictEqual(deployment.provenance_record_count, 1);
  assert.throws(() => verifyDeploymentConfig({
    frontendIndex,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      OPPORTUNITY_WORKSPACE_ENABLED: 'false',
      JWT_SECRET: 'leadsprout-super-secret-key-2026',
      STRIPE_SECRET_KEY: 'sk_test_synthetic_only',
      STRIPE_WEBHOOK_SECRET: 'whsec_synthetic_only',
      BASE_URL: 'https://leadsprout.example/',
      EVIDENCE_INTEGRITY_AUTHORITY_STORE: authorityFile,
      EVIDENCE_INTEGRITY_AUTHORITY_STORE_SHA256: fileSha256(authorityFile),
      EVIDENCE_PROVENANCE_AUTHORITY_STORE: provenanceFile,
      EVIDENCE_PROVENANCE_AUTHORITY_STORE_SHA256: fileSha256(provenanceFile),
      LEADSPROUT_TEAM_DB_EXECUTABLE: teamDbFile,
      LEADSPROUT_TEAM_DB_EXECUTABLE_SHA256: fileSha256(teamDbFile)
    }
  }), error => error.code === 'DEPLOYMENT_JWT_SECRET_INVALID');

  assert.throws(() => loadSnapshot({ env: {
    EVIDENCE_INTEGRITY_AUTHORITY_STORE: authorityFile,
    EVIDENCE_INTEGRITY_AUTHORITY_STORE_SHA256: '0'.repeat(64)
  } }), error => error.code === 'INTEGRITY_AUTHORITY_STORE_DIGEST_MISMATCH');
  assert.throws(() => loadRecords({ env: {
    EVIDENCE_PROVENANCE_AUTHORITY_STORE: provenanceFile,
    EVIDENCE_PROVENANCE_AUTHORITY_STORE_SHA256: '0'.repeat(64)
  } }), error => error.code === 'PROVENANCE_AUTHORITY_STORE_DIGEST_MISMATCH');
  const { resolveTeamDbExecutable } = require('./backend/database');
  assert.throws(() => resolveTeamDbExecutable({
    NODE_ENV: 'production',
    LEADSPROUT_TEAM_DB_EXECUTABLE: teamDbFile,
    LEADSPROUT_TEAM_DB_EXECUTABLE_SHA256: '0'.repeat(64)
  }), error => error.code === 'DATABASE_EXECUTABLE_DIGEST_MISMATCH');

  writeJson(authorityFile, {
    profile: 'LEADSPROUT_EVIDENCE_AUTHORITY_V1',
    store_id: 'EVIDENCE_IDENTITY',
    public_keys: [{
      key_id: 'production-key-1',
      public_key_pem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' })
    }],
    attestations: []
  });
  process.env.EVIDENCE_INTEGRITY_AUTHORITY_STORE_SHA256 = fileSha256(authorityFile);
  await assert.rejects(authority.publicKey('production-key-1'),
    error => error.code === 'INTEGRITY_AUTHORITY_STORE_INVALID');

  fs.rmSync(directory, { recursive: true, force: true });
  delete process.env.EVIDENCE_INTEGRITY_AUTHORITY_STORE;
  delete process.env.EVIDENCE_INTEGRITY_AUTHORITY_STORE_SHA256;
  delete process.env.EVIDENCE_PROVENANCE_AUTHORITY_STORE;
  delete process.env.EVIDENCE_PROVENANCE_AUTHORITY_STORE_SHA256;
  console.log('PASS production Evidence Integrity file adapters');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
