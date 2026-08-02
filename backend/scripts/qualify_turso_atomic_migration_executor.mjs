#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const {
  buildControlledTransaction,
  buildIncrementalTransaction,
  executeTeamDb,
  predecessorBaseSchema,
  requireForeignKeyIntegrity,
  PROTECTED_V1_TARGET_ID
} = require('./apply_migrations');
const {
  EXPECTED_SCHEMA_MANIFEST,
  FINAL_TRIGGER_NAMES,
  migrationInventory,
  PREDECESSOR_BASE_SCHEMA_MANIFEST,
  verifyStructuralSchema
} = require('./verify_schema');
const { legacyDefinitions } = require('../../test_v1_contract_alignment_forward_repair');

const APPROVAL = 'AUTHORIZED_DISPOSABLE_ONLY';
const PROTECTED_HOST = 'agent-team-2d88b7d5-cto.aws-us-west-2.turso.io';
const SERVERLESS_VERSION = '0.2.2';
const GUARD_ARTIFACTS = Object.freeze([
  'preference_retention_forward_repair_guard',
  'preference_retention_cases_forward_repair',
  'v1_contract_alignment_guard',
  'opportunity_workspaces_contract_repair',
  'opportunity_selection_decisions_contract_repair',
  'opportunity_contact_verification_snapshots_contract_repair',
  'preference_retention_cases_contract_repair',
  'preference_retention_holds_contract_repair'
]);

