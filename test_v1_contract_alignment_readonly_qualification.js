const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  buildControlledTransaction,
  predecessorBaseSchema
} = require('./backend/scripts/apply_migrations');
const {
  EXPECTED_STATEMENT_COUNT,
  FOREIGN_KEY_CHECK_SQL,
  GUARD_PROJECTION_SQL,
  LEDGER_SQL,
  qualifyV1ContractAlignment
} = require('./backend/scripts/qualify_v1_contract_alignment');
const {
  FINAL_TRIGGER_NAMES,
  migrationInventory
} = require('./backend/scripts/verify_schema');
const { legacyDefinitions } = require('./test_v1_contract_alignment_forward_repair');

const SQLITE = '/usr/bin/sqlite3';

function sqlite(database, statement) {
  const result = spawnSync(SQLITE, ['-json', database, `\n${statement}`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'sqlite failed');
  return JSON.parse(result.stdout || '[]');
}

function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-readonly-qualification-'));
  const database = path.join(directory, 'synthetic.sqlite');
  const inventory = migrationInventory();
  sqlite(database, `${predecessorBaseSchema().content}\n${buildControlledTransaction({
    inventory: inventory.slice(0, 6),
    revision: 'synthetic-pre-alignment',
    target: 'synthetic-disposable-target',
    operator: 'synthetic-test',
    startedAt: '2026-08-02T00:00:00Z'
  })}`);
  const triggerState = options.triggerState || 'CANONICAL_17';
  const clearTriggers = FINAL_TRIGGER_NAMES
    .map(name => `DROP TRIGGER IF EXISTS ${name};`).join('\n');
  const triggerOverride = triggerState === 'CANONICAL_17' ? '' : triggerState === 'ZERO'
    ? clearTriggers
    : triggerState === 'PARTIAL'
      ? `${clearTriggers}\nCREATE TRIGGER trg_report_versions_no_delete
         BEFORE DELETE ON report_versions BEGIN SELECT 1; END;`
      : (() => { throw new Error('unsupported trigger state'); })();
  sqlite(database, `PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;
    ${legacyDefinitions()}
    ${triggerOverride}
    COMMIT; PRAGMA foreign_keys = ON;`);
  return {
    database,
    dispose: () => fs.rmSync(directory, { recursive: true, force: true })
  };
}

function query(database, observations = [], intercept = null) {
  return Object.freeze({
    all: async statement => {
      observations.push(statement);
      const rows = sqlite(database, statement);
      return intercept ? intercept(statement, rows) : rows;
    }
  });
}

async function rejectsCode(action, code) {
  await assert.rejects(action, error => error?.code === code);
}

async function run() {
  let acceptedStatementCount = 0;
  for (const [triggerState, expectedCount, expectedClassification] of [
    ['CANONICAL_17', 17, 'CANONICAL_17'],
    ['ZERO', 0, 'ZERO']
  ]) {
    const clean = fixture({ triggerState });
    try {
      const statements = [];
      const result = await qualifyV1ContractAlignment(query(clean.database, statements));
      assert.strictEqual(result.status, 'QUALIFIED_READ_ONLY');
      assert.strictEqual(result.trigger_inventory.state, expectedClassification);
      assert.strictEqual(result.trigger_inventory.observed_count, expectedCount);
      assert.strictEqual(result.ledger.length, 6);
      assert.strictEqual(result.counts.pre_repair_trigger_count, expectedCount);
      assert.strictEqual(result.foreign_key_check_rows, 0);
      assert.strictEqual(statements.at(-3), LEDGER_SQL);
      assert.strictEqual(statements.at(-2), GUARD_PROJECTION_SQL);
      assert.strictEqual(statements.at(-1), FOREIGN_KEY_CHECK_SQL);
      assert(statements.every(statement => /^\s*(?:SELECT|PRAGMA)\b/i.test(statement)));
      assert(statements.every(statement =>
        !/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM|ATTACH|DETACH|BEGIN|COMMIT|ROLLBACK)\b/i
          .test(statement.replace(/'[^']*'/g, "''"))
      ));
      acceptedStatementCount = statements.length;
      assert.strictEqual(acceptedStatementCount, EXPECTED_STATEMENT_COUNT);
    } finally {
      clean.dispose();
    }
  }

  const partial = fixture({ triggerState: 'PARTIAL' });
  try {
    await rejectsCode(
      () => qualifyV1ContractAlignment(query(partial.database)),
      'SCHEMA_MISMATCH'
    );
  } finally {
    partial.dispose();
  }

  await rejectsCode(
    () => qualifyV1ContractAlignment({ all: async () => [], run: async () => {} }),
    'READ_ONLY_QUERY_ALL_REQUIRED'
  );

  for (const testCase of [
    {
      name: 'ledger',
      code: 'QUALIFICATION_LEDGER_MISMATCH',
      intercept: (statement, rows) => statement === LEDGER_SQL ? rows.slice(0, 5) : rows
    },
    {
      name: 'guard',
      code: 'QUALIFICATION_GUARD_REJECTED',
      intercept: (statement, rows) => statement === GUARD_PROJECTION_SQL
        ? [{ ...rows[0], contact_null_provenance_rows: 1 }]
        : rows
    },
    {
      name: 'trigger state changed during qualification',
      code: 'QUALIFICATION_GUARD_REJECTED',
      intercept: (statement, rows) => statement === GUARD_PROJECTION_SQL
        ? [{ ...rows[0], pre_repair_trigger_count: 0 }]
        : rows
    },
    {
      name: 'foreign key',
      code: 'QUALIFICATION_FOREIGN_KEY_CHECK_FAILED',
      intercept: (statement, rows) => statement === FOREIGN_KEY_CHECK_SQL
        ? [{ foreign_key_violation_count: 1 }]
        : rows
    },
    {
      name: 'foreign key result shape',
      code: 'QUALIFICATION_FOREIGN_KEY_CHECK_FAILED',
      intercept: (statement, rows) => statement === FOREIGN_KEY_CHECK_SQL
        ? [{ unexpected_field: 0 }]
        : rows
    }
  ]) {
    const database = fixture();
    try {
      await rejectsCode(
        () => qualifyV1ContractAlignment(query(database.database, [], testCase.intercept)),
        testCase.code
      );
    } finally {
      database.dispose();
    }
  }

  console.log(
    `PASS V1 contract-alignment read-only qualification (${acceptedStatementCount} reads)`
  );
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
