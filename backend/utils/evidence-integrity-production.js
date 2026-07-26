const crypto = require('crypto');
const {
  canonicaliseIdentityInput, generateEvidenceId, isEvidenceId
} = require('./evidence-identity');
const { assessEvidenceIntegrity } = require('./evidence-integrity-assessor');
const { enforceEvidenceIntegrity } = require('./evidence-integrity-enforcement');
const {
  preserveDecision, recordDependentReasoning
} = require('./evidence-integrity-lifecycle');
const { canonicalJson } = require('./evidence-integrity-rule-bundle');

const PRODUCTION_OPERATION = 'COMMERCIAL_INTELLIGENCE';
const PRODUCTION_CLAIM_CLASSES = Object.freeze([
  'BUSINESS_IDENTITY',
  'COMMERCIAL_OPPORTUNITY',
  'REVENUE_ESTIMATE',
  'STRATEGIC_RECOMMENDATION',
  'WEBSITE_PERFORMANCE'
]);

function productionRequestedScope(subject) {
  return {
    subject,
    operations: [PRODUCTION_OPERATION],
    requiredClaimClasses: [...PRODUCTION_CLAIM_CLASSES],
    usefulBoundedScopes: [{
      claimClasses: ['BUSINESS_IDENTITY', 'WEBSITE_PERFORMANCE'],
      limitations: ['Commercial opportunity, revenue and strategic recommendation claims are excluded.']
    }],
    breadth: 'commercial intelligence derived from the controlled website acquisition',
    depth: 'material claim level'
  };
}

function validAcquisition(acquisition, requestedScope) {
  if (!acquisition || !requestedScope || acquisition.subject !== requestedScope.subject ||
      !isEvidenceId(acquisition.evidenceId) || acquisition.lifecycleState !== 'ACTIVE' ||
      !acquisition.provenance?.source || !acquisition.provenance?.acquisitionId ||
      !Array.isArray(acquisition.claimClasses) || !acquisition.claimClasses.length ||
      !Array.isArray(acquisition.parentEvidenceIds) ||
      typeof acquisition.contentDigest !== 'string' ||
      typeof acquisition.observedAt !== 'string') return false;
  try {
    const canonical = canonicaliseIdentityInput({
      standard_version: 1,
      item_kind: 'SOURCE',
      source_namespace: 'web',
      subject_business_id: acquisition.subject,
      source_locator: acquisition.provenance.source,
      observed_at: acquisition.observedAt,
      content_sha256: acquisition.contentDigest,
      fragment_locator: '',
      parent_evidence_ids: [],
      derivation_profile: ''
    });
    return generateEvidenceId(canonical) === acquisition.evidenceId;
  } catch (_) {
    return false;
  }
}

function canonicalAssessmentFromAcquisition(acquisition, requestedScope) {
  if (!validAcquisition(acquisition, requestedScope)) return null;
  return {
    requestedScope,
    evidence: [{
      evidenceId: acquisition.evidenceId,
      lifecycleState: acquisition.lifecycleState,
      observedAt: acquisition.observedAt,
      contentDigest: acquisition.contentDigest,
      evidenceClass: acquisition.evidenceClass,
      reliability: acquisition.reliability,
      material: true,
      sourceAuthority: acquisition.sourceAuthority,
      independentSourceId: acquisition.provenance.source,
      claimClasses: [...acquisition.claimClasses],
      parentEvidenceIds: [...acquisition.parentEvidenceIds],
      provenance: { ...acquisition.provenance },
      contradictions: [...(acquisition.contradictions || [])],
      limitations: [...(acquisition.limitations || [])],
      synthetic: acquisition.synthetic === true,
      fabricatedLineage: acquisition.fabricatedLineage === true,
      cleanSeparationPossible: acquisition.cleanSeparationPossible !== false
    }]
  };
}

function legacyAuthorisationDecision(envelope, acquisition) {
  const authorising = ['ELIGIBLE', 'LIMITED'].includes(envelope.outcome);
  const scope = envelope.authorisedScope;
  return {
    outcome: envelope.outcome,
    authorisedAssessmentScope: {
      subjects: [scope?.subject || 'evidence reassessment only'],
      evidenceBoundary: authorising
        ? 'Only claims and lineage in the operational Evidence Integrity envelope are authorised.'
        : 'No downstream commercial assessment is authorised.',
      breadth: scope?.breadth || 'none',
      depth: scope?.depth || 'none',
      confidenceBoundary: envelope.confidenceCeiling
    },
    provenance: [{
      source: acquisition?.provenance?.source || 'production_acquisition',
      method: 'operational_evidence_integrity_assessment',
      reference: acquisition?.provenance?.acquisitionId || envelope.decisionId
    }],
    evidenceIdentities: envelope.evidenceLineage.map(item => ({
      evidenceId: item.evidenceId,
      lifecycleState: acquisition?.lifecycleState || 'ACTIVE'
    })),
    materialUncertainty: [...envelope.uncertainty],
    limitations: envelope.limitations.map(reason => ({
      affectedScope: scope?.breadth || 'commercial intelligence',
      reason,
      propagation: 'The limitation must remain attached to every dependent output.'
    })),
    commercialConfidence: {
      degree: envelope.confidenceCeiling,
      basis: `Operational decision ${envelope.decisionId}`
    },
    decision: {
      reason: envelope.orderedReasonCodes.join(', ') || envelope.outcome,
      ruleVersion: `${envelope.ruleBundle.id}/${envelope.ruleBundle.version}`
    },
    reassessmentCondition: envelope.outcome === 'REASSESSMENT_REQUIRED'
      ? 'Reacquire complete canonical evidence and reassess.'
      : null
  };
}

