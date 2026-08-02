const assert = require('assert');
const {
  expectedPre007Triggers
} = require('./backend/scripts/verify_schema_readonly');
const {
  TRIGGER_INVENTORY_SQL,
  diagnoseV1TriggerInventory
} = require('./backend/scripts/diagnose_v1_trigger_inventory');

function exactRows() {
  return Object.entries(expectedPre007Triggers())
    .map(([name, sql]) => ({ name, sql }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function query(rows, observations = []) {
  return Object.freeze({
    all: async statement => {
      observations.push(statement);
      return rows;
    }
  });
}

async function rejectsCode(action, code) {
  await assert.rejects(action, error => error?.code === code);
}

async function run() {
  const observations = [];
  const exact = await diagnoseV1TriggerInventory(query(exactRows(), observations));
  assert.strictEqual(exact.status, 'CAPTURED');
  assert.strictEqual(exact.matches_expected, true);
  assert.strictEqual(exact.expected_count, 17);
  assert.strictEqual(exact.observed_count, 17);
  assert.deepStrictEqual(exact.missing, []);
  assert.deepStrictEqual(exact.unexpected, []);
  assert.deepStrictEqual(exact.altered, []);
  assert.strictEqual(exact.observed.length, 17);
  assert(exact.observed.every(row => /^[a-f0-9]{64}$/.test(row.normalized_sql_sha256)));
  assert(!JSON.stringify(exact).includes('CREATE TRIGGER'));
  assert(Object.isFrozen(exact));
  assert(Object.isFrozen(exact.observed));
  assert(exact.observed.every(Object.isFrozen));
  assert.strictEqual(exact.statements_executed, 1);
  assert.deepStrictEqual(observations, [TRIGGER_INVENTORY_SQL]);

  const missingRows = exactRows().slice(1);
  const missing = await diagnoseV1TriggerInventory(query(missingRows));
  assert.strictEqual(missing.status, 'CAPTURED');
  assert.strictEqual(missing.matches_expected, false);
  assert.strictEqual(missing.observed_count, 16);
  assert.deepStrictEqual(missing.missing, [exactRows()[0].name]);

  const unexpectedRows = [...exactRows(), {
    name: 'unexpected_trigger',
    sql: 'CREATE TRIGGER unexpected_trigger AFTER INSERT ON synthetic BEGIN SELECT 1; END'
  }].sort((left, right) => left.name.localeCompare(right.name));
  const unexpected = await diagnoseV1TriggerInventory(query(unexpectedRows));
  assert.strictEqual(unexpected.status, 'CAPTURED');
  assert.strictEqual(unexpected.matches_expected, false);
  assert.strictEqual(unexpected.observed_count, 18);
  assert.deepStrictEqual(unexpected.unexpected, ['unexpected_trigger']);

  const changedRows = exactRows();
  changedRows[0] = { ...changedRows[0], sql: `${changedRows[0].sql} ` };
  const whitespaceOnly = await diagnoseV1TriggerInventory(query(changedRows));
  assert.strictEqual(whitespaceOnly.matches_expected, true);
  changedRows[0] = { ...changedRows[0], sql: `${changedRows[0].sql} SELECT 1` };
  const altered = await diagnoseV1TriggerInventory(query(changedRows));
  assert.strictEqual(altered.status, 'CAPTURED');
  assert.strictEqual(altered.matches_expected, false);
  assert.strictEqual(altered.altered.length, 1);
  assert.strictEqual(altered.altered[0].name, changedRows[0].name);
  assert(/^[a-f0-9]{64}$/.test(altered.altered[0].expected_normalized_sql_sha256));
  assert(/^[a-f0-9]{64}$/.test(altered.altered[0].observed_normalized_sql_sha256));

  const combinedRows = exactRows().slice(1);
  combinedRows[0] = { ...combinedRows[0], sql: `${combinedRows[0].sql} SELECT 2` };
  combinedRows.push({
    name: 'unexpected_trigger',
    sql: 'CREATE TRIGGER unexpected_trigger AFTER INSERT ON synthetic BEGIN SELECT 1; END'
  });
  combinedRows.sort((left, right) => left.name.localeCompare(right.name));
  const combined = await diagnoseV1TriggerInventory(query(combinedRows));
  assert.strictEqual(combined.status, 'CAPTURED');
  assert.strictEqual(combined.matches_expected, false);
  assert.strictEqual(combined.missing.length, 1);
  assert.strictEqual(combined.unexpected.length, 1);
  assert.strictEqual(combined.altered.length, 1);
  assert(!JSON.stringify(combined).includes('CREATE TRIGGER'));

  const empty = await diagnoseV1TriggerInventory(query([]));
  assert.strictEqual(empty.status, 'CAPTURED');
  assert.strictEqual(empty.matches_expected, false);
  assert.strictEqual(empty.observed_count, 0);
  assert.strictEqual(empty.missing.length, 17);

  const unsorted = await diagnoseV1TriggerInventory(query([...exactRows()].reverse()));
  assert.strictEqual(unsorted.status, 'CAPTURED');
  assert.strictEqual(unsorted.matches_expected, true);

  await rejectsCode(
    () => diagnoseV1TriggerInventory({ all: async () => [], run: async () => {} }),
    'READ_ONLY_QUERY_ALL_REQUIRED'
  );
  await rejectsCode(
    () => diagnoseV1TriggerInventory(query([{ name: 'duplicate', sql: 'x' },
      { name: 'duplicate', sql: 'y' }])),
    'TRIGGER_INVENTORY_RESULT_INVALID'
  );
  await rejectsCode(
    () => diagnoseV1TriggerInventory(query([{ name: 'a', sql: null }])),
    'TRIGGER_INVENTORY_RESULT_INVALID'
  );
  await rejectsCode(
    () => diagnoseV1TriggerInventory({ all: async () => { throw new Error('secret'); } }),
    'TRIGGER_INVENTORY_READ_FAILED'
  );

  console.log('PASS V1 one-query trigger-inventory diagnostic');
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
