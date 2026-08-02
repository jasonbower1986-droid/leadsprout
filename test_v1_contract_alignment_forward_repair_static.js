const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  EXPECTED_PRE_ALIGNMENT_SCHEMA_MANIFEST,
  EXPECTED_PRE_008_SCHEMA_MANIFEST,
  EXPECTED_SCHEMA_MANIFEST,
  FINAL_TRIGGER_NAMES,
  MIGRATIONS,
  expectedFinalTriggers,
  migrationInventory,
  normalizeSql
} = require('./backend/scripts/verify_schema');
const {
  buildIncrementalTransaction,
  validateCanonicalInventory
} = require('./backend/scripts/apply_migrations');

const repair = fs.readFileSync(
  path.join(__dirname, 'backend/migrations/008_v1_contract_alignment_forward_repair.sql'),
  'utf8'
);
const inventory = migrationInventory();

assert.strictEqual(MIGRATIONS.at(-1), '008_v1_contract_alignment_forward_repair.sql');
assert.strictEqual(inventory.length, 8);
assert(/^[a-f0-9]{64}$/.test(validateCanonicalInventory(inventory).sha256));
assert(Object.isFrozen(EXPECTED_PRE_ALIGNMENT_SCHEMA_MANIFEST));
assert(Object.isFrozen(EXPECTED_PRE_008_SCHEMA_MANIFEST));

for (const name of [
  'opportunity_contact_verification_snapshots',
  'opportunity_selection_decisions',
  'opportunity_workspaces',
  'preference_retention_holds'
]) {
  assert.notStrictEqual(
    EXPECTED_PRE_008_SCHEMA_MANIFEST.tables[name].sql,
    EXPECTED_SCHEMA_MANIFEST.tables[name].sql,
    name
  );
}
assert.strictEqual(
  EXPECTED_PRE_008_SCHEMA_MANIFEST.tables.preference_retention_cases.sql,
  EXPECTED_SCHEMA_MANIFEST.tables.preference_retention_cases.sql
);
assert.notStrictEqual(
  EXPECTED_PRE_ALIGNMENT_SCHEMA_MANIFEST.tables.preference_retention_cases.sql,
  EXPECTED_SCHEMA_MANIFEST.tables.preference_retention_cases.sql
);

assert(!/\bwritable_schema\b/i.test(repair));
assert(repair.includes('CREATE TABLE v1_contract_alignment_guard'));
assert(repair.includes('DROP TABLE v1_contract_alignment_guard;'));
assert(!/CREATE\s+TEMP(?:ORARY)?\s+TABLE/i.test(repair));
for (const name of [
  'opportunity_workspaces',
  'opportunity_selection_decisions',
  'opportunity_contact_verification_snapshots',
  'preference_retention_cases',
  'preference_retention_holds'
]) {
  assert(repair.includes(`CREATE TABLE ${name}_contract_repair`));
  assert(repair.includes(`DROP TABLE ${name};`));
  assert(repair.includes(`RENAME TO ${name};`));
}

for (const control of [
  'contact_null_provenance_rows',
  'selection_dangling_candidate_rows',
  'retention_case_shape_violation_rows',
  'retention_hold_state_violation_rows',
  'retention_hold_dangling_case_rows',
  'pre_repair_trigger_count',
  'workspace_copied_rows',
  'selection_copied_rows',
  'contact_copied_rows',
  'retention_case_copied_rows',
  'retention_hold_copied_rows',
  'workspace_final_rows',
  'selection_final_rows',
  'contact_final_rows',
  'retention_case_final_rows',
  'retention_hold_final_rows',
  'post_repair_trigger_count',
  'post_repair_canonical_trigger_count'
]) assert(repair.includes(control), control);

const createdTriggers = [...repair.matchAll(/CREATE\s+TRIGGER\s+([a-z0-9_]+)/gi)]
  .map(match => match[1]);
assert.deepStrictEqual(createdTriggers.sort(), [...FINAL_TRIGGER_NAMES].filter(name =>
  name.startsWith('preference_')
).sort());
const expectedTriggers = expectedFinalTriggers();
for (const name of createdTriggers) {
  const start = repair.search(new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b`, 'i'));
  const remaining = repair.slice(start);
  const next = remaining.slice(1).search(/\nCREATE\s+TRIGGER\s+|\nUPDATE v1_contract_alignment_guard/i);
  const statement = next < 0 ? remaining : remaining.slice(0, next + 1);
  assert.strictEqual(normalizeSql(statement), expectedTriggers[name], name);
}

const transaction = buildIncrementalTransaction({
  migration: inventory[7],
  revision: 'a'.repeat(40),
  target: 'synthetic-disposable-target',
  operator: 'synthetic-test',
  startedAt: '2026-08-02T00:00:00Z'
});
assert(transaction.startsWith('PRAGMA foreign_keys = OFF;\nBEGIN IMMEDIATE;'));
assert(transaction.endsWith('COMMIT;\nPRAGMA foreign_keys = ON;'));
assert(transaction.includes("'008','008_v1_contract_alignment_forward_repair.sql',8"));
assert(transaction.includes(repair));

console.log('PASS v1 contract-alignment forward-repair static controls');
