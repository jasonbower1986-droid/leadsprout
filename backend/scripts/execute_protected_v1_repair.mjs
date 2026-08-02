#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const {
  main: runMigrations,
  migrationManifestDigest,
  PROTECTED_V1_TARGET_ID,
  requireForeignKeyIntegrity,
  resolveRepositoryIdentity,
  validateAuthorization,
  validateCanonicalInventory,
  validateTargetConfigurationEvidence
} = require('./apply_migrations');
const {
  EXPECTED_SCHEMA_MANIFEST,
  FINAL_TRIGGER_NAMES,
  migrationInventory,
  verifyStructuralSchema
} = require('./verify_schema');
const {
  qualifyV1ContractAlignment
} = require('./qualify_v1_contract_alignment');

const APPROVAL = 'AUTHORIZED_PROTECTED_V1_007_008_WITH_PROVEN_RECOVERY';
const PROTECTED_HOST = 'agent-team-2d88b7d5-cto.aws-us-west-2.turso.io';
const SERVERLESS_VERSION = '0.2.2';
const EVIDENCE_VALIDITY_MS = 15 * 60 * 1000;
const QUALIFICATION_EVIDENCE_VALIDITY_MS = 4 * 60 * 60 * 1000;
const PROVIDER_CLASS = 'TURSO_LIBSQL_AWS_US_WEST_2';
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

function readJsonEvidence(reference, code) {
  if (!reference || !path.isAbsolute(reference)) stop(code);
  try {
    const resolved = fs.realpathSync(reference);
    const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) stop(code);
    return parsed;
  } catch (error) {
    if (error?.code === code) throw error;
    stop(code);
  }
}

function validFreshWindow(capturedAt, expiresAt, now = new Date()) {
  const captured = Date.parse(capturedAt);
  const expires = Date.parse(expiresAt);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  return Number.isFinite(captured) && Number.isFinite(expires) && Number.isFinite(current) &&
    expires > captured && expires - captured <= EVIDENCE_VALIDITY_MS &&
    current >= captured && current < expires;
}

function validBoundedWindow(capturedAt, expiresAt, maximumValidityMs, now = new Date()) {
  const captured = Date.parse(capturedAt);
  const expires = Date.parse(expiresAt);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  return Number.isFinite(captured) && Number.isFinite(expires) && Number.isFinite(current) &&
    expires > captured && expires - captured <= maximumValidityMs &&
    current >= captured && current < expires;
}

function validateRecoveryEvidence(evidence, now = new Date()) {
  if (evidence.target_id !== PROTECTED_V1_TARGET_ID || evidence.verified !== true ||
      evidence.restoration_rehearsed !== true ||
      !/^[a-f0-9]{64}$/.test(evidence.backup_sha256 || '') ||
      typeof evidence.backup_id !== 'string' || !evidence.backup_id.trim() ||
      typeof evidence.provider !== 'string' || !evidence.provider.trim() ||
      typeof evidence.restore_target_id !== 'string' || !evidence.restore_target_id.trim() ||
      evidence.restore_target_id === PROTECTED_V1_TARGET_ID ||
      typeof evidence.restore_rehearsal_reference !== 'string' ||
      !evidence.restore_rehearsal_reference.trim() ||
      !validFreshWindow(evidence.captured_at, evidence.expires_at, now)) {
    stop('PROTECTED_RECOVERY_EVIDENCE_REQUIRED');
  }
  return Object.freeze({ ...evidence });
}

function validateTrafficEvidence(evidence, authorityReference, now = new Date()) {
  if (evidence.target_id !== PROTECTED_V1_TARGET_ID || evidence.verified !== true ||
      evidence.customer_writes_paused !== true ||
      evidence.authority_reference !== authorityReference ||
      typeof evidence.provider_resource_id !== 'string' || !evidence.provider_resource_id.trim() ||
      !validFreshWindow(evidence.captured_at, evidence.expires_at, now)) {
    stop('PROTECTED_TRAFFIC_QUIESCENCE_REQUIRED');
  }
  return Object.freeze({ ...evidence });
}

