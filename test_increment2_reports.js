const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('./backend/node_modules/sqlite3');
const { buildControlledTransaction } = require('./backend/scripts/apply_migrations');
const { migrationInventory } = require('./backend/scripts/verify_schema');
const { createLineage, queueGeneration } = require('./backend/services/reportRepository');
const { evaluateGeneration, materialDigest } = require('./backend/services/reportGenerationPolicy');
const { renderReport } = require('./backend/services/reportRenderer');
const { createArtifactStore, checksum } = require('./backend/services/reportArtifactStore');
const { listReports, reportVersion } = require('./backend/services/reportService');
const { processNext } = require('./backend/services/reportWorker');
const { artifactEligibility } = require('./backend/routes/reports');

function database() {
  const raw = new sqlite3.Database(':memory:');
  const invoke = (method, sql, params = []) => new Promise((resolve, reject) =>
    raw[method](sql, params, function callback(error, rows) {
      if (error) reject(error); else resolve(method === 'run' ? this : rows);
    }));
  const db = {
    all: (sql, params) => invoke('all', sql, params), get: (sql, params) => invoke('get', sql, params),
    run: (sql, params) => invoke('run', sql, params),
    exec: sql => new Promise((resolve, reject) => raw.exec(sql, error => error ? reject(error) : resolve())),
    transaction: async operations => {
      await db.exec('BEGIN IMMEDIATE');
      try {
        for (const operation of operations) await db.run(operation.sql, operation.params || []);
        await db.exec('COMMIT');
      } catch (error) { await db.exec('ROLLBACK'); throw error; }
    },
    close: () => new Promise(resolve => raw.close(resolve))
  };
  return db;
}

async function fixture() {
  const db = database();
  await db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE leads(id TEXT PRIMARY KEY);');
  await db.exec(buildControlledTransaction({
    inventory: migrationInventory(), revision: '980766363518767670c42687f55dfa977d604e37',
    target: 'inc2-isolated', operator: 'test', startedAt: '2026-07-27T00:00:00Z'
  }));
  await db.exec(`
    INSERT INTO users VALUES ('user-a'); INSERT INTO users VALUES ('user-b');
    INSERT INTO opportunity_workspaces
      (workspace_id,user_id,title,lifecycle,current_version,capability_profile_version,created_at,updated_at)
      VALUES ('workspace-a','user-a','A','EVALUATED',1,1,'2026-07-27T00:00:00Z','2026-07-27T00:00:00Z');
    INSERT INTO opportunity_workspace_versions
      (workspace_id,version,policy_version,evidence_window,evaluation_status,candidate_set_digest,created_at)
      VALUES ('workspace-a',1,'policy-1','window','complete','digest','2026-07-27T00:00:00Z');
    INSERT INTO organizations VALUES ('org-a','A','2026-07-27T00:00:00Z');
    INSERT INTO organizations VALUES ('org-b','B','2026-07-27T00:00:00Z');
    INSERT INTO organization_memberships VALUES ('org-a','user-a','ACTIVE','OWNER','2026-07-27T00:00:00Z',NULL);
    INSERT INTO organization_memberships VALUES ('org-b','user-b','ACTIVE','OWNER','2026-07-27T00:00:00Z',NULL);
    INSERT INTO workspace_organization_access VALUES ('workspace-a','org-a','user-a','ACTIVE','2026-07-27T00:00:00Z',NULL);
    INSERT INTO evidence_integrity_decisions
      (decision_id,subject_id,outcome,envelope_json,decision_digest,bundle_id,bundle_version,
       bundle_digest,lifecycle_state,created_at)
      VALUES ('authority-a','subject-a','ELIGIBLE','{}','digest-authority-a','bundle-a','1',
       'bundle-digest-a','CURRENT','2026-07-27T00:00:00Z');
  `);
  return db;
}

const snapshot = {
  workspaceCurrent: true, judgement: { title: 'Bounded judgement', summary: 'Authoritative summary' },
  ownerUserId: 'user-a', candidateSnapshotId: null, evidenceAuthoritySnapshotId: 'authority-a',
  workspaceVersion: 1, policyVersion: 'policy-1', recommendation: 'Review the authorised constraint',
  evidence: [], contradictions: [], limitations: [{ id: 'limitation-a', statement: 'Evidence boundary remains.' }],
  confidenceClassification: 'LIMITED', confidenceBasis: 'Bounded evidence set',
  includedOfferDecision: null, reviewValidity: true, evidenceIntegrityState: 'AUTHORISED'
};

