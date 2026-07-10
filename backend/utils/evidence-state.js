/**
 * Evidence State Manager (v1.0)
 *
 * Manages persistence and reconstruction of Evidence Integrity state
 * throughout the lead lifecycle: acquisition, storage, and retrieval.
 *
 * Persisted evidence_state stores enough metadata to reconstruct
 * the Evidence Integrity boundary without raw HTML acquisition artefacts.
 */

// Evidence state status values
const EVIDENCE_STATES = {
  VALIDATED: 'validated',       // Evidence validated during acquisition
  FAILED: 'failed',             // Evidence validation failed (access denied, CDN, etc.)
  LEGACY: 'legacy',             // Pre-Evidence-Integrity lead (no evidence_state stored)
  UNKNOWN: 'unknown'            // State cannot be determined
};

/**
 * Build evidence_state metadata for persistence.
 * Called after successful or failed evidence validation during acquisition.
 *
 * @param {Object} validationResult - Result from validateEvidence()
 * @returns {Object} evidence_state metadata (JSON-serializable, no raw HTML)
 */
function buildEvidenceState(validationResult) {
  if (!validationResult) {
    return {
      status: EVIDENCE_STATES.UNKNOWN,
      validatedAt: new Date().toISOString(),
      failureType: null,
      failureReason: null
    };
  }

  if (validationResult.valid) {
    return {
      status: EVIDENCE_STATES.VALIDATED,
      validatedAt: new Date().toISOString(),
      failureType: null,
      failureReason: null
    };
  }

  return {
    status: EVIDENCE_STATES.FAILED,
    validatedAt: new Date().toISOString(),
    failureType: validationResult.evidenceFailure || 'unknown',
    failureReason: validationResult.failureReason || 'Evidence validation failed'
  };
}

/**
 * Reconstruct _evidence context from persisted evidence_state.
 * Called when leads are loaded from the database.
 *
 * @param {Object} evidenceState - The persisted evidence_state JSON
 * @returns {Object|null} _evidence object to attach to lead, or null if none
 */
function reconstructEvidence(evidenceState) {
  if (!evidenceState) {
    // No evidence_state stored — this is a legacy lead
    return {
      version: 'legacy',
      status: EVIDENCE_STATES.LEGACY,
      note: 'Pre-Evidence-Integrity lead. No validation metadata available.'
    };
  }

  // Parse stored JSON if string
  const state = typeof evidenceState === 'string' ? JSON.parse(evidenceState) : evidenceState;

  if (!state || !state.status) {
    return {
      version: 'legacy',
      status: EVIDENCE_STATES.LEGACY,
      note: 'Corrupt or missing evidence_state metadata.'
    };
  }

  if (state.status === EVIDENCE_STATES.VALIDATED) {
    return {
      version: 'persisted',
      status: EVIDENCE_STATES.VALIDATED,
      validatedAt: state.validatedAt,
      validation: { valid: true }
    };
  }

  if (state.status === EVIDENCE_STATES.FAILED) {
    return {
      version: 'persisted',
      status: EVIDENCE_STATES.FAILED,
      validatedAt: state.validatedAt,
      failureType: state.failureType,
      failureReason: state.failureReason,
      validation: { valid: false, evidenceFailure: state.failureType, failureReason: state.failureReason }
    };
  }

  return {
    version: 'persisted',
    status: EVIDENCE_STATES.UNKNOWN,
    note: 'Unrecognized evidence state.'
  };
}

/**
 * Determine if a lead is a legacy lead (pre-Evidence-Integrity).
 * Legacy leads have no evidence_state and no _evidence context.
 *
 * @param {Object} lead - The lead object from the database
 * @returns {boolean}
 */
function isLegacyLead(lead) {
  if (!lead) return false;
  if (lead.evidence_state) return false;
  if (lead._evidence) return false;
  // Has technical data but no evidence metadata — likely legacy
  return lead.speed_score !== undefined || lead.domain !== undefined;
}

module.exports = {
  buildEvidenceState,
  reconstructEvidence,
  isLegacyLead,
  EVIDENCE_STATES
};
