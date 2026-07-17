const crypto = require('crypto');

const CONTRACT_VERSION = '1.0';
const GOVERNING_AUTHORITY = 'ENG-CORE-010';

const OUTCOMES = Object.freeze({
  ELIGIBLE: 'ELIGIBLE',
  LIMITED: 'LIMITED',
  REFUSED: 'REFUSED',
  REASSESSMENT_REQUIRED: 'REASSESSMENT_REQUIRED'
});

const AUTHORISING_OUTCOMES = new Set([OUTCOMES.ELIGIBLE, OUTCOMES.LIMITED]);
const EVIDENCE_ID_PATTERN = /^EVI-1-[A-Z2-7]{52}$/;
const EVIDENCE_LIFECYCLE_STATES = new Set(['ACTIVE', 'SUPERSEDED', 'INVALIDATED']);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function makeContractId(decision) {
  const material = { ...decision };
  delete material.contractId;
  return `eac_${crypto.createHash('sha256').update(stableStringify(material)).digest('hex').slice(0, 24)}`;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateScope(scope) {
  return Boolean(scope &&
    Array.isArray(scope.subjects) && scope.subjects.length > 0 && scope.subjects.every(isNonEmptyString) &&
    isNonEmptyString(scope.evidenceBoundary) &&
    isNonEmptyString(scope.breadth) &&
    isNonEmptyString(scope.depth) &&
    isNonEmptyString(scope.confidenceBoundary));
}

function validateProvenance(provenance) {
  return Array.isArray(provenance) && provenance.length > 0 && provenance.every(item =>
    item && isNonEmptyString(item.source) && isNonEmptyString(item.method) && isNonEmptyString(item.reference)
  );
}

function validateLimitation(limitation) {
  return Boolean(limitation && isNonEmptyString(limitation.affectedScope) &&
    isNonEmptyString(limitation.reason) && isNonEmptyString(limitation.propagation));
}

function validateEvidenceIdentities(evidenceIdentities) {
  return Array.isArray(evidenceIdentities) && new Set(evidenceIdentities.map(item => item && item.evidenceId)).size === evidenceIdentities.length && evidenceIdentities.every(item =>
    item && EVIDENCE_ID_PATTERN.test(item.evidenceId || '') && EVIDENCE_LIFECYCLE_STATES.has(item.lifecycleState)
  );
}

function validateEvidenceAuthorisation(contract) {
  const errors = [];
  if (!contract || typeof contract !== 'object') return { valid: false, errors: ['contract_missing'] };
  const evidenceIdentities = Array.isArray(contract.evidenceIdentities) ? contract.evidenceIdentities : [];
  if (contract.contractVersion !== CONTRACT_VERSION) errors.push('contract_version_incompatible');
  if (contract.governingAuthority !== GOVERNING_AUTHORITY) errors.push('governing_authority_missing');
  if (!Object.values(OUTCOMES).includes(contract.outcome)) errors.push('outcome_unrecognised');
  if (!isNonEmptyString(contract.contractId)) errors.push('contract_identity_missing');
  if (!validateScope(contract.authorisedAssessmentScope)) errors.push('authorised_scope_incomplete');
  if (!validateProvenance(contract.provenance)) errors.push('provenance_incomplete');
  if (!validateEvidenceIdentities(contract.evidenceIdentities)) errors.push('evidence_identities_invalid');
  if (!Array.isArray(contract.materialUncertainty)) errors.push('uncertainty_invalid');
  if (!Array.isArray(contract.limitations) || !contract.limitations.every(validateLimitation)) errors.push('limitations_invalid');
  if (!contract.commercialConfidence || !isNonEmptyString(contract.commercialConfidence.degree) ||
      !isNonEmptyString(contract.commercialConfidence.basis)) errors.push('commercial_confidence_incomplete');
  if (!contract.decision || !isNonEmptyString(contract.decision.reason) ||
      !isNonEmptyString(contract.decision.ruleVersion)) errors.push('decision_context_incomplete');

  if (contract.outcome === OUTCOMES.LIMITED && contract.limitations.length === 0) {
    errors.push('limited_outcome_requires_limitation');
  }
  if (AUTHORISING_OUTCOMES.has(contract.outcome) !== (contract.permitsCommercialAssessment === true)) {
    errors.push('permission_outcome_mismatch');
  }
  if (AUTHORISING_OUTCOMES.has(contract.outcome) && evidenceIdentities.length === 0) {
    errors.push('authorising_outcome_requires_evidence_identity');
  }
  if (AUTHORISING_OUTCOMES.has(contract.outcome) && evidenceIdentities.some(item => item.lifecycleState === 'INVALIDATED')) {
    errors.push('authorising_outcome_contains_invalidated_evidence');
  }
  if (contract.outcome === OUTCOMES.REASSESSMENT_REQUIRED && !isNonEmptyString(contract.reassessmentCondition)) {
    errors.push('reassessment_condition_missing');
  }
  return { valid: errors.length === 0, errors };
}

function createEvidenceAuthorisation(input) {
  const contract = {
    contractVersion: CONTRACT_VERSION,
    governingAuthority: GOVERNING_AUTHORITY,
    outcome: input.outcome,
    authorisedAssessmentScope: input.authorisedAssessmentScope,
    provenance: input.provenance,
    evidenceIdentities: input.evidenceIdentities || [],
    materialUncertainty: input.materialUncertainty || [],
    limitations: input.limitations || [],
    commercialConfidence: input.commercialConfidence,
    decision: input.decision,
    permitsCommercialAssessment: AUTHORISING_OUTCOMES.has(input.outcome),
    reassessmentCondition: input.reassessmentCondition || null,
    supersedesContractId: input.supersedesContractId || null
  };
  contract.contractId = input.contractId || makeContractId(contract);
  const validation = validateEvidenceAuthorisation(contract);
  if (!validation.valid) {
    const error = new Error(`Incomplete Evidence Authorisation contract: ${validation.errors.join(', ')}`);
    error.code = 'EVIDENCE_AUTHORISATION_INVALID';
    error.validationErrors = validation.errors;
    throw error;
  }
  return Object.freeze(contract);
}

function failClosedEvidenceAuthorisation(reason, provenance, condition = 'Reacquire and revalidate the evidence state.', supersedesContractId = null) {
  return createEvidenceAuthorisation({
    outcome: OUTCOMES.REASSESSMENT_REQUIRED,
    authorisedAssessmentScope: {
      subjects: ['evidence reassessment only'],
      evidenceBoundary: 'No downstream commercial assessment is authorised.',
      breadth: 'none', depth: 'none', confidenceBoundary: 'undetermined'
    },
    provenance,
    evidenceIdentities: [],
    materialUncertainty: [reason],
    limitations: [],
    commercialConfidence: { degree: 'UNDETERMINED', basis: 'The evidence state is not complete enough to authorise commercial assessment.' },
    decision: { reason, ruleVersion: 'ENG-SPEC-011/2.0' },
    reassessmentCondition: condition,
    supersedesContractId
  });
}

function canPerformCommercialAssessment(contract) {
  const validation = validateEvidenceAuthorisation(contract);
  return validation.valid && AUTHORISING_OUTCOMES.has(contract.outcome);
}

module.exports = {
  CONTRACT_VERSION,
  GOVERNING_AUTHORITY,
  OUTCOMES,
  createEvidenceAuthorisation,
  failClosedEvidenceAuthorisation,
  validateEvidenceAuthorisation,
  canPerformCommercialAssessment,
  stableStringify
};
