const crypto = require('crypto');
const {
  MigrationControlError,
  expectedPre007Triggers,
  normalizeSql
} = require('./verify_schema_readonly');

const TRIGGER_INVENTORY_SQL = `SELECT name, sql FROM sqlite_schema
WHERE type = 'trigger'
ORDER BY name`;

function fail(code) {
  throw new MigrationControlError(code);
}

function requireReadOnlyQueryAll(query) {
  if (!query || typeof query !== 'object' || typeof query.all !== 'function') {
    fail('READ_ONLY_QUERY_ALL_REQUIRED');
  }
  for (const method of ['run', 'get', 'exec', 'transaction']) {
    if (typeof query[method] === 'function') fail('READ_ONLY_QUERY_ALL_REQUIRED');
  }
}

function digestNormalizedSql(sql) {
  return crypto.createHash('sha256').update(normalizeSql(sql)).digest('hex');
}

function validateRows(rows) {
  if (!Array.isArray(rows)) fail('TRIGGER_INVENTORY_RESULT_INVALID');
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row.name !== 'string' || row.name.length === 0 ||
        typeof row.sql !== 'string' || row.sql.length === 0 || seen.has(row.name)) {
      fail('TRIGGER_INVENTORY_RESULT_INVALID');
    }
    seen.add(row.name);
  }
}

async function diagnoseV1TriggerInventory(query, options = {}) {
  requireReadOnlyQueryAll(query);
  const expected = expectedPre007Triggers(options.migrationsDir);
  let rows;
  try {
    rows = await query.all(TRIGGER_INVENTORY_SQL);
  } catch (_) {
    fail('TRIGGER_INVENTORY_READ_FAILED');
  }
  validateRows(rows);

  const expectedHashes = Object.fromEntries(Object.entries(expected).map(
    ([name, sql]) => [name, digestNormalizedSql(sql)]
  ));
  const observedHashes = Object.fromEntries(rows.map(
    row => [row.name, digestNormalizedSql(row.sql)]
  ));
  const expectedNames = Object.keys(expectedHashes).sort();
  const observedNames = Object.keys(observedHashes).sort();
  const missing = expectedNames.filter(name => !Object.hasOwn(observedHashes, name));
  const unexpected = observedNames.filter(name => !Object.hasOwn(expectedHashes, name));
  const altered = expectedNames
    .filter(name => Object.hasOwn(observedHashes, name) &&
      observedHashes[name] !== expectedHashes[name])
    .map(name => Object.freeze({
      name,
      expected_normalized_sql_sha256: expectedHashes[name],
      observed_normalized_sql_sha256: observedHashes[name]
    }));
  const observed = observedNames.map(name => Object.freeze({
    name,
    normalized_sql_sha256: observedHashes[name]
  }));

  return Object.freeze({
    status: 'CAPTURED',
    matches_expected: missing.length === 0 && unexpected.length === 0 && altered.length === 0,
    expected_count: expectedNames.length,
    observed_count: observedNames.length,
    missing: Object.freeze(missing),
    unexpected: Object.freeze(unexpected),
    altered: Object.freeze(altered),
    observed: Object.freeze(observed),
    statements_executed: 1
  });
}

module.exports = {
  TRIGGER_INVENTORY_SQL,
  diagnoseV1TriggerInventory,
  digestNormalizedSql,
  requireReadOnlyQueryAll,
  validateRows
};
