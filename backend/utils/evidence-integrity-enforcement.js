const { BUNDLE_ID, BUNDLE_VERSION, BUNDLE_DIGEST, canonicalJson } = require('./evidence-integrity-rule-bundle');
const crypto = require('crypto');

class EvidenceIntegrityEnforcementError extends Error {
  constructor(code) {
    super('Commercial Intelligence request is not authorised by the governing Evidence Integrity envelope.');
    this.name = 'EvidenceIntegrityEnforcementError';
    this.code = code;
  }
}

function validateEnvelope(envelope) {
  const errors = [];
  if (!envelope || envelope.schema !== 'saiphlab.evidence-integrity.authorisation/2') return { valid: false, errors: ['envelope_missing'] };
  if (envelope.ruleBundle?.id !== BUNDLE_ID || envelope.ruleBundle?.version !== BUNDLE_VERSION ||
      envelope.ruleBundle?.digest !== BUNDLE_DIGEST) errors.push('bundle_tuple_mismatch');
  const material = {
    schema: envelope.schema, ruleBundle: envelope.ruleBundle, outcome: envelope.outcome,
    authorisedScope: envelope.authorisedScope, confidenceCeiling: envelope.confidenceCeiling,
    limitations: envelope.limitations, uncertainty: envelope.uncertainty,
    orderedReasonCodes: envelope.orderedReasonCodes, evidenceLineage: envelope.evidenceLineage,
    completeness: envelope.completeness
  };
  const digest = crypto.createHash('sha256').update(canonicalJson(material)).digest('hex');
  if (envelope.decisionDigest !== digest || envelope.decisionId !== `EIA-${digest}`) errors.push('decision_digest_mismatch');
  if (!['ELIGIBLE', 'LIMITED'].includes(envelope.outcome) || envelope.permitsCommercialIntelligence !== true) {
    errors.push('outcome_not_authorising');
  }
  if (!envelope.authorisedScope || !Array.isArray(envelope.authorisedScope.claimClasses) ||
      !Array.isArray(envelope.evidenceLineage) || !Array.isArray(envelope.limitations)) errors.push('envelope_incomplete');
  if (envelope.outcome === 'LIMITED' && envelope.limitations.length === 0) errors.push('limited_without_limitation');
  return { valid: errors.length === 0, errors };
}

function confidenceRank(value) {
  return ['NONE', 'LOW', 'MEDIUM', 'HIGH'].indexOf(value);
}

function enforceEvidenceIntegrity(envelope, request) {
  const validation = validateEnvelope(envelope);
  if (!validation.valid) throw new EvidenceIntegrityEnforcementError(validation.errors[0]);
  if (!request || typeof request.operation !== 'string' || !Array.isArray(request.claims)) {
    throw new EvidenceIntegrityEnforcementError('downstream_request_malformed');
  }
  if (request.subject !== envelope.authorisedScope.subject) {
    throw new EvidenceIntegrityEnforcementError('subject_scope_expansion');
  }
  if (!Array.isArray(envelope.authorisedScope.operations) ||
      !envelope.authorisedScope.operations.includes(request.operation)) {
    throw new EvidenceIntegrityEnforcementError('operation_scope_expansion');
  }
  if (Array.isArray(request.limitations) &&
      envelope.limitations.some(limitation => !request.limitations.includes(limitation))) {
    throw new EvidenceIntegrityEnforcementError('required_limitation_removed');
  }
  const allowed = new Set(envelope.authorisedScope.claimClasses);
  const outputs = [];
  for (const claim of request.claims) {
    if (!claim || !allowed.has(claim.claimClass)) {
      throw new EvidenceIntegrityEnforcementError('claim_scope_expansion');
    }
    if (confidenceRank(claim.confidence) > confidenceRank(envelope.confidenceCeiling)) {
      throw new EvidenceIntegrityEnforcementError('confidence_escalation');
    }
    if (!Array.isArray(claim.parentEvidenceIds) || claim.parentEvidenceIds.length === 0) {
      throw new EvidenceIntegrityEnforcementError('claim_lineage_missing');
    }
    const authorisedParents = new Set(envelope.evidenceLineage.map(item => item.evidenceId));
    if (claim.parentEvidenceIds.some(identity => !authorisedParents.has(identity))) {
      throw new EvidenceIntegrityEnforcementError('claim_lineage_unauthorised');
    }
    outputs.push(Object.freeze({
      ...claim,
      evidenceIntegrity: {
        decisionId: envelope.decisionId,
        ruleBundle: envelope.ruleBundle,
        confidenceCeiling: envelope.confidenceCeiling,
        limitations: [...envelope.limitations],
        parentEvidenceIds: [...claim.parentEvidenceIds]
      }
    }));
  }
  return Object.freeze({
    operation: request.operation,
    subject: request.subject,
    evidenceIntegrityEnvelope: envelope,
    claims: outputs
  });
}

module.exports = {
  EvidenceIntegrityEnforcementError, validateEnvelope, enforceEvidenceIntegrity
};
