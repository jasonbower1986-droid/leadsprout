const crypto = require('crypto');

const STANDARD_VERSION = 1;
const SCHEMA_VERSION = '1.0';
const IDENTIFIER_PATTERN = /^EVI-1-[A-Z2-7]{52}$/;
const CONTENT_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const SOURCE_NAMESPACE_PATTERN = /^[a-z][a-z0-9._-]{1,31}$/;

const ITEM_KINDS = Object.freeze({ SOURCE: 'SOURCE', FRAGMENT: 'FRAGMENT', DERIVED: 'DERIVED' });
const LIFECYCLE_STATES = Object.freeze({ ACTIVE: 'ACTIVE', SUPERSEDED: 'SUPERSEDED', INVALIDATED: 'INVALIDATED' });

const SOURCE_PROFILES = Object.freeze({
  web: Object.freeze({ id: 'web', version: '1.0', active: true })
});

const DERIVATION_PROFILES = Object.freeze({});
const IDENTITY_FIELDS = Object.freeze([
  'standard_version', 'item_kind', 'source_namespace', 'subject_business_id',
  'source_locator', 'observed_at', 'content_sha256', 'fragment_locator',
  'parent_evidence_ids', 'derivation_profile'
]);

class EvidenceIdentityError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = 'EvidenceIdentityError';
    this.code = code;
    this.details = details;
  }
}

function normaliseText(value) {
  if (typeof value !== 'string') return value;
  return value.normalize('NFC');
}

function normaliseWebLocator(value) {
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    throw new EvidenceIdentityError('MALFORMED_SOURCE_LOCATOR', 'The web source locator must be an absolute URI.');
  }
  if (!url.protocol || !url.hostname) {
    throw new EvidenceIdentityError('MALFORMED_SOURCE_LOCATOR', 'The web source locator must contain a scheme and host.');
  }
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) url.port = '';
  url.hash = '';
  return url.href.replace(/%[0-9a-f]{2}/gi, escape => escape.toUpperCase());
}

function normaliseObservedAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new EvidenceIdentityError('INVALID_OBSERVATION_TIME', 'observed_at must be UTC RFC 3339 with millisecond precision.');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new EvidenceIdentityError('INVALID_OBSERVATION_TIME', 'observed_at is not a canonical UTC timestamp.');
  }
  return value;
}

function base32(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function canonicaliseIdentityInput(input, context = {}) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    throw new EvidenceIdentityError('CANONICAL_INPUT_MISSING', 'Canonical Evidence Identity input is required.');
  }
  const textInputs = ['source_namespace', 'subject_business_id', 'source_locator', 'observed_at', 'content_sha256', 'fragment_locator', 'derivation_profile'];
  if (textInputs.some(field => typeof input[field] === 'string' && /[\u0000-\u001F\u007F]/.test(input[field]))) {
    errors.push('control_character');
  }

  if (input.standard_version !== STANDARD_VERSION) errors.push('standard_version');
  const itemKind = input.item_kind;
  if (!Object.values(ITEM_KINDS).includes(itemKind)) errors.push('item_kind');

  const sourceNamespace = normaliseText(input.source_namespace);
  if (typeof sourceNamespace !== 'string' || !SOURCE_NAMESPACE_PATTERN.test(sourceNamespace)) errors.push('source_namespace');
  const sourceProfiles = context.sourceProfiles || SOURCE_PROFILES;
  const sourceProfile = sourceProfiles[sourceNamespace];
  if (!sourceProfile || sourceProfile.active !== true) errors.push('source_profile_unregistered');

  const subjectBusinessId = normaliseText(input.subject_business_id);
  if (typeof subjectBusinessId !== 'string' || subjectBusinessId.length === 0) errors.push('subject_business_id');

  let sourceLocator = normaliseText(input.source_locator || '');
  if (itemKind === ITEM_KINDS.SOURCE) {
    if (sourceNamespace === 'web') sourceLocator = normaliseWebLocator(sourceLocator);
    else if (!sourceLocator) errors.push('source_locator');
  } else if (sourceLocator && !(sourceProfile && sourceProfile.allowDerivedLocator === true)) {
    errors.push('source_locator_not_permitted');
  }

  let observedAt;
  try { observedAt = normaliseObservedAt(input.observed_at); } catch (error) { errors.push(error.code); }

  const contentSha256 = normaliseText(input.content_sha256);
  if (typeof contentSha256 !== 'string' || !CONTENT_DIGEST_PATTERN.test(contentSha256)) errors.push('content_sha256');

  const fragmentLocator = normaliseText(input.fragment_locator || '');
  const parents = Array.isArray(input.parent_evidence_ids) ? [...new Set(input.parent_evidence_ids)].sort() : [];
  if (parents.some(parent => typeof parent !== 'string' || !IDENTIFIER_PATTERN.test(parent))) errors.push('parent_evidence_ids');

  const derivationProfile = normaliseText(input.derivation_profile || '');
  const derivationProfiles = context.derivationProfiles || DERIVATION_PROFILES;

  if (itemKind === ITEM_KINDS.SOURCE) {
    if (fragmentLocator || parents.length || derivationProfile) errors.push('source_relationship_fields');
  } else if (itemKind === ITEM_KINDS.FRAGMENT) {
    if (!fragmentLocator) errors.push('fragment_locator');
    if (parents.length !== 1) errors.push('fragment_parent_count');
    if (derivationProfile) errors.push('fragment_derivation_profile');
  } else if (itemKind === ITEM_KINDS.DERIVED) {
    if (parents.length === 0) errors.push('derived_parent_count');
    if (!derivationProfile || !derivationProfiles[derivationProfile] || derivationProfiles[derivationProfile].active !== true) {
      errors.push('derivation_profile_unregistered');
    }
  }

  if (errors.length) {
    throw new EvidenceIdentityError('CANONICAL_INPUT_INVALID', `Invalid Evidence Identity input: ${errors.join(', ')}`, errors);
  }

  return Object.freeze({
    standard_version: STANDARD_VERSION,
    item_kind: itemKind,
    source_namespace: sourceNamespace,
    subject_business_id: subjectBusinessId,
    source_locator: sourceLocator,
    observed_at: observedAt,
    content_sha256: contentSha256,
    fragment_locator: fragmentLocator,
    parent_evidence_ids: Object.freeze(parents),
    derivation_profile: derivationProfile
  });
}

