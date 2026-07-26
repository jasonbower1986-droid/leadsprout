const crypto = require('crypto');
const {
  BUNDLE_ID, BUNDLE_VERSION, BUNDLE_DIGEST, canonicalJson, loadRuleBundle
} = require('./evidence-integrity-rule-bundle');

const OUTCOMES = Object.freeze({
  ELIGIBLE: 'ELIGIBLE',
  LIMITED: 'LIMITED',
  REFUSED: 'REFUSED',
  REASSESSMENT_REQUIRED: 'REASSESSMENT_REQUIRED'
});
const CONFIDENCE = ['NONE', 'LOW', 'MEDIUM', 'HIGH'];
const SUPPORTING_RELIABILITY = new Set(['RELIABLE', 'RELIABLE_WITH_LIMITATION']);
const MATERIAL_CORROBORATION = new Set([
  'BUSINESS_IDENTITY', 'CONTACT_IDENTITY', 'DECISION_AUTHORITY', 'MATERIAL_QUANTITATIVE_CLAIM'
]);
const EVIDENCE_ID = /^EVI-1-[A-Z2-7]{52}$/;

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function asTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function failClosed(reasonCode, detail) {
  return finalise({
    outcome: OUTCOMES.REASSESSMENT_REQUIRED,
    authorisedScope: null,
    confidenceCeiling: 'NONE',
    limitations: [],
    uncertainty: [detail],
    reasonCodes: [reasonCode],
    evidenceLineage: [],
    completeness: 'UNDETERMINED'
  });
}

function finalise(decision) {
  const canonical = {
    schema: 'saiphlab.evidence-integrity.authorisation/2',
    ruleBundle: { id: BUNDLE_ID, version: BUNDLE_VERSION, digest: BUNDLE_DIGEST },
    outcome: decision.outcome,
    authorisedScope: decision.authorisedScope,
    confidenceCeiling: decision.confidenceCeiling,
    limitations: uniqueSorted(decision.limitations || []),
    uncertainty: uniqueSorted(decision.uncertainty || []),
    orderedReasonCodes: decision.reasonCodes || [],
    evidenceLineage: [...(decision.evidenceLineage || [])].sort((a, b) =>
      a.evidenceId.localeCompare(b.evidenceId) || a.observedAt.localeCompare(b.observedAt) ||
      a.contentDigest.localeCompare(b.contentDigest)),
    completeness: decision.completeness
  };
  const decisionDigest = crypto.createHash('sha256').update(canonicalJson(canonical)).digest('hex');
  return Object.freeze({
    ...canonical,
    decisionId: `EIA-${decisionDigest}`,
    decisionDigest,
    permitsCommercialIntelligence: [OUTCOMES.ELIGIBLE, OUTCOMES.LIMITED].includes(canonical.outcome),
    reassessmentRequired: canonical.outcome === OUTCOMES.REASSESSMENT_REQUIRED
  });
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || !input.requestedScope ||
      typeof input.requestedScope.subject !== 'string' ||
      !Array.isArray(input.requestedScope.requiredClaimClasses) ||
      input.requestedScope.requiredClaimClasses.length === 0 ||
      !Array.isArray(input.requestedScope.operations) ||
      input.requestedScope.operations.length === 0 ||
      !Array.isArray(input.evidence)) return false;
  return input.evidence.every(item => item && typeof item === 'object');
}

function applicableExpiry(item, bundle) {
  const policy = bundle.freshnessPolicies.find(entry => entry.evidenceClass === item.evidenceClass);
  const observed = asTime(item.observedAt);
  if (observed === null) return null;
  const controlled = policy ? observed + policy.maximumAgeHours * 3600000 : Infinity;
  const source = item.sourceExpiresAt ? asTime(item.sourceExpiresAt) : Infinity;
  return Math.min(controlled, source === null ? -Infinity : source);
}

function confidenceMinimum(left, right) {
  return CONFIDENCE[Math.min(CONFIDENCE.indexOf(left), CONFIDENCE.indexOf(right))];
}

