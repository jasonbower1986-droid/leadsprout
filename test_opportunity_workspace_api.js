const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('./backend/node_modules/express');
const jwt = require('./backend/node_modules/jsonwebtoken');
const sqlite3 = require('./backend/node_modules/sqlite3');
const { buildEvidenceState } = require('./backend/utils/evidence-state');
const { OUTCOMES } = require('./backend/utils/evidence-authorisation');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'coi-api-'));
const databasePath = path.join(temp, 'database.sqlite');
const bin = path.join(temp, 'team-db');
fs.writeFileSync(bin, `#!/usr/bin/env python3
import json, os, sqlite3, sys
db=sqlite3.connect(os.environ['COI_TEST_DATABASE'])
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
process.env.PATH = `${temp}:${process.env.PATH}`;
process.env.COI_TEST_DATABASE = databasePath;

const db = new sqlite3.Database(databasePath);
const exec = sql => new Promise((resolve,reject) => db.exec(sql, error => error ? reject(error) : resolve()));
const migration = fs.readFileSync(path.join(__dirname, 'backend/migrations/002_opportunity_workspace.sql'), 'utf8');
const evidenceState = JSON.stringify(buildEvidenceState({ valid: true, canonicalDecision: {
  outcome: OUTCOMES.ELIGIBLE,
  authorisedAssessmentScope: { subjects: ['observable website evidence'], evidenceBoundary: 'fixture://candidate', breadth: 'observed fields only', depth: 'finding level', confidenceBoundary: 'evidence supported only' },
  provenance: [{ source: 'fixture', method: 'content_validation', reference: 'fixture://candidate' }],
  evidenceIdentities: [{ evidenceId: 'EVI-1-GMIVNAM7YNKE7ROS74HXN3C6OXU7UNHCP4QWQZK4WYJ66MNDVIWQ', lifecycleState: 'ACTIVE' }],
  materialUncertainty: [], limitations: [], commercialConfidence: { degree: 'EVIDENCE_SUPPORTED', basis: 'Controlled fixture.' },
  decision: { reason: 'Controlled fixture decision.', ruleVersion: 'ENG-SPEC-011/2.0' }
} }, { reference: 'fixture://candidate' }));

(async () => {
  await exec(`CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('tenant-a'); INSERT INTO users VALUES ('tenant-b'); CREATE TABLE leads (
    id TEXT PRIMARY KEY, business_name TEXT, domain TEXT, niche TEXT, speed_score INTEGER,
    responsive_status TEXT, address_detected INTEGER, seo_gaps TEXT, conversion_gaps TEXT,
    evidence_state TEXT, details TEXT, created_at TEXT
  ); ${migration}`);
  const insert = (id, speed, responsive, conversion) => new Promise((resolve,reject) => db.run(
    'INSERT INTO leads VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, `Business ${id}`, `${id}.example`, 'General', speed, responsive, 1, '[]', JSON.stringify(conversion), evidenceState, '{}', new Date().toISOString()], error => error ? reject(error) : resolve()
  ));
  await insert('A', 30, 'not_responsive', ['No clear Call-To-Action (CTA) buttons found','No Contact Form']);
  await insert('B', 55, 'responsive', ['No clear Call-To-Action (CTA) buttons found']);
  await insert('C', 70, 'responsive', ['No Contact Form']);
  db.close();

  const { requireOpportunityWorkspace } = require('./backend/config/opportunity-workspace');
  const router = require('./backend/routes/opportunity-workspaces');
  const app = express(); app.use(express.json()); app.use('/api/opportunity-workspaces', requireOpportunityWorkspace, router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve,reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = user => jwt.sign({ id: user, email: `${user}@example.test`, plan: 'agency' }, 'leadsprout-super-secret-key-2026');
  const headers = user => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token(user)}` });
  const request = async (pathName, user, options = {}) => {
    const response = await fetch(`${base}${pathName}`, { ...options, headers: headers(user) });
    return { response, body: response.status === 204 ? null : await response.json() };
  };

  delete process.env.OPPORTUNITY_WORKSPACE_ENABLED;
  let result = await request('/api/opportunity-workspaces', 'tenant-a');
  assert.strictEqual(result.response.status, 404); assert.strictEqual(result.body.code, 'FEATURE_DISABLED');
  process.env.OPPORTUNITY_WORKSPACE_ENABLED = 'true';
  result = await request('/api/opportunity-workspaces', 'tenant-a', { method: 'POST', body: JSON.stringify({ title: 'Decision', capability_profile: { service_capabilities: ['conversion'], disqualifiers: [] } }) });
  assert.strictEqual(result.response.status, 201); const workspaceId = result.body.workspace_id;
  for (const lead_id of ['A','B','C']) {
    result = await request(`/api/opportunity-workspaces/${workspaceId}/candidates`, 'tenant-a', { method: 'POST', body: JSON.stringify({ lead_id, comparison_context: 'CURRENT_PIPELINE', evidence_window: '2026-07-19' }) });
    assert.strictEqual(result.response.status, 201);
  }
  result = await request(`/api/opportunity-workspaces/${workspaceId}/evaluations`, 'tenant-a', { method: 'POST', body: JSON.stringify({ expected_version: 0 }) });
  assert.strictEqual(result.response.status, 200, JSON.stringify(result.body)); assert.strictEqual(result.body.result, 'LEAD_SELECTED');
  result = await request(`/api/opportunity-workspaces/${workspaceId}/offer`, 'tenant-a', { method: 'POST', body: '{}' });
  assert.strictEqual(result.response.status, 200); assert.strictEqual(result.body.result, 'RECOMMENDED');
  result = await request(`/api/opportunity-workspaces/${workspaceId}/conversation`, 'tenant-a', { method: 'POST', body: JSON.stringify({ target_role_category: 'Business owner' }) });
  assert.strictEqual(result.response.status, 200); assert(!result.body.bounded_question.includes('@'));
  result = await request(`/api/opportunity-workspaces/${workspaceId}/actions`, 'tenant-a', { method: 'POST', body: JSON.stringify({ type: 'PURSUE', rationale: 'Begin a truthful conversation.' }) });
  assert.strictEqual(result.response.status, 201); const actionId = result.body.action_id;
  result = await request(`/api/opportunity-workspaces/${workspaceId}/actions`, 'tenant-a', { method: 'PATCH', body: JSON.stringify({ action_id: actionId, state: 'COMPLETED', outcome_note: 'Conversation prepared.' }) });
  assert.strictEqual(result.response.status, 200); assert.strictEqual(result.body.state, 'COMPLETED');
  result = await request(`/api/opportunity-workspaces/${workspaceId}`, 'tenant-b');
  assert.strictEqual(result.response.status, 404, 'Cross-tenant object access must fail closed');
  result = await request(`/api/opportunity-workspaces/${workspaceId}`, 'tenant-a');
  assert.strictEqual(result.response.status, 200); assert.strictEqual(result.body.decision_nodes.length, 8); assert.strictEqual(result.body.actions[0].state, 'COMPLETED');

  delete process.env.OPPORTUNITY_WORKSPACE_ENABLED;
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
  console.log('Opportunity Workspace authenticated I1-I3 end-to-end and tenant-isolation verification: PASS');
})().catch(error => { console.error(error); process.exit(1); });
