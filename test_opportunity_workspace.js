const assert = require('assert');
const {
  evaluateCandidates, buildDecisionGraph, buildOffer, buildConversation, assertActionTransition,
  unsupportedClaim, WorkspacePolicyError
} = require('./backend/utils/opportunity-workspace-policy');
const { isOpportunityWorkspaceEnabled } = require('./backend/config/opportunity-workspace');
const { interpolate } = require('./backend/database');

const profile = { service_capabilities: ['conversion'], disqualifiers: [], delivery_constraints: [], geography: [], exclusions: [] };
const candidate = (id, priorities, overrides = {}) => ({
  snapshot_id: `snapshot-${id}`, lead_id: id, comparison_context: 'CURRENT_PIPELINE', freshness: '2026-07-19',
  subject_identity: { business_name: `Business ${id}` }, eligibility_status: 'ELIGIBLE', contradictions: [],
  evidence_digest: `digest-${id}`, opportunity_understanding: {
    confidence_classification: 'HIGH', material_limitations: [],
    opportunity_signals: priorities.map((priority, index) => ({ statement: `conversion constraint ${index}`, priority, evidence_references: [`ref-${id}-${index}`] }))
  }, ...overrides
});

const candidates = [candidate('A', [9,8]), candidate('B', [5]), candidate('C', [2])];
const evaluation = evaluateCandidates(candidates, profile);
assert.strictEqual(evaluation.result, 'LEAD_SELECTED');
assert.strictEqual(evaluation.outcomes.filter(item => item.outcome === 'LEAD').length, 1);
assert.strictEqual(evaluation.lead_snapshot_id, 'snapshot-A');
assert.throws(() => evaluateCandidates(candidates.slice(0,2), profile), error => error.code === 'MINIMUM_CANDIDATES');
assert.throws(() => evaluateCandidates([candidates[0], candidates[1], candidate('D',[3],{comparison_context:'OTHER'})], profile), error => error.code === 'MIXED_CONTEXT');
assert.throws(() => evaluateCandidates([candidates[0], candidates[1], candidate('D',[3],{freshness:'OLD'})], profile), error => error.code === 'MIXED_EVIDENCE_WINDOW');

const tie = evaluateCandidates([candidate('A',[5]),candidate('B',[5]),candidate('C',[1])], profile);
assert.strictEqual(tie.result, 'NO_WINNER');
assert.strictEqual(tie.outcomes.filter(item => item.outcome === 'LEAD').length, 0);

const disqualified = evaluateCandidates([candidate('A',[9],{eligibility_status:'INELIGIBLE'}),candidate('B',[5]),candidate('C',[1])], profile);
assert(disqualified.outcomes.some(item => item.outcome === 'DECLINE'));

const offer = buildOffer({ evaluation, candidates, profile });
const graph = buildDecisionGraph(candidates[0]);
assert.deepStrictEqual(graph.map(node => node.type), ['OBSERVATION','BUSINESS_MEANING','COMMERCIAL_IMPACT','OPPORTUNITY']);
assert(graph.every(node => node.evidence_references.length > 0));
assert.deepStrictEqual(buildDecisionGraph(candidate('Z', [])), []);
assert.strictEqual(offer.result, 'RECOMMENDED');
assert.strictEqual(offer.primary_service_direction, 'conversion');
assert.strictEqual(unsupportedClaim('This will generate $10,000 and improve conversion 30%'), true);
assert.strictEqual(unsupportedClaim(offer.intended_qualitative_outcome), false);
const noFit = buildOffer({ evaluation, candidates, profile: { ...profile, service_capabilities: ['accounting'] } });
assert.strictEqual(noFit.result, 'FURTHER_QUALIFICATION');

const conversation = buildConversation({ candidate: candidates[0], offer, target_role_category: 'Business owner' });
assert.strictEqual(conversation.target_role_category, 'Business owner');
assert.throws(() => buildConversation({ candidate: candidates[0], offer, target_role_category: 'Dr Jane Smith' }), error => error.code === 'ROLE_CATEGORY_REQUIRED');
assert.doesNotThrow(() => assertActionTransition('PLANNED','IN_PROGRESS'));
assert.throws(() => assertActionTransition('COMPLETED','IN_PROGRESS'), error => error.code === 'ILLEGAL_ACTION_TRANSITION');
assert.strictEqual(isOpportunityWorkspaceEnabled({}), false);
assert.strictEqual(isOpportunityWorkspaceEnabled({ OPPORTUNITY_WORKSPACE_ENABLED: 'true' }), true);
assert.strictEqual(isOpportunityWorkspaceEnabled({ OPPORTUNITY_WORKSPACE_ENABLED: 'false' }), false);
assert.throws(() => evaluateCandidates(candidates, { ...profile, service_capabilities: ['x'.repeat(121)] }), error => error.code === 'INPUT_INVALID');
assert.strictEqual(interpolate('VALUES (?,?)', ['How?', 'Explore this']), "VALUES ('How?','Explore this')");

console.log('Commercial Opportunity Intelligence policy verification: PASS');
