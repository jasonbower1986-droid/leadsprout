const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const PROFILE = 'LEADSPROUT_PROVENANCE_AUTHORITY_V1';
const REQUIRED_FIELDS = Object.freeze([
  'provenance_record_id',
  'subject_business_id',
  'source_namespace',
  'source_locator',
  'observed_at',
  'content_sha256',
  'source_profile_version'
]);

function configurationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function loadRecords(options = {}) {
  const env = options.env || process.env;
  const filename = env.EVIDENCE_PROVENANCE_AUTHORITY_STORE;
  const expectedSha256 = env.EVIDENCE_PROVENANCE_AUTHORITY_STORE_SHA256;
  if (!filename || !path.isAbsolute(filename)) {
    throw configurationError('PROVENANCE_AUTHORITY_STORE_REQUIRED');
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 || '')) {
    throw configurationError('PROVENANCE_AUTHORITY_STORE_DIGEST_REQUIRED');
  }
  let value;
  try {
    const stat = fs.statSync(filename);
    if (!stat.isFile()) throw new Error('not a file');
    const bytes = fs.readFileSync(filename);
    const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== expectedSha256) {
      throw configurationError('PROVENANCE_AUTHORITY_STORE_DIGEST_MISMATCH');
    }
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    if (error?.code === 'PROVENANCE_AUTHORITY_STORE_DIGEST_MISMATCH') throw error;
    throw configurationError('PROVENANCE_AUTHORITY_STORE_INVALID');
  }
  if (!value || value.profile !== PROFILE || !Array.isArray(value.records)) {
    throw configurationError('PROVENANCE_AUTHORITY_STORE_INVALID');
  }
  const records = new Map();
  for (const record of value.records) {
    if (!record || REQUIRED_FIELDS.some(field => typeof record[field] !== 'string' || !record[field]) ||
        !/^[a-f0-9]{64}$/.test(record.content_sha256) ||
        !Number.isFinite(Date.parse(record.observed_at)) ||
        records.has(record.provenance_record_id)) {
      throw configurationError('PROVENANCE_AUTHORITY_STORE_INVALID');
    }
    records.set(record.provenance_record_id, Object.freeze({ ...record }));
  }
  return records;
}

const provenanceResolver = Object.freeze({
  async resolve(provenanceRecordId) {
    return loadRecords().get(provenanceRecordId) || null;
  }
});

module.exports = { PROFILE, provenanceResolver, loadRecords };
