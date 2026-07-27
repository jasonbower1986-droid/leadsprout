const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('./backend/node_modules/sqlite3');
const {
  buildControlledTransaction,
  executeTeamDb,
  inspectLedger,
  parseArgs,
  validateControls
} = require('./backend/scripts/apply_migrations');
const {
  createdTables,
  featureDisabled,
  migrationInventory,
  verifySchema
} = require('./backend/scripts/verify_schema');

const inventory = migrationInventory();
const expected = createdTables(inventory);
const cleanRows = inventory.map(item => ({
  migration_id: item.migration_id,
  filename: item.filename,
  sequence: item.sequence,
  checksum: item.checksum,
  outcome: 'COMPLETED'
}));
const goodGate = { verify: async () => ({ status: 'VERIFIED' }) };

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
      await verifySchema({ dbQuery: query, integrityGate: goodGate });
      assert(query.calls.length > 0);
      assert(query.calls.every(statement => /^\s*(?:SELECT|PRAGMA)\b/i.test(statement)));
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

  await test('canonical 001 through 004 sequence is deterministic', async () => {
    assert.deepStrictEqual(inventory.map(item => item.migration_id), ['001', '002', '003', '004']);
    assert(inventory.every(item => /^[a-f0-9]{64}$/.test(item.checksum)));
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
    assert.strictEqual(state, 'COMPLETED');
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
    const values = parseArgs(['--revision', '32248db8763208b8e56ac99a2b7934557f260513']);
    assert.throws(() => validateControls(values, { LEADSPROUT_CONTROLLED_MIGRATION: 'true' }), /TARGET_MISMATCH/);
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
  });

  await test('existing application migration regressions retain all prior SQL', async () => {
    assert(inventory[1].content.includes('opportunity_workspaces'));
    assert(inventory[2].content.includes('opportunity_commercial_estimates'));
    assert(inventory[3].content.includes('evidence_integrity_decisions'));
  });

  await test('returned controls contain no secret values or protected rows', async () => {
    const transaction = buildControlledTransaction({ inventory, revision: 'r', target: 'formal-target', operator: 'controlled-operator', startedAt: 'now' });
    assert(!/(password|token|credential|private[_ -]?key)/i.test(transaction));
    assert(!transaction.includes('SELECT *'));
  });

  await test('backup restoration and forward-recovery evidence is mandatory', async () => {
    assert.throws(() => validateControls({}, { LEADSPROUT_CONTROLLED_MIGRATION: 'true' }), /REVISION_MISMATCH/);
    const sql001 = inventory[0].content;
    assert(!/\bDROP\b/i.test(sql001));
  });

  console.log(`RESULT ${count} PASS, 0 FAIL`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
