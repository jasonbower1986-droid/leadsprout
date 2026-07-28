const assert = require('assert');
const sqlite3 = require('./backend/node_modules/sqlite3');
const { buildControlledTransaction } = require('./backend/scripts/apply_migrations');
const { migrationInventory } = require('./backend/scripts/verify_schema');
const retention = require('./backend/services/preferenceRetentionService');
const worker = require('./backend/services/preferenceRetentionWorker');

function database() {
  const raw = new sqlite3.Database(':memory:');
  const invoke = (method, sql, params = []) => new Promise((resolve, reject) => {
    raw[method](sql, params, function callback(error, rows) {
      if (error) reject(error); else resolve(method === 'run' ? this : rows);
    });
  });
  const db = {
    all: (sql, params) => invoke('all', sql, params),
    get: (sql, params) => invoke('get', sql, params),
    run: (sql, params) => invoke('run', sql, params),
    exec: sql => new Promise((resolve, reject) => raw.exec(sql, error => error ? reject(error) : resolve())),
    transaction: async operations => {
      await db.exec('BEGIN IMMEDIATE');
      try {
        for (const operation of operations) await db.run(operation.sql, operation.params || []);
        await db.exec('COMMIT');
      } catch (error) {
        await db.exec('ROLLBACK'); throw error;
      }
    },
    close: () => new Promise((resolve, reject) => raw.close(error => error ? reject(error) : resolve()))
  };
  return db;
}

async function fixture() {
  const db = database();
  await db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE leads(id TEXT PRIMARY KEY);');
  await db.exec(buildControlledTransaction({
    inventory: migrationInventory(), revision: 'isolated', target: 'disposable',
    operator: 'test', startedAt: '2026-07-28T00:00:00Z'
  }));
  await db.exec(`
    INSERT INTO users VALUES ('user-a'); INSERT INTO users VALUES ('user-b');
    INSERT INTO opportunity_workspaces VALUES
      ('workspace-a','user-a','A','EVALUATED',1,1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
      ('workspace-b','user-b','B','EVALUATED',1,1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
    INSERT INTO organizations VALUES ('org-a','A','2026-01-01T00:00:00Z');
    INSERT INTO organization_memberships VALUES
      ('org-a','user-a','ACTIVE','OWNER','2026-01-01T00:00:00Z',NULL),
      ('org-a','user-b','ACTIVE','MEMBER','2026-01-01T00:00:00Z',NULL);
    INSERT INTO workspace_organization_access VALUES
      ('workspace-a','org-a','user-a','ACTIVE','2026-01-01T00:00:00Z',NULL),
      ('workspace-b','org-a','user-b','ACTIVE','2026-01-01T00:00:00Z',NULL);
    INSERT INTO user_presentation_preferences VALUES
      ('pref-a','org-a','user-a',NULL,'evidence_density','EXPANDED',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
      ('pref-workspace','org-a','user-a','workspace-a','material_change_notifications','DISABLED',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
      ('pref-b','org-a','user-b',NULL,'evidence_density','COMPACT',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
  `);
  return db;
}

