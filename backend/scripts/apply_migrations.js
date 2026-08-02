const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  EXPECTED_PRE_ALIGNMENT_SCHEMA_MANIFEST,
  EXPECTED_PRE_008_SCHEMA_MANIFEST,
  EXPECTED_SCHEMA_MANIFEST,
  EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST,
  FINAL_SCHEMA_INVENTORY_DIGEST_DOMAIN,
  FINAL_SCHEMA_INVENTORY_SHA256,
  PREDECESSOR_BASE_SCHEMA_MANIFEST,
  featureDisabled,
  migrationInventory,
  MigrationControlError,
  verifyEmptyDatastore,
  verifyFinalTriggers,
  verifyFinalSchemaInventory,
  verifyRepairablePre007Triggers,
  verifyPredecessorBaseSchema,
  verifyStructuralSchema
} = require('./verify_schema');
const {
  buildForeignKeyViolationCheck
} = require('./foreign_key_integrity_readonly');

function fail(code) {
  throw new MigrationControlError(code);
}

const TARGET_CONFIGURATION_MAX_VALIDITY_MS = 4 * 60 * 60 * 1000;
const OWNER_RISK_WAIVER_MAX_VALIDITY_MS = 15 * 60 * 1000;
const PROTECTED_V1_TARGET_ID = 'f499a22e-a253-45ee-8677-8cdd315ded16';
const OWNER_RISK_WAIVED_CONDITIONS = Object.freeze([
  'DATABASE_BACKUP_RESTORATION_UNPROVEN',
  'EXTERNAL_TURSO_ROLLBACK_REHEARSAL_UNPROVEN'
]);
const PREDECESSOR_BASE_SCHEMA_FILENAME = 'predecessor_base_schema.sql';
const PREDECESSOR_BASE_SCHEMA_SHA256 =
  '039c7198613bb77ec932ebfbedb6296269f105f8680ad7731d1cf685e98300cf';
const PREDECESSOR_BASE_PROVENANCE = Object.freeze({
  commit: '9da18cb6698bb72f27d9edc29e9e5819fb96187a',
  blob: '51c7493d7830b79f099c866230af03af49650b98',
  raw_sha256: '5e87967515219ddda76ca51bb62dcd7443ab2796f8a99f1a8da5409569da9f78'
});

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

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function suppliedEvidence(options, optionKey, values, argumentKey, code) {
  const injected = hasOwn(options, optionKey);
  const argument = hasOwn(values, argumentKey);
  if (injected && argument) fail('CONTROL_EVIDENCE_SOURCE_CONFLICT');
  if (injected) return { present: true, value: options[optionKey] };
  if (argument) return { present: true, value: readEvidence(values[argumentKey], code) };
  return { present: false, value: undefined };
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
    ':(top)backend/bootstrap',
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
  const waiverInput = suppliedEvidence(
    options, 'ownerRiskWaiver', values, 'owner-risk-waiver', 'OWNER_RISK_WAIVER_REQUIRED'
  );
  const backupInput = suppliedEvidence(
    options, 'backup', values, 'backup', 'BACKUP_PREREQUISITE'
  );
  const qualificationInput = suppliedEvidence(
    options, 'qualification', values, 'qualification', 'TRANSACTION_QUALIFICATION_REQUIRED'
  );
  let backup;
  let qualification;
  let controlledOwnerRiskWaiver;
  if (waiverInput.present) {
    if (backupInput.present) {
      fail('OWNER_RISK_WAIVER_EVIDENCE_CONFLICT');
    }
    if (!qualificationInput.present) fail('TRANSACTION_QUALIFICATION_REQUIRED');
    controlledOwnerRiskWaiver = validateOwnerRiskWaiver(
      waiverInput.value,
      authorization,
      identity,
      options.now || new Date()
    );
    qualification = validateQualificationEvidence(
      qualificationInput.value,
      preflight,
      true
    );
  } else {
    if (!backupInput.present) fail('BACKUP_PREREQUISITE');
    if (!qualificationInput.present) fail('TRANSACTION_QUALIFICATION_REQUIRED');
    backup = backupInput.value;
    qualification = validateQualificationEvidence(
      qualificationInput.value,
      preflight,
      false
    );
  }
  const targetConfiguration = options.targetConfiguration || readEvidence(
    values['target-configuration'],
    'TARGET_CONFIGURATION_EVIDENCE_REQUIRED'
  );
  if (preflight.target_id !== values.target || preflight.verified !== true ||
      !preflight.schema_sha256 || preflight.authority_reference !== authorization.authority_reference) {
    fail('PREFLIGHT_REQUIRED');
  }
  if (!controlledOwnerRiskWaiver) {
    if (!backup || typeof backup !== 'object' || Array.isArray(backup) ||
        backup.target_id !== values.target || backup.verified !== true ||
        backup.restoration_rehearsed !== true || !backup.backup_sha256) {
      fail('BACKUP_PREREQUISITE');
    }
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
    ownerRiskWaiver: controlledOwnerRiskWaiver,
    evidenceMode: controlledOwnerRiskWaiver ? 'OWNER_RISK_WAIVER' : 'PROVEN',
    targetConfiguration: controlledTargetConfiguration
  });
}

