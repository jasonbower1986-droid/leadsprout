const crypto = require('crypto');
const { EvidenceIdentityError } = require('./evidence-identity');

const MANIFEST_VERSION = 'ENG-DET-001/1';
const STORE_ID = 'EVIDENCE_IDENTITY';

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function publicKeyDigest(publicKey) {
  return crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
}

function authorityFailure(code) {
  return new EvidenceIdentityError(code, 'Independent Evidence Integrity Authority verification failed.');
}

async function buildEvidenceIntegrityManifest(dbQuery, provenanceResolver, previousCheckpointId = null) {
  if (!provenanceResolver || typeof provenanceResolver.resolve !== 'function') {
    throw authorityFailure('PROVENANCE_AUTHORITY_UNAVAILABLE');
  }
  const [identities, lifecycle, authorisations] = await Promise.all([
    dbQuery.all(`SELECT evidence_id, schema_version, standard_version, item_kind,
      subject_business_id, source_namespace, source_locator, observed_at, content_sha256,
      fragment_locator, parent_evidence_ids_json, derivation_profile,
      canonical_payload_digest, provenance_record_id, source_profile_version,
      derivation_profile_version, lifecycle_state, supersedes_evidence_id,
      superseded_by_evidence_id, created_at FROM evidence_identities ORDER BY evidence_id`),
    dbQuery.all(`SELECT event_id, evidence_id, from_state, to_state, reason,
      responsible_authority, occurred_at FROM evidence_identity_lifecycle_events
      ORDER BY evidence_id, event_id`),
    dbQuery.all(`SELECT contract_id, evidence_id, lifecycle_state_at_decision
      FROM evidence_authorisation_evidence_identities ORDER BY contract_id, evidence_id`)
  ]);

  const provenance = [];
  for (const identity of identities) {
    let resolved;
    try { resolved = await provenanceResolver.resolve(identity.provenance_record_id); } catch (_) {
      throw authorityFailure('PROVENANCE_AUTHORITY_UNAVAILABLE');
    }
    if (!resolved) throw authorityFailure('PROVENANCE_AUTHORITY_MISSING');
    if (resolved.ambiguous) throw authorityFailure('PROVENANCE_AUTHORITY_AMBIGUOUS');
    if (resolved.provenance_record_id !== identity.provenance_record_id) {
      throw authorityFailure('PROVENANCE_AUTHORITY_ID_MISMATCH');
    }
    for (const field of ['subject_business_id', 'source_namespace', 'source_locator', 'observed_at',
      'content_sha256', 'source_profile_version', 'derivation_profile_version']) {
      if ((resolved[field] || null) !== (identity[field] || null)) {
        throw authorityFailure('PROVENANCE_AUTHORITY_MISMATCH');
      }
    }
    provenance.push({ evidence_id: identity.evidence_id, provenance_record_id: identity.provenance_record_id,
      authoritative_digest: digest(resolved) });
  }

  return Object.freeze({
    manifest_version: MANIFEST_VERSION,
    store_id: STORE_ID,
    schema_contract: 'ENG-REF-001/1.0',
    previous_checkpoint_id: previousCheckpointId,
    identities: identities.map(row => ({ evidence_id: row.evidence_id, digest: digest(row) })),
    lifecycle: lifecycle.map(row => ({ event_id: row.event_id, evidence_id: row.evidence_id, digest: digest(row) })),
    authorisations: authorisations.map(row => ({ contract_id: row.contract_id, evidence_id: row.evidence_id, digest: digest(row) })),
    provenance,
    counts: { identities: identities.length, lifecycle: lifecycle.length, authorisations: authorisations.length }
  });
}

class IndependentEvidenceIntegrityGate {
  constructor({ authority, provenanceResolver, maxAttestationAgeMs = 300000, now = () => Date.now() } = {}) {
    if (!authority || typeof authority.latest !== 'function' || typeof authority.publicKey !== 'function' ||
        typeof authority.attest !== 'function') throw authorityFailure('INTEGRITY_AUTHORITY_UNAVAILABLE');
    if (!provenanceResolver || typeof provenanceResolver.resolve !== 'function') {
      throw authorityFailure('PROVENANCE_AUTHORITY_UNAVAILABLE');
    }
    this.authority = authority;
    this.provenanceResolver = provenanceResolver;
    this.maxAttestationAgeMs = maxAttestationAgeMs;
    this.now = now;
  }

