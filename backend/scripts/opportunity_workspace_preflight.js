const crypto = require('crypto');
const fs = require('fs');
const { spawnSync } = require('child_process');

const output = process.argv[2];
if (!output) throw new Error('Usage: node opportunity_workspace_preflight.js <protected-output.json>');
if (process.env.OPPORTUNITY_WORKSPACE_ENABLED === 'true') throw new Error('Feature must remain OFF during preflight.');

function query(sql) {
  const result = spawnSync('team-db', [sql], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'team-db query failed');
  return JSON.parse(result.stdout || '[]');
}

const schema = query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type,name");
const tables = schema.filter(item => item.type === 'table' && !item.name.startsWith('sqlite_')).map(item => item.name);
const rowCounts = Object.fromEntries(tables.map(table => [table, Number(query(`SELECT COUNT(*) AS count FROM \"${table.replace(/\"/g,'\"\"')}\"`)[0]?.count || 0)]));
const capturedAt = new Date().toISOString();
const payload = { captured_at: capturedAt, schema, schema_sha256: crypto.createHash('sha256').update(JSON.stringify(schema)).digest('hex'), row_counts: rowCounts };
fs.writeFileSync(output, JSON.stringify(payload, null, 2), { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ output, captured_at: capturedAt, schema_sha256: payload.schema_sha256, table_count: tables.length, row_counts: rowCounts }));
