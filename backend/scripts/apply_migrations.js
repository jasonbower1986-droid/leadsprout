const fs = require('fs');
const { spawnSync } = require('child_process');
const { featureDisabled, migrationInventory, MigrationControlError } = require('./verify_schema');

const REQUIRED_REVISION = '32248db8763208b8e56ac99a2b7934557f260513';

function fail(code) {
  throw new MigrationControlError(code);
}

function sql(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key || !key.startsWith('--') || args[index + 1] === undefined) fail('CONTROL_INPUT_INVALID');
    values[key.slice(2)] = args[index + 1];
  }
  return values;
}

function readEvidence(file, code) {
  if (!file) fail(code);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    fail(code);
  }
}

function validateControls(values, env = process.env) {
  if (env.LEADSPROUT_CONTROLLED_MIGRATION !== 'true') fail('CONTROL_FLAG_REQUIRED');
  featureDisabled(env.OPPORTUNITY_WORKSPACE_ENABLED);
  if (values.revision !== REQUIRED_REVISION) fail('REVISION_MISMATCH');
  if (!values.target || !values.operator) fail('TARGET_MISMATCH');
  if (values['acknowledge-no-lifecycle'] !== 'true') fail('LIFECYCLE_ACK_REQUIRED');
  const preflight = readEvidence(values.preflight, 'PREFLIGHT_REQUIRED');
  const backup = readEvidence(values.backup, 'BACKUP_PREREQUISITE');
  const qualification = readEvidence(values.qualification, 'TRANSACTION_QUALIFICATION_REQUIRED');
  if (preflight.target_id !== values.target || preflight.verified !== true || !preflight.schema_sha256) {
    fail('PREFLIGHT_REQUIRED');
  }
  if (backup.target_id !== values.target || backup.verified !== true ||
      backup.restoration_rehearsed !== true || !backup.backup_sha256) {
    fail('BACKUP_PREREQUISITE');
  }
  if (qualification.target_class !== preflight.target_class ||
      qualification.rollback_verified !== true || !qualification.adapter_identity ||
      !qualification.runtime_identity || !qualification.test_payload_sha256) {
    fail('TRANSACTION_QUALIFICATION_REQUIRED');
  }
  return { preflight, backup, qualification };
}

function buildControlledTransaction({ inventory, revision, target, operator, startedAt }) {
  const timestamp = startedAt || new Date().toISOString();
  const ledger = `
CREATE TABLE schema_migrations (
  migration_id TEXT PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  sequence INTEGER NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  application_revision TEXT NOT NULL,
  target_identifier TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  operator_identity TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('STARTED','COMPLETED','FAILED','INTERRUPTED','ADOPTED'))
);`;
  const statements = ['PRAGMA foreign_keys = ON;', 'BEGIN IMMEDIATE;', ledger];
  for (const migration of inventory) {
    statements.push(migration.content);
    statements.push(`INSERT INTO schema_migrations
      (migration_id,filename,sequence,checksum,application_revision,target_identifier,started_at,completed_at,operator_identity,outcome)
      VALUES (${sql(migration.migration_id)},${sql(migration.filename)},${migration.sequence},${sql(migration.checksum)},
      ${sql(revision)},${sql(target)},${sql(timestamp)},CURRENT_TIMESTAMP,${sql(operator)},'COMPLETED');`);
  }
  statements.push('COMMIT;');
  return statements.join('\n');
}

function executeTeamDb(transactionSql, spawn = spawnSync) {
  const result = spawn('team-db', [transactionSql], {
    encoding: 'utf8',
    env: { ...process.env }
  });
  if (result.error || result.status !== 0) fail('MIGRATION_ATOMIC_EXECUTION_FAILED');
}

function inspectLedger(inventory, spawn = spawnSync) {
  const result = spawn('team-db', [
    'SELECT migration_id,filename,sequence,checksum,outcome FROM schema_migrations ORDER BY sequence'
  ], { encoding: 'utf8', env: { ...process.env } });
  if (result.error) fail('MIGRATION_LEDGER_INSPECTION_FAILED');
  if (result.status !== 0) {
    if (/no such table:\s*schema_migrations/i.test(result.stderr || '')) return 'ABSENT';
    fail('MIGRATION_LEDGER_INSPECTION_FAILED');
  }
  let rows;
  try {
    rows = JSON.parse(result.stdout || '[]');
  } catch (_) {
    fail('MIGRATION_LEDGER_INSPECTION_FAILED');
  }
  if (!Array.isArray(rows) || rows.length !== inventory.length) fail('LEDGER_DIRTY');
  rows.forEach((row, index) => {
    const expected = inventory[index];
    if (row.migration_id !== expected.migration_id ||
        row.filename !== expected.filename ||
        Number(row.sequence) !== expected.sequence) fail('LEDGER_ORDER');
    if (row.checksum !== expected.checksum) fail('LEDGER_CHECKSUM');
    if (row.outcome !== 'COMPLETED' && row.outcome !== 'ADOPTED') fail('LEDGER_DIRTY');
  });
  return 'COMPLETED';
}

async function main(args = process.argv.slice(2), dependencies = {}) {
  const values = parseArgs(args);
  validateControls(values, dependencies.env || process.env);
  const inventory = dependencies.inventory || migrationInventory();
  const spawn = dependencies.spawn || spawnSync;
  if (inspectLedger(inventory, spawn) === 'COMPLETED') {
    const output = {
      status: 'VERIFIED_NOOP',
      feature_enabled: false,
      revision: values.revision,
      target: values.target,
      migrations: inventory.map(({ content, ...entry }) => entry)
    };
    console.log(JSON.stringify(output));
    return output;
  }
  const transaction = buildControlledTransaction({
    inventory,
    revision: values.revision,
    target: values.target,
    operator: values.operator,
    startedAt: dependencies.startedAt
  });
  executeTeamDb(transaction, spawn);
  const output = {
    status: 'COMPLETED',
    feature_enabled: false,
    revision: values.revision,
    target: values.target,
    migrations: inventory.map(({ content, ...entry }) => entry)
  };
  console.log(JSON.stringify(output));
  return output;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.code || 'MIGRATION_FAILED');
    process.exitCode = 1;
  });
}

module.exports = {
  REQUIRED_REVISION,
  buildControlledTransaction,
  executeTeamDb,
  inspectLedger,
  main,
  parseArgs,
  validateControls
};
