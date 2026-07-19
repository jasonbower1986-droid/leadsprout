const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('./backend/node_modules/sqlite3');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opportunity-migration-'));
const databasePath = path.join(dir, 'production-equivalent.sqlite');
const backupPath = path.join(dir, 'pre-migration.sqlite');
const migration = fs.readFileSync(path.join(__dirname, 'backend/migrations/002_opportunity_workspace.sql'), 'utf8');
const db = new sqlite3.Database(databasePath);
const exec = sql => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
const all = sql => new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));

(async () => {
  await exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE leads(id TEXT PRIMARY KEY, evidence_state TEXT); CREATE TABLE evidence_identities(evidence_id TEXT PRIMARY KEY); INSERT INTO users VALUES ("user-1"); INSERT INTO leads VALUES ("lead-1",NULL); INSERT INTO evidence_identities VALUES ("evidence-1");');
  const before = await all("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name");
  const countsBefore = { leads: (await all('SELECT COUNT(*) count FROM leads'))[0].count, evidence: (await all('SELECT COUNT(*) count FROM evidence_identities'))[0].count };
  await exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  assert(fs.statSync(backupPath).size > 0);
  await exec(migration); await exec(migration);
  const after = await all("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name");
  const countsAfter = { leads: (await all('SELECT COUNT(*) count FROM leads'))[0].count, evidence: (await all('SELECT COUNT(*) count FROM evidence_identities'))[0].count };
  assert.deepStrictEqual(countsAfter, countsBefore);
  assert(after.some(item => item.name === 'opportunity_workspaces'));
  assert(after.some(item => item.name === 'opportunity_next_action_events'));
  assert(after.length > before.length);
  const digest = crypto.createHash('sha256').update(JSON.stringify(after)).digest('hex');
  assert.strictEqual(digest.length, 64);
  db.close();
  const restored = new sqlite3.Database(backupPath);
  const restoredTables = await new Promise((resolve,reject) => restored.all("SELECT name FROM sqlite_master WHERE type='table' AND name='opportunity_workspaces'", (e,r)=>e?reject(e):resolve(r)));
  assert.strictEqual(restoredTables.length, 0);
  restored.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Opportunity Workspace additive migration and backup rehearsal: PASS');
})().catch(error => { console.error(error); process.exit(1); });