function model(source, decision) {
  return {
    renderingContractVersion: 'report-html-1', judgementTitle: source.judgement.title,
    judgementSummary: source.judgement.summary,
    judgement: { ...source.judgement, subject_display_name: null },
    evidenceComposition: { complete: true }, confidenceClassification: source.confidenceClassification,
    confidenceBasis: source.confidenceBasis, limitations: source.limitations,
    contradictions: source.contradictions, provenance: {
      workspaceVersion: source.workspaceVersion, policyVersion: source.policyVersion,
      materialDigest: decision.materialDigest
    }, evidence: []
  };
}

async function run() {
  const tests = [];
  const test = async (name, callback) => {
    await callback(); tests.push(name); console.log(`✓ ${name}`);
  };
  await test('material policy is system-only, exact and preference/navigation neutral', async () => {
    const result = evaluateGeneration({
      systemAuthority: 'SYSTEM_CONTROLLED', productionEnabled: true, workspaceCurrent: true,
      customerVisibleJudgement: true, accessRetained: true, integrityVerified: true,
      reportId: 'report-a', snapshot
    });
    assert(result.eligible);
    assert.strictEqual(result.idempotencyKey, 'report-a:1:policy-1');
    assert.strictEqual(materialDigest({ ...snapshot, presentationPreference: 'EXPANDED' }), result.materialDigest);
    assert.throws(() => evaluateGeneration({ ...result, snapshot, systemAuthority: 'CUSTOMER' }),
      error => error.code === 'REPORT_SYSTEM_AUTHORITY_REQUIRED');
    assert.throws(() => evaluateGeneration({
      systemAuthority: 'SYSTEM_CONTROLLED', productionEnabled: true, workspaceCurrent: true,
      customerVisibleJudgement: true, accessRetained: true, integrityVerified: false,
      reportId: 'report-a', snapshot
    }), error => error.code === 'REPORT_INTEGRITY_BLOCKED');
  });
  await test('renderer and artifact adapter preserve deterministic exact bytes and refuse tampering', async () => {
    const bytesA = renderReport(model(snapshot, { materialDigest: materialDigest(snapshot) }));
    const bytesB = renderReport(model(snapshot, { materialDigest: materialDigest(snapshot) }));
    assert(bytesA.equals(bytesB));
    assert(bytesA.toString().includes('does not verify evidence truth'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-inc2-'));
    const store = createArtifactStore({ root });
    const identity = 'report-artifact-1234567890abcdef1234567890abcdef.html';
    const stored = await store.putImmutable({ identity, bytes: bytesA });
    assert.strictEqual(stored.checksum, checksum(bytesA));
    assert((await store.readVerified({ identity, expectedChecksum: stored.checksum })).equals(bytesA));
    fs.writeFileSync(path.join(root, identity), Buffer.from('tampered'));
    await assert.rejects(() => store.readVerified({ identity, expectedChecksum: stored.checksum }),
      error => error.code === 'ARTIFACT_VERIFICATION_FAILED');
    assert.throws(() => createArtifactStore({}), error => error.code === 'ARTIFACT_STORE_UNAVAILABLE');
    fs.rmSync(root, { recursive: true, force: true });
  });
  await test('controlled worker publishes one immutable version and replay creates no duplicate', async () => {
    const db = await fixture();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-inc2-'));
    try {
      await createLineage(db, {
        organizationId: 'org-a', workspaceId: 'workspace-a', userId: 'user-a',
        systemAuthority: 'SYSTEM_CONTROLLED'
      }, { reportId: 'report-a', createdAt: '2026-07-27T00:00:00Z' });
      await queueGeneration(db, {
        organizationId: 'org-a', workspaceId: 'workspace-a', userId: 'user-a',
        systemAuthority: 'SYSTEM_CONTROLLED', reportId: 'report-a', workspaceVersion: 1,
        policyVersion: 'policy-1', idempotencyKey: 'report-a:1:policy-1'
      }, { generationAttemptId: 'attempt-a', outboxId: 'outbox-a', createdAt: '2026-07-27T00:00:01Z' });
      const dependencies = {
        productionEnabled: true, loadSnapshot: async () => snapshot,
        verifyIntegrity: async () => true, verifyAccess: async () => true,
        buildModel: model, artifactStore: createArtifactStore({ root })
      };
      const completed = await processNext(db, dependencies, {
        workerId: 'worker-a', at: '2026-07-27T00:00:02Z'
      });
      assert.strictEqual(completed.version.report_version_sequence, 1);
      assert.strictEqual(await processNext(db, dependencies, {
        workerId: 'worker-a', at: '2026-07-27T00:00:03Z'
      }), null);
      assert.strictEqual((await db.get('SELECT COUNT(*) count FROM report_versions')).count, 1);
      await assert.rejects(() => db.run("UPDATE report_versions SET judgement_json='{}'"));
    } finally { await db.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });
  await test('index/current/history services enforce membership and source-workspace access', async () => {
    const db = await fixture();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-inc2-'));
    try {
      await createLineage(db, {
        organizationId: 'org-a', workspaceId: 'workspace-a', userId: 'user-a',
        systemAuthority: 'SYSTEM_CONTROLLED'
      }, { reportId: 'report-a', createdAt: '2026-07-27T00:00:00Z' });
      await queueGeneration(db, {
        organizationId: 'org-a', workspaceId: 'workspace-a', userId: 'user-a',
        systemAuthority: 'SYSTEM_CONTROLLED', reportId: 'report-a', workspaceVersion: 1,
        policyVersion: 'policy-1', idempotencyKey: 'report-a:1:policy-1'
      }, { generationAttemptId: 'attempt-a', outboxId: 'outbox-a', createdAt: '2026-07-27T00:00:01Z' });
      const publication = await processNext(db, {
        productionEnabled: true, loadSnapshot: async () => snapshot,
        verifyIntegrity: async () => true, verifyAccess: async () => true,
        buildModel: model, artifactStore: createArtifactStore({ root })
      }, { workerId: 'worker-a', at: '2026-07-27T00:00:02Z' });
      assert.strictEqual((await listReports(db, { userId: 'user-a' })).length, 1);
      assert.strictEqual((await listReports(db, { userId: 'user-b' })).length, 0);
      const detail = await reportVersion(db, { userId: 'user-a', reportId: 'report-a' });
      assert.strictEqual(detail.evidence_composition.verified_observation_count, 0);
      assert.strictEqual(detail.artifact.checksum_meaning.includes('not evidence truth'), true);
      assert.strictEqual(detail.currently_verified, true);
      assert.strictEqual(detail.download_allowed, true);
      assert.strictEqual(await reportVersion(db, { userId: 'user-b', reportId: 'report-a' }), null);
    } finally { await db.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });
  await test('post-publication integrity loss fails closed and valid restoration is non-mutating', async () => {
    const db = await fixture();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-inc2-'));
    try {
      await createLineage(db, {
        organizationId: 'org-a', workspaceId: 'workspace-a', userId: 'user-a',
        systemAuthority: 'SYSTEM_CONTROLLED'
      }, { reportId: 'report-a', createdAt: '2026-07-27T00:00:00Z' });
      await queueGeneration(db, {
        organizationId: 'org-a', workspaceId: 'workspace-a', userId: 'user-a',
        systemAuthority: 'SYSTEM_CONTROLLED', reportId: 'report-a', workspaceVersion: 1,
        policyVersion: 'policy-1', idempotencyKey: 'report-a:1:policy-1'
      }, { generationAttemptId: 'attempt-a', outboxId: 'outbox-a', createdAt: '2026-07-27T00:00:01Z' });
      const publication = await processNext(db, {
        productionEnabled: true, loadSnapshot: async () => snapshot,
        verifyIntegrity: async () => true, verifyAccess: async () => true,
        buildModel: model, artifactStore: createArtifactStore({ root })
      }, { workerId: 'worker-a', at: '2026-07-27T00:00:02Z' });
      const publishedVersionId = publication.version.report_version_id;
      const immutableBefore = await db.get(`SELECT judgement_json,evidence_composition_json,
        limitations_json,contradictions_json,provenance_json,content_digest
        FROM report_versions WHERE report_version_id = ?`, [publishedVersionId]);
      assert.strictEqual((await listReports(db, { userId: 'user-a' }))[0].report_state, 'AVAILABLE');

      await db.run("UPDATE evidence_integrity_decisions SET lifecycle_state='INVALIDATED' WHERE decision_id='authority-a'");
      let index = (await listReports(db, { userId: 'user-a' }))[0];
      let detail = await reportVersion(db, { userId: 'user-a', reportId: 'report-a' });
      assert.strictEqual(index.report_state, 'INTEGRITY_BLOCKED');
      assert.strictEqual(index.current, false);
      assert.strictEqual(index.historical, true);
      assert.strictEqual(detail.currently_verified, false);
      assert.strictEqual(detail.artifact.state, 'WITHHELD');
      assert.strictEqual(detail.download_allowed, false);
      assert.strictEqual(detail.progression_allowed, false);
      assert.deepStrictEqual(artifactEligibility(detail),
        { allowed: false, code: 'REPORT_INTEGRITY_BLOCKED' });
      assert.strictEqual(await reportVersion(db, { userId: 'user-b', reportId: 'report-a' }), null);

      await db.run("DELETE FROM evidence_integrity_decisions WHERE decision_id='authority-a'");
      assert.strictEqual((await listReports(db, { userId: 'user-a' }))[0].currently_verified, false);
      await db.run(`INSERT INTO evidence_integrity_decisions
        (decision_id,subject_id,outcome,envelope_json,decision_digest,bundle_id,bundle_version,
         bundle_digest,lifecycle_state,created_at)
        VALUES ('authority-a','subject-a','REFUSED','{}','digest-refused','bundle-a','1',
         'bundle-digest-a','CURRENT','2026-07-27T01:00:00Z')`);
      assert.strictEqual((await listReports(db, { userId: 'user-a' }))[0].currently_verified, false);
      const unavailableDb = {
        ...db,
        get: (sql, params) => sql.includes('evidence_integrity_decisions')
          ? Promise.reject(new Error('integrity store unavailable')) : db.get(sql, params)
      };
      await assert.rejects(() => listReports(unavailableDb, { userId: 'user-a' }),
        /integrity store unavailable/);

      await db.run("UPDATE evidence_integrity_decisions SET lifecycle_state='INVALIDATED' WHERE decision_id='authority-a'");
      await db.run(`INSERT INTO evidence_integrity_decisions
        (decision_id,subject_id,outcome,envelope_json,decision_digest,bundle_id,bundle_version,
         bundle_digest,supersedes_decision_id,lifecycle_state,created_at)
        VALUES ('authority-restored','subject-a','LIMITED','{}','digest-restored','bundle-a','1',
         'bundle-digest-a','authority-a','CURRENT','2026-07-27T02:00:00Z')`);
      index = (await listReports(db, { userId: 'user-a' }))[0];
      detail = await reportVersion(db, { userId: 'user-a', reportId: 'report-a' });
      assert.strictEqual(index.report_state, 'AVAILABLE');
      assert.strictEqual(index.current, true);
      assert.strictEqual(detail.integrity.current_decision_id, 'authority-restored');
      assert.strictEqual(detail.download_allowed, true);
      assert.deepStrictEqual(artifactEligibility(detail), { allowed: true, code: null });
      const immutableAfter = await db.get(`SELECT judgement_json,evidence_composition_json,
        limitations_json,contradictions_json,provenance_json,content_digest
        FROM report_versions WHERE report_version_id = ?`, [publishedVersionId]);
      assert.deepStrictEqual(immutableAfter, immutableBefore);
    } finally { await db.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });
  await test('customer-facing source contains no generation or retry route/control', async () => {
    const routeSource = fs.readFileSync('backend/routes/reports.js', 'utf8');
    assert(!/router\.(post|put|patch|delete)\s*\(/.test(routeSource));
    const productionSources = [
      'frontend/src/pages/Reports.jsx', 'frontend/src/pages/ReportDetail.jsx',
      'frontend/src/components/reports/ReportState.jsx'
    ].map(file => fs.readFileSync(file, 'utf8')).join('\n');
    assert(!/\b(Generate|Regenerate|Create report|Retry generation)\b/.test(productionSources));
    for (const fixture of ['Northstar Dental Group', 'Harbour Legal Partners', 'Alder & Finch',
      'RPT-2026-0718', 'O-17', 'Moderate → Strong']) assert(!productionSources.includes(fixture));
  });
  console.log(`Increment 2 Reports: ${tests.length}/6 passed`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
