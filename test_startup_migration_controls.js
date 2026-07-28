const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('./backend/node_modules/sqlite3');
const {
  buildControlledTransaction,
  buildIncrementalTransaction,
  classifyLedger,
  executeTeamDb,
  inspectLedger,
  main: runMigration,
  migrationManifestDigest,
  parseArgs,
  resolveRepositoryIdentity,
  validateAuthorization,
  validateCanonicalInventory,
  validateControls
} = require('./backend/scripts/apply_migrations');
const {
  createdTables,
  EXPECTED_PRE_006_SCHEMA_MANIFEST,
  EXPECTED_SCHEMA_MANIFEST,
  featureDisabled,
  inspectTable,
  MigrationControlError,
  migrationInventory,
  verifySchema,
  verifyStructuralSchema
} = require('./backend/scripts/verify_schema');

const inventory = migrationInventory();
const canonicalManifest = migrationManifestDigest(inventory);
const expected = createdTables(inventory);
const cleanRows = inventory.map(item => ({
  migration_id: item.migration_id,
  filename: item.filename,
  sequence: item.sequence,
  checksum: item.checksum,
  outcome: 'COMPLETED'
}));
const goodGate = { verify: async () => ({ status: 'VERIFIED' }) };
const controlledIdentity = {
  revision: 'a'.repeat(40),
  tree: 'b'.repeat(40),
  clean: true
};
const controlledAuthorization = {
  authority_reference: 'ENG-MIG-AUTH-001',
  authorised_revision: controlledIdentity.revision,
  authorised_tree: controlledIdentity.tree,
  canonical_migration_manifest_sha256: canonicalManifest.sha256,
  execution_context: 'isolated-qualified-runner',
  issued_at: '2026-07-28T00:00:00Z',
  expires_at: '2026-07-29T00:00:00Z',
  target_id: 'isolated-target'
};
const controlledValues = {
  target: 'isolated-target',
  operator: 'controlled-operator',
  'execution-context': 'isolated-qualified-runner',
  'authority-reference': 'ENG-MIG-AUTH-001',
  'acknowledge-no-lifecycle': 'true'
};
const supportingEvidence = {
  preflight: {
    target_id: 'isolated-target', target_class: 'DISPOSABLE',
    verified: true, schema_sha256: 'schema-hash',
    authority_reference: 'ENG-MIG-AUTH-001',
    canonical_migration_manifest_sha256: canonicalManifest.sha256
  },
  backup: {
    target_id: 'isolated-target', verified: true,
    restoration_rehearsed: true, backup_sha256: 'backup-hash'
  },
  qualification: {
    target_class: 'DISPOSABLE', rollback_verified: true,
    adapter_identity: 'sqlite3', runtime_identity: 'node',
    test_payload_sha256: 'payload-hash'
  }
};

function controlOptions(overrides = {}) {
  return {
    authorization: controlledAuthorization,
    identity: controlledIdentity,
    now: new Date('2026-07-28T12:00:00Z'),
    env: {
      LEADSPROUT_CONTROLLED_MIGRATION: 'true',
      OPPORTUNITY_WORKSPACE_ENABLED: 'false'
    },
    ...supportingEvidence,
    ...overrides
  };
}

function runnerArgs(overrides = {}) {
  const values = { ...controlledValues, ...overrides };
  return Object.entries(values).flatMap(([key, value]) => [`--${key}`, value]);
}

function ledgerRows(count = 6) {
  return inventory.slice(0, count).map(item => ({
    migration_id: item.migration_id,
    filename: item.filename,
    sequence: item.sequence,
    checksum: item.checksum,
    outcome: 'COMPLETED'
  }));
}

