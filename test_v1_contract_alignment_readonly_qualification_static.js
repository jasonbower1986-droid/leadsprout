const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  COUNT_FIELDS,
  EXPECTED_STATEMENT_COUNT,
  FOREIGN_KEY_CHECK_SQL,
  GUARD_PROJECTION_SQL,
  LEDGER_SQL,
  ZERO_FIELDS,
  qualifyV1ContractAlignment
} = require('./backend/scripts/qualify_v1_contract_alignment');

const filename = path.join(
  __dirname,
  'backend/scripts/qualify_v1_contract_alignment.js'
);
const source = fs.readFileSync(filename, 'utf8');

assert.strictEqual(typeof qualifyV1ContractAlignment, 'function');
assert(Object.isFrozen(COUNT_FIELDS));
assert(Object.isFrozen(ZERO_FIELDS));
assert.strictEqual(COUNT_FIELDS.length, 11);
assert.strictEqual(ZERO_FIELDS.length, 5);
assert.strictEqual(EXPECTED_STATEMENT_COUNT, 390);
assert(/^SELECT\b/.test(LEDGER_SQL));
assert(/^SELECT\b/.test(GUARD_PROJECTION_SQL));
assert.strictEqual(FOREIGN_KEY_CHECK_SQL, 'PRAGMA foreign_key_check');

assert(source.includes('await verifyRepairablePre007Triggers(query);'));
assert(source.includes(
  'await verifyStructuralSchema(query, EXPECTED_PRE_ALIGNMENT_SCHEMA_MANIFEST);'
));
assert(source.includes('await query.all(LEDGER_SQL)'));
assert(source.includes('await query.all(GUARD_PROJECTION_SQL)'));
assert(source.includes('await query.all(FOREIGN_KEY_CHECK_SQL)'));
assert(/require\(['"]\.\/verify_schema_readonly['"]\)/.test(source));
assert(!/require\(['"]\.\/verify_schema['"]\)/.test(source));
assert(!/require\(['"]\.\/apply_migrations['"]\)/.test(source));
assert(!/\bquery\s*\.\s*(?:run|get|exec|transaction)\s*\(/.test(source));
assert(!/\b(?:spawn|connect|open|migrate|startup|verifySchema)\s*\(/.test(source));

const functionSource = qualifyV1ContractAlignment.toString();
const orderedCalls = [
  'requireReadOnlyQueryAll(query)',
  'verifyRepairablePre007Triggers(query)',
  'verifyStructuralSchema(query, EXPECTED_PRE_ALIGNMENT_SCHEMA_MANIFEST)',
  'query.all(LEDGER_SQL)',
  'query.all(GUARD_PROJECTION_SQL)',
  'query.all(FOREIGN_KEY_CHECK_SQL)'
];
let previous = -1;
for (const call of orderedCalls) {
  const current = functionSource.indexOf(call);
  assert(current > previous, call);
  previous = current;
}

for (const field of COUNT_FIELDS) assert(GUARD_PROJECTION_SQL.includes(field), field);
assert.strictEqual((GUARD_PROJECTION_SQL.match(/COUNT\(\*\)/g) || []).length, 11);
assert(!/;/.test(LEDGER_SQL));
assert(!/;/.test(GUARD_PROJECTION_SQL));
assert(!/;/.test(FOREIGN_KEY_CHECK_SQL));

console.log('PASS V1 contract-alignment read-only qualification static containment');
