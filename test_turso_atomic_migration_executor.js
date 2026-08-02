const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildIncrementalTransaction } = require('./backend/scripts/apply_migrations');
const { migrationInventory } = require('./backend/scripts/verify_schema');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function runExecutor(executor, modulePath, eventLog, payload, extraEnv = {}) {
  const manifestPath = path.join(path.dirname(modulePath), 'package.json');
  return spawnSync(executor, [
    '--protocol', 'LEADSPROUT_ATOMIC_SQL_V1',
    '--payload-sha256', sha256(payload)
  ], {
    encoding: 'utf8',
    input: payload,
    env: {
      ...process.env,
      TURSO_DATABASE_URL: 'libsql://synthetic.invalid',
      TURSO_AUTH_TOKEN: 'synthetic-token',
      LEADSPROUT_EXPECTED_DATABASE_URL_SHA256: sha256('libsql://synthetic.invalid'),
      LEADSPROUT_TURSO_SERVERLESS_MODULE: modulePath,
      LEADSPROUT_TURSO_SERVERLESS_MODULE_SHA256: sha256(fs.readFileSync(modulePath)),
      LEADSPROUT_TURSO_SERVERLESS_MANIFEST: manifestPath,
      LEADSPROUT_TURSO_SERVERLESS_MANIFEST_SHA256: sha256(fs.readFileSync(manifestPath)),
      LEADSPROUT_TURSO_SERVERLESS_VERSION: '0.2.2-test',
      LEADSPROUT_EXECUTOR_TEST_EVENT_LOG: eventLog,
      ...extraEnv
    }
  });
}

function events(filename) {
  return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8').trim().split('\n') : [];
}

function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leadsprout-turso-executor-'));
  const executor = path.resolve(__dirname, 'backend/scripts/turso_atomic_migration_executor.mjs');
  const modulePath = path.join(directory, 'serverless.mjs');
  const eventLog = path.join(directory, 'events.log');
  const moduleSource = `
import fs from 'node:fs';
const log = value => fs.appendFileSync(process.env.LEADSPROUT_EXECUTOR_TEST_EVENT_LOG, value + '\\n');
export class Session {
  constructor(config) {
    if (config.url !== 'libsql://synthetic.invalid' || config.authToken !== 'synthetic-token') throw new Error('config');
    this.foreignKeys = 1;
  }
  async sequence(sql) {
    log('sequence:' + sql.replace(/\\s+/g, ' ').trim());
    if (sql === 'PRAGMA foreign_keys = OFF') this.foreignKeys = 0;
    if (sql === 'PRAGMA foreign_keys = ON' && process.env.LEADSPROUT_EXECUTOR_TEST_FAIL_RESTORE !== 'true') this.foreignKeys = 1;
    if (process.env.LEADSPROUT_EXECUTOR_TEST_FAIL_BODY === 'true' && sql.includes('CREATE TABLE repair')) {
      throw new Error('injected');
    }
  }
  async execute(sql) {
    log('execute:' + sql);
    return { rows: [{ foreign_keys: this.foreignKeys }] };
  }
  async close() {
    log('close');
    if (process.env.LEADSPROUT_EXECUTOR_TEST_FAIL_CLOSE === 'true') throw new Error('close');
  }
}
`;
  fs.writeFileSync(modulePath, moduleSource);
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
    name: '@tursodatabase/serverless',
    version: '0.2.2-test',
    type: 'module'
  }));
  const payload = `PRAGMA foreign_keys = OFF;\nBEGIN IMMEDIATE;\nCREATE TABLE repair(id INTEGER);\nINSERT INTO repair VALUES (1);\nCOMMIT;\nPRAGMA foreign_keys = ON;`;

  let result = runExecutor(executor, modulePath, eventLog, payload);
  assert.strictEqual(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.strictEqual(receipt.status, 'COMMITTED');
  assert.strictEqual(receipt.payload_sha256, sha256(payload));
  assert.deepStrictEqual(events(eventLog), [
    'sequence:PRAGMA foreign_keys = OFF',
    'execute:PRAGMA foreign_keys',
    'sequence:BEGIN IMMEDIATE',
    'sequence:CREATE TABLE repair(id INTEGER); INSERT INTO repair VALUES (1);',
    'sequence:COMMIT',
    'sequence:PRAGMA foreign_keys = ON',
    'execute:PRAGMA foreign_keys',
    'close'
  ]);

  fs.rmSync(eventLog, { force: true });
  for (const migration of migrationInventory().slice(6)) {
    fs.rmSync(eventLog, { force: true });
    const migrationPayload = buildIncrementalTransaction({
      migration,
      revision: 'a'.repeat(40),
      target: 'synthetic-target',
      operator: 'synthetic-operator',
      startedAt: '2026-08-02T12:00:00.000Z'
    });
    result = runExecutor(executor, modulePath, eventLog, migrationPayload);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).payload_sha256, sha256(migrationPayload));
  }

  fs.rmSync(eventLog, { force: true });
  result = runExecutor(executor, modulePath, eventLog, payload, {
    LEADSPROUT_EXECUTOR_TEST_FAIL_BODY: 'true'
  });
  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.stdout, '');
  assert.deepStrictEqual(events(eventLog), [
    'sequence:PRAGMA foreign_keys = OFF',
    'execute:PRAGMA foreign_keys',
    'sequence:BEGIN IMMEDIATE',
    'sequence:CREATE TABLE repair(id INTEGER); INSERT INTO repair VALUES (1);',
    'sequence:ROLLBACK',
    'sequence:PRAGMA foreign_keys = ON',
    'execute:PRAGMA foreign_keys',
    'close'
  ]);

  fs.rmSync(eventLog, { force: true });
  result = runExecutor(executor, modulePath, eventLog, payload, {
    LEADSPROUT_EXECUTOR_TEST_FAIL_RESTORE: 'true'
  });
  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.stdout, '');
  assert.ok(events(eventLog).includes('close'));

  fs.rmSync(eventLog, { force: true });
  result = runExecutor(executor, modulePath, eventLog, payload, {
    LEADSPROUT_EXECUTOR_TEST_FAIL_CLOSE: 'true'
  });
  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.stdout, '');
  assert.ok(events(eventLog).includes('close'));

  result = runExecutor(executor, modulePath, eventLog, payload, {
    LEADSPROUT_EXPECTED_DATABASE_URL_SHA256: '0'.repeat(64)
  });
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /EXECUTOR_TARGET_INVALID/);
  result = runExecutor(executor, modulePath, eventLog, payload, {
    LEADSPROUT_TURSO_SERVERLESS_MODULE_SHA256: '0'.repeat(64)
  });
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /EXECUTOR_SERVERLESS_MODULE_INVALID/);
  result = runExecutor(executor, modulePath, eventLog, payload, {
    LEADSPROUT_TURSO_SERVERLESS_VERSION: 'substituted-version'
  });
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /EXECUTOR_SERVERLESS_MODULE_INVALID/);
  fs.rmSync(directory, { recursive: true, force: true });
  console.log('PASS Turso serverless atomic migration executor success, rollback, restoration and close');
}

run();
