const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const { dbQuery } = require('../database');
const { enrichLeadData } = require('../utils/enrichment');
const {
  POLICY_VERSION, WorkspacePolicyError, stableDigest, boundedText, validateCapabilityProfile,
  evaluateCandidates, buildDecisionGraph, buildOffer, buildConversation, assertActionTransition, evaluateReviewConditions
} = require('../utils/opportunity-workspace-policy');

const router = express.Router();
const id = prefix => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const json = value => JSON.stringify(value ?? null);
const parse = (value, fallback = null) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };
const fail = (res, error) => {
  if (error instanceof WorkspacePolicyError) return res.status(error.status).json({ error: error.message, code: error.code });
  if (/UNIQUE constraint failed: opportunity_workspace_versions|STALE_WRITE/.test(error.message || '')) return res.status(409).json({ error: 'Workspace version is stale.', code: 'STALE_WRITE' });
  console.error('[OpportunityWorkspace]', error.code || error.message);
  return res.status(500).json({ error: 'Opportunity Workspace technical failure', code: 'TECHNICAL_FAILURE' });
};

async function ownedWorkspace(workspaceId, userId) {
  return dbQuery.get('SELECT * FROM opportunity_workspaces WHERE workspace_id = ? AND user_id = ?', [workspaceId, userId]);
}

async function loadAggregate(workspace, userId) {
  const versions = await dbQuery.all('SELECT * FROM opportunity_workspace_versions WHERE workspace_id = ? ORDER BY version DESC', [workspace.workspace_id]);
  const candidates = await dbQuery.all('SELECT * FROM opportunity_candidate_snapshots WHERE workspace_id = ? ORDER BY workspace_version DESC, captured_at', [workspace.workspace_id]);
  const outcomes = await dbQuery.all('SELECT * FROM opportunity_candidate_outcomes WHERE workspace_id = ? ORDER BY workspace_version DESC', [workspace.workspace_id]);
  const selection_decisions = await dbQuery.all('SELECT * FROM opportunity_selection_decisions WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC', [workspace.workspace_id, userId]);
  const decision_nodes = await dbQuery.all('SELECT * FROM opportunity_decision_nodes WHERE workspace_id = ? ORDER BY workspace_version DESC, created_at', [workspace.workspace_id]);
  const offers = await dbQuery.all('SELECT * FROM opportunity_offer_recommendations WHERE workspace_id = ? ORDER BY workspace_version DESC', [workspace.workspace_id]);
  const offer_decisions = await dbQuery.all(`SELECT decision.* FROM opportunity_offer_decisions decision
    JOIN opportunity_offer_recommendations offer ON offer.offer_id = decision.offer_id
    WHERE offer.workspace_id = ? AND decision.user_id = ? ORDER BY decision.created_at DESC`, [workspace.workspace_id, userId]);
  const conversations = await dbQuery.all('SELECT * FROM opportunity_conversation_preparations WHERE workspace_id = ? ORDER BY workspace_version DESC', [workspace.workspace_id]);
  const actions = await dbQuery.all('SELECT * FROM opportunity_next_actions WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC', [workspace.workspace_id, userId]);
  const hydratedCandidates = candidates.map(hydrateCandidate);
  const candidateNames = new Map(hydratedCandidates.map(item => [item.snapshot_id, item.subject_identity.business_name]));
  const reviews = await dbQuery.all('SELECT * FROM opportunity_reviews WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC', [workspace.workspace_id, userId]);
  const completions = await dbQuery.all(`SELECT completion.* FROM opportunity_review_completions completion JOIN opportunity_reviews review ON review.review_id = completion.review_id WHERE review.workspace_id = ? AND review.user_id = ? ORDER BY completion.completed_at DESC`, [workspace.workspace_id, userId]);
  return { ...workspace, versions, candidates: hydratedCandidates, outcomes: outcomes.map(item => ({ ...item, business_name: candidateNames.get(item.candidate_snapshot_id) })), selection_decisions, decision_nodes, offers, offer_decisions, conversations, actions, reviews, completions };
}

const idempotencyKey = req => boundedText(req.header('idempotency-key'), 'Idempotency-Key', 160, true);
async function currentReviewContext(workspace, userId) {
  const review = await dbQuery.get('SELECT * FROM opportunity_reviews WHERE workspace_id = ? AND workspace_version = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1', [workspace.workspace_id, workspace.current_version, userId]);
  if (!review) throw new WorkspacePolicyError('REVIEW_REQUIRED', 'Open the current opportunity review first.', 409);
  const acknowledgement = await dbQuery.get('SELECT * FROM opportunity_review_acknowledgements WHERE review_id = ? AND user_id = ? ORDER BY acknowledged_at DESC LIMIT 1', [review.review_id, userId]);
  const offerDecision = await dbQuery.get(`SELECT decision.* FROM opportunity_offer_decisions decision JOIN opportunity_offer_recommendations offer ON offer.offer_id = decision.offer_id WHERE offer.workspace_id = ? AND offer.workspace_version = ? AND decision.user_id = ? ORDER BY decision.created_at DESC LIMIT 1`, [workspace.workspace_id, workspace.current_version, userId]);
  const verification = await dbQuery.get('SELECT * FROM opportunity_contact_verification_snapshots WHERE review_id = ? ORDER BY created_at DESC LIMIT 1', [review.review_id]);
  const evaluation = evaluateReviewConditions({ owned: true, current_version: review.workspace_version === workspace.current_version && review.status !== 'INVALIDATED', candidate_matches: Boolean(review.candidate_snapshot_id), evidence_accessible: Boolean(review.evidence_accessible), acknowledgement_matches: acknowledgement?.limitation_set_digest === review.limitation_set_digest, offer_decision: offerDecision?.decision, verification_snapshot_digest: verification?.snapshot_digest, next_action_guidance_presented: Boolean(review.next_action_guidance_presented), completion_action_requested: Boolean(review.completion_action_requested) });
  return { review, acknowledgement, offerDecision, verification, evaluation };
}

