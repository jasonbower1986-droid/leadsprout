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

const {
  OUTCOMES,
  createEvidenceAuthorisation,
  failClosedEvidenceAuthorisation,
  validateEvidenceAuthorisation
} = require('./evidence-authorisation');

function provenanceFor(validationResult, context) {
  return [{
    source: context.source || context.domain || 'website_acquisition',
    method: 'content_validation',
    reference: context.reference || context.analysedUrl || context.domain || 'validation_result'
  }];
}

function compatibilityAuthorisation(reason) {
  return failClosedEvidenceAuthorisation(reason, [{
    source: 'persisted_evidence_state',
    method: 'compatibility_validation',
    reference: 'legacy_or_incompatible_record'
  }]);
}

function buildCanonicalAuthorisation(validationResult, context = {}) {
  const provenance = provenanceFor(validationResult || {}, context);
  if (!validationResult || typeof validationResult.valid !== 'boolean') {
    return failClosedEvidenceAuthorisation('Evidence validation did not produce a determinate result.', provenance);
  }

  // Evidence Integrity may supply an already-evaluated canonical decision.
  // The builder validates it but never broadens or substitutes its meaning.
  if (validationResult.canonicalDecision) {
    return createEvidenceAuthorisation({
      ...validationResult.canonicalDecision,
      supersedesContractId: context.supersedesContractId || validationResult.canonicalDecision.supersedesContractId || null
    });
  }

  // Legacy valid/failed results retain their existing status, but they do not
  // contain the complete scope, uncertainty, limitation and confidence decision
  // required for canonical authority. They must never be silently promoted.
  return failClosedEvidenceAuthorisation(
    `Legacy Evidence Integrity result "${validationResult.valid ? 'validated' : 'failed'}" requires canonical reassessment.`,
    provenance,
    'Re-evaluate the evidence under ENG-SPEC-011 Revision 2.0 and supply a complete canonical decision.',
    context.supersedesContractId || null
  );
}

/**
 * Build evidence_state metadata for persistence.
 * Called after evidence validation during acquisition.
 * Persists only metadata — never raw HTML or acquisition artefacts.
 *
 * @param {Object} validationResult - Result from validateEvidence()
 * @returns {Object} evidence_state metadata (JSON-serializable, no raw HTML)
 */
function buildEvidenceState(validationResult, context = {}) {
  if (!validationResult) {
    const authorisation = buildCanonicalAuthorisation(null, context);
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
      checks: [],
      authorisation
    };
  }

  const state = {
    validatedAt: new Date().toISOString(),
    provenance: {
      source: 'validation',
      method: 'content_validation',
      version: '1.0'
    },
    checks: validationResult.checked || [],
    authorisation: buildCanonicalAuthorisation(validationResult, context)
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
      const authorisation = compatibilityAuthorisation('Persisted evidence state contains malformed JSON.');
      return {
        version: 'persisted',
        status: EVIDENCE_STATES.UNKNOWN,
        note: 'Malformed evidence_state metadata. JSON parse failed.',
        failureType: 'malformed_evidence_state',
        failureReason: 'Persisted evidence_state contains invalid JSON and cannot be parsed.',
        parseError: err.message,
        authorisation,
        authorisationValidation: validateEvidenceAuthorisation(authorisation)
      };
    }
  } else {
    state = evidenceState;
  }

  if (!state || !state.status) {
    return null;
  }

  if (state.status === EVIDENCE_STATES.VALIDATED) {
    const authorisationValidation = validateEvidenceAuthorisation(state.authorisation);
    return {
      version: 'persisted',
      status: EVIDENCE_STATES.VALIDATED,
      validatedAt: state.validatedAt,
      provenance: state.provenance,
      checks: state.checks || [],
      authorisation: state.authorisation || null,
      authorisationValidation,
      validation: { valid: true }
    };
  }

  if (state.status === EVIDENCE_STATES.FAILED) {
    const authorisationValidation = validateEvidenceAuthorisation(state.authorisation);
    return {
      version: 'persisted',
      status: EVIDENCE_STATES.FAILED,
      validatedAt: state.validatedAt,
      provenance: state.provenance,
      checks: state.checks || [],
      authorisation: state.authorisation || null,
      authorisationValidation,
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
  const authorisation = compatibilityAuthorisation(`Evidence state "${state ? state.status : 'null'}" is not recognised.`);
  return {
    version: 'persisted',
    status: EVIDENCE_STATES.UNKNOWN,
    note: 'Unrecognized evidence state.',
    failureType: 'unrecognized_evidence_state',
    failureReason: `Evidence state "${state ? state.status : 'null'}" is not recognized.`,
    authorisation,
    authorisationValidation: validateEvidenceAuthorisation(authorisation)
  };
}

module.exports = {
  buildEvidenceState,
  buildCanonicalAuthorisation,
  reconstructEvidence,
  EVIDENCE_STATES
};
