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
      claimClasses: [
        'BUSINESS_IDENTITY',
        'COMMERCIAL_OPPORTUNITY',
        'STRATEGIC_RECOMMENDATION',
        'WEBSITE_PERFORMANCE'
      ],
      limitations: ['Revenue estimates are excluded because no validated quantitative basis is available.']
    }, {
      claimClasses: ['BUSINESS_IDENTITY', 'WEBSITE_PERFORMANCE'],
      limitations: ['Commercial opportunity, revenue and strategic recommendation claims are excluded.']
    }],
    breadth: 'commercial intelligence derived from the controlled website acquisition',
    depth: 'material claim level'
  };
}

function validAcquisitionIdentity(acquisition, requestedScope) {
  if (!acquisition || !requestedScope || acquisition.subject !== requestedScope.subject ||
      !isEvidenceId(acquisition.evidenceId) || acquisition.lifecycleState !== 'ACTIVE' ||
      !acquisition.provenance?.source || !acquisition.provenance?.acquisitionId ||
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

function validatedEvidenceFromAcquisition(acquisition, requestedScope) {
  if (!validAcquisitionIdentity(acquisition, requestedScope) ||
      !acquisition.validation || typeof acquisition.validation.valid !== 'boolean' ||
      !acquisition.observations || typeof acquisition.observations !== 'object') return null;
  const validation = acquisition.validation;
  const observations = acquisition.observations;
  const failure = validation.evidenceFailure || null;
  const synthetic = failure === 'synthetic_audit_data';
  if (!validation.valid) {
    return {
      evidenceId: acquisition.evidenceId,
      lifecycleState: acquisition.lifecycleState,
      observedAt: acquisition.observedAt,
      contentDigest: acquisition.contentDigest,
      evidenceClass: acquisition.evidenceClass,
      reliability: 'UNRELIABLE',
      material: true,
      sourceAuthority: 'UNVERIFIED',
      independentSourceId: acquisition.provenance.source,
      claimClasses: [],
      parentEvidenceIds: [...acquisition.parentEvidenceIds],
      provenance: { ...acquisition.provenance },
      contradictions: [],
      limitations: validation.failureReason ? [validation.failureReason] : [],
      synthetic,
      fabricatedLineage: false,
      cleanSeparationPossible: !synthetic
    };
  }

  let source;
  try { source = new URL(acquisition.provenance.source); } catch (_) { return null; }
  const sourceValidated = source.hostname === acquisition.subject &&
    observations.domain === acquisition.subject &&
    observations.finalUrl === acquisition.provenance.source &&
    Number(observations.statusCode) >= 200 && Number(observations.statusCode) < 400;
  const checks = new Set(validation.checked || []);
  const validationComplete = checks.has('html_scan_passed') &&
    checks.has('synthetic_data_check_passed');
  if (!sourceValidated || !validationComplete) return null;

  const claimClasses = [];
  if (typeof observations.businessName === 'string' && observations.businessName.trim()) {
    claimClasses.push('BUSINESS_IDENTITY');
  }
  if (Number.isFinite(Number(observations.speedScore)) &&
      typeof observations.responsiveStatus === 'string') {
    claimClasses.push('WEBSITE_PERFORMANCE');
  }
  const gaps = [...(observations.seoGaps || []), ...(observations.conversionGaps || [])];
  if (gaps.length) claimClasses.push('COMMERCIAL_OPPORTUNITY', 'STRATEGIC_RECOMMENDATION');
  const quantitative = observations.quantitativeBasis;
  if (quantitative && ['monthlyTraffic', 'conversionRate', 'averageTransactionValue']
    .every(key => Number.isFinite(Number(quantitative[key])))) {
    claimClasses.push('REVENUE_ESTIMATE');
  }

  return {
    evidenceId: acquisition.evidenceId,
    lifecycleState: acquisition.lifecycleState,
    observedAt: acquisition.observedAt,
    contentDigest: acquisition.contentDigest,
    evidenceClass: acquisition.evidenceClass,
    reliability: 'RELIABLE',
    material: true,
    sourceAuthority: 'PRIMARY',
    independentSourceId: acquisition.provenance.source,
    claimClasses,
    parentEvidenceIds: [...acquisition.parentEvidenceIds],
    provenance: { ...acquisition.provenance },
    contradictions: [],
    limitations: [],
    synthetic: false,
    fabricatedLineage: false,
    cleanSeparationPossible: true
  };
}

function canonicalAssessmentFromAcquisition(acquisition, requestedScope) {
  const validatedEvidence = validatedEvidenceFromAcquisition(acquisition, requestedScope);
  if (!validatedEvidence) return null;
  return {
    requestedScope,
    evidence: [validatedEvidence]
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
  const envelope = assessEvidenceIntegrity(
    canonicalAssessment || { requestedScope, evidence: null },
    { now: Date.parse(occurredAt) }
  );
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

function outputProjectionError() {
  const error = new Error('Commercial Intelligence output cannot be safely projected to authorised claims.');
  error.code = 'EVIDENCE_INTEGRITY_OUTPUT_UNMAPPABLE';
  return error;
}

function containsInseparableRevenueEstimate(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => {
    if (/^(revenue_estimate|estimated_revenue|monthly_revenue|annual_revenue|revenue_leak)$/i.test(key) &&
        nested !== null && nested !== undefined) return true;
    return containsInseparableRevenueEstimate(nested);
  });
}

function projectCommercialIntelligenceOutput(result, envelope) {
  if (!result || typeof result !== 'object') throw outputProjectionError();
  if (envelope?.outcome !== 'LIMITED') return result;

  const allowed = new Set(envelope.authorisedScope?.claimClasses || []);
  const projected = { ...result };
  const commercialAllowed = allowed.has('COMMERCIAL_OPPORTUNITY');
  const strategyAllowed = allowed.has('STRATEGIC_RECOMMENDATION');

  // The current generator composes opportunity and recommendation meaning
  // across shared structures. They can only be retained or removed together.
  if (commercialAllowed !== strategyAllowed) throw outputProjectionError();

  if (!allowed.has('REVENUE_ESTIMATE')) {
    const otherOutput = { ...projected };
    delete otherOutput.revenue_leak;
    if (containsInseparableRevenueEstimate(otherOutput)) throw outputProjectionError();
    projected.revenue_leak = null;
  }
  if (!commercialAllowed) {
    projected.strategy_report = null;
    projected.growth_roadmap = [];
    projected.opportunity_brief = null;
    projected.commercial_context = null;
    projected.discernment = null;
    projected.inductive_conclusion = null;
    projected.discovery_tags = [];
    projected.discovery_patterns = [];
    projected.persona_summary = null;
    projected.sales_hooks = [];
    projected.proposal_cta = null;
    projected.advisor_quote = null;
  }
  if (!allowed.has('WEBSITE_PERFORMANCE')) {
    projected.visibility_health = null;
    projected.health_grade = null;
    projected.pitch_urgency = null;
    projected.investigation = null;
    projected.seo_gaps = [];
    projected.conversion_gaps = [];
    projected.market_standing = null;
  }
  if (!allowed.has('BUSINESS_IDENTITY')) {
    projected.domain = null;
    projected.business_name = null;
    projected.niche = null;
    projected.location = null;
  }
  return projected;
}

function extractMaterialClaims(result) {
  if (!result || typeof result !== 'object') {
    const error = new Error('Commercial Intelligence output is not mappable to governed claims.');
    error.code = 'EVIDENCE_INTEGRITY_OUTPUT_UNMAPPABLE';
    throw error;
  }
  const authorisation = result.evidence_authorisation;
  const parentEvidenceIds = (authorisation?.evidenceIdentities || []).map(item => item.evidenceId);
  const confidence = authorisation?.commercialConfidence?.degree;
  const claims = [];
  const add = (claimClass, value) => {
    if (value === null || value === undefined) return;
    claims.push({
      claimClass,
      confidence,
      parentEvidenceIds: [...parentEvidenceIds],
      valueDigest: crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')
    });
  };
  if ([result.domain, result.business_name, result.niche, result.location]
    .some(value => value !== null && value !== undefined)) add('BUSINESS_IDENTITY', {
    domain: result.domain,
    businessName: result.business_name,
    niche: result.niche,
    location: result.location
  });
  if ([result.visibility_health, result.investigation, result.seo_gaps, result.conversion_gaps]
    .some(value => value !== null && value !== undefined &&
      (!Array.isArray(value) || value.length > 0))) add('WEBSITE_PERFORMANCE', {
    visibilityHealth: result.visibility_health,
    investigation: result.investigation,
    seoGaps: result.seo_gaps,
    conversionGaps: result.conversion_gaps
  });
  add('COMMERCIAL_OPPORTUNITY',
    result.strategy_report?.opportunity || result.opportunity_brief || null);
  add('REVENUE_ESTIMATE', result.revenue_leak || null);
  if (result.strategy_report || result.growth_roadmap?.length || result.opportunity_brief) {
    add('STRATEGIC_RECOMMENDATION', {
    strategy: result.strategy_report || null,
    roadmap: result.growth_roadmap || null,
    brief: result.opportunity_brief || null
  });
  }
  if (!confidence || parentEvidenceIds.length === 0 || claims.length === 0) {
    const error = new Error('Commercial Intelligence output lacks governed confidence or lineage.');
    error.code = 'EVIDENCE_INTEGRITY_OUTPUT_UNMAPPABLE';
    throw error;
  }
  return {
    claims,
    limitations: (authorisation.limitations || []).map(item => item.reason)
  };
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
  const operationRequest = {
    operation,
    subject,
    claims: [],
    limitations: limitations || [...envelope.limitations]
  };
  enforceEvidenceIntegrity(envelope, operationRequest);
  const generatedResult = await execute();
  const projectedResult = projectCommercialIntelligenceOutput(generatedResult, envelope);
  const actual = extractMaterialClaims(projectedResult);
  if (Array.isArray(claimClasses) &&
      actual.claims.some(claim => !claimClasses.includes(claim.claimClass))) {
    const error = new Error('Commercial Intelligence produced an undeclared material claim.');
    error.code = 'EVIDENCE_INTEGRITY_OUTPUT_UNMAPPABLE';
    throw error;
  }
  const enforced = enforceEvidenceIntegrity(envelope, {
    operation,
    subject,
    claims: actual.claims,
    limitations: actual.limitations
  });
  const result = {
    ...projectedResult,
    evidence_integrity_output: {
      decisionId: envelope.decisionId,
      outcome: envelope.outcome,
      authorisedClaimClasses: [...envelope.authorisedScope.claimClasses],
      confidenceCeiling: envelope.confidenceCeiling,
      limitations: [...envelope.limitations],
      materialClaims: enforced.claims.map(claim => ({
        claimClass: claim.claimClass,
        confidence: claim.confidence,
        parentEvidenceIds: [...claim.parentEvidenceIds],
        limitations: [...claim.evidenceIntegrity.limitations]
      }))
    }
  };
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
  validatedEvidenceFromAcquisition,
  projectCommercialIntelligenceOutput,
  extractMaterialClaims,
  legacyAuthorisationDecision,
  assessAndPreserveAcquisition,
  executeGovernedCommercialIntelligence,
  executePersistedLeadIntelligence
};
