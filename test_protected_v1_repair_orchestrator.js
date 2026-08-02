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
  for (const required of [
    "process.env.TEAM_DB_URL",
    "process.env.TEAM_DB_AUTH_TOKEN",
    "url !== teamUrl",
    "token !== teamToken",
    "validateAuthorization(",
    "validateCanonicalInventory(inventory)",
    "validateTargetConfigurationEvidence(",
    "revision !== identity.revision",
    "restoration_rehearsed !== true",
    "customer_writes_paused !== true",
    "validateRecoveryEvidence(recovery, writeNow)",
    "validateTrafficEvidence(trafficEvidence, authorization.authority_reference, writeNow)",
    "__leadsprout_forced_protected_rollback__",
    "PROTECTED_REPAIR_ROLLBACK_MISMATCH",
    "rollback_verified: true",
    "runMigrations(args",
    "verifyFinalState(target, inventory)",
    "PASS_PROTECTED_V1_007_008_COMPLETED"
  ]) assert(source.includes(required), required);
  assert(!source.includes('OWNER_RISK_WAIVER'));
  assert(!source.includes('TURSO_PLATFORM_API_TOKEN'));
  console.log('PASS protected V1 repair orchestrator safety contract');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