function controlledRunner(overrides = {}) {
  let state = overrides.initialState || 'PRE_006';
  let mutationCalls = 0;
  let inspectionCalls = 0;
  const spawn = (_command, args) => {
    const statement = args[0];
    if (/^SELECT migration_id/.test(statement)) {
      inspectionCalls += 1;
      if (state === 'ABSENT') {
        return { status: 1, stderr: 'no such table: schema_migrations', stdout: '' };
      }
      return {
        status: 0,
        stderr: '',
        stdout: JSON.stringify(overrides.rows || ledgerRows(state === 'PRE_006' ? 5 : 6))
      };
    }
    mutationCalls += 1;
    if (overrides.failMutation) return { status: 1, stderr: 'interrupted', stdout: '' };
    state = 'COMPLETE';
    return { status: 0, stderr: '', stdout: '' };
  };
  return {
    dependencies: {
      ...controlOptions(),
      spawn,
      schemaVerifier: overrides.schemaVerifier || (async () => {}),
      startedAt: '2026-07-28T12:00:00Z'
    },
    inspectionCalls: () => inspectionCalls,
    mutationCalls: () => mutationCalls,
    setState: value => { state = value; }
  };
}

function database() {
  const raw = new sqlite3.Database(':memory:');
  const calls = [];
  const invoke = (method, statement, parameters = []) => new Promise((resolve, reject) => {
    calls.push(statement);
    raw[method](statement, parameters, function callback(error, rows) {
      if (error) reject(error);
      else resolve(method === 'run' ? this : rows);
    });
  });
  return {
    calls,
    all: (statement, parameters) => invoke('all', statement, parameters),
    get: (statement, parameters) => invoke('get', statement, parameters),
    run: (statement, parameters) => invoke('run', statement, parameters),
    exec: statement => new Promise((resolve, reject) => {
      calls.push(statement);
      raw.exec(statement, error => error ? reject(error) : resolve());
    }),
    close: () => new Promise((resolve, reject) =>
      raw.close(error => error ? reject(error) : resolve()))
  };
}

