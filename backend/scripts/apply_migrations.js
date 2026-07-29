const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  EXPECTED_PRE_006_SCHEMA_MANIFEST,
  EXPECTED_PRE_007_SCHEMA_MANIFEST,
  EXPECTED_SCHEMA_MANIFEST,
  featureDisabled,
  migrationInventory,
  MigrationControlError,
  verifyStructuralSchema
} = require('./verify_schema');

function fail(code) {
  throw new MigrationControlError(code);
}

const TARGET_CONFIGURATION_MAX_VALIDITY_MS = 4 * 60 * 60 * 1000;

function sql(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key || !key.startsWith('--') || args[index + 1] === undefined) fail('CONTROL_INPUT_INVALID');
    const name = key.slice(2);
    if (Object.prototype.hasOwnProperty.call(values, name)) fail('CONTROL_INPUT_INVALID');
    values[name] = args[index + 1];
  }
  return values;
}

function readEvidence(file, code) {
  if (!file) fail(code);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(code);
    return parsed;
  } catch (_) {
    fail(code);
  }
}

function expectedRepositoryRoot(sourceFile = __filename) {
  try {
    return fs.realpathSync(path.resolve(path.dirname(sourceFile), '../..'));
  } catch (_) {
    fail('EXPECTED_REPOSITORY_ROOT_UNRESOLVED');
  }
}

function resolveRepositoryIdentity(options = {}) {
  const spawn = options.spawn || spawnSync;
  const repositoryRoot = expectedRepositoryRoot(options.sourceFile || __filename);
  const git = args => spawn('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env }
  });
  const topLevel = git(['rev-parse', '--show-toplevel']);
  if (topLevel.error || topLevel.status !== 0 || !topLevel.stdout?.trim()) {
    fail('REPOSITORY_ROOT_UNRESOLVED');
  }
  let actualRoot;
  try {
    actualRoot = fs.realpathSync(topLevel.stdout.trim());
  } catch (_) {
    fail('REPOSITORY_ROOT_UNRESOLVED');
  }
  if (actualRoot !== repositoryRoot) fail('REPOSITORY_ROOT_MISMATCH');
  const resolve = reference => {
    const result = git(['rev-parse', '--verify', reference]);
    if (result.error || result.status !== 0 || !/^[a-f0-9]{40}\n?$/.test(result.stdout || '')) {
      fail('REPOSITORY_IDENTITY_UNRESOLVED');
    }
    return result.stdout.trim();
  };
  const status = git([
    'status', '--porcelain=v1', '--untracked-files=no', '--',
    ':(top)backend/migrations',
    ':(top)backend/scripts/apply_migrations.js',
    ':(top)backend/scripts/verify_schema.js'
  ]);
  if (status.error || status.status !== 0) fail('WORKTREE_STATE_UNRESOLVED');
  if (status.stdout !== '') fail('CONTROLLED_WORKTREE_DIRTY');
  return Object.freeze({
    revision: resolve('HEAD^{commit}'),
    tree: resolve('HEAD^{tree}'),
    clean: true,
    repositoryRoot
  });
}

