const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('./backend/node_modules/sqlite3');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coi-design-migration-'));
const databasePath = path.join(directory, 'production-equivalent.sqlite');
const backupPath = path.join(directory, 'pre-migration.sqlite');
const migration002 = fs.readFileSync(path.join(__dirname, 'backend/migrations/002_opportunity_workspace.sql'), 'utf8');
const migration003 = fs.readFileSync(path.join(__dirname, 'backend/migrations/003_commercial_opportunity_design_states.sql'), 'utf8');
const db = new sqlite3.Database(databasePath);
const exec = sql => new Promise((resolve,reject) => db.exec(sql, error => error ? reject(error) : resolve()));
const one = sql => new Promise((resolve,reject) => db.get(sql, (error,row) => error ? reject(error) : resolve(row)));
const all = sql => new Promise((resolve,reject) => db.all(sql, (error,rows) => error ? reject(error) : resolve(rows)));

(async () => {
  await exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE leads(id TEXT PRIMARY KEY,evidence_state TEXT); INSERT INTO users VALUES('u1'); INSERT INTO leads VALUES('l1',NULL);");
  await exec(migration002);
  await exec("INSERT INTO customer_capability_profiles VALUES('p1','u1',1,'[]','[]','[]','declared','[]','[]','2026-07-24T00:00:00Z'); INSERT INTO opportunity_workspaces VALUES('w1','u1','Fixture','EVALUATED',1,1,NULL,'2026-07-24T00:00:00Z','2026-07-24T00:00:00Z'); INSERT INTO opportunity_workspace_versions VALUES('w1',1,'policy','2026-07-24','COMPLETE',NULL,'No winner','digest',NULL,'fixture','2026-07-24T00:00:00Z');");
  const before = { users:(await one('SELECT COUNT(*) count FROM users')).count, leads:(await one('SELECT COUNT(*) count FROM leads')).count, workspaces:(await one('SELECT COUNT(*) count FROM opportunity_workspaces')).count };
  await exec(`VACUUM INTO '${backupPath.replaceAll("'","''")}'`);
  await exec(migration003); await exec(migration003);
  const after = { users:(await one('SELECT COUNT(*) count FROM users')).count, leads:(await one('SELECT COUNT(*) count FROM leads')).count, workspaces:(await one('SELECT COUNT(*) count FROM opportunity_workspaces')).count };
  assert.deepStrictEqual(after,before);
  const tables = (await all("SELECT name FROM sqlite_master WHERE type='table'")).map(row => row.name);
  for (const table of ['opportunity_commercial_estimates','opportunity_contact_snapshots','opportunity_attribution_snapshots','opportunity_proposal_summaries']) assert(tables.includes(table), `${table} missing`);
  db.close();
  const restored = new sqlite3.Database(backupPath);
  const restored003 = await new Promise((resolve,reject) => restored.all("SELECT name FROM sqlite_master WHERE type='table' AND name='opportunity_commercial_estimates'", (error,rows) => error ? reject(error) : resolve(rows)));
  assert.strictEqual(restored003.length,0);
  restored.close(); fs.rmSync(directory,{recursive:true,force:true});
  console.log('Commercial Opportunity Design migration 003 additive, idempotent, backup and retention rehearsal: PASS');
})().catch(error => { console.error(error); process.exit(1); });
