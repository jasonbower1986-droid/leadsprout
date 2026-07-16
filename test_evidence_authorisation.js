const assert = require('assert');
const {
  OUTCOMES,
  createEvidenceAuthorisation,
  validateEvidenceAuthorisation,
  canPerformCommercialAssessment,
  stableStringify
} = require('./backend/utils/evidence-authorisation');
const { buildEvidenceState, reconstructEvidence } = require('./backend/utils/evidence-state');
const { enrichLeadData } = require('./backend/utils/enrichment');

const scope = {
  subjects: ['observable website evidence'], evidenceBoundary: 'fixture://business',
  breadth: 'observed fields only', depth: 'finding level', confidenceBoundary: 'evidence supported only'
};
const provenance = [{ source: 'fixture', method: 'content_validation', reference: 'fixture://business' }];
const confidence = { degree: 'EVIDENCE_SUPPORTED', basis: 'Approved fixture evidence.' };
const decision = { reason: 'Fixture decision.', ruleVersion: 'ENG-SPEC-011/2.0' };

function contract(outcome, extra = {}) {
  return createEvidenceAuthorisation({ outcome, authorisedAssessmentScope: scope, provenance,
    materialUncertainty: [], limitations: [], commercialConfidence: confidence, decision, ...extra });
}

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`✓ ${name}`); }

test('ELIGIBLE is complete and authorises assessment', () => {
  const value = contract(OUTCOMES.ELIGIBLE);
  assert.equal(validateEvidenceAuthorisation(value).valid, true);
  assert.equal(canPerformCommercialAssessment(value), true);
});

test('LIMITED requires and preserves an explicit limitation', () => {
  const limitation = { affectedScope: 'unobserved pages', reason: 'Not acquired', propagation: 'Must remain excluded downstream' };
  const value = contract(OUTCOMES.LIMITED, { limitations: [limitation], materialUncertainty: ['Unobserved pages'] });
  assert.deepEqual(value.limitations, [limitation]);
  assert.equal(canPerformCommercialAssessment(value), true);
});

test('Evidence Integrity can produce a complete LIMITED decision without broadening it', () => {
  const limitation = { affectedScope: 'unobserved pages', reason: 'Not acquired', propagation: 'Must remain excluded downstream' };
  const state = buildEvidenceState({
    valid: true,
    canonicalDecision: {
      outcome: OUTCOMES.LIMITED,
      authorisedAssessmentScope: scope,
      provenance,
      materialUncertainty: ['Unobserved pages'],
      limitations: [limitation],
      commercialConfidence: confidence,
      decision
    }
  });
  assert.equal(state.authorisation.outcome, OUTCOMES.LIMITED);
  assert.deepEqual(state.authorisation.limitations, [limitation]);
});

test('REFUSED prohibits assessment', () => assert.equal(canPerformCommercialAssessment(contract(OUTCOMES.REFUSED)), false));

test('REASSESSMENT_REQUIRED suspends assessment', () => {
  const value = contract(OUTCOMES.REASSESSMENT_REQUIRED, { reassessmentCondition: 'Reacquire evidence.' });
  assert.equal(canPerformCommercialAssessment(value), false);
});

test('missing scope fails closed', () => {
  assert.throws(() => createEvidenceAuthorisation({ outcome: OUTCOMES.ELIGIBLE, provenance,
    materialUncertainty: [], limitations: [], commercialConfidence: confidence, decision }), /authorised_scope_incomplete/);
});

test('missing provenance fails closed', () => {
  assert.throws(() => createEvidenceAuthorisation({ outcome: OUTCOMES.ELIGIBLE, authorisedAssessmentScope: scope,
    provenance: [], materialUncertainty: [], limitations: [], commercialConfidence: confidence, decision }), /provenance_incomplete/);
});

test('unknown outcome fails closed', () => assert.equal(canPerformCommercialAssessment({ outcome: 'VALIDATED' }), false));

test('equivalent decisions have deterministic identity and meaning', () => {
  const first = contract(OUTCOMES.ELIGIBLE);
  const second = contract(OUTCOMES.ELIGIBLE);
  assert.equal(first.contractId, second.contractId);
  assert.equal(stableStringify(first), stableStringify(second));
});

