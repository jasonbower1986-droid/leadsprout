const assert = require('assert');
const sqlite3 = require('./backend/node_modules/sqlite3');
const { buildControlledTransaction } = require('./backend/scripts/apply_migrations');
const { migrationInventory } = require('./backend/scripts/verify_schema');
const service = require('./backend/services/preferenceService');

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
    inventory: migrationInventory(),
    revision: '449b33f5d4b25a52bfef838c15cb689b50aa260d',
    target: 'isolated-disposable', operator: 'test',
    startedAt: '2026-07-28T00:00:00Z'
  }));
  await db.exec(`
    INSERT INTO users VALUES ('user-a'); INSERT INTO users VALUES ('user-b');
    INSERT INTO opportunity_workspaces VALUES
      ('workspace-a','user-a','A','EVALUATED',1,1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
    INSERT INTO organizations VALUES ('org-a','A','2026-01-01T00:00:00Z');
    INSERT INTO organization_memberships VALUES
      ('org-a','user-a','ACTIVE','OWNER','2026-01-01T00:00:00Z',NULL);
    INSERT INTO workspace_organization_access VALUES
      ('workspace-a','org-a','user-a','ACTIVE','2026-01-01T00:00:00Z',NULL);
  `);
  return db;
}

async function run() {
  const db = await fixture();
  let passed = 0;
  const test = async (name, callback) => {
    await callback(); passed += 1; console.log(`✓ ${name}`);
  };
  try {
    await test('safe defaults and read-only projections are server controlled', async () => {
      const result = await service.getPreferences(db, {
        organizationId: 'org-a', userId: 'user-a', roleClass: 'OWNER', featureEnabled: false
      });
      assert.strictEqual(result.preferences.evidence_density.value, 'BALANCED');
      assert.strictEqual(result.preferences.reduced_motion.value, false);
      assert.strictEqual(result.preferences.material_change_notifications.value, 'ENABLED');
      assert.strictEqual(result.read_only.feature_state, 'DISABLED');
      assert.strictEqual(result.read_only.data_provenance.state, 'UNAVAILABLE');
      assert.match(result.read_only.accessibility_target, /target, not a certification/i);
    });
    await test('permitted values persist with an immutable audit', async () => {
      const result = await service.updatePreference(db, {
        organizationId: 'org-a', userId: 'user-a',
        fieldName: 'evidence_density', fieldValue: 'EXPANDED', expectedRevision: 0
      }, { preferenceId: 'pref-a', auditId: 'audit-a', occurredAt: '2026-07-28T01:00:00Z' });
      assert.strictEqual(result.field_value, 'EXPANDED');
      const audit = await db.get("SELECT * FROM preference_audit_events WHERE audit_event_id='audit-a'");
      assert.strictEqual(audit.outcome, 'CREATED');
      assert.strictEqual(audit.controlled_actor_class, 'CUSTOMER');
      assert.strictEqual(audit.update_source, 'CUSTOMER');
    });
    await test('stale writes fail closed and preserve the confirmed value', async () => {
      await assert.rejects(() => service.updatePreference(db, {
        organizationId: 'org-a', userId: 'user-a',
        fieldName: 'evidence_density', fieldValue: 'COMPACT', expectedRevision: 0
      }), error => error.code === 'STALE_WRITE');
      const row = await db.get("SELECT field_value,revision FROM user_presentation_preferences WHERE preference_id='pref-a'");
      assert.deepStrictEqual(row, { field_value: 'EXPANDED', revision: 1 });
    });
    await test('unknown fields, values and invalid scopes fail closed', async () => {
      assert.throws(() => service.validate('unknown', 'value'), error => error.code === 'PREFERENCE_INVALID');
      assert.throws(() => service.validate('evidence_density', 'INVENTED'), error => error.code === 'PREFERENCE_INVALID');
      assert.throws(() => service.validate('reduced_motion', 'true', 'workspace-a'), error => error.code === 'PREFERENCE_SCOPE_INVALID');
    });
    await test('inactive or foreign users cannot read or overwrite preferences', async () => {
      await assert.rejects(() => service.getPreferences(db, {
        organizationId: 'org-a', userId: 'user-b', roleClass: 'ADMIN', featureEnabled: false
      }));
      await assert.rejects(() => service.updatePreference(db, {
        organizationId: 'org-a', userId: 'user-b',
        fieldName: 'evidence_density', fieldValue: 'COMPACT', expectedRevision: 1
      }));
    });
    await test('Boolean and notification preferences retain exact authorised meanings', async () => {
      assert.strictEqual(service.validate('reduced_motion', true), 'true');
      assert.strictEqual(service.validate('material_change_notifications', 'DISABLED'), 'DISABLED');
      assert.throws(() => service.validate('material_change_notifications', 'EMAIL'));
    });
    await test('provenance is derived from current authority and fails closed', async () => {
      await db.run(`INSERT INTO evidence_integrity_decisions
        (decision_id,subject_id,outcome,envelope_json,decision_digest,bundle_id,
         bundle_version,bundle_digest,lifecycle_state,created_at)
        VALUES ('decision-a','subject-a','ELIGIBLE','{}','decision-digest-a',
          'bundle-a','1','bundle-digest-a','CURRENT','2026-07-28T00:00:00Z')`);
      const result = await service.getPreferences(db, {
        organizationId: 'org-a', userId: 'user-a', roleClass: 'OWNER', featureEnabled: false
      });
      assert.strictEqual(result.read_only.data_provenance.state, 'AVAILABLE');
      assert.match(result.read_only.data_provenance.summary, /1 eligible/i);
      assert(!result.read_only.data_provenance.summary.includes('subject-a'));
    });
    console.log(`Increment 4 Settings: ${passed}/7 passed`);
  } finally {
    await db.close();
  }
}

run().catch(error => { console.error(error); process.exit(1); });