  async manifest(dbQuery, previousCheckpointId = null) {
    return buildEvidenceIntegrityManifest(dbQuery, this.provenanceResolver, previousCheckpointId);
  }

  async verify(dbQuery) {
    let attestation;
    try { attestation = await this.authority.latest(STORE_ID); } catch (_) {
      throw authorityFailure('INTEGRITY_AUTHORITY_UNAVAILABLE');
    }
    if (!attestation) throw authorityFailure('INTEGRITY_ATTESTATION_MISSING');
    const manifest = await this.manifest(dbQuery, attestation.previous_checkpoint_id || null);
    const previous = await this.previousAttestation(attestation);
    await this.verifyAttestation(attestation, manifest, previous);
    await this.verifyHistory(previous);
    return Object.freeze({ status: 'VERIFIED', checkpoint_id: attestation.checkpoint_id,
      sequence: attestation.sequence, manifest_digest: digest(manifest) });
  }

  async previousAttestation(attestation) {
    if (attestation.sequence === 1) return undefined;
    if (!attestation.previous_checkpoint_id || typeof this.authority.checkpoint !== 'function') {
      throw authorityFailure('INTEGRITY_AUTHORITY_UNAVAILABLE');
    }
    let previous;
    try { previous = await this.authority.checkpoint(attestation.previous_checkpoint_id); } catch (_) {
      throw authorityFailure('INTEGRITY_AUTHORITY_UNAVAILABLE');
    }
    if (!previous) throw authorityFailure('INTEGRITY_ATTESTATION_SEQUENCE_INVALID');
    return previous;
  }

  async verifyHistory(attestation, visited = new Set()) {
    if (!attestation) return true;
    if (visited.has(attestation.checkpoint_id)) throw authorityFailure('INTEGRITY_ATTESTATION_SEQUENCE_INVALID');
    visited.add(attestation.checkpoint_id);
    const previous = await this.previousAttestation(attestation);
    await this.verifySignedEnvelope(attestation, previous, false);
    return this.verifyHistory(previous, visited);
  }

  async attest(dbQuery) {
    let previous;
    try { previous = await this.authority.latest(STORE_ID); } catch (_) {
      throw authorityFailure('INTEGRITY_AUTHORITY_UNAVAILABLE');
    }
    const manifest = await this.manifest(dbQuery, previous ? previous.checkpoint_id : null);
    let attestation;
    try {
      attestation = await this.authority.attest({ manifest, manifest_digest: digest(manifest),
        previous_checkpoint_id: previous ? previous.checkpoint_id : null });
    } catch (_) { throw authorityFailure('INTEGRITY_ATTESTATION_FAILED'); }
    await this.verifyAttestation(attestation, manifest, previous);
    return attestation;
  }

  async verifyAttestation(attestation, manifest, previous = undefined) {
    if (!attestation || attestation.store_id !== STORE_ID || attestation.manifest_version !== MANIFEST_VERSION ||
        attestation.manifest_digest !== digest(manifest) || !Number.isInteger(attestation.sequence) ||
        attestation.sequence < 1) throw authorityFailure('INTEGRITY_ATTESTATION_MISMATCH');
    await this.verifySignedEnvelope(attestation, previous, true);
    return true;
  }