function validateAuthorization(evidence, identity, values, now = new Date()) {
  const requiredStrings = [
    'authority_reference', 'authorised_revision', 'authorised_tree',
    'canonical_migration_manifest_sha256', 'execution_context',
    'issued_at', 'expires_at', 'target_id'
  ];
  if (Object.keys(evidence).sort().join('|') !== requiredStrings.slice().sort().join('|') ||
      requiredStrings.some(key => typeof evidence[key] !== 'string' || !evidence[key].trim())) {
    fail('AUTHORIZATION_EVIDENCE_MALFORMED');
  }
  if (!/^[A-Z][A-Z0-9._-]{5,127}$/.test(evidence.authority_reference) ||
      evidence.authority_reference !== values['authority-reference']) {
    fail('AUTHORITY_REFERENCE_INVALID');
  }
  if (!/^[a-f0-9]{40}$/.test(evidence.authorised_revision) ||
      !/^[a-f0-9]{40}$/.test(evidence.authorised_tree) ||
      !/^[a-f0-9]{64}$/.test(evidence.canonical_migration_manifest_sha256)) {
    fail('AUTHORIZATION_EVIDENCE_MALFORMED');
  }
  if (evidence.authorised_revision !== identity.revision) fail('REVISION_MISMATCH');
  if (evidence.authorised_tree !== identity.tree) fail('TREE_MISMATCH');
  if (evidence.target_id !== values.target ||
      evidence.execution_context !== values['execution-context']) {
    fail('EXECUTION_CONTEXT_MISMATCH');
  }
  const issuedAt = Date.parse(evidence.issued_at);
  const expiresAt = Date.parse(evidence.expires_at);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      !Number.isFinite(current) || expiresAt <= issuedAt || current < issuedAt || current >= expiresAt) {
    fail('AUTHORIZATION_EVIDENCE_EXPIRED');
  }
  return Object.freeze({
    authority_reference: evidence.authority_reference,
    authorised_revision: evidence.authorised_revision,
    authorised_tree: evidence.authorised_tree,
    canonical_migration_manifest_sha256: evidence.canonical_migration_manifest_sha256,
    execution_context: evidence.execution_context,
    issued_at: evidence.issued_at,
    expires_at: evidence.expires_at,
    target_id: evidence.target_id
  });
}

function validateControls(values, options = {}) {
  const env = options.env || process.env;
  if (env.LEADSPROUT_CONTROLLED_MIGRATION !== 'true') fail('CONTROL_FLAG_REQUIRED');
  featureDisabled(env.OPPORTUNITY_WORKSPACE_ENABLED);
  if (!values.target || !values.operator || !values['execution-context']) fail('TARGET_MISMATCH');
  if (values['acknowledge-no-lifecycle'] !== 'true') fail('LIFECYCLE_ACK_REQUIRED');
  const identity = options.identity || resolveRepositoryIdentity({
    sourceFile: options.repositorySourceFile,
    spawn: options.repositorySpawn || spawnSync
  });
  if (identity.clean !== true) fail('CONTROLLED_WORKTREE_DIRTY');
  const authorization = validateAuthorization(
    options.authorization || readEvidence(values.authorization, 'AUTHORIZATION_EVIDENCE_REQUIRED'),
    identity,
    values,
    options.now || new Date()
  );
  const preflight = options.preflight || readEvidence(values.preflight, 'PREFLIGHT_REQUIRED');
  const backup = options.backup || readEvidence(values.backup, 'BACKUP_PREREQUISITE');
  const qualification = options.qualification ||
    readEvidence(values.qualification, 'TRANSACTION_QUALIFICATION_REQUIRED');
  const targetConfiguration = options.targetConfiguration || readEvidence(
    values['target-configuration'],
    'TARGET_CONFIGURATION_EVIDENCE_REQUIRED'
  );
  if (preflight.target_id !== values.target || preflight.verified !== true ||
      !preflight.schema_sha256 || preflight.authority_reference !== authorization.authority_reference) {
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
  const controlledTargetConfiguration = validateTargetConfigurationEvidence(
    targetConfiguration,
    authorization,
    values.target,
    options.now || new Date()
  );
  return Object.freeze({
    authorization,
    backup,
    identity,
    preflight,
    qualification,
    targetConfiguration: controlledTargetConfiguration
  });
}

function validateTargetConfigurationEvidence(
  targetConfiguration,
  authorization,
  target,
  now = new Date()
) {
  const configurationKeys = [
    'target_id',
    'authoritative_source_identity',
    'authoritative_source_reference',
    'captured_at',
    'expires_at',
    'source_sha256',
    'configuration_key',
    'authoritative_value',
    'verified'
  ];
  const capturedAt = Date.parse(targetConfiguration?.captured_at);
  const expiresAt = Date.parse(targetConfiguration?.expires_at);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!targetConfiguration || typeof targetConfiguration !== 'object' ||
      Array.isArray(targetConfiguration) ||
      Object.keys(targetConfiguration).sort().join('|') !== configurationKeys.sort().join('|') ||
      targetConfiguration.target_id !== target ||
      typeof targetConfiguration.authoritative_source_identity !== 'string' ||
      !targetConfiguration.authoritative_source_identity.trim() ||
      targetConfiguration.authoritative_source_reference !== authorization.authority_reference ||
      !Number.isFinite(capturedAt) || !Number.isFinite(expiresAt) ||
      !Number.isFinite(current) || expiresAt <= capturedAt ||
      expiresAt - capturedAt > TARGET_CONFIGURATION_MAX_VALIDITY_MS ||
      current < capturedAt || current >= expiresAt ||
      !/^[a-f0-9]{64}$/.test(targetConfiguration.source_sha256 || '') ||
      targetConfiguration.configuration_key !== 'OPPORTUNITY_WORKSPACE_ENABLED' ||
      targetConfiguration.authoritative_value !== 'false' ||
      targetConfiguration.verified !== true) {
    fail('TARGET_CONFIGURATION_EXPLICIT_FALSE_REQUIRED');
  }
  return Object.freeze({ ...targetConfiguration });
}