function validateDisposableQualificationEvidence(evidence, identity, inventory, now = new Date()) {
  const requiredKeys = [
    'adapter_identity',
    'canonical_migration_manifest_sha256',
    'captured_at',
    'classification',
    'disposable_credential_revoked',
    'disposable_database_deleted',
    'disposable_database_id',
    'disposable_host',
    'executor_sha256',
    'expires_at',
    'foreign_key_violation_count',
    'guard_artifact_count',
    'ledger_count',
    'migration_008_committed',
    'provider',
    'provider_class',
    'retry_007_committed',
    'revision',
    'rollback_observed',
    'runtime_identity',
    'serverless_manifest_sha256',
    'serverless_module_sha256',
    'test_payload_sha256'
  ];
  let parsedHost;
  try { parsedHost = new URL(`https://${evidence.disposable_host}`); } catch (_) {
    stop('PROTECTED_DISPOSABLE_QUALIFICATION_REQUIRED');
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) ||
      Object.keys(evidence).sort().join('|') !== requiredKeys.sort().join('|') ||
      evidence.classification !== 'PASS_SAME_PROVIDER_EXECUTOR_QUALIFIED' ||
      evidence.revision !== identity.revision || evidence.provider !== 'Turso' ||
      evidence.provider_class !== PROVIDER_CLASS ||
      typeof evidence.disposable_database_id !== 'string' ||
      !evidence.disposable_database_id.trim() ||
      evidence.disposable_database_id === PROTECTED_V1_TARGET_ID ||
      parsedHost.protocol !== 'https:' || parsedHost.username || parsedHost.password ||
      parsedHost.hostname !== evidence.disposable_host ||
      parsedHost.hostname === PROTECTED_HOST ||
      !parsedHost.hostname.endsWith('.aws-us-west-2.turso.io') ||
      evidence.rollback_observed !== true || evidence.retry_007_committed !== true ||
      evidence.migration_008_committed !== true || evidence.ledger_count !== 8 ||
      evidence.guard_artifact_count !== 0 || evidence.foreign_key_violation_count !== 0 ||
      evidence.disposable_database_deleted !== true ||
      evidence.disposable_credential_revoked !== true ||
      evidence.canonical_migration_manifest_sha256 !== migrationManifestDigest(inventory).sha256 ||
      !/^[a-f0-9]{64}$/.test(evidence.executor_sha256 || '') ||
      evidence.executor_sha256 !== process.env.LEADSPROUT_ATOMIC_MIGRATION_EXECUTOR_SHA256 ||
      !/^[a-f0-9]{64}$/.test(evidence.serverless_module_sha256 || '') ||
      evidence.serverless_module_sha256 !== process.env.LEADSPROUT_TURSO_SERVERLESS_MODULE_SHA256 ||
      !/^[a-f0-9]{64}$/.test(evidence.serverless_manifest_sha256 || '') ||
      evidence.serverless_manifest_sha256 !== process.env.LEADSPROUT_TURSO_SERVERLESS_MANIFEST_SHA256 ||
      typeof evidence.adapter_identity !== 'string' || !evidence.adapter_identity.trim() ||
      typeof evidence.runtime_identity !== 'string' || !evidence.runtime_identity.trim() ||
      !/^[a-f0-9]{64}$/.test(evidence.test_payload_sha256 || '') ||
      !validBoundedWindow(
        evidence.captured_at,
        evidence.expires_at,
        QUALIFICATION_EVIDENCE_VALIDITY_MS,
        now
      )) {
    stop('PROTECTED_DISPOSABLE_QUALIFICATION_REQUIRED');
  }
  return Object.freeze({ ...evidence });
}

function jwtValidityWindow(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) stop('PROTECTED_MIGRATION_CREDENTIAL_EVIDENCE_REQUIRED');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.exp <= claims.iat) {
      stop('PROTECTED_MIGRATION_CREDENTIAL_EVIDENCE_REQUIRED');
    }
    return Object.freeze({ issuedAt: claims.iat * 1000, expiresAt: claims.exp * 1000 });
  } catch (error) {
    if (error?.code === 'PROTECTED_MIGRATION_CREDENTIAL_EVIDENCE_REQUIRED') throw error;
    stop('PROTECTED_MIGRATION_CREDENTIAL_EVIDENCE_REQUIRED');
  }
}

