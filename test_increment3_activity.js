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
    INSERT INTO users VALUES ('operator-a'); INSERT INTO users VALUES ('integration-a');
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
    INSERT INTO report_lineages VALUES
      ('report-a','org-a','workspace-a','report-version-a','2026-01-01T00:00:00Z');
    INSERT INTO report_generation_attempts
      (generation_attempt_id,report_id,workspace_version,policy_version,attempt_sequence,state,
       idempotency_key,retry_eligible,completed_at,created_at)
      VALUES ('attempt-a','report-a',2,'p',1,'SUCCEEDED','attempt-a',0,
        '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
    INSERT INTO report_versions
      (report_version_id,report_id,report_version_sequence,organization_id,workspace_id,
       workspace_version,policy_version,evidence_authority_snapshot_id,generation_attempt_id,
       report_state,is_current,judgement_json,evidence_composition_json,confidence_classification,
       confidence_basis,limitations_json,contradictions_json,provenance_json,content_digest,
       rendering_contract_version,generated_at,created_at)
      VALUES ('report-version-a','report-a',1,'org-a','workspace-a',2,'p','authority-a',
        'attempt-a','AVAILABLE',1,'{}','{}','LIMITED','bounded','[]','[]','{}','digest',
        'render-1','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
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
        sourceEventId: 'mapped', decisionBoundaryChanged: true, commercialConsequence: 'INVENTED',
        causalSources: [
          { sourceObjectType: 'DECISION_BOUNDARY_BEFORE', sourceObjectId: 'before-a', relationshipType: 'CAUSE', verifiedRelationship: true },
          { sourceObjectType: 'DECISION_BOUNDARY_AFTER', sourceObjectId: 'after-a', relationshipType: 'CAUSE', verifiedRelationship: true }
        ]
      });
      assert.strictEqual(projected.eventCategory, 'REVIEW_COMPLETED');
      assert.strictEqual(projected.communicationStatus, 'NOT_RECORDED');
      assert.strictEqual(projected.commercialConsequence, 'PREPARATION_ELIGIBLE');
      assert.notStrictEqual(projected.commercialConsequence, 'INVENTED');
    });
    await test('unverified causality and inferred communication fail closed', async () => {
      assert.throws(() => projection.projectDomainEvent({
        ...base(2), sourceEventType: 'REVIEW_VALIDLY_COMPLETED', materialChange: true,
        causalSources: [{ verifiedRelationship: false }]
      }), error => error.code === 'ACTIVITY_CAUSAL_AUTHORITY_REQUIRED');
      assert.throws(() => projection.projectDomainEvent({
        ...base(2), sourceEventType: 'AUTHORITATIVE_COMMUNICATION_RECORDED', materialChange: true
      }), error => error.code === 'ACTIVITY_COMMUNICATION_SOURCE_REQUIRED');
      assert.throws(() => projection.projectDomainEvent({
        ...base(2), sourceEventType: 'REVIEW_VALIDLY_COMPLETED', materialChange: true,
        decisionBoundaryChanged: true, commercialConsequence: 'INVENTED',
        causalSources: [{ sourceObjectType: 'DECISION_BOUNDARY_AFTER', sourceObjectId: 'after-a',
          relationshipType: 'CAUSE', verifiedRelationship: true }]
      }), error => error.code === 'ACTIVITY_DECISION_BOUNDARY_AUTHORITY_REQUIRED');
    });
    await test('presentation derives consequence from controlled mapping and stored decision boundaries', async () => {
      await storeProjectedEvent(db, {
        ...base(3), sourceEventId: 'controlled-consequence',
        sourceEventType: 'REVIEW_VALIDLY_COMPLETED',
        commercialConsequence: 'INVENTED_COMMERCIAL_CLAIM',
        sources: [
          { sourceObjectType: 'DECISION_BOUNDARY_BEFORE', sourceObjectId: 'before-a', relationshipType: 'CAUSE' },
          { sourceObjectType: 'DECISION_BOUNDARY_AFTER', sourceObjectId: 'after-a', relationshipType: 'CAUSE' }
        ]
      }, { activityEventId: 'controlled-consequence' });
      const feed = await activity.listActivity(db, {
        userId: 'user-a', pageSize: 25
      }, { now: '2026-07-28T02:00:00Z' });
      const event = feed.events.find(item => item.activity_event_id === 'controlled-consequence');
      assert.strictEqual(event.commercial_consequence, 'PREPARATION_ELIGIBLE');
      assert(!JSON.stringify(event).includes('INVENTED_COMMERCIAL_CLAIM'));
    });
    for (let index = 0; index < 27; index += 1) await storeProjectedEvent(db, base(index), { activityEventId: `activity-${String(index).padStart(2, '0')}`, recordedAt: '2026-07-28T01:00:00Z' });
    await test('feed is access-filtered and ordered by authoritative tuple', async () => {
      const first = await activity.listActivity(db, { userId: 'user-a', pageSize: 25 }, { now: '2026-07-28T02:00:00Z' });
      assert.strictEqual(first.events.length, 25);
      assert.strictEqual(first.events[0].activity_event_id, 'activity-26');
      assert(first.next_cursor);
      assert.strictEqual(first.events[0].actor.class, 'CUSTOMER_USER');
      assert.strictEqual(first.events[0].actor.authority, 'VERIFIED');
      assert.strictEqual(first.events[0].actor.display_name, 'Customer user');
      assert(!JSON.stringify(first.events[0].actor).includes('Customer reviewer'));
      assert.strictEqual(first.events[0].source_event_id, 'source-26');
      assert.strictEqual(first.events[0].source_event_type, 'AUTHORITATIVE_DOMAIN_EVENT');
      assert.strictEqual(first.events[0].affected_object.state, 'ACCESSIBLE');
      assert.strictEqual(first.events[0].communication_status, 'NOT_RECORDED');
      const denied = await activity.listActivity(db, { userId: 'user-b', pageSize: 25 }, { now: '2026-07-28T02:00:00Z' });
      assert.deepStrictEqual(denied.events, []);
    });
    await test('cursor pagination has no duplicates and permits only 25 or 50', async () => {
      const first = await activity.listActivity(db, { userId: 'user-a', pageSize: 25 }, { now: '2026-07-28T02:00:00Z' });
      const second = await activity.listActivity(db, { userId: 'user-a', pageSize: 25, cursor: first.next_cursor }, { now: '2026-07-28T02:00:00Z' });
      assert.deepStrictEqual(second.events.map(row => row.activity_event_id), ['activity-02', 'activity-01', 'activity-00']);
      await assert.rejects(() => activity.listActivity(db, { userId: 'user-a', pageSize: 10 }), error => error.code === 'ACTIVITY_PAGE_SIZE_INVALID');
      await assert.rejects(() => activity.listActivity(db, { userId: 'user-a', cursor: 'not-a-cursor' }), error => error.code === 'ACTIVITY_CURSOR_INVALID');
    });
    await test('category filtering accepts every authorised category and rejects unsupported input', async () => {
      for (const category of projection.EVENT_POLICY ? require('./backend/services/activityRepository').CATEGORIES : []) {
        const filtered = await activity.listActivity(db, {
          userId: 'user-a', pageSize: 50, category
        }, { now: '2026-07-28T02:00:00Z' });
        assert(filtered.events.every(event => event.event_category === category));
      }
      const reviews = await activity.listActivity(db, {
        userId: 'user-a', pageSize: 25, category: 'REVIEW_COMPLETED'
      }, { now: '2026-07-28T02:00:00Z' });
      assert.strictEqual(reviews.events.length, 25);
      await assert.rejects(() => activity.listActivity(db, {
        userId: 'user-a', category: 'INVENTED_CATEGORY'
      }), error => error.code === 'ACTIVITY_CATEGORY_INVALID');
    });
    await test('forged actor assertions fail closed and verified actor authorities are presented', async () => {
      for (const actorClass of ['SYSTEM', 'AUTHORISED_OPERATOR', 'AUTHORISED_INTEGRATION']) {
        assert.throws(() => projection.projectDomainEvent({
          ...base(`forged-${actorClass}`),
          sourceEventType: 'REVIEW_VALIDLY_COMPLETED',
          sourceEventId: `forged-projection-${actorClass}`,
          materialChange: true,
          actorClass,
          actorUserId: actorClass === 'SYSTEM' ? null : 'user-a',
          actorDisplayName: 'Forged authority',
          causalSources: []
        }), error => error.code === 'ACTIVITY_ACTOR_AUTHORITY_REQUIRED');
      }
      await storeProjectedEvent(db, {
        ...base(30), sourceEventId: 'unverified-actor', actorUserId: 'user-b',
        actorDisplayName: 'Invented privileged name'
      }, { activityEventId: 'unverified-actor' });
      await storeProjectedEvent(db, {
        ...base(31), sourceEventId: 'unsupported-operator', actorClass: 'AUTHORISED_OPERATOR',
        actorUserId: null, actorDisplayName: 'Invented operator'
      }, { activityEventId: 'unsupported-operator' });
      await storeProjectedEvent(db, {
        ...base(32), sourceEventId: 'forged-system', actorClass: 'SYSTEM',
        actorUserId: null, actorDisplayName: 'Forged LeadSprout'
      }, { activityEventId: 'forged-system' });
      await storeProjectedEvent(db, {
        ...base(33), sourceEventId: 'forged-integration', actorClass: 'AUTHORISED_INTEGRATION',
        actorUserId: 'integration-a', actorDisplayName: 'Forged integration'
      }, { activityEventId: 'forged-integration' });
      const authorities = [
        ['verified-system', 'SYSTEM', null, 'ACTOR_AUTHORITY_SYSTEM', 'LEADSPROUT',
          'SYSTEM_SERVICE', 'LeadSprout'],
        ['verified-operator', 'AUTHORISED_OPERATOR', 'operator-a',
          'ACTOR_AUTHORITY_OPERATOR', 'operator-a', 'AUTHORISED_OPERATOR', 'Authorised operator'],
        ['verified-integration', 'AUTHORISED_INTEGRATION', 'integration-a',
          'ACTOR_AUTHORITY_INTEGRATION', 'integration-a', 'EXTERNAL_SYSTEM', 'Authorised integration']
      ];
      for (let index = 0; index < authorities.length; index += 1) {
        const [id, actorClass, actorUserId, sourceObjectType, sourceObjectId] = authorities[index];
        const projected = projection.projectDomainEvent({
          ...base(34 + index), sourceEventType: 'REVIEW_VALIDLY_COMPLETED',
          sourceEventId: `source-${id}`, materialChange: true, actorClass, actorUserId,
          actorDisplayName: `Caller supplied ${id}`,
          causalSources: [{
            sourceObjectType, sourceObjectId, relationshipType: 'CAUSE',
            verifiedRelationship: true
          }]
        });
        await storeProjectedEvent(db, projected, { activityEventId: id });
      }
      const feed = await activity.listActivity(db, {
        userId: 'user-a', pageSize: 50
      }, { now: '2026-07-28T02:00:00Z' });
      for (const id of [
        'unverified-actor', 'unsupported-operator', 'forged-system', 'forged-integration'
      ]) {
        const event = feed.events.find(item => item.activity_event_id === id);
        assert.deepStrictEqual(event.actor, {
          class: 'UNAVAILABLE', display_name: 'Actor unavailable', authority: 'UNAVAILABLE'
        });
        assert(!JSON.stringify(event).includes('Invented'));
        assert(!JSON.stringify(event).includes('Forged'));
      }
      for (const [id, , , , , expectedClass, expectedName] of authorities) {
        const event = feed.events.find(item => item.activity_event_id === id);
        assert.deepStrictEqual(event.actor, {
          class: expectedClass, display_name: expectedName, authority: 'VERIFIED'
        });
        assert(!JSON.stringify(event).includes('Caller supplied'));
      }
    });
    await test('affected-object access is verified for each supported class and restricted identities are suppressed', async () => {
      const cases = [
        ['affected-workspace', 'WORKSPACE', 'workspace-a', true],
        ['affected-workspace-version', 'WORKSPACE_VERSION', 'workspace-a', true],
        ['affected-report', 'REPORT', 'report-a', true],
        ['affected-report-version', 'REPORT_VERSION', 'report-version-a', true],
        ['affected-report-restricted', 'REPORT', 'restricted-report-secret', false],
        ['affected-unsupported', 'EVIDENCE', 'restricted-evidence-secret', false]
      ];
      for (const [eventId, type, objectId] of cases) {
        await storeProjectedEvent(db, {
          ...base(eventId), sourceEventId: `source-${eventId}`,
          affectedObjectType: type, affectedObjectId: objectId,
          occurredAt: `2026-07-28T01:${String(cases.indexOf(cases.find(row => row[0] === eventId))).padStart(2, '0')}:00Z`
        }, { activityEventId: eventId });
      }
      const feed = await activity.listActivity(db, {
        userId: 'user-a', pageSize: 50
      }, { now: '2026-07-28T02:00:00Z' });
      for (const [eventId, , objectId, accessible] of cases) {
        const event = feed.events.find(item => item.activity_event_id === eventId);
        assert.strictEqual(event.affected_object.state, accessible ? 'ACCESSIBLE' : 'RESTRICTED');
        if (accessible) {
          assert.strictEqual(event.affected_object.id, objectId);
          assert(await activity.affectedObject(db, { userId: 'user-a', activityEventId: eventId }));
        } else {
          assert.strictEqual(event.affected_object.id, undefined);
          assert(!JSON.stringify(event).includes(objectId));
          await assert.rejects(() => activity.affectedObject(db, {
            userId: 'user-a', activityEventId: eventId
          }), error => error.code === 'AFFECTED_OBJECT_ROUTE_UNAVAILABLE');
        }
      }
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
    console.log(`Increment 3 Activity Feed: ${passed}/10 passed`);
  } finally { await db.close(); }
}
run().catch(error => { console.error(error); process.exit(1); });