function migrationManifestDigest(inventory) {
  const canonical = inventory.map(migration => [
    migration.sequence,
    migration.migration_id,
    migration.filename,
    migration.checksum
  ].join('\t')).join('\n') + '\n';
  return Object.freeze({
    canonical,
    sha256: crypto.createHash('sha256').update(canonical).digest('hex')
  });
}

function validateCanonicalInventory(inventory, options = {}) {
  const filenames = [
    '001_evidence_identity_foundation.sql',
    '002_opportunity_workspace.sql',
    '003_commercial_opportunity_design_states.sql',
    '004_evidence_integrity_operational.sql',
    '005_reports_activity_settings.sql',
    '006_preference_retention_controls.sql',
    '007_preference_retention_cases_forward_repair.sql'
  ];
  if (!Array.isArray(inventory) || inventory.length !== filenames.length) {
    fail('CANONICAL_MIGRATION_INVENTORY_INVALID');
  }
  inventory.forEach((migration, index) => {
    if (!migration || migration.migration_id !== String(index + 1).padStart(3, '0') ||
        migration.filename !== filenames[index] || Number(migration.sequence) !== index + 1 ||
        !/^[a-f0-9]{64}$/.test(migration.checksum) || typeof migration.content !== 'string') {
      fail('CANONICAL_MIGRATION_INVENTORY_INVALID');
    }
  });
  const files = options.migrationFiles || fs.readdirSync(
    options.migrationsDir || path.join(__dirname, '../migrations')
  );
  const executionFiles = files.filter(filename =>
    /^\d{3}_.+\.sql$/.test(filename) && !/_rollback\.sql$/.test(filename)
  ).sort();
  if (executionFiles.join('|') !== filenames.join('|')) {
    fail('CANONICAL_MIGRATION_INVENTORY_INVALID');
  }
  return migrationManifestDigest(inventory);
}

