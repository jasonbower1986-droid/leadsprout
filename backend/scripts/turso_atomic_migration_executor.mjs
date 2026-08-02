#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const PROTOCOL = 'LEADSPROUT_ATOMIC_SQL_V1';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseArguments(args) {
  if (args.length !== 4 || args[0] !== '--protocol' || args[2] !== '--payload-sha256' ||
      args[1] !== PROTOCOL || !/^[a-f0-9]{64}$/.test(args[3])) {
    fail('EXECUTOR_ARGUMENTS_INVALID');
  }
  return Object.freeze({ protocol: args[1], payloadSha256: args[3] });
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const payload = Buffer.concat(chunks).toString('utf8');
  if (!payload) fail('EXECUTOR_PAYLOAD_MISSING');
  return payload;
}

function transactionBody(payload) {
  const prefix = 'PRAGMA foreign_keys = OFF;\nBEGIN IMMEDIATE;\n';
  const suffix = '\nCOMMIT;\nPRAGMA foreign_keys = ON;';
  if (!payload.startsWith(prefix) || !payload.endsWith(suffix)) {
    fail('EXECUTOR_PAYLOAD_ENVELOPE_INVALID');
  }
  const body = payload.slice(prefix.length, -suffix.length);
  if (!body.trim() || /^\s*(?:BEGIN\s+(?:IMMEDIATE|DEFERRED|EXCLUSIVE|TRANSACTION)|COMMIT|ROLLBACK)(?:\s|;)/im.test(body) ||
      /^\s*PRAGMA\s+foreign_keys\b/im.test(body)) {
    fail('EXECUTOR_PAYLOAD_ENVELOPE_INVALID');
  }
  return body;
}

function configuredModule() {
  const reference = process.env.LEADSPROUT_TURSO_SERVERLESS_MODULE;
  const expectedSha256 = process.env.LEADSPROUT_TURSO_SERVERLESS_MODULE_SHA256;
  const manifestReference = process.env.LEADSPROUT_TURSO_SERVERLESS_MANIFEST;
  const expectedManifestSha256 = process.env.LEADSPROUT_TURSO_SERVERLESS_MANIFEST_SHA256;
  const expectedVersion = process.env.LEADSPROUT_TURSO_SERVERLESS_VERSION;
  if (!reference || !path.isAbsolute(reference) || !/^[a-f0-9]{64}$/.test(expectedSha256 || '')) {
    fail('EXECUTOR_SERVERLESS_MODULE_REQUIRED');
  }
  let resolved;
  let content;
  try {
    resolved = fs.realpathSync(reference);
    if (!fs.statSync(resolved).isFile()) fail('EXECUTOR_SERVERLESS_MODULE_INVALID');
    content = fs.readFileSync(resolved);
  } catch (error) {
    if (error?.code === 'EXECUTOR_SERVERLESS_MODULE_INVALID') throw error;
    fail('EXECUTOR_SERVERLESS_MODULE_INVALID');
  }
  if (sha256(content) !== expectedSha256) fail('EXECUTOR_SERVERLESS_MODULE_INVALID');
  let manifest;
  try {
    if (!manifestReference || !path.isAbsolute(manifestReference) ||
        !/^[a-f0-9]{64}$/.test(expectedManifestSha256 || '') || !expectedVersion) {
      fail('EXECUTOR_SERVERLESS_MODULE_REQUIRED');
    }
    const manifestPath = fs.realpathSync(manifestReference);
    const manifestContent = fs.readFileSync(manifestPath);
    if (sha256(manifestContent) !== expectedManifestSha256) fail('EXECUTOR_SERVERLESS_MODULE_INVALID');
    manifest = JSON.parse(manifestContent.toString('utf8'));
  } catch (error) {
    if (['EXECUTOR_SERVERLESS_MODULE_REQUIRED', 'EXECUTOR_SERVERLESS_MODULE_INVALID'].includes(error?.code)) {
      throw error;
    }
    fail('EXECUTOR_SERVERLESS_MODULE_INVALID');
  }
  if (manifest.name !== '@tursodatabase/serverless' || manifest.version !== expectedVersion) {
    fail('EXECUTOR_SERVERLESS_MODULE_INVALID');
  }
  return resolved;
}

function configuredTarget() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  const expectedUrlSha256 = process.env.LEADSPROUT_EXPECTED_DATABASE_URL_SHA256;
  let parsed;
  try { parsed = new URL(url); } catch (_) { fail('EXECUTOR_TARGET_INVALID'); }
  if (parsed.protocol !== 'libsql:' || parsed.username || parsed.password ||
      typeof authToken !== 'string' || !authToken ||
      !/^[a-f0-9]{64}$/.test(expectedUrlSha256 || '') || sha256(url) !== expectedUrlSha256) {
    fail('EXECUTOR_TARGET_INVALID');
  }
  return Object.freeze({ url, authToken });
}

function foreignKeyValue(result) {
  const rows = Array.isArray(result) ? result : result?.rows;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  const value = row?.foreign_keys ?? row?.[0];
  return Number(value);
}

async function setForeignKeys(session, enabled) {
  await session.sequence(`PRAGMA foreign_keys = ${enabled ? 'ON' : 'OFF'}`);
  const result = await session.execute('PRAGMA foreign_keys');
  if (foreignKeyValue(result) !== (enabled ? 1 : 0)) fail('EXECUTOR_FOREIGN_KEYS_STATE_INVALID');
}

async function execute() {
  const args = parseArguments(process.argv.slice(2));
  const payload = await readStdin();
  if (sha256(payload) !== args.payloadSha256) fail('EXECUTOR_PAYLOAD_DIGEST_MISMATCH');
  const body = transactionBody(payload);
  const modulePath = configuredModule();
  const target = configuredTarget();
  const loaded = await import(pathToFileURL(modulePath).href);
  if (typeof loaded.Session !== 'function') fail('EXECUTOR_SERVERLESS_MODULE_INVALID');

  const session = new loaded.Session({ url: target.url, authToken: target.authToken });
  let transactionStarted = false;
  let committed = false;
  let foreignKeysRestored = false;
  let connectionClosed = false;
  try {
    await setForeignKeys(session, false);
    await session.sequence('BEGIN IMMEDIATE');
    transactionStarted = true;
    await session.sequence(body);
    await session.sequence('COMMIT');
    committed = true;
    transactionStarted = false;
    await setForeignKeys(session, true);
    foreignKeysRestored = true;
  } catch (error) {
    if (transactionStarted && !committed) {
      try { await session.sequence('ROLLBACK'); } catch (_) {}
    }
    try {
      await setForeignKeys(session, true);
      foreignKeysRestored = true;
    } catch (_) {}
    throw error;
  } finally {
    try {
      await session.close();
      connectionClosed = true;
    } catch (_) {}
  }
  if (!committed || !foreignKeysRestored || !connectionClosed) fail('EXECUTOR_COMPLETION_INVALID');
  process.stdout.write(JSON.stringify({
    protocol: PROTOCOL,
    status: 'COMMITTED',
    payload_sha256: args.payloadSha256,
    foreign_keys_restored: true,
    connection_closed: true
  }));
}

execute().catch(error => {
  process.stderr.write(`${error?.code || 'EXECUTOR_FAILED'}\n`);
  process.exitCode = 1;
});
