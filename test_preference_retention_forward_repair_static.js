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
  OWNER_RISK_WAIVER_MAX_VALIDITY_MS,
  OWNER_RISK_WAIVED_CONDITIONS,
  ownerRiskWaiverDigest,
  PROTECTED_V1_TARGET_ID,
  requireForeignKeyEnforcement,
  TARGET_CONFIGURATION_MAX_VALIDITY_MS,
  validateCanonicalInventory,
  validateOwnerRiskWaiver,
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
assert(!/\bwritable_schema\b/i.test(repair));
assert((repair.match(/FROM sqlite_schema\s+WHERE type='trigger'/g) || []).length >= 3);
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
assert.strictEqual(TARGET_CONFIGURATION_MAX_VALIDITY_MS, 4 * 60 * 60 * 1000);
assert.strictEqual(OWNER_RISK_WAIVER_MAX_VALIDITY_MS, 15 * 60 * 1000);
assert.strictEqual(PROTECTED_V1_TARGET_ID, 'f499a22e-a253-45ee-8677-8cdd315ded16');
const targetConfiguration = {
  target_id: 'synthetic-disposable-target',
  authoritative_source_identity: 'synthetic-operations-control',
  authoritative_source_reference: authority.authority_reference,
  captured_at: '2026-07-29T10:00:00Z',
  expires_at: '2026-07-29T14:00:00Z',
  source_sha256: require('crypto').createHash('sha256')
    .update('synthetic-authoritative-source').digest('hex'),
  configuration_key: 'OPPORTUNITY_WORKSPACE_ENABLED',
  authoritative_value: 'false',
  verified: true
};
assert.deepStrictEqual(
  validateTargetConfigurationEvidence(
    targetConfiguration,
    authority,
    'synthetic-disposable-target',
    new Date('2026-07-29T12:00:00Z')
  ),
  targetConfiguration
);
for (const invalid of [
  undefined,
  { ...targetConfiguration, authoritative_value: true },
  { ...targetConfiguration, authoritative_value: 'true' },
  { ...targetConfiguration, verified: false },
  { ...targetConfiguration, target_id: 'wrong-target' },
  { ...targetConfiguration, authoritative_source_reference: 'WRONG-AUTHORITY' },
  { ...targetConfiguration, authoritative_source_identity: '' },
  { ...targetConfiguration, source_sha256: 'malformed' },
  { ...targetConfiguration, captured_at: 'malformed' },
  { ...targetConfiguration, expires_at: '2026-07-29T11:00:00Z' },
  { ...targetConfiguration, expires_at: '2026-07-29T14:00:01Z' }
]) {
  assert.throws(
    () => validateTargetConfigurationEvidence(
      invalid,
      authority,
      'synthetic-disposable-target',
      new Date('2026-07-29T12:00:00Z')
    ),
    /TARGET_CONFIGURATION_EXPLICIT_FALSE_REQUIRED/
  );
}

const waiverIdentity = {
  revision: 'c'.repeat(40),
  tree: 'd'.repeat(40),
  clean: true
};
const waiverAuthority = {
  authority_reference: 'JAY-BOWER-RISK-WAIVER-001',
  target_id: PROTECTED_V1_TARGET_ID
};
function signedWaiver(overrides = {}) {
  const value = {
  target_id: PROTECTED_V1_TARGET_ID,
  owner_authority_identity: 'Jay Bower',
  owner_authority_reference: waiverAuthority.authority_reference,
  waived_conditions: [...OWNER_RISK_WAIVED_CONDITIONS],
  authorised_revision: waiverIdentity.revision,
  authorised_tree: waiverIdentity.tree,
  issued_at: '2026-07-29T11:55:00Z',
  expires_at: '2026-07-29T12:05:00Z',
  nonce: 'ab'.repeat(16),
    production_execution_risk_accepted: true,
    ...overrides
  };
  value.waiver_sha256 = ownerRiskWaiverDigest(value);
  return value;
}
const waiver = signedWaiver();
assert(validateOwnerRiskWaiver(
  waiver,
  waiverAuthority,
  waiverIdentity,
  new Date('2026-07-29T12:00:00Z')
));
const exactFifteenMinutes = signedWaiver({
  issued_at: '2026-07-29T11:45:00Z',
  expires_at: '2026-07-29T12:00:00Z'
});
assert(validateOwnerRiskWaiver(
  exactFifteenMinutes,
  waiverAuthority,
  waiverIdentity,
  new Date('2026-07-29T11:50:00Z')
));
const exactlyIssued = signedWaiver({
  issued_at: '2026-07-29T12:00:00Z',
  expires_at: '2026-07-29T12:10:00Z'
});
assert(validateOwnerRiskWaiver(
  exactlyIssued,
  waiverAuthority,
  waiverIdentity,
  new Date('2026-07-29T12:00:00Z')
));
const missingNonce = { ...waiver };
delete missingNonce.nonce;
for (const invalid of [
  undefined,
  null,
  false,
  '',
  [],
  missingNonce,
  signedWaiver({ expires_at: '2026-07-29T11:59:00Z' }),
  signedWaiver({
    issued_at: '2026-07-29T11:45:00Z',
    expires_at: '2026-07-29T12:00:00.001Z'
  }),
  signedWaiver({
    issued_at: '2026-07-29T11:50:00Z',
    expires_at: '2026-07-29T12:00:00Z'
  }),
  signedWaiver({
    issued_at: '2026-07-29T12:00:01Z',
    expires_at: '2026-07-29T12:10:00Z'
  }),
  signedWaiver({
    issued_at: '2026-07-29T12:05:00Z',
    expires_at: '2026-07-29T12:00:00Z'
  }),
  { ...waiver, waiver_sha256: '0'.repeat(64) },
  signedWaiver({
    waived_conditions: [...OWNER_RISK_WAIVED_CONDITIONS, 'ANY_OTHER_CONTROL']
  }),
  signedWaiver({ target_id: 'wrong-target' }),
  signedWaiver({ owner_authority_identity: 'Not Jay Bower' }),
  signedWaiver({ owner_authority_reference: 'WRONG-AUTHORITY' }),
  signedWaiver({ authorised_revision: 'e'.repeat(40) }),
  signedWaiver({ authorised_tree: 'f'.repeat(40) }),
  signedWaiver({ nonce: 'malformed' }),
  signedWaiver({ production_execution_risk_accepted: false }),
  signedWaiver({ issued_at: 123 }),
  signedWaiver({ waived_conditions: 'not-an-array' }),
  { ...waiver, unexpected_scope: true }
]) {
  assert.throws(() => validateOwnerRiskWaiver(
    invalid,
    waiverAuthority,
    waiverIdentity,
    new Date('2026-07-29T12:00:00Z')
  ), /OWNER_RISK_WAIVER_INVALID/);
}

assert.throws(() => featureDisabled(undefined), /FEATURE_STATE_REQUIRED/);
assert.strictEqual(featureDisabled('false'), true);
assert.throws(() => featureDisabled('true'), /FEATURE_STATE_INVALID/);

console.log('PASS: forward-repair artifact static controls');