function stop(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function configuredTarget() {
  if (process.env.LEADSPROUT_DISPOSABLE_QUALIFICATION !== APPROVAL) {
    stop('QUALIFICATION_APPROVAL_REQUIRED');
  }
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  const disposableId = process.env.LEADSPROUT_DISPOSABLE_DATABASE_ID;
  let parsed;
  try { parsed = new URL(url); } catch (_) { stop('QUALIFICATION_TARGET_INVALID'); }
  if (parsed.protocol !== 'libsql:' || parsed.username || parsed.password || !token ||
      !disposableId || disposableId === PROTECTED_V1_TARGET_ID ||
      parsed.hostname === PROTECTED_HOST) {
    stop('QUALIFICATION_TARGET_INVALID');
  }
  return Object.freeze({ url, token, disposableId, host: parsed.hostname });
}

async function configuredSession(target) {
  const modulePath = process.env.LEADSPROUT_TURSO_SERVERLESS_MODULE;
  const moduleDigest = process.env.LEADSPROUT_TURSO_SERVERLESS_MODULE_SHA256;
  const manifestPath = process.env.LEADSPROUT_TURSO_SERVERLESS_MANIFEST;
  const manifestDigest = process.env.LEADSPROUT_TURSO_SERVERLESS_MANIFEST_SHA256;
  if (!modulePath || !manifestPath || !path.isAbsolute(modulePath) ||
      !path.isAbsolute(manifestPath) || !/^[a-f0-9]{64}$/.test(moduleDigest || '') ||
      !/^[a-f0-9]{64}$/.test(manifestDigest || '')) {
    stop('QUALIFICATION_SERVERLESS_IDENTITY_INVALID');
  }
  let resolvedModule;
  let manifest;
  try {
    resolvedModule = fs.realpathSync(modulePath);
    const resolvedManifest = fs.realpathSync(manifestPath);
    const moduleBytes = fs.readFileSync(resolvedModule);
    const manifestBytes = fs.readFileSync(resolvedManifest);
    if (sha256(moduleBytes) !== moduleDigest || sha256(manifestBytes) !== manifestDigest) {
      stop('QUALIFICATION_SERVERLESS_IDENTITY_INVALID');
    }
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    if (error?.code === 'QUALIFICATION_SERVERLESS_IDENTITY_INVALID') throw error;
    stop('QUALIFICATION_SERVERLESS_IDENTITY_INVALID');
  }
  if (manifest.name !== '@tursodatabase/serverless' || manifest.version !== SERVERLESS_VERSION ||
      process.env.LEADSPROUT_TURSO_SERVERLESS_VERSION !== SERVERLESS_VERSION) {
    stop('QUALIFICATION_SERVERLESS_IDENTITY_INVALID');
  }
  const loaded = await import(pathToFileURL(resolvedModule).href);
  if (typeof loaded.Session !== 'function') stop('QUALIFICATION_SERVERLESS_IDENTITY_INVALID');
  return new loaded.Session({ url: target.url, authToken: target.token });
}

function plainRows(result) {
  if (!result || !Array.isArray(result.columns) || !Array.isArray(result.rows)) {
    stop('QUALIFICATION_RESULT_INVALID');
  }
  return result.rows.map(row => Object.fromEntries(
    result.columns.map((column, index) => [column, row[index]])
  ));
}

async function withSession(target, callback) {
  const session = await configuredSession(target);
  try {
    return await callback(session);
  } finally {
    await session.close().catch(() => undefined);
  }
}

async function rows(target, statement) {
  return withSession(target, async session => plainRows(await session.execute(statement)));
}

async function sequence(target, statement) {
  return withSession(target, async session => session.sequence(statement));
}

async function scalar(target, statement, field) {
  const result = await rows(target, statement);
  if (result.length !== 1 || !Object.prototype.hasOwnProperty.call(result[0], field)) {
    stop('QUALIFICATION_RESULT_INVALID');
  }
  return Number(result[0][field]);
}

async function schemaSnapshot(target) {
  return rows(target, `SELECT type,name,tbl_name,sql FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name,tbl_name,sql`);
}

async function assertFixture(target) {
  const ledgerCount = await scalar(target, 'SELECT COUNT(*) AS count FROM schema_migrations', 'count');
  const triggerCount = await scalar(target,
    "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger'", 'count');
  const guardCount = await scalar(target,
    `SELECT COUNT(*) AS count FROM sqlite_schema WHERE name IN (${GUARD_ARTIFACTS.map(name => `'${name}'`).join(',')})`,
    'count');
  if (ledgerCount !== 6) stop('QUALIFICATION_FIXTURE_LEDGER_INVALID');
  if (triggerCount !== 0) stop('QUALIFICATION_FIXTURE_TRIGGER_INVALID');
  if (guardCount !== 0) stop('QUALIFICATION_FIXTURE_GUARD_INVALID');
}

async function buildFixture(target, inventory) {
  const existing = await scalar(target, `SELECT COUNT(*) AS count FROM sqlite_schema
    WHERE name IN ('schema_migrations','users','leads','evidence_identities','opportunity_workspaces')`,
  'count');
  if (existing !== 0) stop('QUALIFICATION_TARGET_NOT_EMPTY');
  await sequence(target, predecessorBaseSchema().content);
  await sequence(target, buildControlledTransaction({
    inventory: inventory.slice(0, 6),
    revision: 'qualification-pre-007',
    target: target.disposableId,
    operator: 'bounded-qualification',
    startedAt: '2026-08-02T00:00:00.000Z'
  }));
  await sequence(target, `PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;
${legacyDefinitions()}
UPDATE schema_migrations SET outcome='ADOPTED';
COMMIT;
PRAGMA foreign_keys = ON;`);
  await withSession(target, async session => {
    for (const name of FINAL_TRIGGER_NAMES) {
      await session.sequence(`DROP TRIGGER IF EXISTS ${name};`);
    }
  });
  await assertFixture(target);
}

function migrationPayload(migration, target, content = migration.content) {
  return buildIncrementalTransaction({
    migration: { ...migration, content },
    revision: process.env.LEADSPROUT_QUALIFICATION_REVISION,
    target: target.disposableId,
    operator: 'bounded-qualification',
    startedAt: '2026-08-02T00:00:00.000Z'
  });
}

async function main() {
  const target = configuredTarget();
  if (!/^[a-f0-9]{40}$/.test(process.env.LEADSPROUT_QUALIFICATION_REVISION || '')) {
    stop('QUALIFICATION_REVISION_INVALID');
  }
  const inventory = migrationInventory();
  await buildFixture(target, inventory);
  const preFailure = await schemaSnapshot(target);
  const injected = `${inventory[6].content}\nSELECT * FROM __leadsprout_forced_rollback__;`;
  let rollbackObserved = false;
  try {
    executeTeamDb(migrationPayload(inventory[6], target, injected));
  } catch (error) {
    if (error?.code !== 'MIGRATION_ATOMIC_EXECUTION_FAILED') throw error;
    rollbackObserved = true;
  }
  if (!rollbackObserved) stop('QUALIFICATION_ROLLBACK_NOT_OBSERVED');
  await assertFixture(target);
  const postFailure = await schemaSnapshot(target);
  if (JSON.stringify(postFailure) !== JSON.stringify(preFailure)) {
    stop('QUALIFICATION_ROLLBACK_MISMATCH');
  }

  const receipt007 = executeTeamDb(migrationPayload(inventory[6], target));
  const receipt008 = executeTeamDb(migrationPayload(inventory[7], target));
  const query = Object.freeze({ all: statement => rows(target, statement) });
  await verifyStructuralSchema(query, EXPECTED_SCHEMA_MANIFEST);
  await requireForeignKeyIntegrity(query, EXPECTED_SCHEMA_MANIFEST);

  const ledger = await rows(target,
    'SELECT migration_id,filename,sequence,checksum,outcome FROM schema_migrations ORDER BY sequence');
  const triggers = (await rows(target,
    "SELECT name FROM sqlite_schema WHERE type='trigger' ORDER BY name")).map(row => row.name);
  const guardCount = await scalar(target,
    `SELECT COUNT(*) AS count FROM sqlite_schema WHERE name IN (${GUARD_ARTIFACTS.map(name => `'${name}'`).join(',')})`,
    'count');
  if (ledger.length !== 8 || ledger.some((row, index) =>
      row.migration_id !== inventory[index].migration_id ||
      row.filename !== inventory[index].filename || Number(row.sequence) !== index + 1 ||
      row.checksum !== inventory[index].checksum ||
      (index < 6 ? row.outcome !== 'ADOPTED' : row.outcome !== 'COMPLETED')) ||
      JSON.stringify(triggers) !== JSON.stringify([...FINAL_TRIGGER_NAMES].sort()) || guardCount !== 0) {
    stop('QUALIFICATION_POSTCONDITION_MISMATCH');
  }
  for (const receipt of [receipt007, receipt008]) {
    if (receipt.status !== 'COMMITTED' || receipt.foreign_keys_restored !== true ||
        receipt.connection_closed !== true) stop('QUALIFICATION_RECEIPT_INVALID');
  }
  console.log(JSON.stringify({
    classification: 'PASS_SAME_PROVIDER_EXECUTOR_QUALIFIED',
    revision: process.env.LEADSPROUT_QUALIFICATION_REVISION,
    disposable_database_id: target.disposableId,
    disposable_host: target.host,
    rollback_observed: true,
    retry_007_committed: true,
    migration_008_committed: true,
    ledger_count: ledger.length,
    trigger_names: triggers,
    guard_artifact_count: guardCount,
    foreign_key_violation_count: 0,
    receipts: [receipt007, receipt008].map(receipt => ({
      protocol: receipt.protocol,
      status: receipt.status,
      payload_sha256: receipt.payload_sha256,
      foreign_keys_restored: receipt.foreign_keys_restored,
      connection_closed: receipt.connection_closed
    }))
  }));
}

main().catch(error => {
  console.error(JSON.stringify({
    classification: 'STOP',
    code: error?.code || 'QUALIFICATION_UNEXPECTED_FAILURE'
  }));
  process.exitCode = 1;
});
