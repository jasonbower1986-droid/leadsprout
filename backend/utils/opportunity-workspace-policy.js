const crypto = require('crypto');

const POLICY_VERSION = 'ENG-IMP-AUTH-001/1.0';
const OUTCOMES = ['LEAD', 'LOWER_PRIORITY', 'FURTHER_QUALIFICATION', 'DEFER', 'DECLINE'];
const ACTION_TRANSITIONS = Object.freeze({
  PLANNED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [], CANCELLED: []
});

class WorkspacePolicyError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

const unsupportedClaim = value => /(?:[$£€]\s*\d|\b\d+(?:\.\d+)?\s*%|\bguarantee(?:d|s)?\b|\bwill\s+(?:generate|earn|make|convert)\b)/i.test(value || '');
const stableDigest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function boundedText(value, field, max = 500, required = false) {
  if (required && (typeof value !== 'string' || !value.trim())) throw new WorkspacePolicyError('INPUT_REQUIRED', `${field} is required.`);
  if (value != null && (typeof value !== 'string' || value.length > max)) throw new WorkspacePolicyError('INPUT_INVALID', `${field} is invalid.`);
  return value?.trim();
}
function boundedStrings(value, field, maxItems = 20) {
  if (!Array.isArray(value) || value.length > maxItems || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 120)) throw new WorkspacePolicyError('INPUT_INVALID', `${field} is invalid.`);
  return value.map(item => item.trim());
}

function validateCapabilityProfile(profile) {
  if (!profile || !Array.isArray(profile.service_capabilities) || !profile.service_capabilities.length) {
    throw new WorkspacePolicyError('CAPABILITY_REQUIRED', 'At least one explicit service capability is required.');
  }
  if (!Array.isArray(profile.disqualifiers)) throw new WorkspacePolicyError('DISQUALIFIERS_REQUIRED', 'Explicit disqualifiers are required.');
  boundedStrings(profile.service_capabilities, 'service_capabilities');
  boundedStrings(profile.disqualifiers, 'disqualifiers');
  for (const field of ['delivery_constraints','geography','exclusions']) boundedStrings(profile[field] || [], field);
  boundedText(profile.capacity || 'DECLARED', 'capacity', 120, true);
  return profile;
}

function materialSignals(candidate) {
  return candidate.opportunity_understanding?.opportunity_signals || [];
}

function candidateScore(candidate, profile) {
  if (candidate.eligibility_status !== 'ELIGIBLE') return -1000;
  const text = JSON.stringify(candidate).toLowerCase();
  if ((profile.disqualifiers || []).some(item => text.includes(String(item).toLowerCase()))) return -1000;
  const signals = materialSignals(candidate);
  const capabilityFit = (profile.service_capabilities || []).some(item => text.includes(String(item).toLowerCase())) ? 4 : 0;
  const confidence = { HIGH: 3, MEDIUM: 2, LOW: 1, UNDETERMINED: 0 }[candidate.opportunity_understanding?.confidence_classification] || 0;
  const contradictionPenalty = (candidate.contradictions || []).length * 2;
  return signals.reduce((sum, signal) => sum + Math.max(1, Number(signal.priority) || 1), 0) + capabilityFit + confidence - contradictionPenalty;
}

function evaluateCandidates(candidates, profile) {
  validateCapabilityProfile(profile);
  if (!Array.isArray(candidates) || candidates.length < 3) throw new WorkspacePolicyError('MINIMUM_CANDIDATES', 'At least three candidates are required.');
  if (new Set(candidates.map(item => item.comparison_context)).size !== 1) throw new WorkspacePolicyError('MIXED_CONTEXT', 'Candidates must share one comparison context.');
  if (new Set(candidates.map(item => item.freshness)).size !== 1) throw new WorkspacePolicyError('MIXED_EVIDENCE_WINDOW', 'Candidates must share one evidence window.');
  const ranked = candidates.map(candidate => ({ candidate, score: candidateScore(candidate, profile) }))
    .sort((a, b) => b.score - a.score || String(a.candidate.lead_id).localeCompare(String(b.candidate.lead_id)));
  const winner = ranked[0].score > 0 && ranked[0].score > ranked[1].score ? ranked[0] : null;
  const outcomes = ranked.map((item, index) => {
    let outcome = 'LOWER_PRIORITY';
    if (item.score < 0) outcome = 'DECLINE';
    else if (!materialSignals(item.candidate).length) outcome = 'FURTHER_QUALIFICATION';
    else if (winner && index === 0) outcome = 'LEAD';
    else if (!winner) outcome = 'DEFER';
    return {
      candidate_snapshot_id: item.candidate.snapshot_id, outcome, score: item.score,
      decisive_reason: outcome === 'LEAD' ? 'Strongest evidence-backed capability fit in this candidate set.' : 'Another candidate is stronger or further qualification is required.',
      differentiator: `${materialSignals(item.candidate).length} material evidence-backed opportunity signal(s).`,
      limitation: (item.candidate.contradictions || [])[0] || null,
      confidence_basis: item.candidate.opportunity_understanding?.confidence_classification || 'UNDETERMINED',
      priority_change_condition: 'Re-evaluate after material evidence or customer capability changes.',
      next_action: outcome === 'LEAD' ? 'Prepare the capability-fit offer.' : outcome === 'FURTHER_QUALIFICATION' ? 'Acquire missing evidence.' : 'Retain for comparison or decline.'
    };
  });
  if (outcomes.filter(item => item.outcome === 'LEAD').length > 1 || outcomes.some(item => !OUTCOMES.includes(item.outcome))) throw new WorkspacePolicyError('OUTCOME_INVARIANT', 'Invalid candidate outcomes.');
  return {
    policy_version: POLICY_VERSION,
    candidate_set_digest: stableDigest(candidates.map(item => [item.lead_id, item.evidence_digest])),
    result: winner ? 'LEAD_SELECTED' : 'NO_WINNER',
    lead_snapshot_id: winner?.candidate.snapshot_id || null,
    no_winner_reason: winner ? null : 'No candidate materially outranks the alternatives under the declared capability and evidence.',
    comparative_explanation: winner ? `${winner.candidate.subject_identity.business_name} outranks the alternatives on evidence strength and declared capability fit.` : 'The available evidence does not support a responsible winner.',
    outcomes
  };
}

