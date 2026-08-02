const fs = require('fs');

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

function loadRecords() {
  const filename = process.env.EVIDENCE_PROVENANCE_AUTHORITY_STORE;
  if (!filename) throw configurationError('PROVENANCE_AUTHORITY_STORE_REQUIRED');
  let value;
  try {
    const stat = fs.statSync(filename);
    if (!stat.isFile()) throw new Error('not a file');
    value = JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (_) {
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
