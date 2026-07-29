const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  MIGRATIONS,
  EXPECTED_PRE_007_SCHEMA_MANIFEST,
  EXPECTED_SCHEMA_MANIFEST,
  PREFERENCE_RETENTION_TRIGGER_NAMES,
  expectedPreferenceRetentionTriggers,
  featureDisabled,
  normalizeSql
} = require('./backend/scripts/verify_schema');
const {
  buildIncrementalTransaction,
  migrationManifestDigest,
  requireForeignKeyEnforcement,
  validateCanonicalInventory,
  validateTargetConfigurationEvidence,
  verifyTargetSchema
} = require('./backend/scripts/apply_migrations');

const root = __dirname;
const migration006 = fs.readFileSync(
  path.join(root, 'backend/migrations/006_preference_retention_controls.sql'),
  'utf8'
);
const repair = fs.readFileSync(
  path.join(root, 'backend/migrations/007_preference_retention_cases_forward_repair.sql'),
  'utf8'
);
const inventory = MIGRATIONS.map((filename, index) => {
  const content = fs.readFileSync(path.join(root, 'backend/migrations', filename), 'utf8');
  return {
    migration_id: filename.slice(0, 3),
    filename,
    sequence: index + 1,
    checksum: require('crypto').createHash('sha256').update(content).digest('hex'),
    content
  };
});

assert.strictEqual(MIGRATIONS.at(-1), '007_preference_retention_cases_forward_repair.sql');
assert(!EXPECTED_PRE_007_SCHEMA_MANIFEST.tables.preference_retention_cases.sql.includes(
  "scope_type='membership'anduser_idisnotnullandworkspace_idisnull"
));
assert(EXPECTED_SCHEMA_MANIFEST.tables.preference_retention_cases.sql.includes(
  "scope_type='membership'anduser_idisnotnullandworkspace_idisnull"
));
assert.strictEqual(PREFERENCE_RETENTION_TRIGGER_NAMES.length, 10);
assert.deepStrictEqual(
  Object.keys(expectedPreferenceRetentionTriggers()).sort(),
  [...PREFERENCE_RETENTION_TRIGGER_NAMES].sort()
);
assert.strictEqual(validateCanonicalInventory(inventory).sha256, migrationManifestDigest(inventory).sha256);

assert(repair.includes('CREATE TABLE preference_retention_cases_forward_repair'));
assert.deepStrictEqual(
  [...repair.matchAll(/CREATE\s+(?:TEMP\s+)?TABLE\s+([a-z0-9_]+)/gi)].map(match => match[1]),
  ['preference_retention_forward_repair_guard', 'preference_retention_cases_forward_repair']
);
assert(!/\b(?:writable_schema|sqlite_schema)\b/i.test(repair));
assert(!/006_preference_retention_controls\.sql/i.test(repair));

const columns = [
  'retention_case_id', 'scope_type', 'organization_id', 'user_id', 'workspace_id',
  'inactive_at', 'deletion_due_at', 'state', 'claim_identity', 'claimed_at',
  'completed_at', 'failure_code', 'created_at'
];
const insert = repair.match(
  /INSERT INTO preference_retention_cases_forward_repair\s*\(([^)]+)\)\s*SELECT\s*([\s\S]+?)\s*FROM preference_retention_cases;/i
);
assert(insert);
const listed = value => value.split(',').map(item => item.trim());
assert.deepStrictEqual(listed(insert[1]), columns);
assert.deepStrictEqual(listed(insert[2]), columns);

const scopeShape =
  /\(scope_type='MEMBERSHIP' AND user_id IS NOT NULL AND workspace_id IS NULL\)\s+OR\s+\(scope_type='WORKSPACE' AND workspace_id IS NOT NULL\)/;
assert(scopeShape.test(migration006));
assert(scopeShape.test(repair));
assert(repair.includes('CREATE INDEX idx_preference_retention_due'));
for (const control of [
  'source_row_count',
  'source_violation_count',
  'pre_repair_trigger_count',
  'copied_row_count',
  'final_row_count',
  'post_repair_trigger_count',
  'post_repair_canonical_trigger_count'
]) {
  assert(repair.includes(control));
}

const createdTriggers = [...repair.matchAll(/CREATE\s+TRIGGER\s+([a-z0-9_]+)/gi)]
  .map(match => match[1]);
assert.deepStrictEqual(createdTriggers, PREFERENCE_RETENTION_TRIGGER_NAMES);
const expectedTriggers = expectedPreferenceRetentionTriggers();
for (const name of PREFERENCE_RETENTION_TRIGGER_NAMES) {
  assert(repair.includes(`DROP TRIGGER IF EXISTS ${name};`));
  const start = repair.search(new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b`, 'i'));
  const remaining = repair.slice(start);
  const next = remaining.slice(1).search(/\nCREATE\s+TRIGGER\s+|\nUPDATE preference_retention_forward_repair_guard/i);
  const statement = next < 0 ? remaining : remaining.slice(0, next + 1);
  assert.strictEqual(normalizeSql(statement), expectedTriggers[name]);
}

const transaction = buildIncrementalTransaction({
  migration: inventory[6],
  revision: 'a'.repeat(40),
  target: 'review-only-target',
  operator: 'review-only-operator',
  startedAt: '2026-07-29T00:00:00Z'
});
assert(transaction.startsWith('PRAGMA foreign_keys = OFF;\nBEGIN IMMEDIATE;'));
assert(transaction.endsWith('COMMIT;\nPRAGMA foreign_keys = ON;'));
assert(transaction.includes("'007','007_preference_retention_cases_forward_repair.sql',7"));
assert(!transaction.includes("'006','006_preference_retention_controls.sql',6"));
assert(verifyTargetSchema.toString().includes("query.all('PRAGMA foreign_key_check')"));
assert(requireForeignKeyEnforcement.toString().includes(
  "'PRAGMA foreign_keys = ON; PRAGMA foreign_keys;'"
));

const authority = { authority_reference: 'EXEC-REPAIR-001' };
const targetConfiguration = {
  authority_reference: authority.authority_reference,
  target_id: 'synthetic-disposable-target',
  configuration_key: 'OPPORTUNITY_WORKSPACE_ENABLED',
  authoritative_value: 'false',
  verified: true
};
assert.deepStrictEqual(
  validateTargetConfigurationEvidence(
    targetConfiguration,
    authority,
    'synthetic-disposable-target'
  ),
  targetConfiguration
);
for (const invalid of [
  undefined,
  { ...targetConfiguration, authoritative_value: true },
  { ...targetConfiguration, authoritative_value: 'true' },
  { ...targetConfiguration, verified: false },
  { ...targetConfiguration, target_id: 'wrong-target' }
]) {
  assert.throws(
    () => validateTargetConfigurationEvidence(
      invalid,
      authority,
      'synthetic-disposable-target'
    ),
    /TARGET_CONFIGURATION_EXPLICIT_FALSE_REQUIRED/
  );
}

assert.throws(() => featureDisabled(undefined), /FEATURE_STATE_REQUIRED/);
assert.strictEqual(featureDisabled('false'), true);
assert.throws(() => featureDisabled('true'), /FEATURE_STATE_INVALID/);

console.log('PASS: forward-repair artifact static controls');