async function run() {
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed += 1; console.log(`PASS ${passed}: ${name}`); };

  await test('migration 006 removes protected audit-value columns and satisfies foreign keys', async () => {
    const db = await fixture();
    try {
      const columns = (await db.all('PRAGMA table_info(preference_audit_events)')).map(row => row.name);
      assert(!columns.includes('prior_value'));
      assert(!columns.includes('new_value'));
      assert.deepStrictEqual(await db.all('PRAGMA foreign_key_check'), []);
    } finally { await db.close(); }
  });

  await test('migration 006 reconciles legacy history without retaining protected values', async () => {
    const db = database();
    try {
      const inventory = migrationInventory();
      await db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE leads(id TEXT PRIMARY KEY);');
      await db.exec(buildControlledTransaction({
        inventory: inventory.slice(0, 5), revision: 'isolated', target: 'disposable',
        operator: 'test', startedAt: '2026-07-28T00:00:00Z'
      }));
      await db.exec(`
        INSERT INTO users VALUES ('user-a');
        INSERT INTO opportunity_workspaces VALUES
          ('workspace-a','user-a','A','EVALUATED',1,1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
        INSERT INTO organizations VALUES ('org-a','A','2026-01-01T00:00:00Z');
        INSERT INTO organization_memberships VALUES
          ('org-a','user-a','ACTIVE','OWNER','2026-01-01T00:00:00Z',NULL);
        INSERT INTO user_presentation_preferences VALUES
          ('pref-legacy','org-a','user-a',NULL,'evidence_density','EXPANDED',2,
           '2026-01-01T00:00:00Z','2026-01-02T00:00:00Z');
        INSERT INTO preference_audit_events VALUES
          ('audit-legacy','pref-legacy','org-a','user-a',NULL,'evidence_density',
           'COMPACT','EXPANDED',1,2,'CUSTOMER','2026-01-02T00:00:00Z');
      `);
      await db.exec(inventory[5].content);
      const serialized = JSON.stringify(await db.all('SELECT * FROM preference_audit_events'));
      assert(!serialized.includes('COMPACT'));
      assert(!serialized.includes('EXPANDED'));
      assert.strictEqual((await db.get("SELECT outcome FROM preference_audit_events WHERE audit_event_id='audit-legacy'")).outcome, 'UPDATED');
      assert.deepStrictEqual(await db.all('PRAGMA foreign_key_check'), []);
    } finally { await db.close(); }
  });

  await test('membership and workspace transitions create isolated idempotent 30-day cases', async () => {
    const db = await fixture();
    try {
      await db.run(`UPDATE organization_memberships SET membership_state='INACTIVE',
        ended_at='2026-07-01T10:00:00Z' WHERE organization_id='org-a' AND user_id='user-a'`);
      await db.run(`UPDATE workspace_organization_access SET access_state='REVOKED',
        revoked_at='2026-07-02T10:00:00Z' WHERE organization_id='org-a' AND workspace_id='workspace-b'`);
      await db.run(`UPDATE workspace_organization_access SET access_state='REVOKED',
        revoked_at='2026-07-02T10:00:00Z' WHERE organization_id='org-a' AND workspace_id='workspace-b'`);
      const cases = await db.all('SELECT * FROM preference_retention_cases ORDER BY scope_type');
      assert.strictEqual(cases.length, 2);
      assert.strictEqual(cases[0].deletion_due_at, '2026-07-31T10:00:00Z');
      assert.strictEqual(cases[1].deletion_due_at, '2026-08-01T10:00:00Z');
      assert.notStrictEqual(cases[0].user_id, cases[1].user_id);
    } finally { await db.close(); }
  });

  await test('worker refuses before deadline and deletes exactly at and after deadline with safe replay', async () => {
    for (const now of ['2026-07-31T10:00:00Z', '2026-08-01T10:00:00Z']) {
      const db = await fixture();
      try {
        await db.run(`UPDATE organization_memberships SET membership_state='INACTIVE',
          ended_at='2026-07-01T10:00:00Z' WHERE organization_id='org-a' AND user_id='user-a'`);
        const row = await db.get("SELECT * FROM preference_retention_cases WHERE scope_type='MEMBERSHIP'");
        await assert.rejects(() => worker.processCase(db, {
          retentionCaseId: row.retention_case_id, workerIdentity: 'retention-worker',
          controlledInternalIdentity: true, now: '2026-07-31T09:59:59Z'
        }), error => error.code === 'RETENTION_NOT_DUE');
        const result = await worker.processCase(db, {
          retentionCaseId: row.retention_case_id, workerIdentity: 'retention-worker',
          controlledInternalIdentity: true, now
        });
        assert.strictEqual(result.replay, false);
        assert.strictEqual((await db.get("SELECT COUNT(*) count FROM user_presentation_preferences WHERE user_id='user-a'")).count, 0);
        assert.strictEqual((await worker.processCase(db, {
          retentionCaseId: row.retention_case_id, workerIdentity: 'retention-worker',
          controlledInternalIdentity: true, now
        })).replay, true);
        assert.strictEqual((await db.get("SELECT COUNT(*) count FROM preference_audit_events WHERE outcome='DELETED'")).count, 2);
      } finally { await db.close(); }
    }
  });

  await test('controlled holds suppress deletion, reject unauthorised actions and release overdue cases', async () => {
    const db = await fixture();
    try {
      await db.run(`UPDATE organization_memberships SET membership_state='INACTIVE',
        ended_at='2026-07-01T10:00:00Z' WHERE organization_id='org-a' AND user_id='user-a'`);
      const row = await db.get("SELECT * FROM preference_retention_cases WHERE scope_type='MEMBERSHIP'");
      await assert.rejects(() => retention.createHold(db, {
        retentionCaseId: row.retention_case_id, authorityDomain: 'LEGAL'
      }), error => error.code === 'RETENTION_HOLD_AUTHORITY_REQUIRED');
      const hold = await retention.createHold(db, {
        retentionCaseId: row.retention_case_id, authorityDomain: 'LEGAL',
        externalRecordReference: 'legal-record-7', externalRecordDigest: 'a'.repeat(64),
        reasonClass: 'LITIGATION', verifiedActorIdentity: 'legal-controller',
        actorVerified: true, occurredAt: '2026-07-20T00:00:00Z'
      });
      await assert.rejects(() => worker.processCase(db, {
        retentionCaseId: row.retention_case_id, workerIdentity: 'retention-worker',
        controlledInternalIdentity: true, now: '2026-08-01T00:00:00Z'
      }), error => error.code === 'RETENTION_HELD');
      await assert.rejects(() => retention.releaseHold(db, {
        holdId: hold.retention_hold_id, occurredAt: '2026-08-01T00:00:00Z'
      }), error => error.code === 'RETENTION_HOLD_AUTHORITY_REQUIRED');
      await retention.releaseHold(db, {
        holdId: hold.retention_hold_id, verifiedActorIdentity: 'legal-controller',
        actorVerified: true, occurredAt: '2026-08-01T00:00:00Z'
      });
      assert.strictEqual((await db.get('SELECT state FROM preference_retention_cases WHERE retention_case_id=?', [row.retention_case_id])).state, 'PENDING');
      await assert.rejects(() => db.run('DELETE FROM preference_retention_holds WHERE retention_hold_id=?', [hold.retention_hold_id]), /RETENTION_HOLD_IMMUTABLE/);
    } finally { await db.close(); }
  });

  await test('audit subjects and events are immutable and interruption leaves protected content recoverable', async () => {
    const db = await fixture();
    try {
      await db.run(`UPDATE organization_memberships SET membership_state='INACTIVE',
        ended_at='2026-07-01T10:00:00Z' WHERE organization_id='org-a' AND user_id='user-a'`);
      const row = await db.get("SELECT * FROM preference_retention_cases WHERE scope_type='MEMBERSHIP'");
      const original = db.transaction;
      db.transaction = async () => { throw new Error('INTERRUPTED'); };
      await assert.rejects(() => worker.processCase(db, {
        retentionCaseId: row.retention_case_id, workerIdentity: 'retention-worker',
        controlledInternalIdentity: true, now: '2026-08-01T00:00:00Z'
      }), /INTERRUPTED/);
      assert.strictEqual((await db.get("SELECT COUNT(*) count FROM user_presentation_preferences WHERE user_id='user-a'")).count, 2);
      db.transaction = original;
      await worker.processCase(db, {
        retentionCaseId: row.retention_case_id, workerIdentity: 'retention-worker',
        controlledInternalIdentity: true, now: '2026-08-01T00:00:00Z'
      });
      await assert.rejects(() => db.run("UPDATE preference_audit_subjects SET field_name='reduced_motion'"), /IMMUTABLE_AUDIT_SUBJECT/);
      await assert.rejects(() => db.run("DELETE FROM preference_audit_events"), /IMMUTABLE_PREFERENCE_AUDIT/);
      assert.strictEqual((await db.get("SELECT COUNT(*) count FROM user_presentation_preferences WHERE user_id='user-b'")).count, 1);
    } finally { await db.close(); }
  });

  console.log(`Increment 4 preference retention: ${passed}/6 passed`);
}

run().catch(error => { console.error(error); process.exit(1); });