async function baseDatabase() {
  const query = database();
  await query.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE leads (id TEXT PRIMARY KEY);`);
  return query;
}

async function conformingDatabase() {
  const query = await baseDatabase();
  await query.exec(buildControlledTransaction({
    inventory,
    revision: '32248db8763208b8e56ac99a2b7934557f260513',
    target: 'isolated-test',
    operator: 'test-runner',
    startedAt: '2026-07-27T00:00:00.000Z'
  }));
  return query;
}

async function pre006Database() {
  const query = await baseDatabase();
  await query.exec(buildControlledTransaction({
    inventory: inventory.slice(0, 5),
    revision: 'pre-006',
    target: 'isolated-test',
    operator: 'test-runner',
    startedAt: '2026-07-27T00:00:00.000Z'
  }));
  return query;
}

async function deriveExpectedSchemaContractForTest(factory = conformingDatabase, contractInventory = inventory) {
  return withDatabase(factory, async query => {
    const tables = {};
    for (const name of createdTables(contractInventory)) tables[name] = await inspectTable(query, name);
    const leadColumns = await query.all('PRAGMA table_info("leads")');
    const evidenceState = leadColumns.find(row => row.name === 'evidence_state');
    assert(evidenceState);
    return {
      tables,
      leadsEvidenceState: [
        evidenceState.name,
        String(evidenceState.type || '').toUpperCase(),
        Number(evidenceState.notnull),
        evidenceState.dflt_value === null ? null : String(evidenceState.dflt_value)
          .replace(/\s+/g, '').replace(/^\((.*)\)$/s, '$1').toLowerCase(),
        Number(evidenceState.pk)
      ]
    };
  });
}

async function withDatabase(factory, callback) {
  const query = await factory();
  try {
    return await callback(query);
  } finally {
    await query.close();
  }
}

async function recreateTable(query, name, transform) {
  const row = await query.get(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    [name]
  );
  assert(row && row.sql);
  const replacement = transform(row.sql);
  assert.notStrictEqual(replacement, row.sql);
  await query.exec(`PRAGMA foreign_keys = OFF;
    DROP TABLE "${name}";
    ${replacement};
    PRAGMA foreign_keys = ON;`);
}

async function rejectsCode(fn, code) {
  await assert.rejects(fn, error => error && error.code === code);
}

async function run() {
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    count += 1;
    console.log(`PASS ${count}: ${name}`);
  };

  await test('ordinary startup invokes only read-only structural verification', async () => {
    const source = fs.readFileSync(path.join(__dirname, 'backend/server.js'), 'utf8');
    assert(source.includes('await verifySchema()'));
    assert(!source.includes('initializeSchema'));
    assert(!/\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b/.test(source));
    await withDatabase(conformingDatabase, async query => {
      query.calls.length = 0;
      const originalDatabase = sqlite3.Database;
      const migrationModule = require('./backend/scripts/apply_migrations');
      const originalRunner = migrationModule.buildControlledTransaction;
      let databaseCreations = 0;
      let migrationRunnerCalls = 0;
      sqlite3.Database = function forbiddenDatabaseCreation() {
        databaseCreations += 1;
        throw new Error('SECOND_DATABASE_FORBIDDEN');
      };
      migrationModule.buildControlledTransaction = function forbiddenMigrationRunner() {
        migrationRunnerCalls += 1;
        throw new Error('MIGRATION_RUNNER_FORBIDDEN');
      };
      try {
        await verifySchema({ dbQuery: query, integrityGate: goodGate });
      } finally {
        sqlite3.Database = originalDatabase;
        migrationModule.buildControlledTransaction = originalRunner;
      }
      assert.strictEqual(databaseCreations, 0);
      assert.strictEqual(migrationRunnerCalls, 0);
      assert(query.calls.length > 0);
      assert(query.calls.every(statement => /^\s*(?:SELECT|PRAGMA)\b/i.test(statement)));
      assert(query.calls.every(statement =>
        !/\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE|BEGIN|COMMIT)\b/i.test(statement)));
      assert(query.calls.every(statement =>
        !inventory.some(item => statement.includes(item.content))));
    });
  });

  await test('missing, dirty, unknown, order and checksum ledger states refuse', async () => {
    await withDatabase(baseDatabase, query =>
      rejectsCode(() => verifySchema({ dbQuery: query, integrityGate: goodGate }), 'LEDGER_MISSING'));
    for (const [statement, code] of [
      ["UPDATE schema_migrations SET outcome = 'FAILED' WHERE migration_id = '001'", 'LEDGER_DIRTY'],
      ["UPDATE schema_migrations SET filename = '999_unknown.sql' WHERE migration_id = '001'", 'LEDGER_UNKNOWN'],
      ["UPDATE schema_migrations SET sequence = 9 WHERE migration_id = '001'", 'LEDGER_ORDER'],
      ["UPDATE schema_migrations SET checksum = 'changed' WHERE migration_id = '001'", 'LEDGER_CHECKSUM']
    ]) {
      await withDatabase(conformingDatabase, async query => {
        await query.run(statement);
        await rejectsCode(() => verifySchema({ dbQuery: query, integrityGate: goodGate }), code);
      });
    }
  });

  await test('absent or malformed Evidence Integrity dependencies refuse', async () => {
    await withDatabase(conformingDatabase, query =>
      rejectsCode(() => verifySchema({
        dbQuery: query,
        authority: {},
        provenanceResolver: {},
        integrityGate: { verify: async () => { throw new Error('invalid'); } }
      }), 'ATTESTATION_INVALID'));
  });

  await test('enabled and ambiguous feature states refuse', async () => {
    assert.strictEqual(featureDisabled(undefined), true);
    assert.strictEqual(featureDisabled('false'), true);
    assert.throws(() => featureDisabled('true'), /FEATURE_STATE_INVALID/);
    assert.throws(() => featureDisabled('FALSE'), /FEATURE_STATE_INVALID/);
  });

  await test('canonical 001 through 006 sequence is deterministic', async () => {
    assert.deepStrictEqual(inventory.map(item => item.migration_id), ['001', '002', '003', '004', '005', '006']);
    assert(inventory.every(item => /^[a-f0-9]{64}$/.test(item.checksum)));
  });

  await test('static schema manifest exactly matches canonical migrations 001 through 006', async () => {
    const derived = await deriveExpectedSchemaContractForTest();
    assert.deepStrictEqual(derived, EXPECTED_SCHEMA_MANIFEST);
    assert(Object.isFrozen(EXPECTED_SCHEMA_MANIFEST));
    assert(Object.isFrozen(EXPECTED_SCHEMA_MANIFEST.tables));
  });

  await test('static pre-state manifest exactly matches canonical migrations 001 through 005', async () => {
    const derived = await deriveExpectedSchemaContractForTest(pre006Database, inventory.slice(0, 5));
    assert.deepStrictEqual(derived, EXPECTED_PRE_006_SCHEMA_MANIFEST);
    assert(Object.isFrozen(EXPECTED_PRE_006_SCHEMA_MANIFEST));
  });

  await test('completed rerun is verification-only', async () => {
    await withDatabase(conformingDatabase, async query => {
      query.calls.length = 0;
      await verifySchema({ dbQuery: query, integrityGate: goodGate });
      assert(query.calls.every(statement => /^\s*(?:SELECT|PRAGMA)\b/i.test(statement)));
    });
    const state = inspectLedger(inventory, () => ({
      status: 0,
      stdout: JSON.stringify(cleanRows),
      stderr: ''
    }));
    assert.strictEqual(state, 'COMPLETE');
  });

  await test('failure uses one atomic process and cannot record a completed ledger', async () => {
    let payload;
    assert.throws(() => executeTeamDb('BEGIN IMMEDIATE; CREATE TABLE x(a); BAD; COMMIT;', (_command, args) => {
      payload = args[0];
      return { status: 1, stderr: 'failure' };
    }), /MIGRATION_ATOMIC_EXECUTION_FAILED/);
    assert(payload.includes('BEGIN IMMEDIATE'));
  });

  await test('transaction qualification is a mandatory controlled input', async () => {
    assert.throws(() => validateControls(controlledValues, controlOptions({
      qualification: undefined
    })), /TRANSACTION_QUALIFICATION_REQUIRED/);
  });

  await test('BEGIN IMMEDIATE provides deterministic concurrency refusal', async () => {
    const transaction = buildControlledTransaction({ inventory, revision: 'r', target: 't', operator: 'o', startedAt: 'now' });
    assert.strictEqual((transaction.match(/BEGIN IMMEDIATE/g) || []).length, 1);
    assert(transaction.endsWith('COMMIT;'));
  });

  await test('applied migration checksums are immutable', async () => {
    await withDatabase(conformingDatabase, async query => {
      await query.run("UPDATE schema_migrations SET checksum = ? WHERE migration_id = '003'", ['0'.repeat(64)]);
      await rejectsCode(() => verifySchema({ dbQuery: query, integrityGate: goodGate }), 'LEDGER_CHECKSUM');
    });
  });

  await test('same-named table with incorrect columns refuses adoption', async () => {
    await withDatabase(conformingDatabase, async query => {
      await recreateTable(query, 'opportunity_attribution_snapshots', sql =>
        sql.replace('workspace_id TEXT NOT NULL,', 'workspace_id TEXT NOT NULL,\n  unexpected_column TEXT,'));
      await rejectsCode(() => verifySchema({ dbQuery: query, integrityGate: goodGate }), 'SCHEMA_MISMATCH');
    });
  });

  await test('same-named table with incorrect CHECK constraint refuses adoption', async () => {
    await withDatabase(conformingDatabase, async query => {
      await recreateTable(query, 'opportunity_commercial_estimates', sql =>
        sql.replace(
          "CHECK(estimate_type IN ('CONSULTANT_FEE','CLIENT_UPSIDE'))",
          "CHECK(estimate_type IN ('UNSUPPORTED'))"
        ));
      await rejectsCode(() => verifySchema({ dbQuery: query, integrityGate: goodGate }), 'SCHEMA_MISMATCH');
    });
  });

  await test('same-named table with incorrect foreign key refuses adoption', async () => {
    await withDatabase(conformingDatabase, async query => {
      await recreateTable(query, 'opportunity_attribution_snapshots', sql =>
        sql.replace(
          'REFERENCES opportunity_workspace_versions(workspace_id,version)',
          'REFERENCES opportunity_workspace_versions(version,workspace_id)'
        ));
      await rejectsCode(() => verifySchema({ dbQuery: query, integrityGate: goodGate }), 'SCHEMA_MISMATCH');
    });
  });

  await test('same-named index with incorrect columns refuses adoption', async () => {
    await withDatabase(conformingDatabase, async query => {
      await query.exec(`DROP INDEX idx_attribution_dashboard;
        CREATE INDEX idx_attribution_dashboard
          ON opportunity_attribution_snapshots(metric_key, workspace_id);`);
      await rejectsCode(() => verifySchema({ dbQuery: query, integrityGate: goodGate }), 'SCHEMA_MISMATCH');
    });
  });

  await test('same-named partial index with incorrect predicate refuses adoption', async () => {
    await withDatabase(conformingDatabase, async query => {
      await query.exec(`DROP INDEX idx_evidence_integrity_current_subject;
        CREATE UNIQUE INDEX idx_evidence_integrity_current_subject
          ON evidence_integrity_decisions(subject_id)
          WHERE lifecycle_state = 'SUPERSEDED';`);
      await rejectsCode(() => verifySchema({ dbQuery: query, integrityGate: goodGate }), 'SCHEMA_MISMATCH');
    });
  });

  await test('schema inventory contains ledger and all migration-created tables', async () => {
    for (const name of ['schema_migrations', 'evidence_identities', 'opportunity_workspaces', 'evidence_integrity_decisions']) {
      assert(expected.includes(name));
    }
  });

  await test('Evidence Identity foundation baseline is deterministic and non-destructive', async () => {
    const sql001 = inventory[0].content;
    assert(sql001.includes("VALUES ('EVIDENCE_IDENTITY', 0, 0, 0, CURRENT_TIMESTAMP)"));
    assert(!/^\s*(?:DROP|DELETE|UPDATE|REPLACE)\b/im.test(sql001));
  });

  await test('migration dependencies are fixed by sequence', async () => {
    const transaction = buildControlledTransaction({ inventory, revision: 'r', target: 't', operator: 'o', startedAt: 'now' });
    assert(transaction.indexOf('001_evidence_identity_foundation.sql') < transaction.indexOf('002_opportunity_workspace.sql'));
    assert(transaction.indexOf('002_opportunity_workspace.sql') < transaction.indexOf('003_commercial_opportunity_design_states.sql'));
    assert(transaction.indexOf('003_commercial_opportunity_design_states.sql') < transaction.indexOf('004_evidence_integrity_operational.sql'));
    assert(transaction.indexOf('004_evidence_integrity_operational.sql') < transaction.indexOf('005_reports_activity_settings.sql'));
  });

  await test('existing application migration regressions retain all prior SQL', async () => {
    assert(inventory[1].content.includes('opportunity_workspaces'));
    assert(inventory[2].content.includes('opportunity_commercial_estimates'));
    assert(inventory[3].content.includes('evidence_integrity_decisions'));
    assert(inventory[4].content.includes('report_lineages'));
  });

  await test('returned controls contain no secret values or protected rows', async () => {
    const transaction = buildControlledTransaction({ inventory, revision: 'r', target: 'formal-target', operator: 'controlled-operator', startedAt: 'now' });
    assert(!/(password|token|credential|private[_ -]?key)/i.test(transaction));
    assert(!transaction.includes('SELECT *'));
  });

  await test('external authorization reconciles exact checkout revision, tree, context and authority', async () => {
    const resolved = resolveRepositoryIdentity((_command, args) => {
      if (args[0] === 'status') return { status: 0, stderr: '', stdout: '' };
      if (args[2] === 'HEAD^{commit}') {
        return { status: 0, stderr: '', stdout: `${controlledIdentity.revision}\n` };
      }
      if (args[2] === 'HEAD^{tree}') {
        return { status: 0, stderr: '', stdout: `${controlledIdentity.tree}\n` };
      }
      throw new Error('unexpected repository query');
    });
    assert.deepStrictEqual(resolved, controlledIdentity);
    const controls = validateControls(controlledValues, controlOptions());
    assert.deepStrictEqual(controls.identity, controlledIdentity);
    assert.strictEqual(controls.authorization.authority_reference, 'ENG-MIG-AUTH-001');
    assert.strictEqual(
      controls.authorization.canonical_migration_manifest_sha256,
      canonicalManifest.sha256
    );
    assert(Object.isFrozen(controls.authorization));
  });

  await test('canonical manifest composition binds ordered identities and content checksums', async () => {
    assert.strictEqual(
      canonicalManifest.canonical,
      inventory.map(item => [
        item.sequence, item.migration_id, item.filename, item.checksum
      ].join('\t')).join('\n') + '\n'
    );
    assert(/^[a-f0-9]{64}$/.test(canonicalManifest.sha256));
    assert.strictEqual(
      validateCanonicalInventory(inventory).sha256,
      canonicalManifest.sha256
    );
  });

  await test('missing, malformed, expired and obsolete authorization evidence refuses', async () => {
    assert.throws(() => validateControls(controlledValues, controlOptions({
      authorization: undefined
    })), /AUTHORIZATION_EVIDENCE_REQUIRED/);
    assert.throws(() => validateAuthorization(
      { ...controlledAuthorization, authorised_revision: 'bad' },
      controlledIdentity, controlledValues, new Date('2026-07-28T12:00:00Z')
    ), /AUTHORIZATION_EVIDENCE_MALFORMED/);
    const missingManifest = { ...controlledAuthorization };
    delete missingManifest.canonical_migration_manifest_sha256;
    assert.throws(() => validateAuthorization(
      missingManifest, controlledIdentity, controlledValues,
      new Date('2026-07-28T12:00:00Z')
    ), /AUTHORIZATION_EVIDENCE_MALFORMED/);
    assert.throws(() => validateAuthorization(
      { ...controlledAuthorization, canonical_migration_manifest_sha256: 'bad' },
      controlledIdentity, controlledValues, new Date('2026-07-28T12:00:00Z')
    ), /AUTHORIZATION_EVIDENCE_MALFORMED/);
    assert.throws(() => validateAuthorization(
      { ...controlledAuthorization, alternate_authority_reference: 'ENG-MIG-AUTH-002' },
      controlledIdentity, controlledValues, new Date('2026-07-28T12:00:00Z')
    ), /AUTHORIZATION_EVIDENCE_MALFORMED/);
    assert.throws(() => parseArgs(['--target', 'one', '--target', 'two']), /CONTROL_INPUT_INVALID/);
    assert.throws(() => validateAuthorization(
      { ...controlledAuthorization, authority_reference: 'obsolete reference' },
      controlledIdentity, controlledValues, new Date('2026-07-28T12:00:00Z')
    ), /AUTHORITY_REFERENCE_INVALID/);
    assert.throws(() => validateAuthorization(
      controlledAuthorization, controlledIdentity, controlledValues,
      new Date('2026-07-30T00:00:00Z')
    ), /AUTHORIZATION_EVIDENCE_EXPIRED/);
  });

  await test('revision, tree, execution context and unresolved checkout identity refuse', async () => {
    assert.throws(() => validateAuthorization(
      { ...controlledAuthorization, authorised_revision: 'c'.repeat(40) },
      controlledIdentity, controlledValues, new Date('2026-07-28T12:00:00Z')
    ), /REVISION_MISMATCH/);
    assert.throws(() => validateAuthorization(
      { ...controlledAuthorization, authorised_tree: 'c'.repeat(40) },
      controlledIdentity, controlledValues, new Date('2026-07-28T12:00:00Z')
    ), /TREE_MISMATCH/);
    assert.throws(() => validateAuthorization(
      controlledAuthorization, controlledIdentity,
      { ...controlledValues, 'execution-context': 'different' },
      new Date('2026-07-28T12:00:00Z')
    ), /EXECUTION_CONTEXT_MISMATCH/);
    assert.throws(() => resolveRepositoryIdentity(() => ({
      status: 1, stderr: 'not a repository', stdout: ''
    })), /WORKTREE_STATE_UNRESOLVED/);
  });

  await test('dirty staged or unstaged controlled files refuse before target inspection', async () => {
    for (const dirtyStatus of [
      ' M backend/migrations/006_preference_retention_controls.sql\n',
      'M  backend/scripts/apply_migrations.js\n',
      ' M backend/scripts/verify_schema.js\n'
    ]) {
      assert.throws(() => resolveRepositoryIdentity((command, args) => {
        assert.strictEqual(command, 'git');
        if (args[0] === 'status') return { status: 0, stderr: '', stdout: dirtyStatus };
        throw new Error('identity resolution must not follow dirty-state detection');
      }), /CONTROLLED_WORKTREE_DIRTY/);
    }
    const runner = controlledRunner();
    await assert.rejects(() => runMigration(runnerArgs(), {
      ...runner.dependencies,
      identity: { ...controlledIdentity, clean: false }
    }), error => error.code === 'CONTROLLED_WORKTREE_DIRTY');
    assert.strictEqual(runner.inspectionCalls(), 0);
    assert.strictEqual(runner.mutationCalls(), 0);
  });

  await test('substituted migration content and locally recalculated digest refuse before target inspection', async () => {
    const replacement = inventory.map(item => ({ ...item }));
    replacement[5].content = 'SELECT 1; -- arbitrary replacement SQL';
    replacement[5].checksum = crypto.createHash('sha256')
      .update(replacement[5].content).digest('hex');
    const runner = controlledRunner();
    await assert.rejects(() => runMigration(runnerArgs(), {
      ...runner.dependencies,
      inventory: replacement
    }), error => error.code === 'MIGRATION_MANIFEST_AUTHORITY_MISMATCH');
    assert.strictEqual(runner.inspectionCalls(), 0);
    assert.strictEqual(runner.mutationCalls(), 0);
  });

  await test('wrong authorised digest and preflight identity mismatch refuse before target inspection', async () => {
    for (const dependencies of [
      controlOptions({
        authorization: {
          ...controlledAuthorization,
          canonical_migration_manifest_sha256: 'c'.repeat(64)
        }
      }),
      controlOptions({
        preflight: {
          ...supportingEvidence.preflight,
          canonical_migration_manifest_sha256: 'c'.repeat(64)
        }
      })
    ]) {
      const runner = controlledRunner();
      await assert.rejects(() => runMigration(runnerArgs(), {
        ...runner.dependencies,
        ...dependencies
      }), error => error.code === 'MIGRATION_MANIFEST_AUTHORITY_MISMATCH');
      assert.strictEqual(runner.inspectionCalls(), 0);
      assert.strictEqual(runner.mutationCalls(), 0);
    }
  });

  await test('unknown, duplicate and unexpected canonical migration inventory refuses before target inspection', async () => {
    const cases = [
      inventory.map((item, index) => index === 5 ? { ...item, filename: '006_unknown.sql' } : item),
      [...inventory.slice(0, 5), inventory[4]],
      inventory
    ];
    const files = inventory.map(item => item.filename);
    for (let index = 0; index < cases.length; index += 1) {
      const runner = controlledRunner();
      await assert.rejects(() => runMigration(runnerArgs(), {
        ...runner.dependencies,
        inventory: cases[index],
        migrationFiles: index === 2 ? [...files, '007_unexpected.sql'] : files
      }), error => error.code === 'CANONICAL_MIGRATION_INVENTORY_INVALID');
      assert.strictEqual(runner.inspectionCalls(), 0);
      assert.strictEqual(runner.mutationCalls(), 0);
    }
  });

  await test('canonical 001–005 applies migration 006 atomically with exact ledger and schema', async () => {
    await withDatabase(pre006Database, async query => {
      const transaction = buildIncrementalTransaction({
        migration: inventory[5],
        revision: controlledIdentity.revision,
        target: controlledValues.target,
        operator: controlledValues.operator,
        startedAt: '2026-07-28T12:00:00Z'
      });
      assert.strictEqual((transaction.match(/BEGIN IMMEDIATE/g) || []).length, 1);
      assert(!transaction.includes(inventory[0].content));
      assert(transaction.includes(inventory[5].content));
      await query.exec(transaction);
      const ledger = await query.all(
        'SELECT migration_id,filename,sequence,checksum,outcome FROM schema_migrations ORDER BY sequence'
      );
      assert.deepStrictEqual(ledger.map(row => row.migration_id), ['001', '002', '003', '004', '005', '006']);
      assert.strictEqual(ledger[5].checksum, inventory[5].checksum);
      assert.strictEqual(ledger[5].outcome, 'COMPLETED');
      await verifyStructuralSchema(query, EXPECTED_SCHEMA_MANIFEST);
      assert.deepStrictEqual(await query.all('PRAGMA foreign_key_check'), []);
    });
  });

  await test('runner transitions exact 001–005 and reconciles exact 001–006', async () => {
    const phases = [];
    const runner = controlledRunner({
      schemaVerifier: async (_contract, phase) => { phases.push(phase); }
    });
    const result = await runMigration(runnerArgs(), runner.dependencies);
    assert.strictEqual(result.status, 'COMPLETED');
    assert.strictEqual(result.revision, controlledIdentity.revision);
    assert.strictEqual(result.tree, controlledIdentity.tree);
    assert.strictEqual(result.authority_reference, 'ENG-MIG-AUTH-001');
    assert.strictEqual(runner.mutationCalls(), 1);
    assert.deepStrictEqual(phases, ['PRE_006', 'COMPLETE']);
  });

  await test('canonical 001–006 is a verified zero-mutation no-op', async () => {
    const runner = controlledRunner({ initialState: 'COMPLETE' });
    const result = await runMigration(runnerArgs(), runner.dependencies);
    assert.strictEqual(result.status, 'VERIFIED_NOOP');
    assert.strictEqual(runner.mutationCalls(), 0);
  });

  await test('absent, partial, reordered, unknown and checksum-mismatched ledgers refuse', async () => {
    assert.throws(() => classifyLedger(inventory, controlledRunner({
      initialState: 'ABSENT'
    }).dependencies.spawn), /LEDGER_MISSING/);
    for (const [rows, code] of [
      [ledgerRows(4), 'LEDGER_DIRTY'],
      [[ledgerRows(5)[0], ledgerRows(5)[2], ledgerRows(5)[1], ...ledgerRows(5).slice(3)], 'LEDGER_ORDER'],
      [[...ledgerRows(5).slice(0, 4), {
        migration_id: '999', filename: '999_unknown.sql', sequence: 5,
        checksum: 'f'.repeat(64), outcome: 'COMPLETED'
      }], 'LEDGER_ORDER'],
      [ledgerRows(5).map((row, index) => index === 2 ? { ...row, checksum: '0'.repeat(64) } : row), 'LEDGER_CHECKSUM']
    ]) {
      assert.throws(() => classifyLedger(inventory, controlledRunner({ rows }).dependencies.spawn), new RegExp(code));
    }
    const missingMigration = controlledRunner();
    await assert.rejects(() => runMigration(runnerArgs(), {
      ...missingMigration.dependencies,
      inventory: inventory.slice(0, 5)
    }), error => error.code === 'CANONICAL_MIGRATION_INVENTORY_INVALID');
  });

  await test('fully rolled-back interruption is retryable and concurrent refusal mutates no ledger', async () => {
    const interrupted = controlledRunner({ failMutation: true });
    await assert.rejects(() => runMigration(runnerArgs(), interrupted.dependencies),
      error => error.code === 'MIGRATION_ATOMIC_EXECUTION_FAILED');
    assert.strictEqual(interrupted.mutationCalls(), 1);
    const retry = controlledRunner();
    assert.strictEqual((await runMigration(runnerArgs(), retry.dependencies)).status, 'COMPLETED');
    assert.throws(() => executeTeamDb('BEGIN IMMEDIATE;', () => ({
      status: 1, stderr: 'database is locked', stdout: ''
    })), /MIGRATION_ATOMIC_EXECUTION_FAILED/);
  });

  await test('dirty pre-state schema and unreconciled post-state refuse', async () => {
    const dirty = controlledRunner({
      schemaVerifier: async (_contract, phase) => {
        if (phase === 'PRE_006') throw new MigrationControlError('SCHEMA_MISMATCH');
      }
    });
    await assert.rejects(() => runMigration(runnerArgs(), dirty.dependencies),
      error => error.code === 'SCHEMA_MISMATCH');
    assert.strictEqual(dirty.mutationCalls(), 0);
    let calls = 0;
    const unreconciled = controlledRunner({
      schemaVerifier: async (_contract, phase) => {
        calls += 1;
        if (phase === 'COMPLETE') throw new MigrationControlError('SCHEMA_MISMATCH');
      }
    });
    await assert.rejects(() => runMigration(runnerArgs(), unreconciled.dependencies),
      error => error.code === 'SCHEMA_MISMATCH');
    assert.strictEqual(calls, 2);
  });

  await test('backup restoration and forward-recovery evidence is mandatory', async () => {
    assert.throws(() => validateControls(controlledValues, controlOptions({
      backup: undefined
    })), /BACKUP_PREREQUISITE/);
    const sql001 = inventory[0].content;
    assert(!/\bDROP\b/i.test(sql001));
  });

  console.log(`RESULT ${count} PASS, 0 FAIL`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
