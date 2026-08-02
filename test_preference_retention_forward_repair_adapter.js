const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  buildControlledTransaction,
  buildIncrementalTransaction,
  executeTeamDb,
  main: runMigration,
  migrationManifestDigest,
  OWNER_RISK_WAIVED_CONDITIONS,
  ownerRiskWaiverDigest,
  predecessorBaseSchema,
  PROTECTED_V1_TARGET_ID,
  requireForeignKeyEnforcement,
  requireForeignKeyIntegrity,
  validateControls
} = require('./backend/scripts/apply_migrations');
const {
  EXPECTED_PRE_ALIGNMENT_SCHEMA_MANIFEST,
  FINAL_TRIGGER_NAMES,
  MIGRATION_005_INTEGRITY_TRIGGER_NAMES,
  MIGRATIONS,
  migrationInventory,
  expectedFinalTriggers,
  normalizeSql,
  PREDECESSOR_BASE_SCHEMA_MANIFEST,
  PREFERENCE_RETENTION_TRIGGER_NAMES
} = require('./backend/scripts/verify_schema');
const {
  buildForeignKeyViolationCheck
} = require('./backend/scripts/foreign_key_integrity_readonly');
const { legacyDefinitions } = require('./test_v1_contract_alignment_forward_repair');

const SQLITE = '/usr/bin/sqlite3';
const inventory = migrationInventory();
const manifest = migrationManifestDigest(inventory);
const repair = inventory[6];
let passed = 0;

function test(name, callback) {
  callback();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

function sqlite(database, statement) {
  return spawnSync(SQLITE, ['-json', database, statement], {
    encoding: 'utf8',
    env: { ...process.env }
  });
}

function adapter(database, observations = {}) {
  return (_command, args) => {
    const statement = args[0];
    observations.statements?.push(statement);
    return sqlite(database, statement);
  };
}

function rows(database, statement) {
  const result = sqlite(database, statement);
  if (result.status !== 0) throw new Error(result.stderr || 'sqlite query failed');
  return JSON.parse(result.stdout || '[]');
}

function scalar(database, statement, field) {
  return rows(database, statement)[0]?.[field];
}

function ledgerSql(count = 6) {
  return inventory.slice(0, count).map(item => `
    INSERT INTO schema_migrations
      (migration_id,filename,sequence,checksum,application_revision,target_identifier,
       started_at,completed_at,operator_identity,outcome)
    VALUES (
      '${item.migration_id}','${item.filename}',${item.sequence},'${item.checksum}',
      'synthetic-revision','synthetic-disposable-target','2026-07-29T00:00:00Z',
      '2026-07-29T00:00:01Z','synthetic-test','COMPLETED'
    );`).join('\n');
}

function syntheticPre007Triggers() {
  return [...MIGRATION_005_INTEGRITY_TRIGGER_NAMES, ...PREFERENCE_RETENTION_TRIGGER_NAMES]
    .map(name => `CREATE TRIGGER ${name} AFTER INSERT ON unrelated_synthetic_table
      BEGIN SELECT 1; END;`)
    .join('\n');
}

function createFixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leadsprout-forward-repair-'));
  const database = path.join(directory, 'synthetic.sqlite');
  const setup = sqlite(database, `
    PRAGMA foreign_keys = ON;
    CREATE TABLE organization_memberships (
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      membership_state TEXT NOT NULL,
      ended_at TEXT,
      PRIMARY KEY (organization_id,user_id)
    );
    CREATE TABLE workspace_organization_access (
      workspace_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      access_state TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE preference_audit_subjects (
      audit_subject_id TEXT PRIMARY KEY
    );
    CREATE TABLE preference_audit_events (
      audit_event_id TEXT PRIMARY KEY
    );
    CREATE TABLE preference_retention_cases (
      retention_case_id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('MEMBERSHIP','WORKSPACE')),
      organization_id TEXT NOT NULL,
      user_id TEXT,
      workspace_id TEXT,
      inactive_at TEXT NOT NULL,
      deletion_due_at TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('PENDING','HELD','COMPLETED','FAILED')),
      claim_identity TEXT,
      claimed_at TEXT,
      completed_at TEXT,
      failure_code TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(scope_type,organization_id,user_id,workspace_id,inactive_at)
    );
    CREATE TABLE preference_retention_holds (
      retention_hold_id TEXT PRIMARY KEY,
      retention_case_id TEXT NOT NULL,
      authority_domain TEXT NOT NULL CHECK (authority_domain IN ('LEGAL','SECURITY')),
      external_record_reference TEXT NOT NULL,
      external_record_digest TEXT NOT NULL,
      reason_class TEXT NOT NULL,
      verified_actor_identity TEXT NOT NULL,
      verified_release_actor_identity TEXT,
      state TEXT NOT NULL CHECK (state IN ('ACTIVE','RELEASED')),
      created_at TEXT NOT NULL,
      released_at TEXT,
      CHECK (
        (state='ACTIVE' AND released_at IS NULL AND verified_release_actor_identity IS NULL) OR
        (state='RELEASED' AND released_at IS NOT NULL AND verified_release_actor_identity IS NOT NULL)
      ),
      FOREIGN KEY (retention_case_id)
        REFERENCES preference_retention_cases(retention_case_id) ON DELETE RESTRICT
    );
    CREATE INDEX idx_preference_retention_due
      ON preference_retention_cases(state,deletion_due_at,retention_case_id);
    CREATE INDEX idx_preference_retention_holds_case
      ON preference_retention_holds(retention_case_id,state);
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
      outcome TEXT NOT NULL
    );
    CREATE TABLE unrelated_synthetic_table (
      id TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE report_versions (
      report_version_id TEXT PRIMARY KEY,
      report_id TEXT,
      report_version_sequence INTEGER,
      organization_id TEXT,
      workspace_id TEXT,
      workspace_version TEXT,
      candidate_snapshot_id TEXT,
      policy_version TEXT,
      evidence_authority_snapshot_id TEXT,
      generation_attempt_id TEXT,
      judgement_json TEXT,
      evidence_composition_json TEXT,
      confidence_classification TEXT,
      confidence_basis TEXT,
      limitations_json TEXT,
      contradictions_json TEXT,
      provenance_json TEXT,
      content_digest TEXT,
      rendering_contract_version TEXT,
      report_state TEXT,
      generated_at TEXT,
      created_at TEXT
    );
    CREATE TABLE report_artifacts (id TEXT PRIMARY KEY, artifact_state TEXT);
    CREATE TABLE customer_activity_events (id TEXT PRIMARY KEY);
    CREATE TABLE activity_event_sources (id TEXT PRIMARY KEY);
    ${ledgerSql()}
    ${options.rows || ''}
    ${options.triggers === undefined ? syntheticPre007Triggers() : options.triggers}
  `);
  if (setup.status !== 0) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw new Error(setup.stderr || 'fixture setup failed');
  }
  return {
    database,
    dispose: () => fs.rmSync(directory, { recursive: true, force: true })
  };
}

function createFullFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leadsprout-forward-repair-full-'));
  const database = path.join(directory, 'synthetic.sqlite');
  const baseline = buildControlledTransaction({
    inventory: inventory.slice(0, 6),
    revision: 'synthetic-pre-007',
    target: 'synthetic-disposable-target',
    operator: 'synthetic-test',
    startedAt: '2026-07-29T00:00:00Z'
  });
  const predecessor = predecessorBaseSchema();
  const setup = sqlite(database, `
    ${predecessor.content}
    ${baseline}
  `);
  if (setup.status !== 0) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw new Error(setup.stderr || 'full fixture baseline failed');
  }
  const damage = sqlite(database, `
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    ${legacyDefinitions()}
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
  if (damage.status !== 0) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw new Error(damage.stderr || 'full fixture controlled damage failed');
  }
  assert.strictEqual(scalar(database,
    "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger'", 'count'), 17);
  assert.strictEqual(scalar(database,
    'SELECT COUNT(*) AS count FROM schema_migrations', 'count'), 6);
  return {
    database,
    dispose: () => fs.rmSync(directory, { recursive: true, force: true })
  };
}

function transaction(content = repair.content) {
  return buildIncrementalTransaction({
    migration: { ...repair, content },
    revision: 'a'.repeat(40),
    target: 'synthetic-disposable-target',
    operator: 'synthetic-test',
    startedAt: '2026-07-29T00:00:00Z'
  });
}

function assertPre007(database, expectedRows, expectedTriggers = 17) {
  assert.strictEqual(scalar(database,
    'SELECT COUNT(*) AS count FROM preference_retention_cases', 'count'), expectedRows);
  assert.strictEqual(scalar(database,
    'SELECT COUNT(*) AS count FROM schema_migrations', 'count'), 6);
  assert.strictEqual(scalar(database,
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger'", 'count'), expectedTriggers);
  assert.deepStrictEqual(rows(database, 'PRAGMA foreign_key_check'), []);
}

const membership = `
  INSERT INTO organization_memberships
    (organization_id,user_id,membership_state,ended_at)
  VALUES ('org-1','user-1','INACTIVE','2026-07-01T00:00:00Z');
  INSERT INTO preference_retention_cases
    (retention_case_id,scope_type,organization_id,user_id,workspace_id,inactive_at,
     deletion_due_at,state,created_at)
  VALUES (
    'case-1','MEMBERSHIP','org-1','user-1',NULL,'2026-07-01T00:00:00Z',
    '2026-07-31T00:00:00Z','HELD','2026-07-01T00:00:00Z'
  );
  INSERT INTO preference_retention_holds
    (retention_hold_id,retention_case_id,authority_domain,external_record_reference,
     external_record_digest,reason_class,verified_actor_identity,state,created_at)
  VALUES (
    'hold-1','case-1','LEGAL','synthetic-reference','synthetic-digest',
    'synthetic-reason','synthetic-actor','ACTIVE','2026-07-02T00:00:00Z'
  );`;

test('zero-row repair preserves zero rows and creates exact trigger inventory', () => {
  const fixture = createFixture();
  try {
    requireForeignKeyEnforcement(adapter(fixture.database));
    executeTeamDb(transaction(), adapter(fixture.database));
    assert.strictEqual(scalar(fixture.database,
      'SELECT COUNT(*) AS count FROM preference_retention_cases', 'count'), 0);
    assert.deepStrictEqual(
      rows(fixture.database,
        "SELECT name FROM sqlite_schema WHERE type='trigger' ORDER BY name"
      ).map(row => row.name).sort(),
      [...FINAL_TRIGGER_NAMES].sort()
    );
    const expected = expectedFinalTriggers();
    for (const row of rows(fixture.database,
      "SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name")) {
      assert.strictEqual(normalizeSql(row.sql), expected[row.name], row.name);
    }
    assert.deepStrictEqual(rows(fixture.database, 'PRAGMA foreign_key_check'), []);
    assert.strictEqual(scalar(fixture.database,
      "SELECT COUNT(*) AS count FROM schema_migrations WHERE migration_id='007'", 'count'), 1);
    requireForeignKeyEnforcement(adapter(fixture.database));
  } finally {
    fixture.dispose();
  }
});

test('captured zero-trigger prestate repairs atomically to exact canonical 17', () => {
  const fixture = createFullFixture();
  try {
    const drops = FINAL_TRIGGER_NAMES.map(name => `DROP TRIGGER IF EXISTS ${name};`).join('\n');
    const cleared = sqlite(fixture.database, drops);
    if (cleared.status !== 0) throw new Error(cleared.stderr || 'trigger reset failed');
    assert.strictEqual(scalar(fixture.database,
      "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger'", 'count'), 0);
    executeTeamDb(transaction(), adapter(fixture.database));
    assert.strictEqual(scalar(fixture.database,
      "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger'", 'count'), 17);
    const expected = expectedFinalTriggers();
    for (const row of rows(fixture.database,
      "SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name")) {
      assert.strictEqual(normalizeSql(row.sql), expected[row.name], row.name);
    }
    assert.deepStrictEqual(rows(fixture.database, 'PRAGMA foreign_key_check'), []);
  } finally {
    fixture.dispose();
  }
});

test('seventeen unexpected triggers refuse atomically', () => {
  const unexpected = Array.from({ length: 17 }, (_, index) =>
    `CREATE TRIGGER unexpected_trigger_${String(index + 1).padStart(2, '0')}
     AFTER INSERT ON unrelated_synthetic_table BEGIN SELECT 1; END;`
  ).join('\n');
  const fixture = createFixture({ triggers: unexpected });
  try {
    assert.throws(() => executeTeamDb(transaction(), adapter(fixture.database)),
      /MIGRATION_ATOMIC_EXECUTION_FAILED/);
    assert.strictEqual(scalar(fixture.database,
      "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger'", 'count'), 17);
    assert.strictEqual(scalar(fixture.database,
      'SELECT COUNT(*) AS count FROM schema_migrations', 'count'), 6);
    requireForeignKeyEnforcement(adapter(fixture.database));
  } finally {
    fixture.dispose();
  }
});

test('populated repair preserves rows and referencing holds', () => {
  const fixture = createFixture({ rows: membership });
  try {
    requireForeignKeyEnforcement(adapter(fixture.database));
    executeTeamDb(transaction(), adapter(fixture.database));
    assert.strictEqual(scalar(fixture.database,
      'SELECT COUNT(*) AS count FROM preference_retention_cases', 'count'), 1);
    assert.strictEqual(scalar(fixture.database,
      'SELECT COUNT(*) AS count FROM preference_retention_holds', 'count'), 1);
    assert.deepStrictEqual(rows(fixture.database, 'PRAGMA foreign_key_check'), []);
  } finally {
    fixture.dispose();
  }
});

test('scope-shape violation refuses atomically', () => {
  const violating = `
    INSERT INTO preference_retention_cases
      (retention_case_id,scope_type,organization_id,user_id,workspace_id,inactive_at,
       deletion_due_at,state,created_at)
    VALUES (
      'bad-case','MEMBERSHIP','org-1',NULL,'workspace-1','2026-07-01T00:00:00Z',
      '2026-07-31T00:00:00Z','PENDING','2026-07-01T00:00:00Z'
    );`;
  const fixture = createFixture({ rows: violating });
  try {
    assert.throws(() => executeTeamDb(transaction(), adapter(fixture.database)),
      /MIGRATION_ATOMIC_EXECUTION_FAILED/);
    assertPre007(fixture.database, 1);
    requireForeignKeyEnforcement(adapter(fixture.database));
  } finally {
    fixture.dispose();
  }
});

for (const [name, trigger] of [
  ['partial canonical', `
    CREATE TRIGGER preference_membership_inactivated
    AFTER UPDATE ON organization_memberships BEGIN SELECT 1; END;`],
  ['unexpected on preference_retention_holds', `
    CREATE TRIGGER unexpected_preference_trigger
    AFTER UPDATE ON preference_retention_holds BEGIN SELECT 1; END;`],
  ['unexpected on preference_retention_cases', `
    CREATE TRIGGER unexpected_cases_trigger
    AFTER UPDATE ON preference_retention_cases BEGIN SELECT 1; END;`],
  ['unexpected on schema_migrations', `
    CREATE TRIGGER unexpected_ledger_trigger
    AFTER UPDATE ON schema_migrations BEGIN SELECT 1; END;`],
  ['unexpected on unrelated table', `
    CREATE TRIGGER unexpected_unrelated_trigger
    AFTER UPDATE ON unrelated_synthetic_table BEGIN SELECT 1; END;`]
]) {
  test(`${name} trigger inventory refuses atomically`, () => {
    const fixture = createFixture({ triggers: trigger });
    try {
      assert.throws(() => executeTeamDb(transaction(), adapter(fixture.database)),
        /MIGRATION_ATOMIC_EXECUTION_FAILED/);
      assert.strictEqual(scalar(fixture.database,
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger'", 'count'), 1);
      assert.strictEqual(scalar(fixture.database,
        'SELECT COUNT(*) AS count FROM schema_migrations', 'count'), 6);
      requireForeignKeyEnforcement(adapter(fixture.database));
    } finally {
      fixture.dispose();
    }
  });
}

test('forced copied-row mismatch refuses and rolls back', () => {
  const fixture = createFixture({ rows: membership });
  try {
    const forced = repair.content.replace(
      'SELECT COUNT(*) FROM preference_retention_cases_forward_repair',
      'SELECT COUNT(*) + 1 FROM preference_retention_cases_forward_repair'
    );
    assert.notStrictEqual(forced, repair.content);
    assert.throws(() => executeTeamDb(transaction(forced), adapter(fixture.database)),
      /MIGRATION_ATOMIC_EXECUTION_FAILED/);
    assertPre007(fixture.database, 1);
    assert.strictEqual(scalar(fixture.database,
      'SELECT COUNT(*) AS count FROM preference_retention_holds', 'count'), 1);
    requireForeignKeyEnforcement(adapter(fixture.database));
  } finally {
    fixture.dispose();
  }
});

test('forced final-row mismatch refuses and rolls back', () => {
  const fixture = createFixture({ rows: membership });
  try {
    const forced = repair.content.replace(
      'SELECT COUNT(*) FROM preference_retention_cases\n)',
      'SELECT COUNT(*) + 1 FROM preference_retention_cases\n)'
    );
    assert.notStrictEqual(forced, repair.content);
    assert.throws(() => executeTeamDb(transaction(forced), adapter(fixture.database)),
      /MIGRATION_ATOMIC_EXECUTION_FAILED/);
    assertPre007(fixture.database, 1);
    assert.strictEqual(scalar(fixture.database,
      'SELECT COUNT(*) AS count FROM preference_retention_holds', 'count'), 1);
    requireForeignKeyEnforcement(adapter(fixture.database));
  } finally {
    fixture.dispose();
  }
});

test('post-repair unexpected trigger refuses and rolls back', () => {
  const fixture = createFixture({ rows: membership });
  try {
    const forced = repair.content.replace(
      '\nUPDATE preference_retention_forward_repair_guard\nSET\n  post_repair_trigger_count',
      `\nCREATE TRIGGER unexpected_post_repair_trigger
       AFTER UPDATE ON preference_retention_holds BEGIN SELECT 1; END;

       UPDATE preference_retention_forward_repair_guard
       SET
         post_repair_trigger_count`
    );
    assert.notStrictEqual(forced, repair.content);
    assert.throws(() => executeTeamDb(transaction(forced), adapter(fixture.database)),
      /MIGRATION_ATOMIC_EXECUTION_FAILED/);
    assertPre007(fixture.database, 1);
    requireForeignKeyEnforcement(adapter(fixture.database));
  } finally {
    fixture.dispose();
  }
});

test('interruption before commit rolls back and separately restores enforcement', () => {
  const fixture = createFixture({ rows: membership });
  try {
    const interrupted = transaction().replace(
      '\nCOMMIT;\n',
      '\nSELECT * FROM synthetic_forced_interruption;\nCOMMIT;\n'
    );
    assert.throws(() => executeTeamDb(interrupted, adapter(fixture.database)),
      /MIGRATION_ATOMIC_EXECUTION_FAILED/);
    assertPre007(fixture.database, 1);
    requireForeignKeyEnforcement(adapter(fixture.database));
  } finally {
    fixture.dispose();
  }
});

test('duplicate invocation refuses without changing completed repair', () => {
  const fixture = createFixture({ rows: membership });
  try {
    executeTeamDb(transaction(), adapter(fixture.database));
    assert.throws(() => executeTeamDb(transaction(), adapter(fixture.database)),
      /MIGRATION_ATOMIC_EXECUTION_FAILED/);
    assert.strictEqual(scalar(fixture.database,
      'SELECT COUNT(*) AS count FROM preference_retention_cases', 'count'), 1);
    assert.strictEqual(scalar(fixture.database,
      "SELECT COUNT(*) AS count FROM schema_migrations WHERE migration_id='007'", 'count'), 1);
    assert.deepStrictEqual(rows(fixture.database, 'PRAGMA foreign_key_check'), []);
    requireForeignKeyEnforcement(adapter(fixture.database));
  } finally {
    fixture.dispose();
  }
});

function syntheticControls() {
  const identity = { revision: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true };
  const authority = {
    authority_reference: 'EXEC-REPAIR-001',
    authorised_revision: identity.revision,
    authorised_tree: identity.tree,
    canonical_migration_manifest_sha256: manifest.sha256,
    execution_context: 'synthetic-disposable-adapter',
    issued_at: '2026-07-29T00:00:00Z',
    expires_at: '2026-07-30T00:00:00Z',
    target_id: 'synthetic-disposable-target'
  };
  return {
    authorization: authority,
    backup: {
      target_id: authority.target_id,
      verified: true,
      restoration_rehearsed: true,
      backup_sha256: crypto.createHash('sha256').update('synthetic-backup').digest('hex')
    },
    env: {
      LEADSPROUT_CONTROLLED_MIGRATION: 'true',
      OPPORTUNITY_WORKSPACE_ENABLED: 'false'
    },
    identity,
    now: new Date('2026-07-29T12:00:00Z'),
    preflight: {
      target_id: authority.target_id,
      target_class: 'DISPOSABLE',
      verified: true,
      schema_sha256: crypto.createHash('sha256').update('synthetic-schema').digest('hex'),
      authority_reference: authority.authority_reference,
      canonical_migration_manifest_sha256: manifest.sha256
    },
    qualification: {
      target_class: 'DISPOSABLE',
      rollback_verified: true,
      adapter_identity: '/usr/bin/sqlite3',
      runtime_identity: process.version,
      test_payload_sha256: crypto.createHash('sha256').update('synthetic-payload').digest('hex')
    },
    targetConfiguration: {
      target_id: authority.target_id,
      authoritative_source_identity: 'synthetic-operations-control',
      authoritative_source_reference: authority.authority_reference,
      captured_at: '2026-07-29T10:00:00Z',
      expires_at: '2026-07-29T14:00:00Z',
      source_sha256: crypto.createHash('sha256')
        .update('synthetic-authoritative-source').digest('hex'),
      configuration_key: 'OPPORTUNITY_WORKSPACE_ENABLED',
      authoritative_value: 'false',
      verified: true
    }
  };
}

const values = {
  target: 'synthetic-disposable-target',
  operator: 'synthetic-test',
  'execution-context': 'synthetic-disposable-adapter',
  'authority-reference': 'EXEC-REPAIR-001',
  'acknowledge-no-lifecycle': 'true'
};

const ownerWaiverValues = {
  ...values,
  target: PROTECTED_V1_TARGET_ID,
  'authority-reference': 'JAY-BOWER-RISK-WAIVER-001'
};

function ownerWaiverControls(waiverOverrides = {}) {
  const identity = { revision: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true };
  const authority = {
    authority_reference: ownerWaiverValues['authority-reference'],
    authorised_revision: identity.revision,
    authorised_tree: identity.tree,
    canonical_migration_manifest_sha256: manifest.sha256,
    execution_context: ownerWaiverValues['execution-context'],
    issued_at: '2026-07-29T00:00:00Z',
    expires_at: '2026-07-30T00:00:00Z',
    target_id: PROTECTED_V1_TARGET_ID
  };
  const waiver = {
    target_id: PROTECTED_V1_TARGET_ID,
    owner_authority_identity: 'Jay Bower',
    owner_authority_reference: authority.authority_reference,
    waived_conditions: [...OWNER_RISK_WAIVED_CONDITIONS],
    authorised_revision: identity.revision,
    authorised_tree: identity.tree,
    issued_at: '2026-07-29T11:55:00Z',
    expires_at: '2026-07-29T12:05:00Z',
    nonce: 'cd'.repeat(16),
    production_execution_risk_accepted: true,
    ...waiverOverrides
  };
  waiver.waiver_sha256 = ownerRiskWaiverDigest(waiver);
  return {
    authorization: authority,
    env: {
      LEADSPROUT_CONTROLLED_MIGRATION: 'true',
      OPPORTUNITY_WORKSPACE_ENABLED: 'false'
    },
    identity,
    now: new Date('2026-07-29T12:00:00Z'),
    ownerRiskWaiver: waiver,
    preflight: {
      target_id: PROTECTED_V1_TARGET_ID,
      target_class: 'PROTECTED_V1',
      verified: true,
      schema_sha256: crypto.createHash('sha256').update('synthetic-schema').digest('hex'),
      authority_reference: authority.authority_reference,
      canonical_migration_manifest_sha256: manifest.sha256
    },
    qualification: {
      target_class: 'PROTECTED_V1',
      rollback_verified: false,
      adapter_identity: '/usr/bin/sqlite3',
      runtime_identity: process.version,
      test_payload_sha256: crypto.createHash('sha256')
        .update('synthetic-waiver-payload').digest('hex')
    },
    targetConfiguration: {
      target_id: PROTECTED_V1_TARGET_ID,
      authoritative_source_identity: 'synthetic-operations-control',
      authoritative_source_reference: authority.authority_reference,
      captured_at: '2026-07-29T10:00:00Z',
      expires_at: '2026-07-29T14:00:00Z',
      source_sha256: crypto.createHash('sha256')
        .update('synthetic-authoritative-source').digest('hex'),
      configuration_key: 'OPPORTUNITY_WORKSPACE_ENABLED',
      authoritative_value: 'false',
      verified: true
    }
  };
}

test('authoritative explicit-false evidence is independently mandatory', () => {
  const controls = syntheticControls();
  assert(validateControls(values, controls).targetConfiguration);
  for (const targetConfiguration of [
    undefined,
    { ...controls.targetConfiguration, authoritative_value: 'true' },
    { ...controls.targetConfiguration, verified: false },
    { ...controls.targetConfiguration, target_id: 'wrong-target' },
    { ...controls.targetConfiguration, authoritative_source_reference: 'WRONG-AUTHORITY' },
    { ...controls.targetConfiguration, authoritative_source_identity: '' },
    { ...controls.targetConfiguration, source_sha256: 'malformed' },
    { ...controls.targetConfiguration, captured_at: 'malformed' },
    { ...controls.targetConfiguration, expires_at: '2026-07-29T11:00:00Z' },
    { ...controls.targetConfiguration, expires_at: '2026-07-29T14:00:01Z' }
  ]) {
    const options = { ...controls, targetConfiguration };
    assert.throws(() => validateControls(values, options),
      /TARGET_CONFIGURATION_(?:EVIDENCE_REQUIRED|EXPLICIT_FALSE_REQUIRED)/);
  }
  assert.throws(() => validateControls(values, {
    ...controls,
    env: { ...controls.env, OPPORTUNITY_WORKSPACE_ENABLED: 'true' }
  }), /FEATURE_STATE_INVALID/);
});

test('owner risk waiver is narrow and does not infer waived evidence', () => {
  const controlled = validateControls(ownerWaiverValues, ownerWaiverControls());
  assert.strictEqual(controlled.evidenceMode, 'OWNER_RISK_WAIVER');
  assert.strictEqual(controlled.backup, undefined);
  assert.strictEqual(controlled.qualification.rollback_verified, false);
  assert.strictEqual(controlled.qualification.target_class, 'PROTECTED_V1');
  assert.strictEqual(controlled.qualification.adapter_identity, '/usr/bin/sqlite3');
  assert.deepStrictEqual(controlled.ownerRiskWaiver.waived_conditions,
    OWNER_RISK_WAIVED_CONDITIONS);
  const cases = [
    { ownerRiskWaiver: undefined },
    ownerWaiverControls({ expires_at: '2026-07-29T11:59:00Z' }),
    ownerWaiverControls({
      waived_conditions: [...OWNER_RISK_WAIVED_CONDITIONS, 'ANY_OTHER_CONTROL']
    }),
    ownerWaiverControls({ target_id: 'wrong-target' }),
    ownerWaiverControls({ owner_authority_identity: 'Not Jay Bower' }),
    ownerWaiverControls({ owner_authority_reference: 'WRONG-AUTHORITY' }),
    ownerWaiverControls({ authorised_revision: 'e'.repeat(40) }),
    ownerWaiverControls({ authorised_tree: 'f'.repeat(40) }),
    ownerWaiverControls({ nonce: 'malformed' })
  ];
  cases[0] = {
    ...ownerWaiverControls(),
    ownerRiskWaiver: undefined
  };
  const mismatchedDigest = ownerWaiverControls();
  mismatchedDigest.ownerRiskWaiver.waiver_sha256 = '0'.repeat(64);
  cases.push(mismatchedDigest);
  for (const options of cases) {
    assert.throws(() => validateControls(ownerWaiverValues, options),
      /(?:BACKUP_PREREQUISITE|OWNER_RISK_WAIVER_INVALID)/);
  }
  for (const ownerRiskWaiver of [null, false, '', []]) {
    assert.throws(() => validateControls(ownerWaiverValues, {
      ...ownerWaiverControls(),
      ownerRiskWaiver
    }), /OWNER_RISK_WAIVER_INVALID/);
  }
  for (const qualification of [
    null,
    false,
    '',
    [],
    {},
    { ...ownerWaiverControls().qualification, rollback_verified: true },
    { ...ownerWaiverControls().qualification, target_class: 'WRONG' },
    { ...ownerWaiverControls().qualification, adapter_identity: '' },
    { ...ownerWaiverControls().qualification, runtime_identity: '' },
    { ...ownerWaiverControls().qualification, test_payload_sha256: 'malformed' }
  ]) {
    assert.throws(() => validateControls(ownerWaiverValues, {
      ...ownerWaiverControls(),
      qualification
    }), /TRANSACTION_QUALIFICATION_REQUIRED/);
  }
  assert.throws(() => validateControls(ownerWaiverValues, {
    ...ownerWaiverControls(),
    backup: syntheticControls().backup
  }), /OWNER_RISK_WAIVER_EVIDENCE_CONFLICT/);
  assert.throws(() => validateControls(ownerWaiverValues, {
    ...ownerWaiverControls(),
    backup: null
  }), /OWNER_RISK_WAIVER_EVIDENCE_CONFLICT/);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leadsprout-waiver-cli-'));
  try {
    const controlsForCli = ownerWaiverControls();
    const waiverPath = path.join(directory, 'waiver.json');
    const backupPath = path.join(directory, 'backup.json');
    const qualificationPath = path.join(directory, 'qualification.json');
    fs.writeFileSync(waiverPath, JSON.stringify(controlsForCli.ownerRiskWaiver));
    fs.writeFileSync(backupPath, JSON.stringify(syntheticControls().backup));
    fs.writeFileSync(qualificationPath, JSON.stringify(controlsForCli.qualification));
    const injected = { ...controlsForCli };
    delete injected.ownerRiskWaiver;
    delete injected.qualification;
    assert.throws(() => validateControls({
      ...ownerWaiverValues,
      'owner-risk-waiver': waiverPath,
      backup: backupPath,
      qualification: qualificationPath
    }, injected), /OWNER_RISK_WAIVER_EVIDENCE_CONFLICT/);
    assert.throws(() => validateControls({
      ...ownerWaiverValues,
      'owner-risk-waiver': waiverPath
    }, controlsForCli), /CONTROL_EVIDENCE_SOURCE_CONFLICT/);
    for (const supplied of ['', false]) {
      assert.throws(() => validateControls({
        ...ownerWaiverValues,
        'owner-risk-waiver': supplied
      }, injected), /OWNER_RISK_WAIVER_REQUIRED/);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function actualStructuralVerifierEndToEnd() {
  const fixture = createFullFixture();
  try {
    const observations = { statements: [] };
    const args = Object.entries(values).flatMap(([key, value]) => [`--${key}`, value]);
    const completed = await runMigration(args, {
      ...syntheticControls(),
      spawn: adapter(fixture.database, observations)
    });
    assert.strictEqual(completed.status, 'COMPLETED');
    assert.strictEqual(scalar(fixture.database,
      "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger'", 'count'), 17);
    assert.deepStrictEqual(rows(fixture.database, 'PRAGMA foreign_key_check'), []);
    observations.statements.length = 0;
    const noOp = await runMigration(args, {
      ...syntheticControls(),
      spawn: adapter(fixture.database, observations)
    });
    assert.strictEqual(noOp.status, 'VERIFIED_NOOP');
    assert.strictEqual(observations.statements.filter(statement =>
      /\b(?:BEGIN|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b/i.test(statement)
    ).length, 0);
  } finally {
    fixture.dispose();
  }
}

async function actualZeroTriggerRunnerEndToEnd() {
  const fixture = createFullFixture();
  try {
    const cleared = sqlite(fixture.database, FINAL_TRIGGER_NAMES
      .map(name => `DROP TRIGGER IF EXISTS ${name};`).join('\n'));
    if (cleared.status !== 0) throw new Error(cleared.stderr || 'trigger reset failed');
    assert.strictEqual(scalar(fixture.database,
      "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger'", 'count'), 0);
    const args = Object.entries(values).flatMap(([key, value]) => [`--${key}`, value]);
    const completed = await runMigration(args, {
      ...syntheticControls(),
      spawn: adapter(fixture.database)
    });
    assert.strictEqual(completed.status, 'COMPLETED');
    assert.strictEqual(scalar(fixture.database,
      "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger'", 'count'), 17);
    assert.strictEqual(scalar(fixture.database,
      'SELECT COUNT(*) AS count FROM schema_migrations', 'count'), 8);
    assert.deepStrictEqual(rows(fixture.database, 'PRAGMA foreign_key_check'), []);
  } finally {
    fixture.dispose();
  }
}

async function foreignKeyIntegrityUsesExactSelectInventory() {
  const fixture = createFullFixture();
  const check = buildForeignKeyViolationCheck(
    EXPECTED_PRE_ALIGNMENT_SCHEMA_MANIFEST,
    PREDECESSOR_BASE_SCHEMA_MANIFEST
  );
  const query = Object.freeze({
    all: async statement => {
      assert.strictEqual(statement, check.sql);
      return rows(fixture.database, statement);
    }
  });
  try {
    assert.strictEqual(check.relationship_count, 71);
    await requireForeignKeyIntegrity(query, EXPECTED_PRE_ALIGNMENT_SCHEMA_MANIFEST);
    const violated = sqlite(fixture.database, `
      INSERT INTO activity_event_sources
        (activity_event_id,source_object_type,source_object_id,relationship_type)
      VALUES ('missing-event','synthetic','synthetic','CAUSE');
    `);
    if (violated.status !== 0) throw new Error(violated.stderr || 'fixture insert failed');
    await assert.rejects(
      () => requireForeignKeyIntegrity(query, EXPECTED_PRE_ALIGNMENT_SCHEMA_MANIFEST),
      error => error?.code === 'SCHEMA_MISMATCH'
    );
  } finally {
    fixture.dispose();
  }
}

async function trailingPragmaFailureReconcilesWithoutAssumption() {
  const fixture = createFullFixture();
  try {
    const baseSpawn = adapter(fixture.database);
    let sabotaged = false;
    const failingSpawn = (command, args) => {
      if (!sabotaged && args[0].includes('BEGIN IMMEDIATE;')) {
        sabotaged = true;
        return baseSpawn(command, [
          args[0].replace(
            'COMMIT;\nPRAGMA foreign_keys = ON;',
            'COMMIT;\nSELECT * FROM synthetic_trailing_pragma_failure;'
          )
        ]);
      }
      return baseSpawn(command, args);
    };
    const args = Object.entries(values).flatMap(([key, value]) => [`--${key}`, value]);
    await assert.rejects(() => runMigration(args, {
      ...syntheticControls(),
      spawn: failingSpawn
    }), error => error?.code === 'INTERRUPTION_UNRECONCILED');
    assert.strictEqual(scalar(fixture.database,
      "SELECT COUNT(*) AS count FROM schema_migrations WHERE migration_id='007'", 'count'), 1);
    assert.deepStrictEqual(rows(fixture.database, 'PRAGMA foreign_key_check'), []);
    requireForeignKeyEnforcement(baseSpawn);
  } finally {
    fixture.dispose();
  }
}

async function ownerRiskWaiverExecutesOnceAndRefusesReplay() {
  const fixture = createFullFixture();
  try {
    const args = Object.entries(ownerWaiverValues)
      .flatMap(([key, value]) => [`--${key}`, value]);
    const controls = ownerWaiverControls();
    const completed = await runMigration(args, {
      ...controls,
      spawn: adapter(fixture.database)
    });
    assert.strictEqual(completed.status, 'COMPLETED');
    assert.strictEqual(completed.evidence_mode, 'OWNER_RISK_WAIVER');
    await assert.rejects(() => runMigration(args, {
      ...controls,
      spawn: adapter(fixture.database)
    }), error => error?.code === 'OWNER_RISK_WAIVER_REPLAYED');
    assert.strictEqual(scalar(fixture.database,
      "SELECT COUNT(*) AS count FROM schema_migrations WHERE migration_id='007'", 'count'), 1);
    assert.deepStrictEqual(rows(fixture.database, 'PRAGMA foreign_key_check'), []);
  } finally {
    fixture.dispose();
  }
}

async function failedWaiverAttemptRequiresFreshWaiver() {
  const fixture = createFullFixture();
  try {
    const args = Object.entries(ownerWaiverValues)
      .flatMap(([key, value]) => [`--${key}`, value]);
    const baseSpawn = adapter(fixture.database);
    let sabotaged = false;
    const failingSpawn = (command, spawnArgs) => {
      if (!sabotaged && spawnArgs[0].includes(repair.content)) {
        sabotaged = true;
        return baseSpawn(command, [
          spawnArgs[0].replace(
            '\nCOMMIT;\n',
            '\nSELECT * FROM synthetic_failed_waiver_attempt;\nCOMMIT;\n'
          )
        ]);
      }
      return baseSpawn(command, spawnArgs);
    };
    await assert.rejects(() => runMigration(args, {
      ...ownerWaiverControls(),
      spawn: failingSpawn
    }), error => {
      assert.strictEqual(error?.code, 'OWNER_RISK_WAIVER_RETRY_REQUIRED');
      assert.strictEqual(
        error.retry_contract?.attempt_outcome,
        'FAILED_OR_INTERRUPTED_RECONCILED_PRE_007_ALIGNMENT'
      );
      assert.strictEqual(
        error.retry_contract?.retry_requires_new_owner_approved_waiver,
        true
      );
      assert.strictEqual(error.retry_contract?.retry_requires_new_nonce, true);
      assert.strictEqual(error.retry_contract?.retry_requires_new_issued_at, true);
      assert.strictEqual(
        error.retry_contract?.durable_cross_attempt_nonce_consumption_available,
        false
      );
      return true;
    });
    assertPre007(fixture.database, 0, 17);
    const fresh = ownerWaiverControls({
      nonce: 'ef'.repeat(16),
      issued_at: '2026-07-29T12:00:00Z',
      expires_at: '2026-07-29T12:10:00Z'
    });
    const completed = await runMigration(args, {
      ...fresh,
      spawn: baseSpawn
    });
    assert.strictEqual(completed.status, 'COMPLETED');
  } finally {
    fixture.dispose();
  }
}

async function indeterminateWaiverAttemptRequiresFreshWaiver() {
  const fixture = createFullFixture();
  try {
    const args = Object.entries(ownerWaiverValues)
      .flatMap(([key, value]) => [`--${key}`, value]);
    const baseSpawn = adapter(fixture.database);
    let attempted = false;
    const indeterminateSpawn = (command, spawnArgs) => {
      if (!attempted && spawnArgs[0].includes(repair.content)) {
        attempted = true;
        return { status: 1, stdout: '', stderr: 'synthetic indeterminate attempt' };
      }
      if (attempted) {
        return { status: 1, stdout: '', stderr: 'synthetic reconciliation unavailable' };
      }
      return baseSpawn(command, spawnArgs);
    };
    await assert.rejects(() => runMigration(args, {
      ...ownerWaiverControls(),
      spawn: indeterminateSpawn
    }), error => {
      assert.strictEqual(error?.code, 'OWNER_RISK_WAIVER_RETRY_REQUIRED');
      assert.strictEqual(error.retry_contract?.attempt_outcome, 'INDETERMINATE');
      assert.strictEqual(
        error.retry_contract?.retry_requires_new_owner_approved_waiver,
        true
      );
      return true;
    });
  } finally {
    fixture.dispose();
  }
}

Promise.resolve().then(trailingPragmaFailureReconcilesWithoutAssumption).then(() => {
  passed += 1;
  console.log(`PASS ${passed}: trailing-PRAGMA failure is explicitly reconciled`);
  return ownerRiskWaiverExecutesOnceAndRefusesReplay();
}).then(() => {
  passed += 1;
  console.log(`PASS ${passed}: completed-007 waiver replay is refused`);
  return failedWaiverAttemptRequiresFreshWaiver();
}).then(() => {
  passed += 1;
  console.log(`PASS ${passed}: failed waiver attempt requires freshly issued waiver`);
  return indeterminateWaiverAttemptRequiresFreshWaiver();
}).then(() => {
  passed += 1;
  console.log(`PASS ${passed}: indeterminate waiver attempt returns stop contract`);
  return actualStructuralVerifierEndToEnd();
}).then(() => {
  passed += 1;
  console.log(`PASS ${passed}: actual pre/post structural verifier and completed no-op`);
  return actualZeroTriggerRunnerEndToEnd();
}).then(() => {
  passed += 1;
  console.log(`PASS ${passed}: actual runner repairs captured zero-trigger prestate end to end`);
  return foreignKeyIntegrityUsesExactSelectInventory();
}).then(() => {
  passed += 1;
  console.log(`PASS ${passed}: exact SELECT foreign-key inventory rejects a real violation`);
  assert.deepStrictEqual(MIGRATIONS.map(name => name.slice(0, 3)),
    ['001', '002', '003', '004', '005', '006', '007', '008']);
  console.log(`PASS: ${passed} disposable adapter-level forward-repair tests`);
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