function validateMigrationCredentialEvidence(
  evidence,
  target,
  ordinaryRuntimeToken,
  authorityReference,
  now = new Date()
) {
  const requiredKeys = [
    'authorization',
    'authority_reference',
    'authoritative_source_reference',
    'database_scoped',
    'expires_at',
    'issued_at',
    'least_privilege',
    'permits_data_change',
    'permits_schema_change',
    'provider',
    'separate_from_ordinary_runtime_credentials',
    'target_id',
    'time_bounded',
    'verified'
  ];
  const jwtWindow = jwtValidityWindow(target.token);
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) ||
      Object.keys(evidence).sort().join('|') !== requiredKeys.sort().join('|') ||
      evidence.target_id !== PROTECTED_V1_TARGET_ID || evidence.provider !== 'Turso' ||
      evidence.authority_reference !== authorityReference ||
      evidence.authorization !== 'database-full-access' || evidence.database_scoped !== true ||
      evidence.permits_schema_change !== true || evidence.permits_data_change !== true ||
      evidence.least_privilege !== true || evidence.time_bounded !== true ||
      evidence.separate_from_ordinary_runtime_credentials !== true || evidence.verified !== true ||
      typeof evidence.authoritative_source_reference !== 'string' ||
      !evidence.authoritative_source_reference.trim() ||
      target.token === ordinaryRuntimeToken ||
      Date.parse(evidence.issued_at) !== jwtWindow.issuedAt ||
      Date.parse(evidence.expires_at) !== jwtWindow.expiresAt ||
      !validBoundedWindow(evidence.issued_at, evidence.expires_at, EVIDENCE_VALIDITY_MS, now)) {
    stop('PROTECTED_MIGRATION_CREDENTIAL_EVIDENCE_REQUIRED');
  }
  return Object.freeze({ ...evidence });
}

function configuredTarget() {
  if (process.env.LEADSPROUT_PROTECTED_V1_REPAIR !== APPROVAL ||
      process.env.LEADSPROUT_PROTECTED_TARGET_ID !== PROTECTED_V1_TARGET_ID) {
    stop('PROTECTED_REPAIR_APPROVAL_REQUIRED');
  }
  const teamUrl = process.env.TEAM_DB_URL;
  const teamToken = process.env.TEAM_DB_AUTH_TOKEN;
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  let parsed;
  try { parsed = new URL(url); } catch (_) { stop('PROTECTED_REPAIR_TARGET_INVALID'); }
  if (parsed.protocol !== 'libsql:' || parsed.username || parsed.password ||
      parsed.hostname !== PROTECTED_HOST || !teamUrl || !teamToken || !token ||
      url !== teamUrl || token === teamToken ||
      !/^[a-f0-9]{64}$/.test(process.env.LEADSPROUT_EXPECTED_DATABASE_URL_SHA256 || '') ||
      sha256(url) !== process.env.LEADSPROUT_EXPECTED_DATABASE_URL_SHA256) {
    stop('PROTECTED_REPAIR_TARGET_INVALID');
  }
  return Object.freeze({ url, token, host: parsed.hostname, ordinaryRuntimeToken: teamToken });
}

