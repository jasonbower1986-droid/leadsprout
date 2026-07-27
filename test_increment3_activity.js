const assert = require('assert');
const sqlite3 = require('./backend/node_modules/sqlite3');
const { buildControlledTransaction } = require('./backend/scripts/apply_migrations');
const { migrationInventory } = require('./backend/scripts/verify_schema');
const { storeProjectedEvent } = require('./backend/services/activityRepository');
const projection = require('./backend/services/activityProjectionService');
const activity = require('./backend/services/activityService');

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
      } catch (error) { await db.exec('ROLLBACK'); throw error; }
    },
    close: () => new Promise((resolve, reject) => raw.close(error => error ? reject(error) : resolve()))
  };
  return db;
}

async function fixture() {
  const db = database();
  await db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE leads(id TEXT PRIMARY KEY);');
  await db.exec(buildControlledTransaction({
    inventory: migrationInventory(), revision: 'd9b67dc4615c6e327164cf86f1aed35adb79338b',
    target: 'isolated-disposable', operator: 'test', startedAt: '2026-07-28T00:00:00Z'
  }));
  await db.exec(`
    INSERT INTO users VALUES ('user-a'); INSERT INTO users VALUES ('user-b');
    INSERT INTO opportunity_workspaces VALUES
      ('workspace-a','user-a','A','EVALUATED',2,1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
    INSERT INTO opportunity_workspace_versions
      (workspace_id,version,policy_version,evidence_window,evaluation_status,candidate_set_digest,created_at)
      VALUES ('workspace-a',1,'p','w','complete','d1','2025-01-01T00:00:00Z'),
             ('workspace-a',2,'p','w','complete','d2','2026-01-01T00:00:00Z');
    INSERT INTO organizations VALUES ('org-a','A','2026-01-01T00:00:00Z'),('org-b','B','2026-01-01T00:00:00Z');
    INSERT INTO organization_memberships VALUES
      ('org-a','user-a','ACTIVE','OWNER','2026-01-01T00:00:00Z',NULL),
      ('org-b','user-b','ACTIVE','OWNER','2026-01-01T00:00:00Z',NULL);
    INSERT INTO workspace_organization_access VALUES
      ('workspace-a','org-a','user-a','ACTIVE','2026-01-01T00:00:00Z',NULL);
  `);
  return db;
}

const base = index => ({
  organizationId: 'org-a', workspaceId: 'workspace-a', userId: 'user-a',
  projectionAuthority: 'POLICY_PROJECTED', workspaceVersion: 2,
  sourceEventId: `source-${index}`, sourceEventType: 'AUTHORITATIVE_DOMAIN_EVENT',
  eventCategory: 'REVIEW_COMPLETED', actorClass: 'AUTHENTICATED_USER',
  actorUserId: 'user-a', actorDisplayName: 'Customer reviewer',
  affectedObjectType: 'WORKSPACE', affectedObjectId: 'workspace-a',
  eventSummary: `Review ${index} completed`, commercialConsequence: 'PREPARATION_ELIGIBLE',
  communicationStatus: 'NOT_RECORDED', evidenceIntegrityState: 'AUTHORISED',
  projectionPolicyVersion: 'activity-1', occurredAt: `2026-07-28T00:${String(index).padStart(2, '0')}:00Z`,
  sources: [{ sourceObjectType: 'WORKSPACE', sourceObjectId: 'workspace-a', relationshipType: 'CAUSE' }]
});

