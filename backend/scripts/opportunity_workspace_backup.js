const crypto = require('crypto');
const fs = require('fs');
const { spawnSync } = require('child_process');

const output = process.argv[2];
if (!output) throw new Error('Usage: node opportunity_workspace_backup.js <protected-backup.json>');
if (process.env.OPPORTUNITY_WORKSPACE_ENABLED === 'true') throw new Error('Feature must remain OFF during backup.');
function query(sql) {
  const result = spawnSync('team-db', [sql], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 200 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'team-db query failed');
  return JSON.parse(result.stdout || '[]');
}
const schema = query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type,name");
const tables = schema.filter(item => item.type === 'table' && !item.name.startsWith('sqlite_')).map(item => item.name);
const rows = Object.fromEntries(tables.map(table => [table, query(`SELECT * FROM \"${table.replace(/\"/g,'\"\"')}\"`)]));
const payload = { format: 'LEADSPROUT_LOGICAL_BACKUP_V1', captured_at: new Date().toISOString(), schema, rows };
payload.payload_sha256 = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
fs.writeFileSync(output, JSON.stringify(payload), { mode: 0o600, flag: 'wx' });
const verified = JSON.parse(fs.readFileSync(output, 'utf8'));
const checksum = verified.payload_sha256; delete verified.payload_sha256;
if (crypto.createHash('sha256').update(JSON.stringify(verified)).digest('hex') !== checksum) throw new Error('Backup verification failed.');
console.log(JSON.stringify({ output, format: payload.format, payload_sha256: checksum, table_count: tables.length, verified: true }));