async function configuredSession(target) {
  const modulePath = process.env.LEADSPROUT_TURSO_SERVERLESS_MODULE;
  const moduleDigest = process.env.LEADSPROUT_TURSO_SERVERLESS_MODULE_SHA256;
  const manifestPath = process.env.LEADSPROUT_TURSO_SERVERLESS_MANIFEST;
  const manifestDigest = process.env.LEADSPROUT_TURSO_SERVERLESS_MANIFEST_SHA256;
  if (!modulePath || !manifestPath || !path.isAbsolute(modulePath) ||
      !path.isAbsolute(manifestPath) || !/^[a-f0-9]{64}$/.test(moduleDigest || '') ||
      !/^[a-f0-9]{64}$/.test(manifestDigest || '')) {
    stop('PROTECTED_REPAIR_SERVERLESS_IDENTITY_INVALID');
  }
  let resolvedModule;
  let manifest;
  try {
    resolvedModule = fs.realpathSync(modulePath);
    const resolvedManifest = fs.realpathSync(manifestPath);
    const moduleBytes = fs.readFileSync(resolvedModule);
    const manifestBytes = fs.readFileSync(resolvedManifest);
    if (sha256(moduleBytes) !== moduleDigest || sha256(manifestBytes) !== manifestDigest) {
      stop('PROTECTED_REPAIR_SERVERLESS_IDENTITY_INVALID');
    }
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    if (error?.code === 'PROTECTED_REPAIR_SERVERLESS_IDENTITY_INVALID') throw error;
    stop('PROTECTED_REPAIR_SERVERLESS_IDENTITY_INVALID');
  }
  if (manifest.name !== '@tursodatabase/serverless' || manifest.version !== SERVERLESS_VERSION ||
      process.env.LEADSPROUT_TURSO_SERVERLESS_VERSION !== SERVERLESS_VERSION) {
    stop('PROTECTED_REPAIR_SERVERLESS_IDENTITY_INVALID');
  }
  const loaded = await import(pathToFileURL(resolvedModule).href);
  if (typeof loaded.Session !== 'function') stop('PROTECTED_REPAIR_SERVERLESS_IDENTITY_INVALID');
  return new loaded.Session({ url: target.url, authToken: target.token });
}