test('explicit canonical evidence decision survives reconstruction', () => {
  const state = buildEvidenceState({ valid: true, canonicalDecision: {
    outcome: OUTCOMES.ELIGIBLE, authorisedAssessmentScope: scope, provenance,
    materialUncertainty: [], limitations: [], commercialConfidence: confidence, decision
  } }, { reference: 'fixture://business' });
  const reconstructed = reconstructEvidence(JSON.stringify(state));
  assert.equal(reconstructed.authorisation.outcome, OUTCOMES.ELIGIBLE);
  assert.equal(reconstructed.authorisationValidation.valid, true);
});

test('explicit REFUSED decision cannot authorise assessment', () => {
  const state = buildEvidenceState({ valid: false, evidenceFailure: 'access_denied', failureReason: 'HTTP 403', canonicalDecision: {
    outcome: OUTCOMES.REFUSED, authorisedAssessmentScope: scope, provenance,
    materialUncertainty: [], limitations: [], commercialConfidence: { degree: 'NONE', basis: 'Evidence refused.' }, decision
  } }, { reference: 'fixture://blocked' });
  assert.equal(state.authorisation.outcome, OUTCOMES.REFUSED);
  assert.equal(canPerformCommercialAssessment(state.authorisation), false);
});

test('absent validation produces REASSESSMENT_REQUIRED', () => {
  const state = buildEvidenceState(null, { reference: 'fixture://missing' });
  assert.equal(state.authorisation.outcome, OUTCOMES.REASSESSMENT_REQUIRED);
});

test('legacy valid and failed results require reassessment rather than canonical promotion', () => {
  const valid = buildEvidenceState({ valid: true, checked: ['status_ok'] }, { reference: 'fixture://legacy-valid' });
  const failed = buildEvidenceState({ valid: false, evidenceFailure: 'access_denied' }, { reference: 'fixture://legacy-failed' });
  assert.equal(valid.authorisation.outcome, OUTCOMES.REASSESSMENT_REQUIRED);
  assert.equal(failed.authorisation.outcome, OUTCOMES.REASSESSMENT_REQUIRED);
});

test('legacy persisted validation is not promoted to canonical authority', () => {
  const reconstructed = reconstructEvidence(JSON.stringify({ status: 'validated', checks: [] }));
  assert.equal(reconstructed.authorisationValidation.valid, false);
});

test('reassessment history preserves the superseded contract identity', () => {
  const first = buildEvidenceState({ valid: true, checked: ['status_ok'] }, { reference: 'fixture://history' });
  const second = buildEvidenceState({ valid: true, checked: ['status_ok', 'content_sufficient'] }, {
    reference: 'fixture://history', supersedesContractId: first.authorisation.contractId
  });
  assert.equal(second.authorisation.supersedesContractId, first.authorisation.contractId);
  assert.notEqual(second.authorisation.contractId, first.authorisation.contractId);
});

test('canonical contract survives JSON persistence without semantic loss', () => {
  const state = buildEvidenceState({ valid: true, canonicalDecision: {
    outcome: OUTCOMES.ELIGIBLE, authorisedAssessmentScope: scope, provenance,
    materialUncertainty: [], limitations: [], commercialConfidence: confidence, decision
  } }, { reference: 'fixture://round-trip' });
  const stored = JSON.stringify(state);
  const reconstructed = reconstructEvidence(stored);
  assert.equal(stableStringify(reconstructed.authorisation), stableStringify(state.authorisation));
});

test('canonical REFUSED contract remains visible and blocks Commercial Intelligence', () => {
  const state = buildEvidenceState({ valid: false, evidenceFailure: 'access_denied', failureReason: 'HTTP 403', canonicalDecision: {
    outcome: OUTCOMES.REFUSED, authorisedAssessmentScope: scope, provenance,
    materialUncertainty: [], limitations: [], commercialConfidence: { degree: 'NONE', basis: 'Evidence refused.' }, decision
  } }, { reference: 'fixture://refused' });
  const enriched = enrichLeadData({
    id: 'fixture-refused', evidence_state: JSON.stringify(state), speed_score: 80,
    seo_gaps: [], conversion_gaps: [], details: { status_code: 200 }
  });
  assert.equal(enriched._evidenceFailure, 'access_denied');
  assert.equal(enriched.evidence_authorisation.outcome, OUTCOMES.REFUSED);
  assert.equal(enriched.strategy_report, null);
});

console.log(`\n${passed} canonical Evidence Authorisation tests passed.`);
