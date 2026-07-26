const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('./backend/node_modules/sqlite3');
const axios = require('./backend/node_modules/axios');

const temporaryDirectory = fs.mkdtempSync(path.join(__dirname, '.exec-sd-016-'));
const databasePath = path.join(temporaryDirectory, 'database.sqlite');
const teamDbPath = path.join(temporaryDirectory, 'team-db');
fs.writeFileSync(teamDbPath, `#!/usr/bin/env python3
import json, os, sqlite3, sys
db=sqlite3.connect(os.environ['EXEC_SD_016_DATABASE'])
db.row_factory=sqlite3.Row
db.execute('PRAGMA foreign_keys=ON')
sql=sys.argv[1]
try:
  if ';' in sql.strip().rstrip(';'):
    db.executescript(sql); db.commit(); print('[]')
  else:
    cur=db.execute(sql)
    if cur.description: print(json.dumps([dict(row) for row in cur.fetchall()]))
    else: db.commit(); print('[]')
finally: db.close()
`, { mode: 0o700 });
process.env.PATH = `${temporaryDirectory}:${process.env.PATH}`;
process.env.EXEC_SD_016_DATABASE = databasePath;
process.env.OPPORTUNITY_WORKSPACE_ENABLED = 'true';

const db = new sqlite3.Database(databasePath);
const exec = sql => new Promise((resolve, reject) =>
  db.exec(sql, error => error ? reject(error) : resolve()));
const get = (sql, params = []) => new Promise((resolve, reject) =>
  db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const close = () => new Promise(resolve => db.close(resolve));

function controlledHtml({ quantitative = true, synthetic = false } = {}) {
  const words = Array.from({ length: 120 }, (_, index) => `service${index}`).join(' ');
  const quantitativeJson = quantitative ? `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Organization',
    additionalProperty: [
      { name: 'monthlyTraffic', value: 1000 },
      { name: 'conversionRate', value: 0.02 },
      { name: 'averageTransactionValue', value: 500 }
    ]
  })}</script>` : '';
  const images = synthetic
    ? `${Array.from({ length: 3 }, () => '<img src="missing.png">').join('')}${Array.from({ length: 9 }, () => '<img src="ok.png" alt="controlled">').join('')}`
    : '<img src="ok.png" alt="controlled">';
  return `<!doctype html><html><head>${synthetic ? '' : '<title>Controlled Business</title><meta name="description" content="Controlled business description">'}<meta name="viewport" content="width=device-width">${quantitativeJson}</head><body>${synthetic ? '' : '<h1>Controlled Business</h1>'}<p>${words}</p>${images}</body></html>`;
}

let transportMode = { status: 200, html: controlledHtml(), reject: false };
axios.get = async url => {
  if (transportMode.reject) throw new Error('controlled transport failure');
  return {
    status: transportMode.status,
    data: transportMode.html,
    request: { res: { responseUrl: url } }
  };
};

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader() {}
  };
}

function routeHandler(router, routePath, method) {
  const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods[method]);
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function invoke(handler, request) {
  const response = responseRecorder();
  await handler(request, response);
  return response;
}

