const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { executeTeamDb } = require('./backend/scripts/apply_migrations');

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leadsprout-executor-'));
  const executable = path.join(directory, 'executor.js');
  const source = `#!/usr/bin/env node
const crypto = require('crypto');
const args = process.argv.slice(2);
const protocol = args[args.indexOf('--protocol') + 1];
const expected = args[args.indexOf('--payload-sha256') + 1];
let sql = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { sql += chunk; });
process.stdin.on('end', () => {
  const actual = crypto.createHash('sha256').update(sql).digest('hex');
  if (protocol !== 'LEADSPROUT_ATOMIC_SQL_V1' || actual !== expected) process.exit(2);
  process.stdout.write(JSON.stringify({ protocol, status: 'COMMITTED', payload_sha256: actual,
    foreign_keys_restored: true, connection_closed: true }));
});
`;
  fs.writeFileSync(executable, source, { mode: 0o700 });
  const executableSha256 = crypto.createHash('sha256').update(source).digest('hex');
  const previousPath = process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR;
  const previousSha = process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR_SHA256;
  delete process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR;
  delete process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR_SHA256;
  assert.throws(() => executeTeamDb('BEGIN IMMEDIATE; COMMIT;'),
    error => error.code === 'MIGRATION_EXECUTOR_REQUIRED');

  process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR = executable;
  process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR_SHA256 = '0'.repeat(64);
  assert.throws(() => executeTeamDb('BEGIN IMMEDIATE; COMMIT;'),
    error => error.code === 'MIGRATION_EXECUTOR_INVALID');

  process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR_SHA256 = executableSha256;
  const receipt = executeTeamDb('BEGIN IMMEDIATE; COMMIT;');
  assert.strictEqual(receipt.status, 'COMMITTED');
  assert.strictEqual(receipt.foreign_keys_restored, true);
  assert.strictEqual(receipt.connection_closed, true);

  const invalidReceiptSource = source.replace('connection_closed: true', 'connection_closed: false');
  fs.writeFileSync(executable, invalidReceiptSource, { mode: 0o700 });
  process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR_SHA256 =
    crypto.createHash('sha256').update(invalidReceiptSource).digest('hex');
  assert.throws(() => executeTeamDb('BEGIN IMMEDIATE; COMMIT;'),
    error => error.code === 'MIGRATION_EXECUTOR_RECEIPT_INVALID');

  if (previousPath === undefined) delete process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR;
  else process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR = previousPath;
  if (previousSha === undefined) delete process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR_SHA256;
  else process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR_SHA256 = previousSha;
  fs.rmSync(directory, { recursive: true, force: true });
  console.log('PASS atomic migration executor contract');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