function hydrateCandidate(row) {
  return {
    ...row, subject_identity: parse(row.subject_identity_json, {}),
    evidence_references: parse(row.evidence_references_json, []),
    opportunity_understanding: parse(row.opportunity_understanding_json, {}),
    contradictions: parse(row.contradictions_json, [])
  };
}

async function latestProfile(userId, version) {
  const row = await dbQuery.get('SELECT * FROM customer_capability_profiles WHERE user_id = ? AND version = ?', [userId, version]);
  if (!row) throw new WorkspacePolicyError('CAPABILITY_PROFILE_NOT_FOUND', 'Capability profile not found.', 404);
  return {
    service_capabilities: parse(row.service_capabilities_json, []), delivery_constraints: parse(row.delivery_constraints_json, []),
    geography: parse(row.geography_json, []), capacity: row.capacity, exclusions: parse(row.exclusions_json, []),
    disqualifiers: parse(row.disqualifiers_json, [])
  };
}

async function createProfile(userId, body) {
  validateCapabilityProfile(body);
  const current = await dbQuery.get('SELECT MAX(version) AS version FROM customer_capability_profiles WHERE user_id = ?', [userId]);
  const version = Number(current?.version || 0) + 1;
  await dbQuery.run(`INSERT INTO customer_capability_profiles
    (profile_id,user_id,version,service_capabilities_json,delivery_constraints_json,geography_json,capacity,exclusions_json,disqualifiers_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [id('profile'), userId, version, json(body.service_capabilities), json(body.delivery_constraints || []), json(body.geography || []), body.capacity || 'DECLARED', json(body.exclusions || []), json(body.disqualifiers), now()]);
  return version;
}

router.post('/', auth, async (req, res) => {
  try {
    const profileVersion = await createProfile(req.user.id, req.body.capability_profile);
    const workspaceId = id('workspace'); const timestamp = now();
    await dbQuery.run(`INSERT INTO opportunity_workspaces
      (workspace_id,user_id,title,lifecycle,current_version,capability_profile_version,created_at,updated_at)
      VALUES (?,?,?,'DRAFT',0,?,?,?)`, [workspaceId, req.user.id, boundedText(req.body.title || 'Opportunity Decision Workspace', 'title', 160, true), profileVersion, timestamp, timestamp]);
    res.status(201).json({ workspace_id: workspaceId, current_version: 0, lifecycle: 'DRAFT', capability_profile_version: profileVersion });
  } catch (error) { fail(res, error); }
});

router.get('/', auth, async (req, res) => {
  try { res.json(await dbQuery.all('SELECT * FROM opportunity_workspaces WHERE user_id = ? ORDER BY updated_at DESC', [req.user.id])); }
  catch (error) { fail(res, error); }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    res.json(await loadAggregate(workspace, req.user.id));
  } catch (error) { fail(res, error); }
});

router.put('/:id/capability-profile', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    if (Number(req.body.expected_version) !== Number(workspace.current_version)) throw new WorkspacePolicyError('STALE_WRITE', 'Workspace version is stale.', 409);
    const version = await createProfile(req.user.id, req.body.capability_profile);
    await dbQuery.run('UPDATE opportunity_workspaces SET capability_profile_version = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?', [version, now(), workspace.workspace_id, req.user.id]);
    res.json({ capability_profile_version: version });
  } catch (error) { fail(res, error); }
});

router.post('/:id/candidates', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    if (workspace.lifecycle !== 'DRAFT') throw new WorkspacePolicyError('WORKSPACE_NOT_DRAFT', 'Candidates can only change while DRAFT.', 409);
    const lead = await dbQuery.get('SELECT * FROM leads WHERE id = ?', [req.body.lead_id]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const unlocked = await dbQuery.get('SELECT 1 AS authorised FROM unlocked_leads WHERE user_id = ? AND lead_id = ?', [req.user.id, lead.id]);
    const authorised = Boolean(unlocked) || ['pro','agency'].includes(req.user.plan);
    if (!authorised) return res.status(403).json({ error: 'Candidate evidence is not authorised for this customer', code: 'CANDIDATE_NOT_AUTHORISED' });
    const enriched = enrichLeadData(lead);
    if (!enriched.opportunity_understanding) throw new WorkspacePolicyError('CANDIDATE_EVIDENCE_UNAVAILABLE', 'Candidate lacks an eligible Opportunity Understanding result.');
    const snapshotId = id('snapshot');
    const refs = enriched.opportunity_understanding.supporting_evidence_references || [];
    const contradictions = enriched._evidence?.contradictoryEvidence || [];
    const comparisonContext = boundedText(req.body.comparison_context || 'DEFAULT', 'comparison_context', 120, true);
    const draftVersion = Number(workspace.current_version) + 1;
    await dbQuery.run(`INSERT INTO opportunity_candidate_snapshots
      (snapshot_id,workspace_id,workspace_version,lead_id,subject_identity_json,evidence_authorisation_id,evidence_references_json,opportunity_understanding_json,evidence_digest,freshness,contradictions_json,eligibility_status,comparison_context,captured_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [snapshotId, workspace.workspace_id, draftVersion, lead.id, json(enriched.opportunity_understanding.subject_identity), enriched.evidence_authorisation?.contractId || null, json(refs), json(enriched.opportunity_understanding), stableDigest(refs), req.body.evidence_window || new Date().toISOString().slice(0,10), json(contradictions), 'ELIGIBLE', comparisonContext, now()]);
    res.status(201).json({ snapshot_id: snapshotId });
  } catch (error) { fail(res, error); }
});