function serializeCanonicalPayload(canonicalInput) {
  return `${IDENTITY_FIELDS.map(field => {
    const value = field === 'parent_evidence_ids'
      ? canonicalInput[field].join(',')
      : canonicalInput[field];
    return `${field}=${value}`;
  }).join('\n')}\n`;
}

function generateEvidenceId(canonicalInput) {
  const payload = serializeCanonicalPayload(canonicalInput);
  const digest = crypto.createHash('sha256').update(payload, 'utf8').digest();
  return `EVI-${STANDARD_VERSION}-${base32(digest)}`;
}

function payloadDigest(canonicalInput) {
  return crypto.createHash('sha256').update(serializeCanonicalPayload(canonicalInput), 'utf8').digest('hex');
}

function createEvidenceIdentityRecord(input, relationships, context = {}) {
  const canonicalInput = canonicaliseIdentityInput(input, context);
  const provenance = relationships && relationships.provenanceRecord;
  if (!provenance || !provenance.provenance_record_id) {
    throw new EvidenceIdentityError('PROVENANCE_MISSING', 'Authoritative provenance is required before identity issuance.');
  }
  const registeredSourceProfile = (context.sourceProfiles || SOURCE_PROFILES)[canonicalInput.source_namespace];
  if (!provenance.source_profile_version || provenance.source_profile_version !== registeredSourceProfile.version) {
    throw new EvidenceIdentityError('SOURCE_PROFILE_VERSION_MISMATCH', 'Provenance does not identify the registered source profile version.');
  }
  if (canonicalInput.item_kind === ITEM_KINDS.DERIVED) {
    const registeredDerivationProfile = (context.derivationProfiles || DERIVATION_PROFILES)[canonicalInput.derivation_profile];
    if (!provenance.derivation_profile_version || provenance.derivation_profile_version !== registeredDerivationProfile.version) {
      throw new EvidenceIdentityError('DERIVATION_PROFILE_VERSION_MISMATCH', 'Provenance does not identify the registered derivation profile version.');
    }
  }
  const duplicatedFields = ['subject_business_id', 'source_namespace', 'source_locator', 'observed_at', 'content_sha256'];
  if (duplicatedFields.some(field => provenance[field] !== canonicalInput[field])) {
    throw new EvidenceIdentityError('PROVENANCE_MISMATCH', 'Canonical identity inputs do not match authoritative provenance.');
  }
  if (relationships.businessIdentityResolved !== true) {
    throw new EvidenceIdentityError('SUBJECT_BUSINESS_UNRESOLVED', 'The canonical Assessed Business Identity did not resolve.');
  }

  const parentRecords = relationships.parentRecords || [];
  if (canonicalInput.parent_evidence_ids.length !== parentRecords.length ||
      parentRecords.some(parent => parent.subject_business_id !== canonicalInput.subject_business_id || parent.lifecycle_state === LIFECYCLE_STATES.INVALIDATED)) {
    throw new EvidenceIdentityError('PARENT_RELATIONSHIP_INVALID', 'Parent identities must resolve, match the subject business and remain usable.');
  }

  const evidenceId = generateEvidenceId(canonicalInput);
  const createdAt = context.createdAt || new Date().toISOString();
  return Object.freeze({
    evidence_id: evidenceId,
    schema_version: SCHEMA_VERSION,
    ...canonicalInput,
    canonical_payload_digest: payloadDigest(canonicalInput),
    provenance_record_id: provenance.provenance_record_id,
    source_profile_version: provenance.source_profile_version,
    derivation_profile_version: provenance.derivation_profile_version || null,
    lifecycle_state: LIFECYCLE_STATES.ACTIVE,
    supersedes_evidence_id: input.supersedes_evidence_id || null,
    superseded_by_evidence_id: null,
    created_at: createdAt
  });
}