function assessEvidenceIntegrity(input, options = {}) {
  let bundle;
  try { bundle = options.bundle || loadRuleBundle(); } catch (error) {
    return failClosed(error.code === 'EVIDENCE_RULE_BUNDLE_DIGEST_MISMATCH' ?
      'EI-REASON-RB-003' : 'EI-REASON-RB-002', error.code || 'Rule bundle unavailable.');
  }
  try {
    const { verifyRuleBundle } = require('./evidence-integrity-rule-bundle');
    verifyRuleBundle(bundle);
  } catch (error) {
    return failClosed(error.code === 'EVIDENCE_RULE_BUNDLE_DIGEST_MISMATCH' ?
      'EI-REASON-RB-003' : 'EI-REASON-RB-002', error.code || 'Rule bundle unavailable.');
  }
  if (!validateInput(input)) return failClosed('EI-REASON-IN-001', 'Mandatory assessment input is missing.');

  const now = options.now instanceof Date ? options.now.getTime() :
    typeof options.now === 'number' ? options.now : Date.now();
  const reasons = ['EI-REASON-RB-001'];
  const limitations = [];
  const uncertainty = [];
  const excludedClaims = new Set();
  const usable = [];
  let materialReassessment = false;
  let contaminated = false;

  for (const item of input.evidence) {
    if (!EVIDENCE_ID.test(item.evidenceId || '') || !item.provenance ||
        !item.provenance.source || !item.provenance.acquisitionId ||
        !Array.isArray(item.parentEvidenceIds) || !item.contentDigest || !item.observedAt) {
      reasons.push('EI-REASON-PV-002');
      materialReassessment = true;
      continue;
    }
    if (item.synthetic === true || item.fabricatedLineage === true) {
      reasons.push(item.synthetic ? 'EI-REASON-SY-001' : 'EI-REASON-SY-002');
      contaminated = contaminated || item.cleanSeparationPossible === false;
      for (const claim of item.claimClasses || []) excludedClaims.add(claim);
      continue;
    }
    if (item.lifecycleState && item.lifecycleState !== 'ACTIVE') {
      reasons.push('EI-REASON-PV-003', 'EI-REASON-LC-001');
      materialReassessment = true;
      continue;
    }
    const expiry = applicableExpiry(item, bundle);
    if (expiry === null) {
      reasons.push('EI-REASON-FR-003');
      materialReassessment = true;
      continue;
    }
    if (now > expiry) {
      reasons.push('EI-REASON-FR-002');
      for (const claim of item.claimClasses || []) excludedClaims.add(claim);
      if (item.reacquisitionRequired !== false) materialReassessment = true;
      continue;
    }
    reasons.push('EI-REASON-FR-001');
    if (!SUPPORTING_RELIABILITY.has(item.reliability)) {
      reasons.push(item.reliability === 'UNVERIFIABLE' ? 'EI-REASON-RL-004' : 'EI-REASON-RL-003');
      if (item.reliability === 'UNVERIFIABLE' && item.material !== false) materialReassessment = true;
      for (const claim of item.claimClasses || []) excludedClaims.add(claim);
      continue;
    }
    reasons.push(item.reliability === 'RELIABLE' ? 'EI-REASON-RL-001' : 'EI-REASON-RL-002');
    if (item.reliability === 'RELIABLE_WITH_LIMITATION') {
      limitations.push(...(item.limitations || ['Evidence carries a reliability limitation.']));
    }
    for (const contradiction of item.contradictions || []) {
      if (contradiction.material && !contradiction.isolatable) {
        reasons.push('EI-REASON-CT-001');
        materialReassessment = true;
      } else if (contradiction.isolatable) {
        reasons.push('EI-REASON-CT-002');
        for (const claim of contradiction.claimClasses || []) excludedClaims.add(claim);
        limitations.push(contradiction.limitation || 'Contradictory claim excluded from authorised scope.');
      } else {
        reasons.push('EI-REASON-CT-003');
        uncertainty.push(contradiction.description || 'Non-material contradiction remains.');
      }
    }
    usable.push(item);
  }

  if (contaminated) return finalise({
    outcome: OUTCOMES.REFUSED, authorisedScope: null, confidenceCeiling: 'NONE',
    limitations, uncertainty, reasonCodes: orderReasons(reasons, bundle),
    evidenceLineage: [], completeness: 'INSUFFICIENT'
  });
  if (materialReassessment) return finalise({
    outcome: OUTCOMES.REASSESSMENT_REQUIRED, authorisedScope: null, confidenceCeiling: 'NONE',
    limitations, uncertainty, reasonCodes: orderReasons(reasons.concat('EI-REASON-LC-001'), bundle),
    evidenceLineage: lineage(usable), completeness: 'UNDETERMINED'
  });

  const required = uniqueSorted(input.requestedScope.requiredClaimClasses);
  const supported = new Set();
  for (const claim of required) {
    if (excludedClaims.has(claim)) continue;
    const claimEvidence = usable.filter(item => (item.claimClasses || []).includes(claim));
    if (!claimEvidence.length) continue;
    if (MATERIAL_CORROBORATION.has(claim)) {
      const primary = claimEvidence.some(item => item.sourceAuthority === 'PRIMARY');
      const independent = new Set(claimEvidence.map(item => item.independentSourceId).filter(Boolean));
      if (!primary && independent.size < 2) {
        reasons.push('EI-REASON-CB-002');
        continue;
      }
      reasons.push('EI-REASON-CB-001');
    }
    supported.add(claim);
  }

  let completeness = 'INSUFFICIENT';
  let authorisedClaims = [];
  if (required.every(claim => supported.has(claim))) {
    completeness = 'COMPLETE';
    authorisedClaims = required;
    reasons.push('EI-REASON-CP-001', 'EI-REASON-SC-001');
  } else {
    const bounded = (input.requestedScope.usefulBoundedScopes || []).find(scope =>
      Array.isArray(scope.claimClasses) && scope.claimClasses.length &&
      scope.claimClasses.every(claim => supported.has(claim)));
    if (bounded) {
      completeness = 'BOUNDED';
      authorisedClaims = uniqueSorted(bounded.claimClasses);
      limitations.push(...(bounded.limitations || ['Authority is limited to the supported bounded scope.']));
      reasons.push('EI-REASON-CP-002', 'EI-REASON-SC-002');
    } else {
      reasons.push('EI-REASON-CP-003', 'EI-REASON-SC-003');
    }
  }

  if (completeness === 'INSUFFICIENT') return finalise({
    outcome: OUTCOMES.REFUSED, authorisedScope: null, confidenceCeiling: 'NONE',
    limitations, uncertainty, reasonCodes: orderReasons(reasons, bundle),
    evidenceLineage: lineage(usable), completeness
  });

  let ceiling = completeness === 'COMPLETE' ? 'HIGH' : 'MEDIUM';
  if (usable.some(item => item.reliability === 'RELIABLE_WITH_LIMITATION')) ceiling = confidenceMinimum(ceiling, 'MEDIUM');
  if (usable.some(item => item.sourceAuthority !== 'PRIMARY' && (item.claimClasses || []).some(claim => authorisedClaims.includes(claim)))) {
    ceiling = confidenceMinimum(ceiling, 'LOW');
  }
  for (let index = 0; index < uncertainty.length; index += 1) {
    ceiling = CONFIDENCE[Math.max(1, CONFIDENCE.indexOf(ceiling) - 1)];
  }
  reasons.push('EI-REASON-CF-001');
  const outcome = completeness === 'COMPLETE' ? OUTCOMES.ELIGIBLE : OUTCOMES.LIMITED;
  return finalise({
    outcome,
    authorisedScope: {
      subject: input.requestedScope.subject,
      operations: uniqueSorted(input.requestedScope.operations),
      claimClasses: authorisedClaims,
      breadth: completeness === 'COMPLETE' ? input.requestedScope.breadth : 'bounded',
      depth: input.requestedScope.depth,
      excludedClaimClasses: required.filter(claim => !authorisedClaims.includes(claim))
    },
    confidenceCeiling: ceiling,
    limitations,
    uncertainty,
    reasonCodes: orderReasons(reasons, bundle),
    evidenceLineage: lineage(usable.filter(item => (item.claimClasses || []).some(claim => authorisedClaims.includes(claim)))),
    completeness
  });
}

function lineage(items) {
  return items.map(item => ({
    evidenceId: item.evidenceId,
    observedAt: item.observedAt,
    contentDigest: item.contentDigest,
    parentEvidenceIds: uniqueSorted(item.parentEvidenceIds || []),
    claimClasses: uniqueSorted(item.claimClasses || [])
  }));
}

function orderReasons(reasons, bundle) {
  const precedence = new Map(bundle.precedence.map((name, index) => [name, index]));
  const rules = new Map();
  for (const rule of bundle.rules) {
    for (const reason of rule.reasons || []) {
      const current = rules.get(reason);
      const rank = [precedence.get(rule.precedence) ?? 999, rule.id];
      if (!current || rank[0] < current[0] || (rank[0] === current[0] && rank[1] < current[1])) rules.set(reason, rank);
    }
  }
  return [...new Set(reasons)].sort((left, right) => {
    const a = rules.get(left) || [999, left];
    const b = rules.get(right) || [999, right];
    return a[0] - b[0] || a[1].localeCompare(b[1]) || left.localeCompare(right);
  });
}

module.exports = { OUTCOMES, assessEvidenceIntegrity };
