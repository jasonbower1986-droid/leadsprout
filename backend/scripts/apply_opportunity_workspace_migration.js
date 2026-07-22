const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const preflightPath = process.argv[2];
const backupPath = process.argv[3];
if (!preflightPath || !backupPath) throw new Error('Usage: node apply_opportunity_workspace_migration.js <preflight.json> <backup.json>');
if (process.env.OPPORTUNITY_WORKSPACE_ENABLED === 'true') throw new Error('Feature must remain OFF during migration.');
const preflight = JSON.parse(fs.readFileSync(preflightPath, 'utf8'));
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
if (!preflight.schema_sha256 || backup.format !== 'LEADSPROUT_LOGICAL_BACKUP_V1' || !backup.payload_sha256) throw new Error('Verified preflight and backup evidence are required.');
const migration = fs.readFileSync(path.join(__dirname, '../migrations/002_opportunity_workspace.sql'), 'utf8');
const statements = migration.split(';').map(item => item.trim()).filter(Boolean);
for (const statement of statements) {
  const result = spawnSync('team-db', [`${statement};`], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'Migration failed');
}
console.log(JSON.stringify({ migration: '002_opportunity_workspace.sql', statements: statements.length, feature_enabled: false, status: 'APPLIED' }));