function plainRows(result) {
  if (!result || !Array.isArray(result.columns) || !Array.isArray(result.rows)) {
    stop('PROTECTED_REPAIR_RESULT_INVALID');
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

async function schemaSnapshot(target) {
  return rows(target, `SELECT type,name,tbl_name,sql FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name,tbl_name,sql`);
}

async function scalar(target, statement, field) {
  const result = await rows(target, statement);
  if (result.length !== 1 || !Object.prototype.hasOwnProperty.call(result[0], field)) {
    stop('PROTECTED_REPAIR_RESULT_INVALID');
  }
  return Number(result[0][field]);
}

async function exactPreflight(target, authorization, inventory) {
  const query = Object.freeze({ all: statement => rows(target, statement) });
  const qualification = await qualifyV1ContractAlignment(query);
  const snapshot = await schemaSnapshot(target);
  return Object.freeze({
    evidence: Object.freeze({
      target_id: PROTECTED_V1_TARGET_ID,
      target_class: 'PROTECTED_V1',
      verified: true,
      schema_sha256: sha256(JSON.stringify(snapshot)),
      authority_reference: authorization.authority_reference,
      canonical_migration_manifest_sha256: migrationManifestDigest(inventory).sha256
    }),
    qualification,
    snapshot
  });
}

async function verifyFinalState(target, inventory) {
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
    stop('PROTECTED_REPAIR_POSTCONDITION_MISMATCH');
  }
  return Object.freeze({ ledger, triggers, guardCount });
}

async function main(clock = () => new Date()) {
  const initialNow = clock();
  const rawAuthorization = readJsonEvidence(
    process.env.LEADSPROUT_MIGRATION_AUTHORIZATION_EVIDENCE,
    'PROTECTED_REPAIR_AUTHORIZATION_REQUIRED'
  );
  const inventory = migrationInventory();
  const identity = resolveRepositoryIdentity();
  const controlValues = {
    target: PROTECTED_V1_TARGET_ID,
    'authority-reference': rawAuthorization.authority_reference,
    'execution-context': rawAuthorization.execution_context
  };
  const authorization = validateAuthorization(
    rawAuthorization,
    identity,
    controlValues,
    initialNow
  );
  const manifest = validateCanonicalInventory(inventory);
  if (authorization.canonical_migration_manifest_sha256 !== manifest.sha256) {
    stop('PROTECTED_REPAIR_MANIFEST_AUTHORITY_MISMATCH');
  }
  const recovery = validateRecoveryEvidence(readJsonEvidence(
    process.env.LEADSPROUT_RECOVERY_EVIDENCE,
    'PROTECTED_RECOVERY_EVIDENCE_REQUIRED'
  ), initialNow);
  const trafficEvidence = readJsonEvidence(
    process.env.LEADSPROUT_TRAFFIC_QUIESCENCE_EVIDENCE,
    'PROTECTED_TRAFFIC_QUIESCENCE_REQUIRED'
  );
  validateTrafficEvidence(trafficEvidence, authorization.authority_reference, initialNow);
  const targetConfiguration = readJsonEvidence(
    process.env.LEADSPROUT_TARGET_CONFIGURATION_EVIDENCE,
    'PROTECTED_TARGET_CONFIGURATION_REQUIRED'
  );
  validateTargetConfigurationEvidence(
    targetConfiguration,
    authorization,
    PROTECTED_V1_TARGET_ID,
    initialNow
  );
  const target = configuredTarget();
  const disposableQualification = validateDisposableQualificationEvidence(readJsonEvidence(
    process.env.LEADSPROUT_DISPOSABLE_QUALIFICATION_EVIDENCE,
    'PROTECTED_DISPOSABLE_QUALIFICATION_REQUIRED'
  ), identity, inventory, initialNow);
  const migrationCredential = validateMigrationCredentialEvidence(readJsonEvidence(
    process.env.LEADSPROUT_MIGRATION_CREDENTIAL_EVIDENCE,
    'PROTECTED_MIGRATION_CREDENTIAL_EVIDENCE_REQUIRED'
  ), target, target.ordinaryRuntimeToken, authorization.authority_reference, initialNow);
  const revision = process.env.LEADSPROUT_QUALIFICATION_REVISION;
  if (!/^[a-f0-9]{40}$/.test(revision || '') || revision !== identity.revision) {
    stop('PROTECTED_REPAIR_REVISION_INVALID');
  }
  const before = await exactPreflight(target, authorization, inventory);
  const qualification = Object.freeze({
    target_class: 'PROTECTED_V1',
    rollback_verified: true,
    adapter_identity: disposableQualification.adapter_identity,
    runtime_identity: disposableQualification.runtime_identity,
    test_payload_sha256: disposableQualification.test_payload_sha256
  });
  const writeNow = clock();
  validateRecoveryEvidence(recovery, writeNow);
  validateTrafficEvidence(trafficEvidence, authorization.authority_reference, writeNow);
  validateMigrationCredentialEvidence(
    migrationCredential,
    target,
    target.ordinaryRuntimeToken,
    authorization.authority_reference,
    writeNow
  );
  const args = [
    '--target', PROTECTED_V1_TARGET_ID,
    '--operator', 'cto-protected-v1-repair',
    '--execution-context', authorization.execution_context,
    '--authority-reference', authorization.authority_reference,
    '--acknowledge-no-lifecycle', 'true'
  ];
  const migrationResult = await runMigrations(args, {
    authorization,
    backup: recovery,
    preflight: before.evidence,
    qualification,
    targetConfiguration,
    now: writeNow
  });
  const final = await verifyFinalState(target, inventory);
  console.log(JSON.stringify({
    classification: 'PASS_PROTECTED_V1_007_008_COMPLETED',
    revision,
    target_id: PROTECTED_V1_TARGET_ID,
    protected_host: target.host,
    disposable_qualification_verified: true,
    dedicated_migration_credential_verified: true,
    recovery_verified: true,
    traffic_quiesced: true,
    migrations_status: migrationResult.status,
    ledger_count: final.ledger.length,
    trigger_names: final.triggers,
    guard_artifact_count: final.guardCount,
    foreign_key_violation_count: 0
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(JSON.stringify({
      classification: 'STOP',
      code: error?.code || 'PROTECTED_REPAIR_UNEXPECTED_FAILURE'
    }));
    process.exitCode = 1;
  });
}

export {
  APPROVAL,
  EVIDENCE_VALIDITY_MS,
  PROVIDER_CLASS,
  PROTECTED_HOST,
  QUALIFICATION_EVIDENCE_VALIDITY_MS,
  validFreshWindow,
  validateDisposableQualificationEvidence,
  validateMigrationCredentialEvidence,
  validateRecoveryEvidence,
  validateTrafficEvidence
};
