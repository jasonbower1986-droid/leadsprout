const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const filename = path.join(__dirname, 'backend/scripts/execute_protected_v1_repair.mjs');
const source = fs.readFileSync(filename, 'utf8');

async function main() {
  const module = await import(pathToFileURL(filename).href);
  const target = 'f499a22e-a253-45ee-8677-8cdd315ded16';
  const now = new Date('2026-08-02T18:00:00Z');
  const window = {
    captured_at: '2026-08-02T17:55:00Z',
    expires_at: '2026-08-02T18:10:00Z'
  };
  assert.strictEqual(module.APPROVAL,
    'AUTHORIZED_PROTECTED_V1_007_008_WITH_PROVEN_RECOVERY');
  assert.strictEqual(module.PROTECTED_HOST,
    'agent-team-2d88b7d5-cto.aws-us-west-2.turso.io');
  assert.strictEqual(module.validFreshWindow(window.captured_at, window.expires_at, now), true);
  assert.throws(() => module.validateRecoveryEvidence({
    target_id: target,
    verified: true,
    restoration_rehearsed: false,
    backup_sha256: 'a'.repeat(64),
    backup_id: 'backup',
    provider: 'Turso',
    restore_target_id: 'isolated-restore',
    restore_rehearsal_reference: 'rehearsal',
    ...window
  }, now), error => error.code === 'PROTECTED_RECOVERY_EVIDENCE_REQUIRED');
  assert.doesNotThrow(() => module.validateRecoveryEvidence({
    target_id: target,
    verified: true,
    restoration_rehearsed: true,
    backup_sha256: 'a'.repeat(64),
    backup_id: 'backup',
    provider: 'Turso',
    restore_target_id: 'isolated-restore',
    restore_rehearsal_reference: 'rehearsal',
    ...window
  }, now));
  assert.throws(() => module.validateTrafficEvidence({
    target_id: target,
    verified: true,
    customer_writes_paused: false,
    authority_reference: 'EXEC-V1-REPAIR-001',
    provider_resource_id: 'provider-resource',
    ...window
  }, 'EXEC-V1-REPAIR-001', now),
  error => error.code === 'PROTECTED_TRAFFIC_QUIESCENCE_REQUIRED');
  assert.doesNotThrow(() => module.validateTrafficEvidence({
    target_id: target,
    verified: true,
    customer_writes_paused: true,
    authority_reference: 'EXEC-V1-REPAIR-001',
    provider_resource_id: 'provider-resource',
    ...window
  }, 'EXEC-V1-REPAIR-001', now));
  const qualification = {
    adapter_identity: 'turso-atomic-executor:' + 'b'.repeat(64),
    canonical_migration_manifest_sha256: 'c'.repeat(64),
    captured_at: '2026-08-02T17:55:00Z',
    classification: 'PASS_SAME_PROVIDER_EXECUTOR_QUALIFIED',
    disposable_credential_revoked: true,
    disposable_database_deleted: true,
    disposable_database_id: 'disposable-v1-qualification',
    disposable_host: 'disposable-v1-qualification-cto.aws-us-west-2.turso.io',
    executor_sha256: 'b'.repeat(64),
    expires_at: '2026-08-02T18:10:00Z',
    foreign_key_violation_count: 0,
    guard_artifact_count: 0,
    ledger_count: 8,
    migration_008_committed: true,
    provider: 'Turso',
    provider_class: module.PROVIDER_CLASS,
    retry_007_committed: true,
    revision: 'd'.repeat(40),
    rollback_observed: true,
    runtime_identity: '@tursodatabase/serverless@0.2.2:' + 'e'.repeat(64),
    serverless_manifest_sha256: 'f'.repeat(64),
    serverless_module_sha256: 'e'.repeat(64),
    test_payload_sha256: 'a'.repeat(64)
  };
  const inventory = [{ sequence: 1, migration_id: '001', filename: '001.sql', checksum: 'a'.repeat(64) }];
  const expectedManifest = require('./backend/scripts/apply_migrations').migrationManifestDigest(inventory).sha256;
  qualification.canonical_migration_manifest_sha256 = expectedManifest;
  const priorEnv = { ...process.env };
  process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR_SHA256 = 'b'.repeat(64);
  process.env.LEADSPROUT_TURSO_SERVERLESS_MODULE_SHA256 = 'e'.repeat(64);
  process.env.LEADSPROUT_TURSO_SERVERLESS_MANIFEST_SHA256 = 'f'.repeat(64);
  assert.doesNotThrow(() => module.validateDisposableQualificationEvidence(
    qualification,
    { revision: 'd'.repeat(40) },
    inventory,
    now
  ));
  const credentialEvidence = {
    authorization: 'database-full-access',
    authority_reference: 'EXEC-V1-REPAIR-001',
    authoritative_source_reference: 'turso-db-token-create-terminal-evidence',
    database_scoped: true,
    expires_at: '2026-08-02T18:10:00Z',
    issued_at: '2026-08-02T17:55:00Z',
    least_privilege: true,
    permits_data_change: true,
    permits_schema_change: true,
    provider: 'Turso',
    separate_from_ordinary_runtime_credentials: true,
    target_id: target,
    time_bounded: true,
    verified: true
  };
  const migrationToken = [
    Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify({
      iat: Date.parse(credentialEvidence.issued_at) / 1000,
      exp: Date.parse(credentialEvidence.expires_at) / 1000
    })).toString('base64url'),
    'signature'
  ].join('.');
  assert.doesNotThrow(() => module.validateMigrationCredentialEvidence(
    credentialEvidence,
    { token: migrationToken },
    'ordinary-runtime-token',
    'EXEC-V1-REPAIR-001',
    now
  ));
  assert.throws(() => module.validateMigrationCredentialEvidence(
    credentialEvidence,
    { token: migrationToken },
    migrationToken,
    'EXEC-V1-REPAIR-001',
    now
  ), error => error.code === 'PROTECTED_MIGRATION_CREDENTIAL_EVIDENCE_REQUIRED');
  process.env = priorEnv;
  for (const required of [
    "process.env.TEAM_DB_URL",
    "process.env.TEAM_DB_AUTH_TOKEN",
    "url !== teamUrl",
    "token === teamToken",
    "validateAuthorization(",
    "validateCanonicalInventory(inventory)",
    "validateTargetConfigurationEvidence(",
    "revision !== identity.revision",
    "restoration_rehearsed !== true",
    "customer_writes_paused !== true",
    "validateRecoveryEvidence(recovery, writeNow)",
    "validateTrafficEvidence(trafficEvidence, authorization.authority_reference, writeNow)",
    "LEADSPROUT_DISPOSABLE_QUALIFICATION_EVIDENCE",
    "LEADSPROUT_MIGRATION_CREDENTIAL_EVIDENCE",
    "rollback_verified: true",
    "runMigrations(args",
    "verifyFinalState(target, inventory)",
    "PASS_PROTECTED_V1_007_008_COMPLETED"
  ]) assert(source.includes(required), required);
  assert(!source.includes('__leadsprout_forced_protected_rollback__'));
  assert(!source.includes('OWNER_RISK_WAIVER'));
  assert(!source.includes('TURSO_PLATFORM_API_TOKEN'));
  console.log('PASS protected V1 repair orchestrator safety contract');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