async function assessAndPreserveAcquisition({
  dbQuery, acquisition, requestedScope, priorDecisionId = null, occurredAt
}) {
  if (!dbQuery || !occurredAt) throw new Error('Production Evidence Integrity persistence context is required.');
  const canonicalAssessment = canonicalAssessmentFromAcquisition(acquisition, requestedScope);
  const envelope = assessEvidenceIntegrity(canonicalAssessment, { now: Date.parse(occurredAt) });
  await preserveDecision(dbQuery, requestedScope?.subject || acquisition?.subject || 'UNKNOWN', envelope, {
    supersedesDecisionId: priorDecisionId,
    triggerCodes: priorDecisionId ? ['NORMALISED_DECISION_INPUT_CHANGE'] : [],
    occurredAt
  });
  return Object.freeze({
    canonicalAssessment,
    canonicalDecision: legacyAuthorisationDecision(envelope, acquisition),
    envelope
  });
}

function governedClaims(envelope, claimClasses = envelope.authorisedScope?.claimClasses || []) {
  const parentEvidenceIds = envelope.evidenceLineage.map(item => item.evidenceId);
  return claimClasses.map(claimClass => ({
    claimClass,
    confidence: envelope.confidenceCeiling,
    parentEvidenceIds
  }));
}

async function executeGovernedCommercialIntelligence({
  dbQuery, envelope, subject, operation = PRODUCTION_OPERATION,
  claimClasses, limitations, execute, occurredAt
}) {
  if (typeof execute !== 'function' || !dbQuery || !occurredAt) {
    throw new Error('Governed Commercial Intelligence execution context is incomplete.');
  }
  const current = await dbQuery.get(
    "SELECT decision_id FROM evidence_integrity_decisions WHERE decision_id = ? AND lifecycle_state = 'CURRENT'",
    [envelope?.decisionId]
  );
  if (!current) {
    const error = new Error('Stale Evidence Integrity authority cannot execute Commercial Intelligence.');
    error.code = 'EVIDENCE_INTEGRITY_STALE_DECISION';
    throw error;
  }
  const claims = governedClaims(envelope, claimClasses);
  const request = { operation, subject, claims, limitations: limitations || [...envelope.limitations] };
  enforceEvidenceIntegrity(envelope, request);
  const result = await execute();
  const enforced = enforceEvidenceIntegrity(envelope, request);
  const outputDigest = crypto.createHash('sha256').update(canonicalJson(result)).digest('hex');
  const reasoningId = `EIR-${crypto.createHash('sha256').update(
    `${envelope.decisionId}|${occurredAt}|${outputDigest}|${crypto.randomUUID()}`
  ).digest('hex')}`;
  await recordDependentReasoning(dbQuery, reasoningId, envelope.decisionId, outputDigest, occurredAt);
  return Object.freeze({ result, enforced, reasoningId, outputDigest });
}

async function executePersistedLeadIntelligence({
  dbQuery, lead, execute, occurredAt = new Date().toISOString()
}) {
  let envelope;
  try {
    envelope = JSON.parse(lead?.evidence_state || 'null')?.integrityEnvelope || null;
  } catch (_) {
    envelope = null;
  }
  if (!envelope) {
    const error = new Error('Persisted lead requires canonical Evidence Integrity reassessment.');
    error.code = 'EVIDENCE_INTEGRITY_REASSESSMENT_REQUIRED';
    throw error;
  }
  return executeGovernedCommercialIntelligence({
    dbQuery,
    envelope,
    subject: envelope.authorisedScope?.subject,
    execute,
    occurredAt
  });
}

module.exports = {
  PRODUCTION_OPERATION,
  PRODUCTION_CLAIM_CLASSES,
  productionRequestedScope,
  canonicalAssessmentFromAcquisition,
  legacyAuthorisationDecision,
  assessAndPreserveAcquisition,
  executeGovernedCommercialIntelligence,
  executePersistedLeadIntelligence
};