function validateMigrationAuthority(inventory, controls, options = {}) {
  const manifest = validateCanonicalInventory(inventory, options);
  const authorised = controls.authorization.canonical_migration_manifest_sha256;
  const preflight = controls.preflight.canonical_migration_manifest_sha256;
  if (!/^[a-f0-9]{64}$/.test(preflight || '') ||
      authorised !== preflight || authorised !== manifest.sha256) {
    fail('MIGRATION_MANIFEST_AUTHORITY_MISMATCH');
  }
  return manifest;
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

function buildIncrementalTransaction({ migration, revision, target, operator, startedAt }) {
  if (!migration || migration.migration_id !== '007' || migration.sequence !== 7 ||
      migration.filename !== '007_preference_retention_cases_forward_repair.sql') {
    fail('FORWARD_REPAIR_IDENTITY_INVALID');
  }
  const timestamp = startedAt || new Date().toISOString();
  return [
    'PRAGMA foreign_keys = OFF;',
    'BEGIN IMMEDIATE;',
    migration.content,
    `INSERT INTO schema_migrations
      (migration_id,filename,sequence,checksum,application_revision,target_identifier,
       started_at,completed_at,operator_identity,outcome)
      VALUES (${sql(migration.migration_id)},${sql(migration.filename)},${migration.sequence},
      ${sql(migration.checksum)},${sql(revision)},${sql(target)},${sql(timestamp)},
      CURRENT_TIMESTAMP,${sql(operator)},'COMPLETED');`,
    'COMMIT;',
    'PRAGMA foreign_keys = ON;'
  ].join('\n');
}

function executeTeamDb(transactionSql, spawn = spawnSync) {
  const result = spawn('team-db', [transactionSql], {
    encoding: 'utf8',
    env: { ...process.env }
  });
  if (result.error || result.status !== 0) fail('MIGRATION_ATOMIC_EXECUTION_FAILED');
}

function teamDbRows(statement, spawn = spawnSync) {
  const result = spawn('team-db', [statement], {
    encoding: 'utf8',
    env: { ...process.env }
  });
  if (result.error || result.status !== 0) {
    if (/no such table:\s*schema_migrations/i.test(result.stderr || '')) fail('LEDGER_MISSING');
    fail('MIGRATION_LEDGER_INSPECTION_FAILED');
  }
  try {
    const rows = JSON.parse(result.stdout || '[]');
    if (!Array.isArray(rows)) fail('MIGRATION_LEDGER_INSPECTION_FAILED');
    return rows;
  } catch (_) {
    fail('MIGRATION_LEDGER_INSPECTION_FAILED');
  }
}

function classifyLedger(inventory, spawn = spawnSync) {
  const rows = teamDbRows(
    'SELECT migration_id,filename,sequence,checksum,outcome FROM schema_migrations ORDER BY sequence',
    spawn
  );
  if (rows.length !== 6 && rows.length !== 7) fail('LEDGER_DIRTY');
  rows.forEach((row, index) => {
    const expected = inventory[index];
    if (!expected) fail('LEDGER_UNKNOWN');
    if (row.migration_id !== expected.migration_id || row.filename !== expected.filename ||
        Number(row.sequence) !== expected.sequence) fail('LEDGER_ORDER');
    if (row.checksum !== expected.checksum) fail('LEDGER_CHECKSUM');
    if (row.outcome !== 'COMPLETED' && row.outcome !== 'ADOPTED') fail('LEDGER_DIRTY');
  });
  return rows.length === 6 ? 'PRE_007' : 'COMPLETE';
}

function inspectLedger(inventory, spawn = spawnSync) {
  return classifyLedger(inventory, spawn);
}

function teamDbQuery(spawn = spawnSync) {
  return Object.freeze({
    all: async statement => teamDbRows(statement, spawn)
  });
}

function requireForeignKeyEnforcement(spawn = spawnSync) {
  const rows = teamDbRows('PRAGMA foreign_keys = ON; PRAGMA foreign_keys;', spawn);
  if (rows.length !== 1 || Number(rows[0].foreign_keys) !== 1) {
    fail('FOREIGN_KEY_ENFORCEMENT_REQUIRED');
  }
}

async function verifyTargetSchema(contract, phase, spawn = spawnSync) {
  try {
    const query = teamDbQuery(spawn);
    requireForeignKeyEnforcement(spawn);
    if (phase === 'PRE_007') {
      const triggers = await query.all(
        `SELECT name FROM sqlite_schema
         WHERE type = 'trigger'
         ORDER BY name`
      );
      if (triggers.length !== 0) fail('PRE_REPAIR_TRIGGER_INVENTORY_INVALID');
    }
    await verifyStructuralSchema(query, contract);
    if ((await query.all('PRAGMA foreign_key_check')).length !== 0) {
      fail('SCHEMA_MISMATCH');
    }
  } catch (error) {
    if ([
      'FOREIGN_KEY_ENFORCEMENT_REQUIRED',
      'PRE_REPAIR_TRIGGER_INVENTORY_INVALID',
      'SCHEMA_MISMATCH'
    ].includes(error?.code)) throw error;
    fail('SCHEMA_MISMATCH');
  }
}

async function main(args = process.argv.slice(2), dependencies = {}) {
  const values = parseArgs(args);
  const controls = validateControls(values, {
    authorization: dependencies.authorization,
    backup: dependencies.backup,
    env: dependencies.env,
    identity: dependencies.identity,
    now: dependencies.now,
    preflight: dependencies.preflight,
    qualification: dependencies.qualification,
    repositorySpawn: dependencies.repositorySpawn,
    repositorySourceFile: dependencies.repositorySourceFile,
    targetConfiguration: dependencies.targetConfiguration
  });
  let inventory;
  try {
    inventory = dependencies.inventory || migrationInventory();
  } catch (_) {
    fail('CANONICAL_MIGRATION_INVENTORY_INVALID');
  }
  const manifest = validateMigrationAuthority(inventory, controls, {
    migrationFiles: dependencies.migrationFiles,
    migrationsDir: dependencies.migrationsDir
  });
  const spawn = dependencies.spawn || spawnSync;
  const schemaVerifier = dependencies.schemaVerifier ||
    ((contract, phase) => verifyTargetSchema(contract, phase, spawn));
  const ledgerState = classifyLedger(inventory, spawn);
  if (ledgerState === 'COMPLETE') {
    await schemaVerifier(EXPECTED_SCHEMA_MANIFEST, 'COMPLETE');
    const output = Object.freeze({
      status: 'VERIFIED_NOOP',
      authority_reference: controls.authorization.authority_reference,
      canonical_migration_manifest_sha256: manifest.sha256,
      feature_enabled: false,
      revision: controls.identity.revision,
      tree: controls.identity.tree,
      target: values.target,
      migrations: inventory.map(({ content, ...entry }) => entry)
    });
    console.log(JSON.stringify(output));
    return output;
  }
  await schemaVerifier(EXPECTED_PRE_007_SCHEMA_MANIFEST, 'PRE_007');
  const transaction = buildIncrementalTransaction({
    migration: inventory[6],
    revision: controls.identity.revision,
    target: values.target,
    operator: values.operator,
    startedAt: dependencies.startedAt
  });
  try {
    executeTeamDb(transaction, spawn);
  } catch (error) {
    try {
      requireForeignKeyEnforcement(spawn);
      if (classifyLedger(inventory, spawn) !== 'PRE_007') {
        fail('INTERRUPTION_UNRECONCILED');
      }
      await schemaVerifier(EXPECTED_PRE_007_SCHEMA_MANIFEST, 'PRE_007');
    } catch (_) {
      fail('INTERRUPTION_UNRECONCILED');
    }
    throw error;
  }
  requireForeignKeyEnforcement(spawn);
  if (classifyLedger(inventory, spawn) !== 'COMPLETE') fail('POST_MIGRATION_RECONCILIATION_FAILED');
  await schemaVerifier(EXPECTED_SCHEMA_MANIFEST, 'COMPLETE');
  const output = Object.freeze({
    status: 'COMPLETED',
    authority_reference: controls.authorization.authority_reference,
    canonical_migration_manifest_sha256: manifest.sha256,
    feature_enabled: false,
    revision: controls.identity.revision,
    tree: controls.identity.tree,
    target: values.target,
    migrations: inventory.map(({ content, ...entry }) => entry)
  });
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
  buildControlledTransaction,
  buildIncrementalTransaction,
  classifyLedger,
  executeTeamDb,
  inspectLedger,
  main,
  migrationManifestDigest,
  parseArgs,
  expectedRepositoryRoot,
  resolveRepositoryIdentity,
  teamDbQuery,
  TARGET_CONFIGURATION_MAX_VALIDITY_MS,
  requireForeignKeyEnforcement,
  validateAuthorization,
  validateCanonicalInventory,
  validateControls,
  validateTargetConfigurationEvidence,
  validateMigrationAuthority,
  verifyTargetSchema
};