(async () => {
  const migration004 = fs.readFileSync(
    path.join(__dirname, 'backend/migrations/004_evidence_integrity_operational.sql'), 'utf8'
  );
  const migration002 = fs.readFileSync(
    path.join(__dirname, 'backend/migrations/002_opportunity_workspace.sql'), 'utf8'
  );
  await exec(`CREATE TABLE users (
      id TEXT PRIMARY KEY, persona TEXT, company_name TEXT
    );
    INSERT INTO users VALUES ('user-1','web_agency','Controlled Agency');
    CREATE TABLE leads (
      id TEXT PRIMARY KEY, domain TEXT UNIQUE, business_name TEXT, niche TEXT, location TEXT,
      speed_score INTEGER, responsive_status TEXT, seo_gaps TEXT, conversion_gaps TEXT,
      verified_emails TEXT, screenshot_path TEXT, trackers_found TEXT, address_detected INTEGER,
      discovery_tags TEXT, evidence_state TEXT, outreach_status TEXT, details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT
    );
    CREATE TABLE niche_benchmarks (niche TEXT PRIMARY KEY, avg_seo_score INTEGER);
    CREATE TABLE unlocked_leads (
      user_id TEXT NOT NULL, lead_id TEXT NOT NULL, unlocked_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id,lead_id)
    );
    CREATE TABLE evidence_authorisations (
      contract_id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, outcome TEXT NOT NULL,
      contract_json TEXT NOT NULL, supersedes_contract_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    ${migration004}
    ${migration002}`);
  const { analyzeWebsite } = require('./backend/scraper');
  const observed = await analyzeWebsite('https://eligible.test');
  assert.strictEqual(observed._evidence.validation.valid, true);
  assert(observed._evidence.acquisition.evidenceId);
  assert.strictEqual(Object.hasOwn(observed._evidence.acquisition, 'reliability'), false);
  assert.strictEqual(Object.hasOwn(observed._evidence.acquisition, 'sourceAuthority'), false);
  assert.strictEqual(Object.hasOwn(observed._evidence.acquisition, 'claimClasses'), false);

  const leadsRouter = require('./backend/routes/leads');
  const analyzeHandler = routeHandler(leadsRouter, '/analyze', 'post');
  const authenticatedRequest = domain => ({
    body: { url: `https://${domain}`, niche: 'General' },
    user: { id: 'user-1', plan: 'agency' },
    params: {},
    query: {},
    header: () => null
  });

  transportMode = { status: 200, html: controlledHtml(), reject: false };
  let result = await invoke(analyzeHandler, authenticatedRequest('eligible.test'));
  assert.strictEqual(result.statusCode, 200, JSON.stringify(result.body));
  assert.strictEqual(result.body.success, true);
  assert(result.body.lead.evidence_integrity.reasoningId);
  let current = await get(
    "SELECT outcome,lifecycle_state FROM evidence_integrity_decisions WHERE subject_id='eligible.test' AND lifecycle_state='CURRENT'"
  );
  assert.deepStrictEqual(current, { outcome: 'ELIGIBLE', lifecycle_state: 'CURRENT' });
  assert.strictEqual((await get(
    "SELECT COUNT(*) AS count FROM evidence_integrity_dependent_reasoning WHERE valid=1"
  )).count, 1);

  transportMode = { status: 200, html: controlledHtml({ quantitative: false }), reject: false };
  result = await invoke(analyzeHandler, authenticatedRequest('limited.test'));
  assert.strictEqual(result.statusCode, 200, JSON.stringify(result.body));
  assert.strictEqual(result.body.success, true);
  assert.strictEqual(result.body.lead.revenue_leak, null);
  assert.strictEqual(result.body.lead.persona_summary, null);
  assert.deepStrictEqual(result.body.lead.sales_hooks, []);
  assert.strictEqual(result.body.lead.opportunity_brief.hook, null);
  assert.strictEqual(JSON.stringify(result.body.lead).includes('"formatted_leak"'), false);
  assert.strictEqual(result.body.lead.evidence_integrity_output.outcome, 'LIMITED');
  assert.deepStrictEqual(
    result.body.lead.evidence_integrity_output.materialClaims.map(claim => claim.claimClass).sort(),
    [
      'BUSINESS_IDENTITY',
      'COMMERCIAL_OPPORTUNITY',
      'STRATEGIC_RECOMMENDATION',
      'WEBSITE_PERFORMANCE'
    ]
  );
  const limitedOutput = result.body.lead.evidence_integrity_output;
  assert(limitedOutput.limitations.includes(
    'Revenue estimates are excluded because no validated quantitative basis is available.'
  ));
  const persistedLimitedLead = await get(
    "SELECT evidence_state FROM leads WHERE domain='limited.test'"
  );
  const persistedLimitedEnvelope = JSON.parse(persistedLimitedLead.evidence_state).integrityEnvelope;
  assert.strictEqual(
    persistedLimitedEnvelope.authorisedScope.claimClasses.includes('REVENUE_ESTIMATE'),
    false
  );
  const expectedLimitedLineage = persistedLimitedEnvelope.evidenceLineage.map(item => item.evidenceId);
  assert(limitedOutput.materialClaims.every(claim =>
    claim.confidence === limitedOutput.confidenceCeiling &&
    claim.limitations.length === limitedOutput.limitations.length &&
    claim.limitations.every(limitation => limitedOutput.limitations.includes(limitation)) &&
    JSON.stringify(claim.parentEvidenceIds) === JSON.stringify(expectedLimitedLineage)
  ));
  current = await get(
    "SELECT outcome,lifecycle_state FROM evidence_integrity_decisions WHERE subject_id='limited.test' AND lifecycle_state='CURRENT'"
  );
  assert.deepStrictEqual(current, { outcome: 'LIMITED', lifecycle_state: 'CURRENT' });
  assert.strictEqual((await get(
    "SELECT COUNT(*) AS count FROM evidence_integrity_dependent_reasoning WHERE decision_id=(SELECT decision_id FROM evidence_integrity_decisions WHERE subject_id='limited.test')"
  )).count, 1);

  transportMode = { status: 403, html: '<html><body>Access denied</body></html>', reject: false };
  result = await invoke(analyzeHandler, authenticatedRequest('refused.test'));
  assert.strictEqual(result.statusCode, 422);
  current = await get(
    "SELECT outcome,lifecycle_state FROM evidence_integrity_decisions WHERE subject_id='refused.test' AND lifecycle_state='CURRENT'"
  );
  assert.deepStrictEqual(current, { outcome: 'REFUSED', lifecycle_state: 'CURRENT' });

  transportMode = { reject: true };
  result = await invoke(analyzeHandler, authenticatedRequest('reassessment.test'));
  assert.strictEqual(result.statusCode, 422);
  current = await get(
    "SELECT outcome,lifecycle_state FROM evidence_integrity_decisions WHERE subject_id='reassessment.test' AND lifecycle_state='CURRENT'"
  );
  assert.deepStrictEqual(current, { outcome: 'REASSESSMENT_REQUIRED', lifecycle_state: 'CURRENT' });

  transportMode = { status: 200, html: controlledHtml({ synthetic: true }), reject: false };
  result = await invoke(analyzeHandler, authenticatedRequest('synthetic.test'));
  assert.strictEqual(result.statusCode, 422);
  current = await get(
    "SELECT outcome,lifecycle_state FROM evidence_integrity_decisions WHERE subject_id='synthetic.test' AND lifecycle_state='CURRENT'"
  );
  assert.deepStrictEqual(current, { outcome: 'REFUSED', lifecycle_state: 'CURRENT' });

  await exec(`INSERT INTO customer_capability_profiles
      (profile_id,user_id,version,service_capabilities_json,delivery_constraints_json,geography_json,capacity,exclusions_json,disqualifiers_json,created_at)
      VALUES ('profile-1','user-1',1,'["conversion"]','[]','[]','one project','[]','[]','2026-07-26T12:00:00.000Z');
    INSERT INTO opportunity_workspaces
      (workspace_id,user_id,title,lifecycle,current_version,capability_profile_version,created_at,updated_at)
      VALUES ('workspace-current','user-1','Controlled workspace','DRAFT',0,1,'2026-07-26T12:00:00.000Z','2026-07-26T12:00:00.000Z');`);
  const eligibleLead = await get("SELECT id FROM leads WHERE domain='eligible.test'");
  const workspaceRouter = require('./backend/routes/opportunity-workspaces');
  const candidateHandler = routeHandler(workspaceRouter, '/:id/candidates', 'post');
  const candidateRequest = leadId => ({
    params: { id: 'workspace-current' },
    body: { lead_id: leadId, comparison_context: 'CONTROLLED', evidence_window: '2026-07-26' },
    user: { id: 'user-1', plan: 'agency' },
    header: () => null
  });
  const reasoningBeforeCandidate = (await get(
    'SELECT COUNT(*) AS count FROM evidence_integrity_dependent_reasoning'
  )).count;
  result = await invoke(candidateHandler, candidateRequest(eligibleLead.id));
  assert.strictEqual(result.statusCode, 201, JSON.stringify(result.body));
  assert.strictEqual((await get(
    'SELECT COUNT(*) AS count FROM opportunity_candidate_snapshots'
  )).count, 1);
  assert.strictEqual((await get(
    'SELECT COUNT(*) AS count FROM evidence_integrity_dependent_reasoning'
  )).count, reasoningBeforeCandidate + 1);

  await exec(`INSERT INTO leads
    (id,domain,business_name,niche,location,speed_score,responsive_status,seo_gaps,conversion_gaps,evidence_state,outreach_status)
    VALUES ('missing-authority','missing-authority.test','Missing Authority','General','Unknown',70,'responsive','[]','[]',NULL,'new')`);
  const snapshotsBeforeMissingAuthority = (await get(
    'SELECT COUNT(*) AS count FROM opportunity_candidate_snapshots'
  )).count;
  const reasoningBeforeMissingAuthority = (await get(
    'SELECT COUNT(*) AS count FROM evidence_integrity_dependent_reasoning'
  )).count;
  result = await invoke(candidateHandler, candidateRequest('missing-authority'));
  assert.strictEqual(result.statusCode, 409);
  assert.strictEqual(result.body.code, 'EVIDENCE_INTEGRITY_REASSESSMENT_REQUIRED');
  assert.strictEqual((await get(
    'SELECT COUNT(*) AS count FROM opportunity_candidate_snapshots'
  )).count, snapshotsBeforeMissingAuthority);
  assert.strictEqual((await get(
    'SELECT COUNT(*) AS count FROM evidence_integrity_dependent_reasoning'
  )).count, reasoningBeforeMissingAuthority);

  const { assessAndPreserveAcquisition, productionRequestedScope } =
    require('./backend/utils/evidence-integrity-production');
  const { dbQuery } = require('./backend/database');
  const eligibleState = JSON.parse((await get(
    "SELECT evidence_state FROM leads WHERE domain='eligible.test'"
  )).evidence_state);
  await assessAndPreserveAcquisition({
    dbQuery,
    acquisition: null,
    requestedScope: productionRequestedScope('eligible.test'),
    priorDecisionId: eligibleState.integrityEnvelope.decisionId,
    occurredAt: '2026-07-26T14:00:00.000Z'
  });
  const snapshotsBeforeRefusal = (await get(
    'SELECT COUNT(*) AS count FROM opportunity_candidate_snapshots'
  )).count;
  const reasoningBeforeRefusal = (await get(
    'SELECT COUNT(*) AS count FROM evidence_integrity_dependent_reasoning'
  )).count;
  result = await invoke(candidateHandler, candidateRequest(eligibleLead.id));
  assert.strictEqual(result.statusCode, 409);
  assert.strictEqual(result.body.code, 'EVIDENCE_INTEGRITY_STALE_DECISION');
  assert.strictEqual((await get(
    'SELECT COUNT(*) AS count FROM opportunity_candidate_snapshots'
  )).count, snapshotsBeforeRefusal);
  assert.strictEqual((await get(
    'SELECT COUNT(*) AS count FROM evidence_integrity_dependent_reasoning'
  )).count, reasoningBeforeRefusal);

  await close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  console.log('Evidence Integrity real acquisition, leads route, persisted authority and authenticated workspace route: PASS');
})().catch(error => {
  try { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); } catch (_) {}
  console.error(error);
  process.exit(1);
});