router.delete('/:id/candidates', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    if (workspace.lifecycle !== 'DRAFT') throw new WorkspacePolicyError('WORKSPACE_NOT_DRAFT', 'Candidates can only change while DRAFT.', 409);
    await dbQuery.run('DELETE FROM opportunity_candidate_snapshots WHERE workspace_id = ? AND workspace_version = ? AND lead_id = ?', [workspace.workspace_id, Number(workspace.current_version) + 1, req.body.lead_id]);
    res.status(204).end();
  } catch (error) { fail(res, error); }
});

router.post('/:id/evaluations', auth, async (req, res) => {
  const started = Date.now();
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    if (Number(req.body.expected_version) !== Number(workspace.current_version)) throw new WorkspacePolicyError('STALE_WRITE', 'Workspace version is stale.', 409);
    if (workspace.lifecycle !== 'DRAFT') throw new WorkspacePolicyError('WORKSPACE_NOT_DRAFT', 'Refresh the workspace before reevaluation.', 409);
    const version = Number(workspace.current_version) + 1;
    const draft = (await dbQuery.all('SELECT * FROM opportunity_candidate_snapshots WHERE workspace_id = ? AND workspace_version = ?', [workspace.workspace_id, version])).map(hydrateCandidate);
    const profile = await latestProfile(req.user.id, workspace.capability_profile_version);
    const evaluation = evaluateCandidates(draft, profile); const timestamp = now();
    const operations = [];
    for (const candidate of draft) {
      const persistedNodeIds = [];
      for (const node of buildDecisionGraph(candidate)) {
        const nodeId = id('node');
        operations.push({ sql: `INSERT INTO opportunity_decision_nodes
          (node_id,workspace_id,workspace_version,candidate_snapshot_id,type,statement,confidence,evidence_references_json,parent_node_references_json,assumptions_json,limitations_json,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, params: [nodeId, workspace.workspace_id, version, candidate.snapshot_id, node.type, node.statement, node.confidence, json(node.evidence_references), json(node.parent_indexes.map(index => persistedNodeIds[index])), json(node.assumptions), json(node.limitations), timestamp] });
        persistedNodeIds.push(nodeId);
      }
    }
    operations.push({ sql: `INSERT INTO opportunity_workspace_versions
      (workspace_id,version,policy_version,evidence_window,evaluation_status,lead_candidate_snapshot_id,no_winner_reason,candidate_set_digest,superseded_version,change_explanation,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, params: [workspace.workspace_id, version, POLICY_VERSION, draft[0].freshness, 'COMPLETE', evaluation.lead_snapshot_id, evaluation.no_winner_reason, evaluation.candidate_set_digest, workspace.current_version > 0 ? workspace.current_version : null, workspace.pending_change_explanation || (workspace.current_version > 0 ? 'Customer-requested reevaluation.' : 'Initial evaluation.'), timestamp] });
    for (const outcome of evaluation.outcomes) operations.push({ sql: `INSERT INTO opportunity_candidate_outcomes
      (candidate_snapshot_id,workspace_id,workspace_version,outcome,decisive_reason,differentiator,limitation,confidence_basis,priority_change_condition,next_action)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, params: [outcome.candidate_snapshot_id, workspace.workspace_id, version, outcome.outcome, outcome.decisive_reason, outcome.differentiator, outcome.limitation, outcome.confidence_basis, outcome.priority_change_condition, outcome.next_action] });
    operations.push(
      { sql: `INSERT INTO opportunity_workspace_outcomes (workspace_id,workspace_version,result,comparative_explanation,lead_snapshot_id,evaluation_limitations_json) VALUES (?,?,?,?,?,?)`, params: [workspace.workspace_id, version, evaluation.result, evaluation.comparative_explanation, evaluation.lead_snapshot_id, json([])] },
      { sql: 'UPDATE opportunity_workspaces SET lifecycle = ?, current_version = ?, pending_change_explanation = NULL, updated_at = ? WHERE workspace_id = ? AND user_id = ? AND current_version = ?', params: ['EVALUATED', version, timestamp, workspace.workspace_id, req.user.id, workspace.current_version] },
      { sql: `INSERT INTO opportunity_workspace_events (event_id,workspace_id,workspace_version,user_id,event_type,result_category,correlation_id,duration_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?)`, params: [id('event'), workspace.workspace_id, version, req.user.id, 'EVALUATION', evaluation.result, req.header('x-correlation-id') || id('correlation'), Date.now()-started, timestamp] }
    );
    await dbQuery.transaction(operations);
    res.json({ version, ...evaluation });
  } catch (error) { fail(res, error); }
});

router.post('/:id/selection-decision', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    if (workspace.lifecycle !== 'EVALUATED') throw new WorkspacePolicyError('SELECTION_NOT_READY', 'Selection requires a completed evaluation.', 409);
    if (!['ACCEPTED','CHALLENGED'].includes(req.body.decision)) throw new WorkspacePolicyError('SELECTION_DECISION_INVALID', 'Selection decision must be ACCEPTED or CHALLENGED.');
    const selectedSnapshotId = req.body.selected_candidate_snapshot_id || null;
    if (req.body.decision === 'ACCEPTED') {
      const candidate = selectedSnapshotId && await dbQuery.get('SELECT snapshot_id FROM opportunity_candidate_snapshots WHERE snapshot_id = ? AND workspace_id = ? AND workspace_version = ?', [selectedSnapshotId, workspace.workspace_id, workspace.current_version]);
      if (!candidate) throw new WorkspacePolicyError('SELECTED_CANDIDATE_REQUIRED', 'Accepting selection requires an evaluated candidate.', 409);
      const latestDecision = await dbQuery.get('SELECT * FROM opportunity_selection_decisions WHERE workspace_id = ? AND workspace_version = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1', [workspace.workspace_id, workspace.current_version, req.user.id]);
      if (latestDecision?.decision === 'CHALLENGED') {
        const systemOutcome = await dbQuery.get('SELECT lead_snapshot_id FROM opportunity_workspace_outcomes WHERE workspace_id = ? AND workspace_version = ?', [workspace.workspace_id, workspace.current_version]);
        if (selectedSnapshotId === systemOutcome?.lead_snapshot_id) throw new WorkspacePolicyError('CHALLENGE_UNRESOLVED', 'A challenged selection cannot progress unchanged; reassess, change inputs/evidence, or select an alternative.', 409);
      }
    }
    const decisionId = id('selection-decision'); const timestamp = now();
    await dbQuery.transaction([
      { sql: 'INSERT INTO opportunity_selection_decisions (decision_id,workspace_id,workspace_version,user_id,decision,selected_candidate_snapshot_id,resolution_route,rationale,created_at) VALUES (?,?,?,?,?,?,?,?,?)', params: [decisionId, workspace.workspace_id, workspace.current_version, req.user.id, req.body.decision, selectedSnapshotId, req.body.decision === 'CHALLENGED' ? boundedText(req.body.resolution_route || 'REASSESSMENT', 'resolution_route', 80, true) : null, boundedText(req.body.rationale || '', 'rationale', 1000), timestamp] },
      { sql: 'UPDATE opportunity_workspaces SET lifecycle = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?', params: [req.body.decision === 'ACCEPTED' ? 'SELECTED' : 'EVALUATED', timestamp, workspace.workspace_id, req.user.id] }
    ]);
    res.json({ decision_id: decisionId, decision: req.body.decision, selected_candidate_snapshot_id: selectedSnapshotId, customer_selection_controls_progression: true, customer_authored: true });
  } catch (error) { fail(res, error); }
});

router.post('/:id/offer', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    if (req.body.decision) {
      if (!['ACCEPTED','ADAPTED','REJECTED'].includes(req.body.decision)) throw new WorkspacePolicyError('OFFER_DECISION_INVALID', 'Invalid offer decision.');
      if (req.body.decision === 'ADAPTED') boundedText(req.body.adaptation_text, 'adaptation_text', 1000, true);
      const existing = await dbQuery.get('SELECT * FROM opportunity_offer_recommendations WHERE workspace_id = ? AND workspace_version = ?', [workspace.workspace_id, workspace.current_version]);
      if (!existing) throw new WorkspacePolicyError('OFFER_REQUIRED', 'Create an offer before recording a decision.');
      const decisionId = id('offer-decision');
      await dbQuery.run('INSERT INTO opportunity_offer_decisions (decision_id,offer_id,user_id,decision,adaptation_text,rationale,created_at) VALUES (?,?,?,?,?,?,?)', [decisionId, existing.offer_id, req.user.id, req.body.decision, req.body.adaptation_text || null, req.body.rationale || null, now()]);
      return res.json({ decision_id: decisionId, decision: req.body.decision, customer_authored: true });
    }
    const selection = await dbQuery.get("SELECT * FROM opportunity_selection_decisions WHERE workspace_id = ? AND workspace_version = ? AND user_id = ? AND decision = 'ACCEPTED' ORDER BY created_at DESC LIMIT 1", [workspace.workspace_id, workspace.current_version, req.user.id]);
    if (!selection || workspace.lifecycle !== 'SELECTED') throw new WorkspacePolicyError('SELECTION_ACCEPTANCE_REQUIRED', 'An accepted customer selection is required before offer preparation.', 409);
    const candidates = (await dbQuery.all('SELECT * FROM opportunity_candidate_snapshots WHERE workspace_id = ? AND workspace_version = ?', [workspace.workspace_id, workspace.current_version])).map(hydrateCandidate);
    const profile = await latestProfile(req.user.id, workspace.capability_profile_version);
    const offer = buildOffer({ evaluation: { result: 'LEAD_SELECTED', lead_snapshot_id: selection.selected_candidate_snapshot_id }, candidates, profile });
    const offerId = id('offer');
    await dbQuery.run(`INSERT INTO opportunity_offer_recommendations
      (offer_id,workspace_id,workspace_version,candidate_snapshot_id,primary_service_direction,problem_fit,intended_qualitative_outcome,why_first,evidence_nodes_json,assumptions_json,limitations_json,result,policy_version,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [offerId, workspace.workspace_id, workspace.current_version, selection.selected_candidate_snapshot_id, offer.primary_service_direction || null, offer.problem_fit || null, offer.intended_qualitative_outcome || null, offer.why_first || null, json(offer.evidence_nodes || []), json(offer.assumptions || []), json(offer.limitations || []), offer.result, POLICY_VERSION, now()]);
    res.json({ offer_id: offerId, ...offer });
  } catch (error) { fail(res, error); }
});

router.get('/:id/offer', auth, async (req, res) => {
  try { const workspace = await ownedWorkspace(req.params.id, req.user.id); if (!workspace) return res.status(404).json({ error: 'Workspace not found' }); res.json(await dbQuery.get('SELECT * FROM opportunity_offer_recommendations WHERE workspace_id = ? AND workspace_version = ?', [workspace.workspace_id, workspace.current_version])); }
  catch (error) { fail(res, error); }
});

router.post('/:id/conversation', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id); if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    const offerRow = await dbQuery.get('SELECT * FROM opportunity_offer_recommendations WHERE workspace_id = ? AND workspace_version = ?', [workspace.workspace_id, workspace.current_version]);
    if (!offerRow) throw new WorkspacePolicyError('OFFER_REQUIRED', 'Create an offer first.');
    const offerDecision = await dbQuery.get('SELECT * FROM opportunity_offer_decisions WHERE offer_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1', [offerRow.offer_id, req.user.id]);
    if (!offerDecision || !['ACCEPTED','ADAPTED'].includes(offerDecision.decision)) throw new WorkspacePolicyError('OFFER_ACCEPTANCE_REQUIRED', 'An accepted or adapted offer is required before conversation preparation.', 409);
    const candidate = hydrateCandidate(await dbQuery.get('SELECT * FROM opportunity_candidate_snapshots WHERE snapshot_id = ?', [offerRow.candidate_snapshot_id]));
    const offer = { ...offerRow, evidence_nodes: parse(offerRow.evidence_nodes_json, []), limitations: parse(offerRow.limitations_json, []) };
    if (offerDecision.decision === 'ADAPTED') offer.primary_service_direction = offerDecision.adaptation_text;
    const conversation = buildConversation({ candidate, offer, target_role_category: req.body.target_role_category }); const conversationId = id('conversation');
    await dbQuery.run(`INSERT INTO opportunity_conversation_preparations
      (conversation_id,workspace_id,workspace_version,offer_id,target_role_category,observed_condition,business_relevance,bounded_question,offer_to_explore,evidence_nodes_json,confidence_language,limitations_json,system_version,customer_adaptation,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [conversationId, workspace.workspace_id, workspace.current_version, offerRow.offer_id, conversation.target_role_category, conversation.observed_condition, conversation.business_relevance, conversation.bounded_question, conversation.offer_to_explore, json(conversation.evidence_nodes), conversation.confidence_language, json(conversation.limitations), POLICY_VERSION, req.body.customer_adaptation || null, now()]);
    await dbQuery.run('UPDATE opportunity_workspaces SET lifecycle = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?', ['PREPARED', now(), workspace.workspace_id, req.user.id]);
    res.json({ conversation_id: conversationId, ...conversation, customer_adaptation: req.body.customer_adaptation || null });
  } catch (error) { fail(res, error); }
});

router.get('/:id/conversation', auth, async (req, res) => {
  try { const workspace = await ownedWorkspace(req.params.id, req.user.id); if (!workspace) return res.status(404).json({ error: 'Workspace not found' }); res.json(await dbQuery.get('SELECT * FROM opportunity_conversation_preparations WHERE workspace_id = ? AND workspace_version = ?', [workspace.workspace_id, workspace.current_version])); }
  catch (error) { fail(res, error); }
});

router.post('/:id/review/open', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id); if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    const candidate = await dbQuery.get('SELECT * FROM opportunity_candidate_snapshots WHERE snapshot_id = ? AND workspace_id = ? AND workspace_version = ?', [req.body.candidate_snapshot_id, workspace.workspace_id, workspace.current_version]);
    if (!candidate) throw new WorkspacePolicyError('CURRENT_CANDIDATE_REQUIRED', 'Review requires a candidate from the current workspace version.', 409);
    const limitations = [...parse(candidate.contradictions_json, []), ...(parse(candidate.opportunity_understanding_json, {}).material_limitations || [])];
    const digest = stableDigest(limitations); const existing = await dbQuery.get('SELECT * FROM opportunity_reviews WHERE workspace_id = ? AND workspace_version = ? AND candidate_snapshot_id = ? AND user_id = ?', [workspace.workspace_id, workspace.current_version, candidate.snapshot_id, req.user.id]);
    if (existing) return res.json(existing);
    const reviewId = id('review'); const timestamp = now();
    const fieldStates = req.body.contact_verification || { business_identity: 'UNCONFIRMED', contact_identity: 'UNCONFIRMED', contact_role: 'UNCONFIRMED', email: 'UNCONFIRMED', phone: 'UNCONFIRMED', domain: 'UNCONFIRMED', decision_authority: 'UNCONFIRMED' };
    const verificationId = id('verification');
    await dbQuery.transaction([
      { sql: `INSERT INTO opportunity_reviews (review_id,workspace_id,workspace_version,candidate_snapshot_id,user_id,policy_version,status,limitation_set_digest,evidence_accessible,next_action_guidance_presented,completion_action_requested,created_at) VALUES (?,?,?,?,?,?,'INCOMPLETE',?,?,?,0,?)`, params: [reviewId, workspace.workspace_id, workspace.current_version, candidate.snapshot_id, req.user.id, POLICY_VERSION, digest, candidate.evidence_references_json !== '[]' ? 1 : 0, req.body.next_action_guidance_presented ? 1 : 0, timestamp] },
      { sql: 'INSERT INTO opportunity_contact_verification_snapshots (snapshot_id,review_id,field_states_json,snapshot_digest,created_at) VALUES (?,?,?,?,?)', params: [verificationId, reviewId, json(fieldStates), stableDigest(fieldStates), timestamp] },
      { sql: `INSERT INTO opportunity_workspace_events (event_id,workspace_id,workspace_version,user_id,event_type,result_category,correlation_id,duration_ms,created_at) VALUES (?,?,?,?,?,'INCOMPLETE',?,NULL,?)`, params: [id('event'), workspace.workspace_id, workspace.current_version, req.user.id, 'REVIEW_OPENED', req.header('x-correlation-id') || id('correlation'), timestamp] }
    ]);
    res.status(201).json({ review_id: reviewId, status: 'INCOMPLETE', limitation_set_digest: digest, field_verification_states: fieldStates });
  } catch (error) { fail(res, error); }
});

router.get('/:id/review', auth, async (req, res) => {
  try { const workspace = await ownedWorkspace(req.params.id, req.user.id); if (!workspace) return res.status(404).json({ error: 'Workspace not found' }); const context = await currentReviewContext(workspace, req.user.id); res.json({ ...context.review, conditions: context.evaluation.states, unsatisfied_conditions: context.evaluation.unsatisfied_conditions, completion_eligible: context.evaluation.eligible, verification_states: parse(context.verification?.field_states_json, {}) }); }
  catch (error) { fail(res, error); }
});

router.post('/:id/review/acknowledgement', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id); if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    const key = idempotencyKey(req); const context = await currentReviewContext(workspace, req.user.id);
    if (req.body.limitation_set_digest !== context.review.limitation_set_digest) throw new WorkspacePolicyError('LIMITATION_SET_CHANGED', 'The displayed limitation set has changed; reopen the review.', 409);
    const existing = await dbQuery.get('SELECT * FROM opportunity_review_acknowledgements WHERE user_id = ? AND idempotency_key = ?', [req.user.id, key]); if (existing) return res.json(existing);
    const acknowledgementId = id('acknowledgement'); await dbQuery.run('INSERT INTO opportunity_review_acknowledgements (acknowledgement_id,review_id,user_id,limitation_set_digest,idempotency_key,acknowledged_at) VALUES (?,?,?,?,?,?)', [acknowledgementId, context.review.review_id, req.user.id, context.review.limitation_set_digest, key, now()]);
    res.status(201).json({ acknowledgement_id: acknowledgementId, acknowledged: true, verification_unchanged: true });
  } catch (error) { fail(res, error); }
});

router.post('/:id/review/complete', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id); if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    if (Number(req.body.expected_version) !== Number(workspace.current_version)) throw new WorkspacePolicyError('STALE_WRITE', 'Workspace version is stale.', 409);
    const key = idempotencyKey(req); const existing = await dbQuery.get(`SELECT completion.* FROM opportunity_review_completions completion JOIN opportunity_reviews review ON review.review_id = completion.review_id WHERE completion.idempotency_key = ? AND review.user_id = ?`, [key, req.user.id]); if (existing) return res.json(existing);
    let context = await currentReviewContext(workspace, req.user.id);
    await dbQuery.run('UPDATE opportunity_reviews SET completion_action_requested = 1 WHERE review_id = ? AND user_id = ?', [context.review.review_id, req.user.id]);
    context = await currentReviewContext(workspace, req.user.id);
    if (!context.evaluation.eligible) return res.status(409).json({ error: 'Review conditions are unsatisfied.', code: 'REVIEW_INCOMPLETE', unsatisfied_conditions: context.evaluation.unsatisfied_conditions });
    const completionId = id('completion'); const timestamp = now();
    await dbQuery.transaction([
      { sql: 'INSERT INTO opportunity_review_completions (completion_id,review_id,workspace_version,offer_decision_id,condition_digest,verification_snapshot_id,policy_version,idempotency_key,completed_at) VALUES (?,?,?,?,?,?,?,?,?)', params: [completionId, context.review.review_id, workspace.current_version, context.offerDecision.decision_id, context.evaluation.condition_digest, context.verification.snapshot_id, POLICY_VERSION, key, timestamp] },
      { sql: "UPDATE opportunity_reviews SET status = 'COMPLETE', completed_at = ? WHERE review_id = ? AND user_id = ? AND status = 'INCOMPLETE'", params: [timestamp, context.review.review_id, req.user.id] },
      { sql: `INSERT INTO opportunity_workspace_events (event_id,workspace_id,workspace_version,user_id,event_type,result_category,correlation_id,duration_ms,created_at) VALUES (?,?,?,?,?,'COMPLETE',?,NULL,?)`, params: [id('event'), workspace.workspace_id, workspace.current_version, req.user.id, 'REVIEW_COMPLETED', req.header('x-correlation-id') || id('correlation'), timestamp] }
    ]);
    res.status(201).json({ completion_id: completionId, review_id: context.review.review_id, completed: true, conditions: context.evaluation.states });
  } catch (error) { fail(res, error); }
});

router.post('/:id/start-outreach', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id); if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    if (Number(req.body.expected_version) !== Number(workspace.current_version)) throw new WorkspacePolicyError('STALE_WRITE', 'Workspace version is stale.', 409);
    const key = idempotencyKey(req); const existing = await dbQuery.get('SELECT * FROM opportunity_outreach_progression_events WHERE user_id = ? AND idempotency_key = ?', [req.user.id, key]); if (existing) return res.json(existing);
    const context = await currentReviewContext(workspace, req.user.id); const completion = await dbQuery.get('SELECT * FROM opportunity_review_completions WHERE review_id = ? AND workspace_version = ?', [context.review.review_id, workspace.current_version]);
    if (!completion || context.review.status !== 'COMPLETE' || completion.offer_decision_id !== context.offerDecision?.decision_id) throw new WorkspacePolicyError('OUTREACH_GATE_CLOSED', 'Complete the current review and offer decision before Start outreach.', 409);
    const transition = req.body.transition_type; if (!['PURSUE','QUALIFY','RESEARCH','DEFER','DECLINE','ARCHIVE','PREPARE'].includes(transition)) throw new WorkspacePolicyError('TRANSITION_INVALID', 'Select a permitted customer-controlled transition.');
    const eventId = id('progression'); const timestamp = now(); await dbQuery.run('INSERT INTO opportunity_outreach_progression_events (event_id,completion_id,workspace_id,workspace_version,user_id,transition_type,idempotency_key,selected_at) VALUES (?,?,?,?,?,?,?,?)', [eventId, completion.completion_id, workspace.workspace_id, workspace.current_version, req.user.id, transition, key, timestamp]);
    res.status(201).json({ event_id: eventId, transition_type: transition, communication_sent: false, communication_recorded: false });
  } catch (error) { fail(res, error); }
});

router.post('/:id/actions', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id); if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    const progression = await dbQuery.get('SELECT event_id FROM opportunity_outreach_progression_events WHERE workspace_id = ? AND workspace_version = ? AND user_id = ? ORDER BY selected_at DESC LIMIT 1', [workspace.workspace_id, workspace.current_version, req.user.id]);
    if (!progression) throw new WorkspacePolicyError('OUTREACH_GATE_CLOSED', 'A completed review and Start outreach transition are required before creating a next action.', 409);
    if (!['PURSUE','QUALIFY','RESEARCH','DEFER','DECLINE','ARCHIVE'].includes(req.body.type)) throw new WorkspacePolicyError('ACTION_TYPE_INVALID', 'Invalid next-action type.');
    const actionId = id('action'); const timestamp = now();
    await dbQuery.run(`INSERT INTO opportunity_next_actions (action_id,workspace_id,workspace_version,user_id,type,owner,state,rationale,due_at,created_at,updated_at) VALUES (?,?,?,?,?,?,'PLANNED',?,?,?,?)`, [actionId, workspace.workspace_id, workspace.current_version, req.user.id, req.body.type, boundedText(req.body.owner || req.user.email, 'owner', 160, true), boundedText(req.body.rationale || 'Customer-selected next action.', 'rationale', 1000, true), req.body.due_at || null, timestamp, timestamp]);
    await dbQuery.run(`INSERT INTO opportunity_next_action_events (event_id,action_id,user_id,from_state,to_state,occurred_at) VALUES (?,?,?,NULL,'PLANNED',?)`, [id('action-event'), actionId, req.user.id, timestamp]);
    res.status(201).json({ action_id: actionId, state: 'PLANNED' });
  } catch (error) { fail(res, error); }
});

router.patch('/:id/actions', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id); if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    const action = await dbQuery.get('SELECT * FROM opportunity_next_actions WHERE action_id = ? AND workspace_id = ? AND user_id = ?', [req.body.action_id, workspace.workspace_id, req.user.id]);
    if (!action) return res.status(404).json({ error: 'Action not found' });
    assertActionTransition(action.state, req.body.state); const timestamp = now();
    await dbQuery.run('UPDATE opportunity_next_actions SET state = ?, outcome_note = ?, occurred_at = ?, updated_at = ? WHERE action_id = ? AND user_id = ?', [req.body.state, req.body.outcome_note || null, ['COMPLETED','CANCELLED'].includes(req.body.state) ? timestamp : null, timestamp, action.action_id, req.user.id]);
    await dbQuery.run('INSERT INTO opportunity_next_action_events (event_id,action_id,user_id,from_state,to_state,occurred_at) VALUES (?,?,?,?,?,?)', [id('action-event'), action.action_id, req.user.id, action.state, req.body.state, timestamp]);
    res.json({ action_id: action.action_id, state: req.body.state });
  } catch (error) { fail(res, error); }
});

router.post('/:id/refresh', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id); if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    if (Number(req.body.expected_version) !== Number(workspace.current_version)) throw new WorkspacePolicyError('STALE_WRITE', 'Workspace version is stale.', 409);
    if (workspace.lifecycle === 'DRAFT') throw new WorkspacePolicyError('REFRESH_ALREADY_OPEN', 'A refresh draft is already open.', 409);
    const explanation = boundedText(req.body.change_explanation, 'change_explanation', 1000, true);
    const materialCategory = req.body.material_category;
    if (!['EVIDENCE','POLICY','CUSTOMER_CONSTRAINT','CANDIDATE_OUTCOME','OFFER_RECOMMENDATION','VERIFICATION_STATE'].includes(materialCategory)) throw new WorkspacePolicyError('MATERIAL_CATEGORY_REQUIRED', 'An explicit recognised material-change category is required.');
    const previous = await dbQuery.all('SELECT * FROM opportunity_candidate_snapshots WHERE workspace_id = ? AND workspace_version = ?', [workspace.workspace_id, workspace.current_version]);
    const nextVersion = Number(workspace.current_version) + 1; const timestamp = now();
    const operations = previous.map(candidate => ({ sql: `INSERT INTO opportunity_candidate_snapshots
      (snapshot_id,workspace_id,workspace_version,lead_id,subject_identity_json,evidence_authorisation_id,evidence_references_json,opportunity_understanding_json,evidence_digest,freshness,contradictions_json,eligibility_status,comparison_context,captured_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, params: [id('snapshot'), workspace.workspace_id, nextVersion, candidate.lead_id, candidate.subject_identity_json, candidate.evidence_authorisation_id, candidate.evidence_references_json, candidate.opportunity_understanding_json, candidate.evidence_digest, candidate.freshness, candidate.contradictions_json, candidate.eligibility_status, candidate.comparison_context, timestamp] }));
    const priorReviews = await dbQuery.all("SELECT review.*, completion.completion_id FROM opportunity_reviews review LEFT JOIN opportunity_review_completions completion ON completion.review_id = review.review_id WHERE review.workspace_id = ? AND review.workspace_version = ? AND review.user_id = ? AND review.status != 'INVALIDATED'", [workspace.workspace_id, workspace.current_version, req.user.id]);
    for (const review of priorReviews) operations.push(
      { sql: "UPDATE opportunity_reviews SET status = 'INVALIDATED', invalidated_at = ? WHERE review_id = ?", params: [timestamp, review.review_id] },
      { sql: 'INSERT INTO opportunity_review_invalidations (invalidation_id,review_id,completion_id,superseding_workspace_version,material_category,reason,invalidated_at) VALUES (?,?,?,?,?,?,?)', params: [id('invalidation'), review.review_id, review.completion_id || null, nextVersion, materialCategory, explanation, timestamp] },
      { sql: `INSERT INTO opportunity_workspace_events (event_id,workspace_id,workspace_version,user_id,event_type,result_category,correlation_id,duration_ms,created_at) VALUES (?,?,?,?,?,'INVALIDATED',?,NULL,?)`, params: [id('event'), workspace.workspace_id, workspace.current_version, req.user.id, 'REVIEW_INVALIDATED', req.header('x-correlation-id') || id('correlation'), timestamp] }
    );
    operations.push({ sql: 'UPDATE opportunity_workspaces SET lifecycle = ?, pending_change_explanation = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ? AND current_version = ?', params: ['DRAFT', explanation, timestamp, workspace.workspace_id, req.user.id, workspace.current_version] });
    await dbQuery.transaction(operations);
    res.json({ previous_version: workspace.current_version, draft_version: nextVersion, current_version: workspace.current_version, material_category: materialCategory, prior_completion_unlocks_new_version: false, change_explanation: explanation });
  } catch (error) { fail(res, error); }
});

module.exports = router;
