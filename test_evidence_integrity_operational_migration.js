const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('./backend/node_modules/sqlite3');

const migration = fs.readFileSync(path.join(__dirname, 'backend/migrations/004_evidence_integrity_operational.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(__dirname, 'backend/migrations/004_evidence_integrity_operational_rollback.sql'), 'utf8');
const db = new sqlite3.Database(':memory:');
const exec = sql => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
const all = sql => new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));

(async () => {
  await exec(migration);
  await exec(migration);
  const tables = (await all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'evidence_integrity_%' ORDER BY name")).map(row => row.name);
  assert.deepStrictEqual(tables, [
    'evidence_integrity_decision_evidence',
    'evidence_integrity_decisions',
    'evidence_integrity_dependent_reasoning',
    'evidence_integrity_lifecycle_events'
  ]);
  await exec(`INSERT INTO evidence_integrity_decisions
    (decision_id,subject_id,outcome,envelope_json,decision_digest,bundle_id,bundle_version,bundle_digest,lifecycle_state,created_at)
    VALUES ('D1','S1','REFUSED','{}','${'a'.repeat(64)}','EI-RULE-BUNDLE-001','1.0.0','${'b'.repeat(64)}','CURRENT','2026-07-26T12:00:00.000Z')`);
  await assert.rejects(exec(`INSERT INTO evidence_integrity_decisions
    (decision_id,subject_id,outcome,envelope_json,decision_digest,bundle_id,bundle_version,bundle_digest,lifecycle_state,created_at)
    VALUES ('D2','S1','REFUSED','{}','${'c'.repeat(64)}','EI-RULE-BUNDLE-001','1.0.0','${'b'.repeat(64)}','CURRENT','2026-07-26T12:01:00.000Z')`));
  await exec(rollback);
  assert.deepStrictEqual(await all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'evidence_integrity_%'"
  ), []);
  await exec(migration);
  await new Promise(resolve => db.close(resolve));
  console.log('Evidence Integrity operational migration additive, idempotent, reversible and current-authority constrained: PASS');
})().catch(error => { console.error(error); process.exit(1); });
