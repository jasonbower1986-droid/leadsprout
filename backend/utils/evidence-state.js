/**
 * Evidence State Manager (ENG-AUTH-015 Gates 001-002)
 *
 * Gate 001: Persists Evidence Integrity metadata and provenance state alongside leads.
 * Gate 002: Reconstructs canonical Evidence Integrity state from stored records.
 *
 * Stores only metadata (status, validatedAt, failure info), never raw HTML.
 *
 * ENG-SPEC-015 Requirements:
 *   R1: Establish canonical Evidence Authorisation boundary
 *   R2: Maintain explicit evidence state, provenance, and validation decisions
 */

// Evidence state status values
const EVIDENCE_STATES = {
  VALIDATED: 'validated',
  FAILED: 'failed',
  UNKNOWN: 'unknown'
};

/**
 * Build evidence_state metadata for persistence.
 * Called after evidence validation during acquisition.
 * Persists only metadata — never raw HTML or acquisition artefacts.
 *
 * @param {Object} validationResult - Result from validateEvidence()
 * @returns {Object} evidence_state metadata (JSON-serializable, no raw HTML)
 */
function buildEvidenceState(validationResult) {
  if (!validationResult) {
    return {
      status: EVIDENCE_STATES.UNKNOWN,
      validatedAt: new Date().toISOString(),
      provenance: {
        source: 'validation',
        method: 'content_validation',
        version: '1.0'
      },
      failureType: null,
      failureReason: null,
      checks: []
    };
  }

  const state = {
    validatedAt: new Date().toISOString(),
    provenance: {
      source: 'validation',
      method: 'content_validation',
      version: '1.0'
    },
    checks: validationResult.checked || []
  };

  if (validationResult.valid) {
    return {
      ...state,
      status: EVIDENCE_STATES.VALIDATED,
      failureType: null,
      failureReason: null
    };
  }

  return {
    ...state,
    status: EVIDENCE_STATES.FAILED,
    failureType: validationResult.evidenceFailure || 'unknown',
    failureReason: validationResult.failureReason || 'Evidence validation failed'
  };
}

/**
 * Reconstruct canonical _evidence context from persisted evidence_state.
 * Called when leads are loaded from the database.
 * Gate 002: Ensures Commercial Intelligence receives the same validated
 * Evidence Integrity representation regardless of acquisition path.
 *
 * @param {Object|string|null|undefined} evidenceState - The persisted evidence_state
 * @returns {Object|null} _evidence context object, or null for legacy/no-state
 */
function reconstructEvidence(evidenceState) {
  if (!evidenceState) {
    // No evidence_state stored — legacy lead or pre-Gate-001
    return null;
  }

  // Parse stored JSON if string
  let state;
  if (typeof evidenceState === 'string') {
    try {
      state = JSON.parse(evidenceState);
    } catch (err) {
      // Malformed JSON — fail closed
      return {
        version: 'persisted',
        status: EVIDENCE_STATES.UNKNOWN,
        note: 'Malformed evidence_state metadata. JSON parse failed.',
        failureType: 'malformed_evidence_state',
        failureReason: 'Persisted evidence_state contains invalid JSON and cannot be parsed.',
        parseError: err.message
      };
    }
  } else {
    state = evidenceState;
  }

  if (!state || !state.status) {
    return null;
  }

  if (state.status === EVIDENCE_STATES.VALIDATED) {
    return {
      version: 'persisted',
      status: EVIDENCE_STATES.VALIDATED,
      validatedAt: state.validatedAt,
      provenance: state.provenance,
      checks: state.checks || [],
      validation: { valid: true }
    };
  }

  if (state.status === EVIDENCE_STATES.FAILED) {
    return {
      version: 'persisted',
      status: EVIDENCE_STATES.FAILED,
      validatedAt: state.validatedAt,
      provenance: state.provenance,
      checks: state.checks || [],
      failureType: state.failureType,
      failureReason: state.failureReason,
      validation: {
        valid: false,
        evidenceFailure: state.failureType,
        failureReason: state.failureReason
      }
    };
  }

  // Unknown status — not validated, not failed, not empty
  return {
    version: 'persisted',
    status: EVIDENCE_STATES.UNKNOWN,
    note: 'Unrecognized evidence state.',
    failureType: 'unrecognized_evidence_state',
    failureReason: `Evidence state "${state ? state.status : 'null'}" is not recognized.`
  };
}

module.exports = {
  buildEvidenceState,
  reconstructEvidence,
  EVIDENCE_STATES
};