  async verifySignedEnvelope(attestation, previous = undefined, requireFresh = false) {
    const authorityTime = Date.parse(attestation.authority_time);
    if (!Number.isFinite(authorityTime) || authorityTime > this.now() ||
        (requireFresh && this.now() - authorityTime > this.maxAttestationAgeMs)) {
      throw authorityFailure('INTEGRITY_ATTESTATION_STALE');
    }
    if (!previous && (attestation.sequence !== 1 || attestation.previous_checkpoint_id !== null)) {
      throw authorityFailure('INTEGRITY_GENESIS_NOT_AUTHORISED');
    }
    if (previous && (attestation.sequence !== previous.sequence + 1 ||
        attestation.previous_checkpoint_id !== previous.checkpoint_id)) {
      throw authorityFailure('INTEGRITY_ATTESTATION_SEQUENCE_INVALID');
    }
    let publicKey;
    try { publicKey = await this.authority.publicKey(attestation.key_id); } catch (_) {
      throw authorityFailure('INTEGRITY_AUTHORITY_UNAVAILABLE');
    }
    if (!publicKey) throw authorityFailure('INTEGRITY_SIGNING_KEY_UNTRUSTED');
    if (!previous) await this.verifyGenesisAuthorization(attestation, publicKey);
    if (previous && previous.key_id !== attestation.key_id) {
      await this.verifyKeyTransition(attestation, previous, publicKey);
    }
    const signed = canonicalJson({ checkpoint_id: attestation.checkpoint_id, store_id: attestation.store_id,
      manifest_version: attestation.manifest_version, manifest_digest: attestation.manifest_digest,
      previous_checkpoint_id: attestation.previous_checkpoint_id, sequence: attestation.sequence,
      authority_time: attestation.authority_time, key_id: attestation.key_id,
      genesis_authorization: attestation.genesis_authorization || null,
      key_transition: attestation.key_transition || null });
    let valid = false;
    try { valid = crypto.verify(null, Buffer.from(signed), publicKey, Buffer.from(attestation.signature, 'base64')); } catch (_) {}
    if (!valid) throw authorityFailure('INTEGRITY_ATTESTATION_SIGNATURE_INVALID');
    return true;
  }

  async verifyGenesisAuthorization(attestation, publicKey) {
    const authorization = attestation.genesis_authorization;
    if (!authorization || authorization.store_id !== STORE_ID ||
        authorization.manifest_digest !== attestation.manifest_digest ||
        authorization.key_id !== attestation.key_id || authorization.write_quiesced !== true ||
        authorization.engineering_baseline_verified !== true ||
        typeof authorization.environment !== 'string' || !authorization.environment ||
        typeof authorization.repository_revision !== 'string' || !authorization.repository_revision) {
      throw authorityFailure('INTEGRITY_GENESIS_NOT_AUTHORISED');
    }
    const { signature, ...body } = authorization;
    let valid = false;
    try { valid = crypto.verify(null, Buffer.from(canonicalJson(body)), publicKey, Buffer.from(signature, 'base64')); } catch (_) {}
    if (!valid) throw authorityFailure('INTEGRITY_GENESIS_NOT_AUTHORISED');
  }

  async verifyKeyTransition(attestation, previous, newPublicKey) {
    const transition = attestation.key_transition;
    if (!transition || transition.store_id !== STORE_ID ||
        transition.previous_key_id !== previous.key_id || transition.new_key_id !== attestation.key_id ||
        transition.new_public_key_sha256 !== publicKeyDigest(newPublicKey) ||
        transition.previous_checkpoint_id !== previous.checkpoint_id) {
      throw authorityFailure('INTEGRITY_KEY_TRANSITION_INVALID');
    }
    let previousPublicKey;
    try { previousPublicKey = await this.authority.publicKey(previous.key_id); } catch (_) {
      throw authorityFailure('INTEGRITY_AUTHORITY_UNAVAILABLE');
    }
    if (!previousPublicKey) throw authorityFailure('INTEGRITY_KEY_TRANSITION_INVALID');
    const { signature, ...body } = transition;
    let valid = false;
    try { valid = crypto.verify(null, Buffer.from(canonicalJson(body)), previousPublicKey,
      Buffer.from(signature, 'base64')); } catch (_) {}
    if (!valid) throw authorityFailure('INTEGRITY_KEY_TRANSITION_INVALID');
  }
}

module.exports = { MANIFEST_VERSION, STORE_ID, canonicalJson, digest,
  publicKeyDigest, buildEvidenceIntegrityManifest, IndependentEvidenceIntegrityGate };
