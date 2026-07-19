const CONTRACT_VERSION = 'ENG-TASK-002/1.0';

const STATUSES = Object.freeze({
  COMPLETE: 'COMPLETE',
  LIMITED: 'LIMITED',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT EVIDENCE'
});

const CONFIDENCE = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  UNDETERMINED: 'UNDETERMINED'
});

const CLAIM_CLASSIFICATIONS = Object.freeze({
  OBSERVATION: 'OBSERVATION',
  INTERPRETATION: 'INTERPRETATION'
});

class OpportunityUnderstandingError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = 'OpportunityUnderstandingError';
    this.code = code;
    this.details = details;
  }
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function unique(values) {
  return [...new Set(values)];
}

function investigationIdentity(lead) {
  return String(lead.investigation_id || lead.id || lead.domain || lead.business_name || 'current-investigation');
}

function subjectIdentity(lead) {
  return Object.freeze({
    subject_id: String(lead.id || lead.domain || lead.business_name || 'unknown-subject'),
    business_name: lead.business_name || lead.domain || 'Unknown business',
    domain: lead.domain || null
  });
}

function sourceReference(investigationId, dimension, finding, index) {
  return Object.freeze({
    reference_id: `INVESTIGATION:${investigationId}:${dimension}:${index}:${finding.signal || 'finding'}`,
    source_type: 'INVESTIGATION_OBSERVATION',
    investigation_id: investigationId,
    source_path: `investigation.dimensions.${dimension}.findings[${index}]`,
    evidence_id: null
  });
}

function investigationSummaryReference(investigationId) {
  return Object.freeze({
    reference_id: `INVESTIGATION:${investigationId}:SUMMARY`,
    source_type: 'INVESTIGATION_RESULT',
    investigation_id: investigationId,
    source_path: 'investigation.overall',
    evidence_id: null
  });
}

function canonicalEvidenceReferences(investigationId, authorisation) {
  const identities = authorisation && Array.isArray(authorisation.evidenceIdentities)
    ? authorisation.evidenceIdentities
    : [];
  return identities.map(item => Object.freeze({
    reference_id: item.evidenceId,
    source_type: 'EVIDENCE_IDENTITY',
    investigation_id: investigationId,
    source_path: 'evidence_authorisation.evidenceIdentities',
    evidence_id: item.evidenceId
  }));
}

function collectLimitations(lead, authorisation, status) {
  const limitations = [];
  if (authorisation) {
    for (const uncertainty of authorisation.materialUncertainty || []) {
      if (nonEmpty(uncertainty)) limitations.push(uncertainty.trim());
    }
    for (const limitation of authorisation.limitations || []) {
      if (nonEmpty(limitation.reason)) limitations.push(limitation.reason.trim());
    }
  }
  for (const contradiction of lead._evidence?.contradictoryEvidence || []) {
    if (nonEmpty(contradiction)) limitations.push(contradiction.trim());
  }
  if (status === STATUSES.LIMITED) {
    limitations.push('Only one material opportunity signal is available; the commercial interpretation is constrained.');
  }
  if (status === STATUSES.INSUFFICIENT_EVIDENCE) {
    limitations.push('The current investigation contains no material signal supporting a responsible commercial interpretation.');
  }
  return unique(limitations);
}

function claim(classification, statement, evidenceReferences) {
  return Object.freeze({
    classification,
    statement,
    evidence_references: unique(evidenceReferences)
  });
}

function signalStatement(dimension, finding) {
  const labels = {
    accessibility: 'Accessibility and performance',
    trust: 'Trust and credibility',
    conversion: 'Conversion',
    localSEO: 'Local visibility'
  };
  return `${labels[dimension] || dimension}: ${finding.detail}.`;
}

function dimensionLabel(dimension) {
  const labels = {
    accessibility: 'accessibility and performance',
    trust: 'trust and credibility',
    conversion: 'conversion',
    localSEO: 'local visibility'
  };
  return labels[dimension] || dimension;
}

function significanceFor(signals) {
  if (signals.length === 0) {
    return 'The available investigation evidence does not support a responsible commercial interpretation.';
  }
  const dimensions = unique(signals.map(item => item.dimension_label));
  return `Observed constraints across ${dimensions.join(' and ')} may prevent the business from converting its existing digital presence into customer action.`;
}