function buildDecisionGraph(candidate) {
  const signal = materialSignals(candidate)[0];
  if (!signal) return [];
  if (!(signal.evidence_references || []).length) throw new WorkspacePolicyError('TRACEABILITY_REQUIRED', 'Decision graph requires an evidence-backed observation.');
  const limitation = candidate.opportunity_understanding?.material_limitations || [];
  const confidence = candidate.opportunity_understanding?.confidence_classification || 'UNDETERMINED';
  const nodes = [
    { type: 'OBSERVATION', statement: signal.statement, evidence_references: signal.evidence_references, parent_indexes: [] },
    { type: 'BUSINESS_MEANING', statement: 'The observed condition may create friction in the customer decision journey.', evidence_references: signal.evidence_references, parent_indexes: [0] },
    { type: 'COMMERCIAL_IMPACT', statement: 'This friction may reduce the business’s ability to turn existing attention into customer action.', evidence_references: signal.evidence_references, parent_indexes: [1] },
    { type: 'OPPORTUNITY', statement: 'A capability-fit intervention can be explored without asserting a certain financial outcome.', evidence_references: signal.evidence_references, parent_indexes: [2] }
  ].map(node => ({ ...node, confidence, assumptions: [], limitations: limitation }));
  if (nodes.some(node => unsupportedClaim(node.statement))) throw new WorkspacePolicyError('PROHIBITED_CLAIM', 'Unsupported decision-graph claim rejected.');
  return nodes;
}

function buildOffer({ evaluation, candidates, profile }) {
  if (evaluation.result !== 'LEAD_SELECTED') return { result: 'NO_OFFER', limitations: ['A lead candidate has not been selected.'] };
  const candidate = candidates.find(item => item.snapshot_id === evaluation.lead_snapshot_id);
  const signalText = materialSignals(candidate).map(item => item.statement).join(' ').toLowerCase();
  const capability = profile.service_capabilities.find(item => signalText.includes(String(item).toLowerCase()));
  if (!capability) return { result: 'FURTHER_QUALIFICATION', limitations: ['No declared customer capability matches the selected opportunity.'] };
  const offer = {
    result: 'RECOMMENDED', primary_service_direction: capability,
    problem_fit: materialSignals(candidate)[0]?.statement || 'Evidence-backed commercial constraint.',
    intended_qualitative_outcome: 'Reduce the observed customer-action friction while preserving truthful evidence boundaries.',
    why_first: 'This direction addresses the highest-priority evidence-backed constraint and matches declared capability.',
    evidence_nodes: materialSignals(candidate).flatMap(item => item.evidence_references || []), assumptions: [],
    limitations: candidate.opportunity_understanding.material_limitations || [], policy_version: POLICY_VERSION
  };
  if (Object.values(offer).some(value => typeof value === 'string' && unsupportedClaim(value))) throw new WorkspacePolicyError('PROHIBITED_CLAIM', 'Unsupported numerical or guaranteed claim rejected.');
  return offer;
}

function buildConversation({ candidate, offer, target_role_category }) {
  boundedText(target_role_category, 'target_role_category', 120, true);
  if (!target_role_category || /@|\b(?:mr|mrs|ms|dr)\.?\s+[a-z]/i.test(target_role_category)) throw new WorkspacePolicyError('ROLE_CATEGORY_REQUIRED', 'Use an appropriate role category, not an invented person.');
  return {
    target_role_category,
    observed_condition: offer.problem_fit,
    business_relevance: offer.intended_qualitative_outcome,
    bounded_question: `How is the ${target_role_category} currently handling this observed constraint?`,
    offer_to_explore: `Explore whether ${offer.primary_service_direction} is appropriate.`,
    evidence_nodes: offer.evidence_nodes, confidence_language: candidate.opportunity_understanding.confidence_classification,
    limitations: offer.limitations, system_version: POLICY_VERSION
  };
}

function assertActionTransition(from, to) {
  if (!ACTION_TRANSITIONS[from]?.includes(to)) throw new WorkspacePolicyError('ILLEGAL_ACTION_TRANSITION', `Cannot transition from ${from} to ${to}.`, 409);
}

module.exports = { POLICY_VERSION, WorkspacePolicyError, unsupportedClaim, stableDigest, boundedText, validateCapabilityProfile, evaluateCandidates, buildDecisionGraph, buildOffer, buildConversation, assertActionTransition };
