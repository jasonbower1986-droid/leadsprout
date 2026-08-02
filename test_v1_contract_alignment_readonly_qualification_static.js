const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  COUNT_FIELDS,
  EXPECTED_STATEMENT_COUNT,
  FOREIGN_KEY_CHECK_SQL,
  FOREIGN_KEY_RELATIONSHIP_COUNT,
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
assert(/^SELECT\b/.test(FOREIGN_KEY_CHECK_SQL));
assert.strictEqual(FOREIGN_KEY_RELATIONSHIP_COUNT, 71);
assert.strictEqual((FOREIGN_KEY_CHECK_SQL.match(/SELECT COUNT\(\*\)/g) || []).length, 71);
assert.strictEqual(Buffer.byteLength(FOREIGN_KEY_CHECK_SQL), 17022);
assert.strictEqual(
  crypto.createHash('sha256').update(FOREIGN_KEY_CHECK_SQL).digest('hex'),
  '72a52dfa437f74a7a9f3adda52be30b5b92caaed4cfff94bf67e528c4a70ffcf'
);
assert(FOREIGN_KEY_CHECK_SQL.endsWith(' AS foreign_key_violation_count'));
assert(!/\bPRAGMA\b/i.test(FOREIGN_KEY_CHECK_SQL));
assert(!/pragma_/i.test(FOREIGN_KEY_CHECK_SQL));

assert(source.includes('await verifyRepairablePre007Triggers(query);'));
assert(source.includes(
  'await verifyStructuralSchema(query, EXPECTED_PRE_ALIGNMENT_SCHEMA_MANIFEST);'
));
assert(source.includes('await query.all(LEDGER_SQL)'));
assert(source.includes('await query.all(GUARD_PROJECTION_SQL)'));
assert(source.includes('await query.all(FOREIGN_KEY_CHECK_SQL)'));
assert(/require\(['"]\.\/verify_schema_readonly['"]\)/.test(source));
assert(/require\(['"]\.\/foreign_key_integrity_readonly['"]\)/.test(source));
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