async function run() {
  const db = await fixture();
  let passed = 0;
  const test = async (name, callback) => {
    await callback(); passed += 1; console.log(`✓ ${name}`);
  };
  try {
    await test('exact mapping excludes internal, immaterial and unsupported source events', async () => {
      assert.strictEqual(projection.projectDomainEvent({ sourceEventType: 'EVALUATION' }), null);
      assert.strictEqual(projection.projectDomainEvent({ sourceEventType: 'REVIEW_VALIDLY_COMPLETED', materialChange: false }), null);
      assert.strictEqual(projection.projectDomainEvent({ sourceEventType: 'INVENTED', materialChange: true }), null);
      const projected = projection.projectDomainEvent({
        ...base(1), sourceEventType: 'REVIEW_VALIDLY_COMPLETED', materialChange: true,
        sourceEventId: 'mapped', decisionBoundaryChanged: true,
        causalSources: [{ sourceObjectType: 'WORKSPACE', sourceObjectId: 'workspace-a', relationshipType: 'CAUSE', verifiedRelationship: true }]
      });
      assert.strictEqual(projected.eventCategory, 'REVIEW_COMPLETED');
      assert.strictEqual(projected.communicationStatus, 'NOT_RECORDED');
      assert.strictEqual(projected.commercialConsequence, 'PREPARATION_ELIGIBLE');
    });
    await test('unverified causality and inferred communication fail closed', async () => {
      assert.throws(() => projection.projectDomainEvent({
        ...base(2), sourceEventType: 'REVIEW_VALIDLY_COMPLETED', materialChange: true,
        causalSources: [{ verifiedRelationship: false }]
      }), error => error.code === 'ACTIVITY_CAUSAL_AUTHORITY_REQUIRED');
      assert.throws(() => projection.projectDomainEvent({
        ...base(2), sourceEventType: 'AUTHORITATIVE_COMMUNICATION_RECORDED', materialChange: true
      }), error => error.code === 'ACTIVITY_COMMUNICATION_SOURCE_REQUIRED');
    });
    for (let index = 0; index < 27; index += 1) await storeProjectedEvent(db, base(index), { activityEventId: `activity-${String(index).padStart(2, '0')}`, recordedAt: '2026-07-28T01:00:00Z' });
    await test('feed is access-filtered and ordered by authoritative tuple', async () => {
      const first = await activity.listActivity(db, { userId: 'user-a', pageSize: 25 }, { now: '2026-07-28T02:00:00Z' });
      assert.strictEqual(first.events.length, 25);
      assert.strictEqual(first.events[0].activity_event_id, 'activity-26');
      assert(first.next_cursor);
      assert.strictEqual(first.events[0].actor.class, 'CUSTOMER_USER');
      assert.strictEqual(first.events[0].communication_status, 'NOT_RECORDED');
      const denied = await activity.listActivity(db, { userId: 'user-b', pageSize: 25 }, { now: '2026-07-28T02:00:00Z' });
      assert.deepStrictEqual(denied.events, []);
    });
    await test('cursor pagination has no duplicates and permits only 25 or 50', async () => {
      const first = await activity.listActivity(db, { userId: 'user-a', pageSize: 25 }, { now: '2026-07-28T02:00:00Z' });
      const second = await activity.listActivity(db, { userId: 'user-a', pageSize: 25, cursor: first.next_cursor }, { now: '2026-07-28T02:00:00Z' });
      assert.deepStrictEqual(second.events.map(row => row.activity_event_id), ['activity-01', 'activity-00']);
      await assert.rejects(() => activity.listActivity(db, { userId: 'user-a', pageSize: 10 }), error => error.code === 'ACTIVITY_PAGE_SIZE_INVALID');
      await assert.rejects(() => activity.listActivity(db, { userId: 'user-a', cursor: 'not-a-cursor' }), error => error.code === 'ACTIVITY_CURSOR_INVALID');
    });
    await test('retention removes old ordinary history but preserves current-version and unresolved integrity events', async () => {
      await storeProjectedEvent(db, { ...base(40), sourceEventId: 'old-review', occurredAt: '2023-01-01T00:00:00Z' }, { activityEventId: 'old-review' });
      await storeProjectedEvent(db, { ...base(41), sourceEventId: 'old-current', eventCategory: 'WORKSPACE_VERSION_CURRENT', occurredAt: '2023-01-01T00:00:01Z' }, { activityEventId: 'old-current' });
      await storeProjectedEvent(db, { ...base(42), sourceEventId: 'old-block', eventCategory: 'EVIDENCE_INTEGRITY_BLOCKED', evidenceIntegrityState: 'BLOCKED', occurredAt: '2023-01-01T00:00:02Z' }, { activityEventId: 'old-block' });
      const feed = await activity.listActivity(db, { userId: 'user-a', pageSize: 50 }, { now: '2026-07-28T02:00:00Z' });
      const ids = feed.events.map(row => row.activity_event_id);
      assert(!ids.includes('old-review')); assert(ids.includes('old-current')); assert(ids.includes('old-block'));
    });
    await test('correction and supersession remain append-only and exposed without rewriting earlier events', async () => {
      await storeProjectedEvent(db, { ...base(50), sourceEventId: 'correction', correctionOfActivityEventId: 'activity-00', supersedesActivityEventId: 'activity-00' }, { activityEventId: 'correction' });
      const original = await db.get("SELECT event_summary FROM customer_activity_events WHERE activity_event_id='activity-00'");
      const correction = await db.get("SELECT correction_of_activity_event_id FROM customer_activity_events WHERE activity_event_id='correction'");
      assert.strictEqual(original.event_summary, 'Review 0 completed');
      assert.strictEqual(correction.correction_of_activity_event_id, 'activity-00');
      await assert.rejects(() => db.run("UPDATE customer_activity_events SET event_summary='changed' WHERE activity_event_id='activity-00'"));
    });
    console.log(`Increment 3 Activity Feed: ${passed}/6 passed`);
  } finally { await db.close(); }
}
run().catch(error => { console.error(error); process.exit(1); });
