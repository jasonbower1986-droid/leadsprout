const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  EXPECTED_SCHEMA_MANIFEST,
  inspectTable,
  migrationInventory
} = require('./backend/scripts/verify_schema');
const { buildControlledTransaction } = require('./backend/scripts/apply_migrations');

const SQLITE = '/usr/bin/sqlite3';
const repair = fs.readFileSync(
  path.join(__dirname, 'backend/migrations/008_v1_contract_alignment_forward_repair.sql'),
  'utf8'
);
const migration007 = fs.readFileSync(
  path.join(__dirname, 'backend/migrations/007_preference_retention_cases_forward_repair.sql'),
  'utf8'
);

function sqlite(database, statement) {
  return spawnSync(SQLITE, ['-json', database, statement], {
    encoding: 'utf8',
    env: { ...process.env }
  });
}

function rows(database, statement) {
  const result = sqlite(database, statement);
  if (result.status !== 0) throw new Error(result.stderr || 'sqlite query failed');
  return JSON.parse(result.stdout || '[]');
}

function query(database) {
  return Object.freeze({ all: async statement => rows(database, statement) });
}

function executeRepair(database) {
  return sqlite(database, `
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    ${repair}
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function applyLegacyDefinitions(database) {
  const result = sqlite(database, `
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    ${legacyDefinitions()}
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
  assert.strictEqual(result.status, 0, result.stderr);
}

function triggerDefinitions() {
  const start = migration007.indexOf('CREATE TRIGGER preference_membership_inactivated');
  const end = migration007.indexOf('\nUPDATE preference_retention_forward_repair_guard', start);
  assert(start >= 0 && end > start);
  return migration007.slice(start, end);
}

function legacyDefinitions() {
  return `
    DROP TRIGGER preference_membership_inactivated;
    DROP TRIGGER preference_workspace_revoked;
    DROP TRIGGER preference_audit_subjects_no_update;
    DROP TRIGGER preference_audit_subjects_no_delete;
    DROP TRIGGER preference_audit_events_no_update;
    DROP TRIGGER preference_audit_events_no_delete;
    DROP TRIGGER preference_retention_holds_release_only;
    DROP TRIGGER preference_retention_holds_no_delete;
    DROP TRIGGER preference_retention_hold_active;
    DROP TRIGGER preference_retention_hold_released;

    DROP TABLE opportunity_contact_verification_snapshots;
    CREATE TABLE opportunity_contact_verification_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      field_states_json TEXT NOT NULL,
      snapshot_digest TEXT NOT NULL,
      created_at TEXT NOT NULL,
      provenance_json TEXT,
      FOREIGN KEY(review_id) REFERENCES opportunity_reviews(review_id) ON DELETE RESTRICT
    );

    DROP TABLE opportunity_selection_decisions;
    CREATE TABLE opportunity_selection_decisions (
      decision_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      workspace_version INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('ACCEPTED','CHALLENGED')),
      rationale TEXT,
      created_at TEXT NOT NULL,
      selected_candidate_snapshot_id TEXT,
      resolution_route TEXT CHECK(resolution_route IS NULL OR resolution_route IN ('REASSESSMENT','CHANGED_INPUT','FURTHER_EVIDENCE','ALTERNATIVE_DECISION')),
      FOREIGN KEY(workspace_id,workspace_version) REFERENCES opportunity_workspace_versions(workspace_id,version) ON DELETE RESTRICT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
    );

    DROP INDEX idx_opportunity_workspaces_owner;
    DROP TABLE opportunity_workspaces;
    CREATE TABLE opportunity_workspaces (
      workspace_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      lifecycle TEXT NOT NULL CHECK(lifecycle IN ('DRAFT','EVALUATED','SELECTED','PREPARED','CLOSED')),
      current_version INTEGER NOT NULL DEFAULT 0,
      capability_profile_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      pending_change_explanation TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX idx_opportunity_workspaces_owner ON opportunity_workspaces(user_id,updated_at);

    DROP INDEX idx_preference_retention_holds_case;
    DROP TABLE preference_retention_holds;
    DROP INDEX idx_preference_retention_due;
    DROP TABLE preference_retention_cases;
    CREATE TABLE preference_retention_cases (
      retention_case_id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('MEMBERSHIP','WORKSPACE')),
      organization_id TEXT NOT NULL,
      user_id TEXT,
      workspace_id TEXT,
      inactive_at TEXT NOT NULL,
      deletion_due_at TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('PENDING','HELD','COMPLETED','FAILED')),
      claim_identity TEXT,
      claimed_at TEXT,
      completed_at TEXT,
      failure_code TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(scope_type,organization_id,user_id,workspace_id,inactive_at)
    );
    CREATE TABLE preference_retention_holds (
      retention_hold_id TEXT PRIMARY KEY,
      retention_case_id TEXT NOT NULL,
      authority_domain TEXT NOT NULL CHECK(authority_domain IN ('LEGAL','SECURITY')),
      external_record_reference TEXT NOT NULL,
      external_record_digest TEXT NOT NULL,
      reason_class TEXT NOT NULL,
      verified_actor_identity TEXT NOT NULL,
      verified_release_actor_identity TEXT,
      state TEXT NOT NULL CHECK(state IN ('ACTIVE','RELEASED')),
      created_at TEXT NOT NULL,
      released_at TEXT,
      FOREIGN KEY(retention_case_id) REFERENCES preference_retention_cases(retention_case_id) ON DELETE RESTRICT
    );
    CREATE INDEX idx_preference_retention_due
      ON preference_retention_cases(state,deletion_due_at,retention_case_id);
    CREATE INDEX idx_preference_retention_holds_case
      ON preference_retention_holds(retention_case_id,state);
    ${triggerDefinitions()}
  `;
}

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leadsprout-contract-repair-'));
  const database = path.join(directory, 'synthetic.sqlite');
  try {
    const inventory = migrationInventory();
    const baseline = buildControlledTransaction({
      inventory,
      revision: 'synthetic-contract-repair',
      target: 'synthetic-disposable-target',
      operator: 'synthetic-test',
      startedAt: '2026-08-02T00:00:00Z'
    });
    const setup = sqlite(database, `
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE leads (id TEXT PRIMARY KEY);
      ${baseline}
      PRAGMA foreign_keys = OFF;
      BEGIN IMMEDIATE;
      ${legacyDefinitions()}
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
    assert.strictEqual(setup.status, 0, setup.stderr);
    assert.strictEqual(rows(database, "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger'")[0].count, 17);

    const execution = executeRepair(database);
    assert.strictEqual(execution.status, 0, execution.stderr);
    assert.deepStrictEqual(rows(database, 'PRAGMA foreign_key_check'), []);

    for (const name of [
      'opportunity_contact_verification_snapshots',
      'opportunity_selection_decisions',
      'opportunity_workspaces',
      'preference_retention_cases',
      'preference_retention_holds'
    ]) {
      const { foreignKeys, ...expected } = EXPECTED_SCHEMA_MANIFEST.tables[name];
      assert.deepStrictEqual(await inspectTable(query(database), name), expected, name);
    }
    assert.strictEqual(rows(database, "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger'")[0].count, 17);

    const refusalCases = [
      {
        name: 'null contact provenance',
        insert: `INSERT INTO opportunity_contact_verification_snapshots
          (snapshot_id,review_id,field_states_json,snapshot_digest,created_at,provenance_json)
          VALUES ('bad-contact','missing-review','{}','digest','2026-08-02T00:00:00Z',NULL);`,
        cleanup: "DELETE FROM opportunity_contact_verification_snapshots WHERE snapshot_id='bad-contact';"
      },
      {
        name: 'dangling selected candidate',
        insert: `INSERT INTO opportunity_selection_decisions
          (decision_id,workspace_id,workspace_version,user_id,decision,rationale,created_at,
           selected_candidate_snapshot_id,resolution_route)
          VALUES ('bad-decision','missing-workspace',1,'missing-user','ACCEPTED',NULL,
            '2026-08-02T00:00:00Z','missing-candidate',NULL);`,
        cleanup: "DELETE FROM opportunity_selection_decisions WHERE decision_id='bad-decision';"
      },
      {
        name: 'invalid retention-case scope shape',
        insert: `INSERT INTO preference_retention_cases
          (retention_case_id,scope_type,organization_id,user_id,workspace_id,inactive_at,
           deletion_due_at,state,created_at)
          VALUES ('bad-case','MEMBERSHIP','org',NULL,'workspace','2026-08-02T00:00:00Z',
            '2026-09-01T00:00:00Z','PENDING','2026-08-02T00:00:00Z');`,
        cleanup: "DELETE FROM preference_retention_cases WHERE retention_case_id='bad-case';"
      },
      {
        name: 'invalid retention-hold release state',
        insert: `INSERT INTO preference_retention_cases
          (retention_case_id,scope_type,organization_id,user_id,workspace_id,inactive_at,
           deletion_due_at,state,created_at)
          VALUES ('hold-case','MEMBERSHIP','org','user',NULL,'2026-08-02T00:00:00Z',
            '2026-09-01T00:00:00Z','PENDING','2026-08-02T00:00:00Z');
          INSERT INTO preference_retention_holds
          (retention_hold_id,retention_case_id,authority_domain,external_record_reference,
           external_record_digest,reason_class,verified_actor_identity,
           verified_release_actor_identity,state,created_at,released_at)
          VALUES ('bad-hold','hold-case','LEGAL','reference','digest','reason','actor',
            NULL,'RELEASED','2026-08-02T00:00:00Z',NULL);`,
        cleanup: `DELETE FROM preference_retention_holds WHERE retention_hold_id='bad-hold';
          DELETE FROM preference_retention_cases WHERE retention_case_id='hold-case';`
      }
    ];

    for (const refusal of refusalCases) {
      applyLegacyDefinitions(database);
      const seeded = sqlite(database, `PRAGMA foreign_keys = OFF; ${refusal.insert}`);
      assert.strictEqual(seeded.status, 0, `${refusal.name}: ${seeded.stderr}`);
      const refused = executeRepair(database);
      assert.notStrictEqual(refused.status, 0, `${refusal.name} unexpectedly repaired`);
      assert.strictEqual(rows(database,
        "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name LIKE '%_contract_repair'"
      )[0].count, 0, `${refusal.name} left repair artifacts`);
      applyLegacyDefinitions(database);
      const recovered = executeRepair(database);
      assert.strictEqual(recovered.status, 0, `${refusal.name}: ${recovered.stderr}`);
      assert.deepStrictEqual(rows(database, 'PRAGMA foreign_key_check'), []);
    }
    console.log('PASS v1 contract-alignment forward repair');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  run().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { legacyDefinitions };