function validateEvidenceIdentity(record, context = {}) {
  const errors = [];
  if (!record || typeof record !== 'object') return { valid: false, errors: ['record_missing'] };
  if (!IDENTIFIER_PATTERN.test(record.evidence_id || '')) errors.push('identifier_format');
  let canonical;
  try { canonical = canonicaliseIdentityInput(record, context); } catch (error) { errors.push(...(error.details.length ? error.details : [error.code])); }
  if (canonical) {
    if (generateEvidenceId(canonical) !== record.evidence_id) errors.push('identifier_mismatch');
    if (payloadDigest(canonical) !== record.canonical_payload_digest) errors.push('payload_digest_mismatch');
  }
  if (record.schema_version !== SCHEMA_VERSION) errors.push('schema_version');
  const sourceProfile = (context.sourceProfiles || SOURCE_PROFILES)[record.source_namespace];
  if (!sourceProfile || record.source_profile_version !== sourceProfile.version) errors.push('source_profile_version');
  if (record.item_kind === ITEM_KINDS.DERIVED && !record.derivation_profile_version) errors.push('derivation_profile_version');
  if (record.item_kind !== ITEM_KINDS.DERIVED && record.derivation_profile_version) errors.push('derivation_profile_version_not_permitted');
  if (!Object.values(LIFECYCLE_STATES).includes(record.lifecycle_state)) errors.push('lifecycle_state');
  if (typeof record.provenance_record_id !== 'string' || !record.provenance_record_id) errors.push('provenance_record_id');
  if (record.supersedes_evidence_id && !IDENTIFIER_PATTERN.test(record.supersedes_evidence_id)) errors.push('supersedes_evidence_id');
  if (record.superseded_by_evidence_id && !IDENTIFIER_PATTERN.test(record.superseded_by_evidence_id)) errors.push('superseded_by_evidence_id');
  if (record.lifecycle_state === LIFECYCLE_STATES.SUPERSEDED && !record.superseded_by_evidence_id) errors.push('supersession_incomplete');
  if (record.lifecycle_state === LIFECYCLE_STATES.ACTIVE && record.superseded_by_evidence_id) errors.push('active_has_successor');
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function isEvidenceId(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function assertLifecycleTransition(from, to) {
  const permitted = {
    [LIFECYCLE_STATES.ACTIVE]: [LIFECYCLE_STATES.SUPERSEDED, LIFECYCLE_STATES.INVALIDATED],
    [LIFECYCLE_STATES.SUPERSEDED]: [LIFECYCLE_STATES.INVALIDATED],
    [LIFECYCLE_STATES.INVALIDATED]: []
  };
  if (!permitted[from] || !permitted[from].includes(to)) {
    throw new EvidenceIdentityError('INVALID_LIFECYCLE_TRANSITION', `Evidence Identity cannot transition from ${from} to ${to}.`);
  }
  return true;
}

module.exports = {
  STANDARD_VERSION,
  SCHEMA_VERSION,
  IDENTIFIER_PATTERN,
  ITEM_KINDS,
  LIFECYCLE_STATES,
  SOURCE_PROFILES,
  DERIVATION_PROFILES,
  EvidenceIdentityError,
  canonicaliseIdentityInput,
  serializeCanonicalPayload,
  generateEvidenceId,
  payloadDigest,
  createEvidenceIdentityRecord,
  validateEvidenceIdentity,
  assertLifecycleTransition,
  isEvidenceId,
  normaliseWebLocator
};
