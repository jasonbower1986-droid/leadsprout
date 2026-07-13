/**
 * Evidence State Manager (ENG-AUTH-015 Gate 001)
 *
 * Persists Evidence Integrity metadata and provenance state alongside leads.
 * Stores only metadata (status, validatedAt, failure info), never raw HTML.
 * This is Gate 001 of the ENG-EXEC-001 execution order.
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

module.exports = {
  buildEvidenceState,
  EVIDENCE_STATES
};