function validateQualificationEvidence(qualification, preflight, waiverMode) {
  const keys = [
    'target_class',
    'rollback_verified',
    'adapter_identity',
    'runtime_identity',
    'test_payload_sha256'
  ];
  if (!qualification || typeof qualification !== 'object' ||
      Array.isArray(qualification) ||
      Object.keys(qualification).sort().join('|') !== keys.sort().join('|') ||
      qualification.target_class !== preflight.target_class ||
      typeof qualification.adapter_identity !== 'string' ||
      !qualification.adapter_identity.trim() ||
      typeof qualification.runtime_identity !== 'string' ||
      !qualification.runtime_identity.trim() ||
      !/^[a-f0-9]{64}$/.test(qualification.test_payload_sha256 || '') ||
      qualification.rollback_verified !== (waiverMode ? false : true)) {
    fail('TRANSACTION_QUALIFICATION_REQUIRED');
  }
  return Object.freeze({ ...qualification });
}

function ownerRiskWaiverDigest(waiver) {
  const canonical = JSON.stringify({
    target_id: waiver.target_id,
    owner_authority_identity: waiver.owner_authority_identity,
    owner_authority_reference: waiver.owner_authority_reference,
    waived_conditions: waiver.waived_conditions,
    authorised_revision: waiver.authorised_revision,
    authorised_tree: waiver.authorised_tree,
    issued_at: waiver.issued_at,
    expires_at: waiver.expires_at,
    nonce: waiver.nonce,
    production_execution_risk_accepted: waiver.production_execution_risk_accepted
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function validateOwnerRiskWaiver(waiver, authorization, identity, now = new Date()) {
  const keys = [
    'target_id',
    'owner_authority_identity',
    'owner_authority_reference',
    'waived_conditions',
    'authorised_revision',
    'authorised_tree',
    'issued_at',
    'expires_at',
    'nonce',
    'production_execution_risk_accepted',
    'waiver_sha256'
  ];
  const issuedAt = Date.parse(waiver?.issued_at);
  const expiresAt = Date.parse(waiver?.expires_at);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!waiver || typeof waiver !== 'object' || Array.isArray(waiver) ||
      Object.keys(waiver).sort().join('|') !== keys.sort().join('|') ||
      waiver.target_id !== PROTECTED_V1_TARGET_ID ||
      authorization.target_id !== PROTECTED_V1_TARGET_ID ||
      waiver.owner_authority_identity !== 'Jay Bower' ||
      waiver.owner_authority_reference !== authorization.authority_reference ||
      JSON.stringify(waiver.waived_conditions) !==
        JSON.stringify(OWNER_RISK_WAIVED_CONDITIONS) ||
      waiver.authorised_revision !== identity.revision ||
      waiver.authorised_tree !== identity.tree ||
      !/^[a-f0-9]{40}$/.test(waiver.authorised_revision || '') ||
      !/^[a-f0-9]{40}$/.test(waiver.authorised_tree || '') ||
      !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      !Number.isFinite(current) || expiresAt <= issuedAt ||
      expiresAt - issuedAt > OWNER_RISK_WAIVER_MAX_VALIDITY_MS ||
      current < issuedAt || current >= expiresAt ||
      !/^[a-f0-9]{32,128}$/.test(waiver.nonce || '') ||
      waiver.production_execution_risk_accepted !== true ||
      !/^[a-f0-9]{64}$/.test(waiver.waiver_sha256 || '') ||
      waiver.waiver_sha256 !== ownerRiskWaiverDigest(waiver)) {
    fail('OWNER_RISK_WAIVER_INVALID');
  }
  return Object.freeze({
    ...waiver,
    waived_conditions: Object.freeze([...waiver.waived_conditions])
  });
}

function ownerRiskWaiverRetryRequired(waiver, attemptOutcome, priorError) {
  const error = new MigrationControlError('OWNER_RISK_WAIVER_RETRY_REQUIRED');
  error.retry_contract = Object.freeze({
    status: 'STOP_OWNER_REAPPROVAL_REQUIRED',
    attempt_outcome: attemptOutcome,
    prior_error_code: priorError?.code || 'MIGRATION_FAILED',
    prior_waiver_sha256: waiver.waiver_sha256,
    retry_requires_new_owner_approved_waiver: true,
    retry_requires_new_nonce: true,
    retry_requires_new_issued_at: true,
    durable_cross_attempt_nonce_consumption_available: false
  });
  return error;
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

function predecessorBaseSchema(
  bootstrapDir = path.join(__dirname, '../bootstrap')
) {
  const file = path.join(bootstrapDir, PREDECESSOR_BASE_SCHEMA_FILENAME);
  let content;
  try {
    content = fs.readFileSync(file);
  } catch (_) {
    fail('BASE_SCHEMA_ARTIFACT_INVALID');
  }
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  if (sha256 !== PREDECESSOR_BASE_SCHEMA_SHA256) fail('BASE_SCHEMA_ARTIFACT_INVALID');
  return Object.freeze({
    filename: PREDECESSOR_BASE_SCHEMA_FILENAME,
    sha256,
    provenance: PREDECESSOR_BASE_PROVENANCE,
    content: content.toString('utf8')
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
    '007_preference_retention_cases_forward_repair.sql',
    '008_v1_contract_alignment_forward_repair.sql'
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

function buildBootstrapTransaction({
  baseSchema,
  inventory,
  revision,
  target,
  operator,
  startedAt
}) {
  if (!baseSchema || baseSchema.sha256 !== PREDECESSOR_BASE_SCHEMA_SHA256 ||
      typeof baseSchema.content !== 'string') {
    fail('BASE_SCHEMA_ARTIFACT_INVALID');
  }
  const timestamp = startedAt || new Date().toISOString();
  const statements = [
    'PRAGMA foreign_keys = OFF;',
    'BEGIN IMMEDIATE;',
    baseSchema.content,
    `CREATE TABLE schema_migrations (
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
    );`
  ];
  for (const migration of inventory) {
    statements.push(migration.content);
    statements.push(`INSERT INTO schema_migrations
      (migration_id,filename,sequence,checksum,application_revision,target_identifier,
       started_at,completed_at,operator_identity,outcome)
      VALUES (${sql(migration.migration_id)},${sql(migration.filename)},${migration.sequence},
      ${sql(migration.checksum)},${sql(revision)},${sql(target)},${sql(timestamp)},
      CURRENT_TIMESTAMP,${sql(operator)},'COMPLETED');`);
  }
  statements.push('COMMIT;', 'PRAGMA foreign_keys = ON;');
  return statements.join('\n');
}

function buildIncrementalTransaction({ migration, revision, target, operator, startedAt }) {
  const allowed = Object.freeze({
    '007': Object.freeze({
      sequence: 7,
      filename: '007_preference_retention_cases_forward_repair.sql'
    }),
    '008': Object.freeze({
      sequence: 8,
      filename: '008_v1_contract_alignment_forward_repair.sql'
    })
  });
  const expected = migration && allowed[migration.migration_id];
  if (!expected || migration.sequence !== expected.sequence ||
      migration.filename !== expected.filename) {
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
  if (spawn === spawnSync) {
    const configuredPath = process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR;
    const configuredSha256 = process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR_SHA256;
    if (!configuredPath || !path.isAbsolute(configuredPath) ||
        !/^[a-f0-9]{64}$/.test(configuredSha256 || '')) {
      fail('MIGRATION_EXECUTOR_REQUIRED');
    }
    let executable;
    let executableSha256;
    try {
      executable = fs.realpathSync(configuredPath);
      const stat = fs.statSync(executable);
      if (!stat.isFile() || (stat.mode & 0o111) === 0) fail('MIGRATION_EXECUTOR_INVALID');
      executableSha256 = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
    } catch (error) {
      if (error?.code === 'MIGRATION_EXECUTOR_INVALID') throw error;
      fail('MIGRATION_EXECUTOR_INVALID');
    }
    if (executableSha256 !== configuredSha256) fail('MIGRATION_EXECUTOR_INVALID');
    const payloadSha256 = crypto.createHash('sha256').update(transactionSql).digest('hex');
    const result = spawn(executable, [
      '--protocol', 'LEADSPROUT_ATOMIC_SQL_V1',
      '--payload-sha256', payloadSha256
    ], {
      encoding: 'utf8',
      env: { ...process.env },
      input: transactionSql
    });
    if (result.error || result.status !== 0) fail('MIGRATION_ATOMIC_EXECUTION_FAILED');
    let receipt;
    try { receipt = JSON.parse(result.stdout || ''); } catch (_) {
      fail('MIGRATION_EXECUTOR_RECEIPT_INVALID');
    }
    if (!receipt || receipt.status !== 'COMMITTED' || receipt.payload_sha256 !== payloadSha256 ||
        receipt.protocol !== 'LEADSPROUT_ATOMIC_SQL_V1' || receipt.foreign_keys_restored !== true ||
        receipt.connection_closed !== true) {
      fail('MIGRATION_EXECUTOR_RECEIPT_INVALID');
    }
    return Object.freeze({ executable, executable_sha256: executableSha256, ...receipt });
  }

  // Injected executors are used only by the disposable adapter test matrix.
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
  if (![6, 7, 8].includes(rows.length)) fail('LEDGER_DIRTY');
  rows.forEach((row, index) => {
    const expected = inventory[index];
    if (!expected) fail('LEDGER_UNKNOWN');
    if (row.migration_id !== expected.migration_id || row.filename !== expected.filename ||
        Number(row.sequence) !== expected.sequence) fail('LEDGER_ORDER');
    if (row.checksum !== expected.checksum) fail('LEDGER_CHECKSUM');
    if (row.outcome !== 'COMPLETED' && row.outcome !== 'ADOPTED') fail('LEDGER_DIRTY');
  });
  if (rows.length === 6) return 'PRE_007_ALIGNMENT';
  if (rows.length === 7) return 'PRE_008';
  return 'COMPLETE';
}

function inspectLedger(inventory, spawn = spawnSync) {
  return classifyLedger(inventory, spawn);
}

function teamDbQuery(spawn = spawnSync) {
  return Object.freeze({
    all: async statement => teamDbRows(statement, spawn)
  });
}

async function requireForeignKeyIntegrity(query, contract) {
  const check = buildForeignKeyViolationCheck(
    contract,
    PREDECESSOR_BASE_SCHEMA_MANIFEST
  );
  if (check.relationship_count !== 71) fail('SCHEMA_MISMATCH');
  const rows = await query.all(check.sql);
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] ||
      Object.keys(rows[0]).join('\n') !== 'foreign_key_violation_count') {
    fail('SCHEMA_MISMATCH');
  }
  const violationCount = Number(rows[0].foreign_key_violation_count);
  if (!Number.isSafeInteger(violationCount) || violationCount !== 0) {
    fail('SCHEMA_MISMATCH');
  }
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
    if (phase === 'PRE_007_ALIGNMENT') {
      await verifyRepairablePre007Triggers(query);
    }
    if (phase === 'PRE_008') {
      await verifyFinalTriggers(query);
    }
    if (phase === 'BOOTSTRAP_COMPLETE' || phase === 'COMPLETE') {
      await verifyPredecessorBaseSchema(query, { afterMigration001: true });
    }
    await verifyStructuralSchema(query, contract);
    await requireForeignKeyIntegrity(query, contract);
    if (phase === 'BOOTSTRAP_COMPLETE' || phase === 'COMPLETE') {
      await verifyFinalSchemaInventory(query);
    }
  } catch (error) {
    if ([
      'FOREIGN_KEY_ENFORCEMENT_REQUIRED',
      'SCHEMA_MISMATCH'
    ].includes(error?.code)) throw error;
    fail('SCHEMA_MISMATCH');
  }
}

async function main(args = process.argv.slice(2), dependencies = {}) {
  const values = parseArgs(args);
  const controlDependencies = {
    authorization: dependencies.authorization,
    env: dependencies.env,
    identity: dependencies.identity,
    now: dependencies.now,
    preflight: dependencies.preflight,
    repositorySpawn: dependencies.repositorySpawn,
    repositorySourceFile: dependencies.repositorySourceFile,
    targetConfiguration: dependencies.targetConfiguration
  };
  for (const key of ['backup', 'ownerRiskWaiver', 'qualification']) {
    if (hasOwn(dependencies, key)) controlDependencies[key] = dependencies[key];
  }
  const controls = validateControls(values, controlDependencies);
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
  const baseSchema = predecessorBaseSchema(dependencies.bootstrapDir);
  const spawn = dependencies.spawn || spawnSync;
  const schemaVerifier = dependencies.schemaVerifier ||
    ((contract, phase) => verifyTargetSchema(contract, phase, spawn));
  let ledgerState;
  try {
    ledgerState = classifyLedger(inventory, spawn);
  } catch (error) {
    if (error?.code !== 'LEDGER_MISSING') throw error;
    try {
      const query = teamDbQuery(spawn);
      requireForeignKeyEnforcement(spawn);
      await verifyEmptyDatastore(query);
      ledgerState = 'EMPTY';
    } catch (emptyError) {
      if (emptyError?.code === 'EMPTY_DATASTORE_REQUIRED') throw emptyError;
      fail('EMPTY_DATASTORE_INSPECTION_FAILED');
    }
  }
  if (controls.ownerRiskWaiver && ledgerState === 'COMPLETE') {
    fail('OWNER_RISK_WAIVER_REPLAYED');
  }
  if (ledgerState === 'COMPLETE') {
    await schemaVerifier(EXPECTED_SCHEMA_MANIFEST, 'COMPLETE');
    const output = Object.freeze({
      status: 'VERIFIED_NOOP',
      authority_reference: controls.authorization.authority_reference,
      canonical_migration_manifest_sha256: manifest.sha256,
      final_schema_inventory_sha256: FINAL_SCHEMA_INVENTORY_SHA256,
      final_schema_inventory_digest_domain: FINAL_SCHEMA_INVENTORY_DIGEST_DOMAIN,
      final_schema_inventory_serialization:
        EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST.serialization,
      final_schema_inventory_preimage_byte_length:
        EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST.byte_length,
      feature_enabled: false,
      evidence_mode: controls.evidenceMode,
      revision: controls.identity.revision,
      tree: controls.identity.tree,
      target: values.target,
      migrations: inventory.map(({ content, ...entry }) => entry)
    });
    console.log(JSON.stringify(output));
    return output;
  }
  if (ledgerState === 'EMPTY') {
    if (controls.qualification.target_class !== 'DISPOSABLE' ||
        controls.ownerRiskWaiver ||
        values.target === PROTECTED_V1_TARGET_ID) {
      fail('BOOTSTRAP_DISPOSABLE_TARGET_REQUIRED');
    }
    const transaction = buildBootstrapTransaction({
      baseSchema,
      inventory,
      revision: controls.identity.revision,
      target: values.target,
      operator: values.operator,
      startedAt: dependencies.startedAt
    });
    let reconciled = false;
    try {
      executeTeamDb(transaction, spawn);
    } catch (executionError) {
      try {
        requireForeignKeyEnforcement(spawn);
        if (classifyLedger(inventory, spawn) !== 'COMPLETE') {
          fail('INTERRUPTION_UNRECONCILED');
        }
        await schemaVerifier(EXPECTED_SCHEMA_MANIFEST, 'BOOTSTRAP_COMPLETE');
        reconciled = true;
      } catch (reconciliationError) {
        if (reconciliationError?.code === 'LEDGER_MISSING') {
          try {
            await verifyEmptyDatastore(teamDbQuery(spawn));
            throw executionError;
          } catch (emptyError) {
            if (emptyError === executionError) throw emptyError;
          }
        }
        fail('INTERRUPTION_UNRECONCILED');
      }
    }
    requireForeignKeyEnforcement(spawn);
    if (classifyLedger(inventory, spawn) !== 'COMPLETE') {
      fail('POST_MIGRATION_RECONCILIATION_FAILED');
    }
    await schemaVerifier(EXPECTED_SCHEMA_MANIFEST, 'BOOTSTRAP_COMPLETE');
    const output = Object.freeze({
      status: reconciled ? 'COMPLETED_RECONCILED' : 'COMPLETED',
      authority_reference: controls.authorization.authority_reference,
      canonical_migration_manifest_sha256: manifest.sha256,
      final_schema_inventory_sha256: FINAL_SCHEMA_INVENTORY_SHA256,
      final_schema_inventory_digest_domain: FINAL_SCHEMA_INVENTORY_DIGEST_DOMAIN,
      final_schema_inventory_serialization:
        EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST.serialization,
      final_schema_inventory_preimage_byte_length:
        EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST.byte_length,
      predecessor_base_schema_sha256: baseSchema.sha256,
      predecessor_base_provenance: baseSchema.provenance,
      feature_enabled: false,
      evidence_mode: controls.evidenceMode,
      revision: controls.identity.revision,
      tree: controls.identity.tree,
      target: values.target,
      migrations: inventory.map(({ content, ...entry }) => entry)
    });
    console.log(JSON.stringify(output));
    return output;
  }
  const stages = ledgerState === 'PRE_007_ALIGNMENT'
    ? [
        Object.freeze({
          before: 'PRE_007_ALIGNMENT',
          after: 'PRE_008',
          contract: EXPECTED_PRE_ALIGNMENT_SCHEMA_MANIFEST,
          phase: 'PRE_007_ALIGNMENT',
          migration: inventory[6]
        }),
        Object.freeze({
          before: 'PRE_008',
          after: 'COMPLETE',
          contract: EXPECTED_PRE_008_SCHEMA_MANIFEST,
          phase: 'PRE_008',
          migration: inventory[7]
        })
      ]
    : [Object.freeze({
        before: 'PRE_008',
        after: 'COMPLETE',
        contract: EXPECTED_PRE_008_SCHEMA_MANIFEST,
        phase: 'PRE_008',
        migration: inventory[7]
      })];

  for (const stage of stages) {
    await schemaVerifier(stage.contract, stage.phase);
    const transaction = buildIncrementalTransaction({
      migration: stage.migration,
      revision: controls.identity.revision,
      target: values.target,
      operator: values.operator,
      startedAt: dependencies.startedAt
    });
    try {
      executeTeamDb(transaction, spawn);
    } catch (error) {
      let reconciled = false;
      try {
        requireForeignKeyEnforcement(spawn);
        if (classifyLedger(inventory, spawn) !== stage.before) {
          fail('INTERRUPTION_UNRECONCILED');
        }
        await schemaVerifier(stage.contract, stage.phase);
        reconciled = true;
      } catch (_) {
        reconciled = false;
      }
      if (controls.ownerRiskWaiver) {
        throw ownerRiskWaiverRetryRequired(
          controls.ownerRiskWaiver,
          reconciled ? `FAILED_OR_INTERRUPTED_RECONCILED_${stage.before}` : 'INDETERMINATE',
          error
        );
      }
      if (!reconciled) fail('INTERRUPTION_UNRECONCILED');
      throw error;
    }
    try {
      requireForeignKeyEnforcement(spawn);
      if (classifyLedger(inventory, spawn) !== stage.after) {
        fail('POST_MIGRATION_RECONCILIATION_FAILED');
      }
      if (stage.after === 'PRE_008') {
        await schemaVerifier(EXPECTED_PRE_008_SCHEMA_MANIFEST, 'PRE_008');
      } else {
        await schemaVerifier(EXPECTED_SCHEMA_MANIFEST, 'COMPLETE');
      }
    } catch (error) {
      if (controls.ownerRiskWaiver) {
        throw ownerRiskWaiverRetryRequired(
          controls.ownerRiskWaiver,
          'POST_EXECUTION_UNVERIFIED',
          error
        );
      }
      throw error;
    }
  }
  const output = Object.freeze({
    status: 'COMPLETED',
    authority_reference: controls.authorization.authority_reference,
    canonical_migration_manifest_sha256: manifest.sha256,
    final_schema_inventory_sha256: FINAL_SCHEMA_INVENTORY_SHA256,
    final_schema_inventory_digest_domain: FINAL_SCHEMA_INVENTORY_DIGEST_DOMAIN,
    final_schema_inventory_serialization:
      EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST.serialization,
    final_schema_inventory_preimage_byte_length:
      EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST.byte_length,
    feature_enabled: false,
    evidence_mode: controls.evidenceMode,
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
    console.error(JSON.stringify({
      code: error.code || 'MIGRATION_FAILED',
      ...(error.retry_contract ? { retry_contract: error.retry_contract } : {})
    }));
    process.exitCode = 1;
  });
}

module.exports = {
  buildBootstrapTransaction,
  buildControlledTransaction,
  buildIncrementalTransaction,
  classifyLedger,
  executeTeamDb,
  inspectLedger,
  main,
  migrationManifestDigest,
  OWNER_RISK_WAIVER_MAX_VALIDITY_MS,
  OWNER_RISK_WAIVED_CONDITIONS,
  ownerRiskWaiverDigest,
  ownerRiskWaiverRetryRequired,
  parseArgs,
  predecessorBaseSchema,
  PREDECESSOR_BASE_PROVENANCE,
  PREDECESSOR_BASE_SCHEMA_SHA256,
  PROTECTED_V1_TARGET_ID,
  expectedRepositoryRoot,
  resolveRepositoryIdentity,
  teamDbQuery,
  TARGET_CONFIGURATION_MAX_VALIDITY_MS,
  requireForeignKeyEnforcement,
  requireForeignKeyIntegrity,
  validateAuthorization,
  validateCanonicalInventory,
  validateControls,
  validateTargetConfigurationEvidence,
  validateMigrationAuthority,
  validateOwnerRiskWaiver,
  validateQualificationEvidence,
  verifyTargetSchema
};