function directionFor(signals) {
  if (signals.length === 0) {
    return 'Acquire or validate additional evidence before beginning a commercial conversation.';
  }
  const primary = signals[0].dimension_label.toLowerCase();
  return `Begin with an evidence-led conversation about the observed ${primary} constraint and its effect on customer action.`;
}

function validateClaim(claimValue, expectedClassification, referenceIds, errors, field) {
  if (!claimValue || claimValue.classification !== expectedClassification || !nonEmpty(claimValue.statement)) {
    errors.push(`${field}_invalid`);
    return;
  }
  if (!Array.isArray(claimValue.evidence_references)) {
    errors.push(`${field}_evidence_invalid`);
    return;
  }
  if (claimValue.evidence_references.some(reference => !referenceIds.has(reference))) {
    errors.push(`${field}_evidence_unresolved`);
  }
}

function hasUnsupportedClaim(statement) {
  if (!nonEmpty(statement)) return false;
  return /(?:[$£€]\s*\d|\b\d+(?:\.\d+)?\s*%\s+(?:revenue|profit|sales)|\bguarantee(?:d|s)?\b|\bwill\s+(?:generate|earn|make)\b|\bact\s+now\b|\bimmediately\b)/i.test(statement);
}

function validateOpportunityUnderstanding(result) {
  const errors = [];
  if (!result || typeof result !== 'object') return { valid: false, errors: ['result_missing'] };
  if (result.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (!Object.values(STATUSES).includes(result.status)) errors.push('status_invalid');
  if (!result.subject_identity || !nonEmpty(result.subject_identity.subject_id) ||
      !nonEmpty(result.subject_identity.business_name)) errors.push('subject_identity_invalid');
  if (!Object.values(CONFIDENCE).includes(result.confidence_classification)) errors.push('confidence_invalid');
  if (!Array.isArray(result.material_limitations)) errors.push('limitations_invalid');
  if (!Array.isArray(result.supporting_evidence_references)) errors.push('evidence_references_invalid');
  if (!Array.isArray(result.opportunity_signals)) errors.push('signals_invalid');

  const references = Array.isArray(result.supporting_evidence_references)
    ? result.supporting_evidence_references
    : [];
  const referenceIds = new Set(references.map(item => item && item.reference_id));
  if (referenceIds.has(undefined) || referenceIds.size !== references.length || references.some(item =>
    !nonEmpty(item.reference_id) || !nonEmpty(item.source_type) || !nonEmpty(item.investigation_id) || !nonEmpty(item.source_path))) {
    errors.push('evidence_reference_invalid');
  }

  validateClaim(result.attention_rationale, CLAIM_CLASSIFICATIONS.INTERPRETATION, referenceIds, errors, 'attention_rationale');
  validateClaim(result.commercial_significance, CLAIM_CLASSIFICATIONS.INTERPRETATION, referenceIds, errors, 'commercial_significance');
  validateClaim(result.initial_commercial_direction, CLAIM_CLASSIFICATIONS.INTERPRETATION, referenceIds, errors, 'initial_commercial_direction');
  for (const signal of result.opportunity_signals || []) {
    validateClaim(signal, CLAIM_CLASSIFICATIONS.OBSERVATION, referenceIds, errors, 'opportunity_signal');
  }

  const materialStatements = [
    result.attention_rationale?.statement,
    result.commercial_significance?.statement,
    result.initial_commercial_direction?.statement,
    ...(result.opportunity_signals || []).map(item => item.statement)
  ];
  if (materialStatements.some(hasUnsupportedClaim)) errors.push('unsupported_commercial_claim');

  if (result.status === STATUSES.COMPLETE && ((result.opportunity_signals || []).length < 2 ||
      !result.attention_rationale?.evidence_references?.length ||
      !result.commercial_significance?.evidence_references?.length ||
      !result.initial_commercial_direction?.evidence_references?.length)) {
    errors.push('complete_result_incomplete');
  }
  if (result.status === STATUSES.LIMITED && result.material_limitations.length === 0) {
    errors.push('limited_result_requires_limitation');
  }
  if (result.status === STATUSES.INSUFFICIENT_EVIDENCE && result.opportunity_signals.length !== 0) {
    errors.push('insufficient_result_contains_signal');
  }

  return Object.freeze({ valid: errors.length === 0, errors: unique(errors) });
}

function synthesiseOpportunityUnderstanding({ lead, investigation, evidenceAuthorisation = null } = {}) {
  if (!lead || !investigation || !investigation.dimensions) {
    throw new OpportunityUnderstandingError(
      'OPPORTUNITY_UNDERSTANDING_INPUT_UNAVAILABLE',
      'Opportunity Understanding requires the current lead and completed investigation.'
    );
  }

  const investigationId = investigationIdentity(lead);
  const summaryReference = investigationSummaryReference(investigationId);
  const references = [summaryReference];
  const signals = [];
  for (const [dimension, result] of Object.entries(investigation.dimensions)) {
    for (const [index, finding] of (result.findings || []).entries()) {
      const reference = sourceReference(investigationId, dimension, finding, index);
      references.push(reference);
      signals.push(Object.freeze({
        ...claim(CLAIM_CLASSIFICATIONS.OBSERVATION, signalStatement(dimension, finding), [reference.reference_id]),
        dimension,
        dimension_label: dimensionLabel(dimension),
        priority: Number(finding.severity) || 0
      }));
    }
  }
  signals.sort((left, right) => right.priority - left.priority || left.statement.localeCompare(right.statement));
  const prioritisedSignals = signals.slice(0, 5);
  const usedReferenceIds = unique(prioritisedSignals.flatMap(item => item.evidence_references));
  const canonicalReferences = canonicalEvidenceReferences(investigationId, evidenceAuthorisation);
  references.push(...canonicalReferences);
  const claimReferences = unique([
    summaryReference.reference_id,
    ...usedReferenceIds,
    ...canonicalReferences.map(item => item.reference_id)
  ]);

  const status = prioritisedSignals.length >= 2
    ? STATUSES.COMPLETE
    : prioritisedSignals.length === 1
      ? STATUSES.LIMITED
      : STATUSES.INSUFFICIENT_EVIDENCE;
  const confidence = prioritisedSignals.length >= 3
    ? CONFIDENCE.HIGH
    : prioritisedSignals.length >= 2
      ? CONFIDENCE.MEDIUM
      : prioritisedSignals.length === 1
        ? CONFIDENCE.LOW
        : CONFIDENCE.UNDETERMINED;
  const limitations = collectLimitations(lead, evidenceAuthorisation, status);
  const businessName = lead.business_name || lead.domain || 'This business';
  const attention = prioritisedSignals.length
    ? `${businessName} merits attention because the investigation identified ${prioritisedSignals.length} evidence-backed constraint${prioritisedSignals.length === 1 ? '' : 's'} affecting customer action.`
    : `${businessName} cannot yet be assessed for commercial attention from the available evidence.`;

  const result = Object.freeze({
    contract_version: CONTRACT_VERSION,
    status,
    subject_identity: subjectIdentity(lead),
    attention_rationale: claim(CLAIM_CLASSIFICATIONS.INTERPRETATION, attention, claimReferences),
    commercial_significance: claim(CLAIM_CLASSIFICATIONS.INTERPRETATION, significanceFor(prioritisedSignals), claimReferences),
    opportunity_signals: Object.freeze(prioritisedSignals),
    initial_commercial_direction: claim(CLAIM_CLASSIFICATIONS.INTERPRETATION, directionFor(prioritisedSignals), claimReferences),
    supporting_evidence_references: Object.freeze(references.filter(item =>
      claimReferences.includes(item.reference_id))),
    confidence_classification: confidence,
    material_limitations: Object.freeze(limitations)
  });
  const validation = validateOpportunityUnderstanding(result);
  if (!validation.valid) {
    throw new OpportunityUnderstandingError(
      'OPPORTUNITY_UNDERSTANDING_CONFORMANCE_FAILURE',
      'Opportunity Understanding failed evidence-conformance validation.',
      validation.errors
    );
  }
  return result;
}

module.exports = {
  CONTRACT_VERSION,
  STATUSES,
  CONFIDENCE,
  CLAIM_CLASSIFICATIONS,
  OpportunityUnderstandingError,
  synthesiseOpportunityUnderstanding,
  validateOpportunityUnderstanding,
  hasUnsupportedClaim
};
