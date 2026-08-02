const {
  EXPECTED_PRE_ALIGNMENT_SCHEMA_MANIFEST,
  MigrationControlError,
  migrationInventory,
  verifyPre007Triggers,
  verifyStructuralSchema
} = require('./verify_schema');

const LEDGER_SQL =
  'SELECT migration_id,filename,sequence,checksum,outcome FROM schema_migrations ORDER BY sequence';
const FOREIGN_KEY_CHECK_SQL = 'PRAGMA foreign_key_check';
const EXPECTED_STATEMENT_COUNT = 390;
const GUARD_PROJECTION_SQL = `SELECT
  (SELECT COUNT(*) FROM opportunity_workspaces) AS workspace_source_rows,
  (SELECT COUNT(*) FROM opportunity_selection_decisions) AS selection_source_rows,
  (SELECT COUNT(*) FROM opportunity_contact_verification_snapshots) AS contact_source_rows,
  (SELECT COUNT(*) FROM preference_retention_cases) AS retention_case_source_rows,
  (SELECT COUNT(*) FROM preference_retention_holds) AS retention_hold_source_rows,
  (SELECT COUNT(*) FROM opportunity_contact_verification_snapshots WHERE provenance_json IS NULL) AS contact_null_provenance_rows,
  (SELECT COUNT(*) FROM opportunity_selection_decisions AS decision
    WHERE decision.selected_candidate_snapshot_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM opportunity_candidate_snapshots AS candidate
        WHERE candidate.snapshot_id = decision.selected_candidate_snapshot_id
      )) AS selection_dangling_candidate_rows,
  (SELECT COUNT(*) FROM preference_retention_cases
    WHERE NOT (
      (scope_type='MEMBERSHIP' AND user_id IS NOT NULL AND workspace_id IS NULL) OR
      (scope_type='WORKSPACE' AND workspace_id IS NOT NULL)
    )) AS retention_case_shape_violation_rows,
  (SELECT COUNT(*) FROM preference_retention_holds
    WHERE NOT (
      (state='ACTIVE' AND released_at IS NULL AND verified_release_actor_identity IS NULL) OR
      (state='RELEASED' AND released_at IS NOT NULL AND verified_release_actor_identity IS NOT NULL)
    )) AS retention_hold_state_violation_rows,
  (SELECT COUNT(*) FROM preference_retention_holds AS hold
    WHERE NOT EXISTS (
      SELECT 1 FROM preference_retention_cases AS retention_case
      WHERE retention_case.retention_case_id = hold.retention_case_id
    )) AS retention_hold_dangling_case_rows,
  (SELECT COUNT(*) FROM sqlite_schema WHERE type='trigger') AS pre_repair_trigger_count`;

const COUNT_FIELDS = Object.freeze([
  'workspace_source_rows',
  'selection_source_rows',
  'contact_source_rows',
  'retention_case_source_rows',
  'retention_hold_source_rows',
  'contact_null_provenance_rows',
  'selection_dangling_candidate_rows',
  'retention_case_shape_violation_rows',
  'retention_hold_state_violation_rows',
  'retention_hold_dangling_case_rows',
  'pre_repair_trigger_count'
]);

const ZERO_FIELDS = Object.freeze([
  'contact_null_provenance_rows',
  'selection_dangling_candidate_rows',
  'retention_case_shape_violation_rows',
  'retention_hold_state_violation_rows',
  'retention_hold_dangling_case_rows'
]);

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

function validateLedger(rows) {
  const inventory = migrationInventory();
  if (!Array.isArray(rows) || rows.length !== 6) fail('QUALIFICATION_LEDGER_MISMATCH');
  rows.forEach((row, index) => {
    const expected = inventory[index];
    if (!row || row.migration_id !== expected.migration_id ||
        row.filename !== expected.filename || Number(row.sequence) !== expected.sequence ||
        row.checksum !== expected.checksum ||
        !['COMPLETED', 'ADOPTED'].includes(row.outcome)) {
      fail('QUALIFICATION_LEDGER_MISMATCH');
    }
  });
  return Object.freeze(rows.map(row => Object.freeze({
    migration_id: row.migration_id,
    filename: row.filename,
    sequence: Number(row.sequence),
    checksum: row.checksum,
    outcome: row.outcome
  })));
}

function validateCounts(rows) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] ||
      Object.keys(rows[0]).sort().join('\n') !== [...COUNT_FIELDS].sort().join('\n')) {
    fail('QUALIFICATION_GUARD_RESULT_INVALID');
  }
  const counts = {};
  for (const field of COUNT_FIELDS) {
    const value = Number(rows[0][field]);
    if (!Number.isSafeInteger(value) || value < 0) {
      fail('QUALIFICATION_GUARD_RESULT_INVALID');
    }
    counts[field] = value;
  }
  if (ZERO_FIELDS.some(field => counts[field] !== 0) ||
      counts.pre_repair_trigger_count !== 17) {
    fail('QUALIFICATION_GUARD_REJECTED');
  }
  return Object.freeze(counts);
}

async function qualifyV1ContractAlignment(query) {
  requireReadOnlyQueryAll(query);
  await verifyPre007Triggers(query);
  await verifyStructuralSchema(query, EXPECTED_PRE_ALIGNMENT_SCHEMA_MANIFEST);
  const ledger = validateLedger(await query.all(LEDGER_SQL));
  const counts = validateCounts(await query.all(GUARD_PROJECTION_SQL));
  const foreignKeyRows = await query.all(FOREIGN_KEY_CHECK_SQL);
  if (!Array.isArray(foreignKeyRows) || foreignKeyRows.length !== 0) {
    fail('QUALIFICATION_FOREIGN_KEY_CHECK_FAILED');
  }
  return Object.freeze({
    status: 'QUALIFIED_READ_ONLY',
    ledger,
    counts,
    foreign_key_check_rows: 0
  });
}

module.exports = {
  COUNT_FIELDS,
  EXPECTED_STATEMENT_COUNT,
  FOREIGN_KEY_CHECK_SQL,
  GUARD_PROJECTION_SQL,
  LEDGER_SQL,
  ZERO_FIELDS,
  qualifyV1ContractAlignment,
  requireReadOnlyQueryAll,
  validateCounts,
  validateLedger
};
