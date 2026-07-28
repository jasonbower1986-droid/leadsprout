const assert = require('assert');
const crypto = require('crypto');
const sqlite3 = require('./backend/node_modules/sqlite3');
const { buildControlledTransaction } = require('./backend/scripts/apply_migrations');
const { migrationInventory, EXPECTED_SCHEMA_MANIFEST, verifyStructuralSchema } =
  require('./backend/scripts/verify_schema');
const outbox = require('./backend/services/domain-outbox');
const preferences = require('./backend/services/preferenceService');
const reports = require('./backend/services/reportRepository');
const activity = require('./backend/services/activityRepository');
const { resolveWorkspaceAccess } = require('./backend/services/reportAccess');

function database() {
  const raw = new sqlite3.Database(':memory:');
  const invoke = (method, statement, parameters = []) => new Promise((resolve, reject) => {
    raw[method](statement, parameters, function callback(error, rows) {
      if (error) reject(error);
      else resolve(method === 'run' ? this : rows);
    });
  });
  const query = {
    all: (sql, params) => invoke('all', sql, params),
    get: (sql, params) => invoke('get', sql, params),
    run: (sql, params) => invoke('run', sql, params),
    exec: sql => new Promise((resolve, reject) =>
      raw.exec(sql, error => error ? reject(error) : resolve())),
    transaction: async operations => {
      await query.exec('BEGIN IMMEDIATE');
      try {
        for (const operation of operations) await query.run(operation.sql, operation.params || []);
        await query.exec('COMMIT');
      } catch (error) {
        await query.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => new Promise((resolve, reject) =>
      raw.close(error => error ? reject(error) : resolve()))
  };
  return query;
}

async function fixture() {
  const db = database();
  await db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE leads(id TEXT PRIMARY KEY);');
  const inventory = migrationInventory();
  await db.exec(buildControlledTransaction({
    inventory,
    revision: '224f58901dbc254bf7c0c94c7db698b1cf436e53',
    target: 'isolated-disposable',
    operator: 'test',
    startedAt: '2026-07-27T00:00:00.000Z'
  }));
  await db.exec(`
    INSERT INTO users VALUES ('user-a');
    INSERT INTO users VALUES ('user-b');
    INSERT INTO opportunity_workspaces
      (workspace_id,user_id,title,lifecycle,current_version,capability_profile_version,created_at,updated_at)
      VALUES ('workspace-a','user-a','A','EVALUATED',1,1,'2026-07-27T00:00:00Z','2026-07-27T00:00:00Z');
    INSERT INTO opportunity_workspace_versions
      (workspace_id,version,policy_version,evidence_window,evaluation_status,candidate_set_digest,created_at)
      VALUES ('workspace-a',1,'policy-1','window','complete','digest','2026-07-27T00:00:00Z');
    INSERT INTO organizations VALUES ('org-a','Organisation A','2026-07-27T00:00:00Z');
    INSERT INTO organizations VALUES ('org-b','Organisation B','2026-07-27T00:00:00Z');
    INSERT INTO organization_memberships VALUES ('org-a','user-a','ACTIVE','OWNER','2026-07-27T00:00:00Z',NULL);
    INSERT INTO organization_memberships VALUES ('org-b','user-b','ACTIVE','OWNER','2026-07-27T00:00:00Z',NULL);
    INSERT INTO workspace_organization_access
      VALUES ('workspace-a','org-a','user-a','ACTIVE','2026-07-27T00:00:00Z',NULL);
  `);
  return db;
}

async function rejectsCode(action, code) {
  await assert.rejects(action, error => error.code === code);
}

async function run() {
  let passed = 0;
  const test = async (name, callback) => {
    const db = await fixture();
    try {
      await callback(db);
      passed += 1;
      console.log(`✓ ${name}`);
    } finally {
      await db.close();
    }
  };

  await test('canonical migrations 001–006 are structurally verified and foreign-key clean', async db => {
    const inventory = migrationInventory();
    assert.deepStrictEqual(inventory.map(row => row.migration_id), ['001', '002', '003', '004', '005', '006']);
    await verifyStructuralSchema(db, EXPECTED_SCHEMA_MANIFEST);
    assert.deepStrictEqual(await db.all('PRAGMA foreign_key_check'), []);
    for (const table of [
      'domain_outbox', 'report_lineages', 'report_versions', 'report_artifacts',
      'customer_activity_events', 'user_presentation_preferences', 'preference_audit_events'
    ]) assert(EXPECTED_SCHEMA_MANIFEST.tables[table]);
  });

  await test('access resolution suppresses inaccessible organization and workspace identities', async db => {
    const allowed = await resolveWorkspaceAccess(db, {
      organizationId: 'org-a', workspaceId: 'workspace-a', userId: 'user-a'
    });
    assert.strictEqual(allowed.workspace_id, 'workspace-a');
    await rejectsCode(() => resolveWorkspaceAccess(db, {
      organizationId: 'org-b', workspaceId: 'workspace-a', userId: 'user-b'
    }), 'OBJECT_NOT_FOUND');
  });

  await test('outbox is idempotent, conflict-safe, claim-safe and interruption-recoverable', async db => {
    const event = {
      organizationId: 'org-a', workspaceId: 'workspace-a', aggregateType: 'REPORT',
      aggregateId: 'report-a', eventType: 'REPORT_REQUESTED', payload: { b: 2, a: 1 },
      policyVersion: 'policy-1', idempotencyKey: 'event-1'
    };
    const first = await outbox.enqueue(db, event, { outboxId: 'outbox-a', createdAt: '2026-07-27T00:00:00Z' });
    assert.strictEqual(first.replay, false);
    assert.strictEqual((await outbox.enqueue(db, event)).replay, true);
    await rejectsCode(() => outbox.enqueue(db, { ...event, aggregateId: 'different' }),
      'OUTBOX_IDEMPOTENCY_CONFLICT');
    const claimed = await outbox.claimNext(db, { workerId: 'worker-a', at: '2026-07-27T00:00:01Z' });
    assert.strictEqual(claimed.outbox_id, 'outbox-a');
    assert.strictEqual(await outbox.claimNext(db, { workerId: 'worker-b', at: '2026-07-27T00:00:01Z' }), undefined);
    await outbox.recoverInterrupted(db, {
      olderThan: '2026-07-27T00:01:00Z', retryAt: '2026-07-27T00:02:00Z'
    });
    assert.strictEqual((await db.get('SELECT state FROM domain_outbox WHERE outbox_id = ?', ['outbox-a'])).state, 'PENDING');
  });

  await test('preferences enforce defaults, ownership, validation, CAS and immutable audit', async db => {
    const identity = {
      organizationId: 'org-a', workspaceId: 'workspace-a', userId: 'user-a',
      fieldName: 'evidence_density'
    };
    assert.strictEqual((await preferences.getPreference(db, identity)).field_value, 'BALANCED');
    const changed = await preferences.updatePreference(db, {
      ...identity, fieldValue: 'EXPANDED', expectedRevision: 0
    }, { preferenceId: 'preference-a', auditId: 'audit-a', occurredAt: '2026-07-27T00:00:00Z' });
    assert.strictEqual(changed.revision, 1);
    await rejectsCode(() => preferences.updatePreference(db, {
      ...identity, fieldValue: 'COMPACT', expectedRevision: 0
    }), 'STALE_WRITE');
    await rejectsCode(() => preferences.updatePreference(db, {
      ...identity, fieldName: 'reduced_motion', fieldValue: 'true', expectedRevision: 0
    }), 'PREFERENCE_SCOPE_INVALID');
    await rejectsCode(() => preferences.getPreference(db, {
      ...identity, organizationId: 'org-b', userId: 'user-b'
    }), 'OBJECT_NOT_FOUND');
    await assert.rejects(() => db.run("UPDATE preference_audit_events SET new_value='COMPACT' WHERE audit_event_id='audit-a'"));
  });

  await test('report lineage, transactional request and immutable artifact version persist system-only', async db => {
    const access = {
      organizationId: 'org-a', workspaceId: 'workspace-a', userId: 'user-a',
      systemAuthority: 'SYSTEM_CONTROLLED'
    };
    const lineage = await reports.createLineage(db, access, {
      reportId: 'report-a', createdAt: '2026-07-27T00:00:00Z'
    });
    assert.strictEqual(lineage.report_id, 'report-a');
    const attempt = await reports.queueGeneration(db, {
      ...access, reportId: 'report-a', workspaceVersion: 1,
      policyVersion: 'policy-1', idempotencyKey: 'attempt-key'
    }, {
      generationAttemptId: 'attempt-a', outboxId: 'outbox-report',
      createdAt: '2026-07-27T00:00:01Z'
    });
    assert.strictEqual(attempt.state, 'PENDING');
    assert(await db.get("SELECT * FROM domain_outbox WHERE aggregate_id='report-a'"));
    const bytes = Buffer.from('controlled synthetic report');
    const version = await reports.persistAvailableVersion(db, {
      ...access, reportId: 'report-a', generationAttemptId: 'attempt-a', workspaceVersion: 1,
      policyVersion: 'policy-1', reportState: 'AVAILABLE', evidenceAuthoritySnapshotId: 'authority-1',
      judgement: { outcome: 'bounded' }, evidenceComposition: { verified: [] },
      confidenceClassification: 'LIMITED', confidenceBasis: 'Synthetic isolated test',
      limitations: ['test'], contradictions: [], provenance: { policy: 'policy-1' },
      contentDigest: crypto.createHash('sha256').update('content').digest('hex'),
      renderingContractVersion: 'render-1', artifactBytes: bytes,
      storageIdentity: 'synthetic://artifact-a', mediaType: 'application/pdf'
    }, {
      reportVersionId: 'version-a', artifactId: 'artifact-a',
      generatedAt: '2026-07-27T00:00:02Z'
    });
    assert.strictEqual(version.artifact_checksum, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.strictEqual((await db.get("SELECT current_report_version_id FROM report_lineages WHERE report_id='report-a'")).current_report_version_id, 'version-a');
    await assert.rejects(() => db.run("UPDATE report_versions SET content_digest='changed' WHERE report_version_id='version-a'"));
    await assert.rejects(() => db.run("UPDATE report_artifacts SET artifact_checksum='changed' WHERE artifact_id='artifact-a'"));
    await rejectsCode(() => reports.createLineage(db, { ...access, systemAuthority: 'CUSTOMER' }),
      'REPORT_SYSTEM_AUTHORITY_REQUIRED');
  });

  await test('activity accepts the complete authorised taxonomy and rejects internal or invented categories', async db => {
    const authorisedCategories = [
      'WORKSPACE_VERSION_CURRENT', 'WORKSPACE_VERSION_SUPERSEDED',
      'REVIEW_COMPLETED', 'REVIEW_INVALIDATED', 'PREPARATION_SELECTED',
      'RECOMMENDATION_CHANGED', 'EVIDENCE_STATE_CHANGED', 'OFFER_DECISION_RECORDED',
      'NEXT_ACTION_PLANNED', 'NEXT_ACTION_CHANGED', 'NEXT_ACTION_COMPLETED',
      'NEXT_ACTION_CANCELLED', 'COMMUNICATION_RECORDED',
      'REPORT_AVAILABLE', 'REPORT_PARTIAL_EVIDENCE', 'REPORT_FAILED', 'REPORT_SUPERSEDED',
      'EVIDENCE_INTEGRITY_BLOCKED', 'EVIDENCE_INTEGRITY_RESTORED'
    ];
    assert.deepStrictEqual([...activity.CATEGORIES], authorisedCategories);
    const base = {
      organizationId: 'org-a', workspaceId: 'workspace-a', userId: 'user-a',
      projectionAuthority: 'POLICY_PROJECTED', workspaceVersion: 1,
      sourceEventType: 'AUTHORITATIVE_DOMAIN_EVENT', actorClass: 'SYSTEM',
      affectedObjectType: 'REPORT', affectedObjectId: 'report-a',
      eventSummary: 'Report available', communicationStatus: 'NOT_RECORDED',
      evidenceIntegrityState: 'AUTHORISED', projectionPolicyVersion: 'activity-1',
      occurredAt: '2026-07-27T00:00:00Z',
      sources: [{ sourceObjectType: 'REPORT', sourceObjectId: 'report-a', relationshipType: 'CAUSE' }]
    };
    for (const [index, category] of authorisedCategories.entries()) {
      const projected = {
        ...base,
        sourceEventId: `source-${index}`,
        eventCategory: category,
        communicationAuthority: category === 'COMMUNICATION_RECORDED'
          ? 'AUTHORITATIVE_COMMUNICATION_SOURCE'
          : undefined
      };
      const stored = await activity.storeProjectedEvent(db, projected, {
        activityEventId: `activity-${index}`, recordedAt: '2026-07-27T00:00:01Z'
      });
      assert.strictEqual(stored.event_category, category);
      assert.strictEqual(stored.replay, false);
    }
    for (const [index, sourceEventType] of [
      'PAGE_VIEW', 'RETRY', 'POLL', 'DIAGNOSTIC', 'MIGRATION', 'STARTUP',
      'NOTIFICATION_ATTEMPT'
    ].entries()) {
      await rejectsCode(() => activity.storeProjectedEvent(db, {
        ...base, sourceEventId: `internal-${index}`, sourceEventType,
        eventCategory: 'REPORT_AVAILABLE'
      }), 'ACTIVITY_EVENT_NOT_CUSTOMER_VISIBLE');
    }
    for (const [index, eventCategory] of [
      'NEXT_ACTION_CREATED', 'EVIDENCE_INTEGRITY_LOST', 'CUSTOMER_CONTACTED',
      'REPORT_VIEWED', 'INVENTED_CATEGORY'
    ].entries()) {
      await rejectsCode(() => activity.storeProjectedEvent(db, {
        ...base, sourceEventId: `rejected-${index}`, eventCategory
      }), 'ACTIVITY_EVENT_NOT_CUSTOMER_VISIBLE');
    }
    await rejectsCode(() => activity.storeProjectedEvent(db, {
      ...base, sourceEventId: 'communication-without-authority',
      eventCategory: 'COMMUNICATION_RECORDED'
    }), 'ACTIVITY_COMMUNICATION_SOURCE_REQUIRED');
    assert.strictEqual(
      await db.get("SELECT * FROM customer_activity_events WHERE source_event_id='communication-without-authority'"),
      undefined
    );
    await assert.rejects(() => db.run("DELETE FROM customer_activity_events WHERE activity_event_id='activity-0'"));
  });

  console.log(`Increment 1 domain foundation: ${passed}/6 passed`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
