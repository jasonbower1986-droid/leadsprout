const fs = require('fs');
const crypto = require('crypto');

const PROFILE = 'LEADSPROUT_EVIDENCE_AUTHORITY_V1';
const STORE_ID = 'EVIDENCE_IDENTITY';

function configurationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function readConfiguration() {
  const filename = process.env.EVIDENCE_INTEGRITY_AUTHORITY_STORE;
  if (!filename) throw configurationError('INTEGRITY_AUTHORITY_STORE_REQUIRED');
  let value;
  try {
    const stat = fs.statSync(filename);
    if (!stat.isFile()) throw new Error('not a file');
    value = JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (_) {
    throw configurationError('INTEGRITY_AUTHORITY_STORE_INVALID');
  }
  if (!value || value.profile !== PROFILE || value.store_id !== STORE_ID ||
      !Array.isArray(value.public_keys) || !Array.isArray(value.attestations)) {
    throw configurationError('INTEGRITY_AUTHORITY_STORE_INVALID');
  }
  return value;
}

function loadSnapshot() {
  const value = readConfiguration();
  const keys = new Map();
  for (const entry of value.public_keys) {
    if (!entry || typeof entry.key_id !== 'string' || !entry.key_id ||
        typeof entry.public_key_pem !== 'string' || /PRIVATE KEY/.test(entry.public_key_pem) ||
        keys.has(entry.key_id)) {
      throw configurationError('INTEGRITY_AUTHORITY_STORE_INVALID');
    }
    let key;
    try {
      key = crypto.createPublicKey(entry.public_key_pem);
    } catch (_) {
      throw configurationError('INTEGRITY_AUTHORITY_STORE_INVALID');
    }
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
      throw configurationError('INTEGRITY_AUTHORITY_STORE_INVALID');
    }
    keys.set(entry.key_id, key);
  }

  const attestations = new Map();
  const sequences = new Set();
  let latest = null;
  for (const entry of value.attestations) {
    if (!entry || entry.store_id !== STORE_ID || typeof entry.checkpoint_id !== 'string' ||
        !entry.checkpoint_id || !Number.isInteger(entry.sequence) || entry.sequence < 1 ||
        typeof entry.key_id !== 'string' || !keys.has(entry.key_id) ||
        attestations.has(entry.checkpoint_id) || sequences.has(entry.sequence)) {
      throw configurationError('INTEGRITY_AUTHORITY_STORE_INVALID');
    }
    const frozen = Object.freeze({ ...entry });
    attestations.set(entry.checkpoint_id, frozen);
    sequences.add(entry.sequence);
    if (!latest || frozen.sequence > latest.sequence) latest = frozen;
  }
  if (attestations.size && (!latest || latest.sequence !== attestations.size ||
      [...sequences].some(sequence => sequence > attestations.size))) {
    throw configurationError('INTEGRITY_AUTHORITY_STORE_INVALID');
  }
  return Object.freeze({ keys, attestations, latest });
}

const authority = Object.freeze({
  async latest(storeId) {
    if (storeId !== STORE_ID) return null;
    return loadSnapshot().latest;
  },
  async checkpoint(checkpointId) {
    return loadSnapshot().attestations.get(checkpointId) || null;
  },
  async publicKey(keyId) {
    return loadSnapshot().keys.get(keyId) || null;
  },
  async attest() {
    throw configurationError('INTEGRITY_AUTHORITY_READ_ONLY');
  }
});

module.exports = { PROFILE, STORE_ID, authority, loadSnapshot };
