const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const { dbQuery } = require('../database');
const { enrichLeadData } = require('../utils/enrichment');
const {
  POLICY_VERSION, WorkspacePolicyError, stableDigest, boundedText, validateCapabilityProfile,
  evaluateCandidates, buildDecisionGraph, buildOffer, buildConversation, assertActionTransition
} = require('../utils/opportunity-workspace-policy');

const router = express.Router();
const id = prefix => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const json = value => JSON.stringify(value ?? null);
const parse = (value, fallback = null) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };
const fail = (res, error) => {
  if (error instanceof WorkspacePolicyError) return res.status(error.status).json({ error: error.message, code: error.code });
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
  return { ...workspace, versions, candidates: hydratedCandidates, outcomes: outcomes.map(item => ({ ...item, business_name: candidateNames.get(item.candidate_snapshot_id) })), selection_decisions, decision_nodes, offers, offer_decisions, conversations, actions };
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
    await dbQuery.run(`INSERT INTO opportunity_candidate_snapshots
      (snapshot_id,workspace_id,workspace_version,lead_id,subject_identity_json,evidence_authorisation_id,evidence_references_json,opportunity_understanding_json,evidence_digest,freshness,contradictions_json,eligibility_status,comparison_context,captured_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [snapshotId, workspace.workspace_id, 0, lead.id, json(enriched.opportunity_understanding.subject_identity), enriched.evidence_authorisation?.contractId || null, json(refs), json(enriched.opportunity_understanding), stableDigest(refs), req.body.evidence_window || new Date().toISOString().slice(0,10), json(contradictions), 'ELIGIBLE', comparisonContext, now()]);
    res.status(201).json({ snapshot_id: snapshotId });
  } catch (error) { fail(res, error); }
});

router.delete('/:id/candidates', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    if (workspace.lifecycle !== 'DRAFT') throw new WorkspacePolicyError('WORKSPACE_NOT_DRAFT', 'Candidates can only change while DRAFT.', 409);
    await dbQuery.run('DELETE FROM opportunity_candidate_snapshots WHERE workspace_id = ? AND workspace_version = 0 AND lead_id = ?', [workspace.workspace_id, req.body.lead_id]);
    res.status(204).end();
  } catch (error) { fail(res, error); }
});

router.post('/:id/evaluations', auth, async (req, res) => {
  const started = Date.now();
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    if (Number(req.body.expected_version) !== Number(workspace.current_version)) throw new WorkspacePolicyError('STALE_WRITE', 'Workspace version is stale.', 409);
    const draft = (await dbQuery.all('SELECT * FROM opportunity_candidate_snapshots WHERE workspace_id = ? AND workspace_version = 0', [workspace.workspace_id])).map(hydrateCandidate);
    const profile = await latestProfile(req.user.id, workspace.capability_profile_version);
    const evaluation = evaluateCandidates(draft, profile); const version = Number(workspace.current_version) + 1; const timestamp = now();
    const operations = [];
    for (const candidate of draft) {
      operations.push({ sql: 'UPDATE opportunity_candidate_snapshots SET workspace_version = ? WHERE snapshot_id = ?', params: [version, candidate.snapshot_id] });
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
      (workspace_id,version,policy_version,evidence_window,evaluation_status,lead_candidate_snapshot_id,no_winner_reason,candidate_set_digest,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`, params: [workspace.workspace_id, version, POLICY_VERSION, draft[0].freshness, 'COMPLETE', evaluation.lead_snapshot_id, evaluation.no_winner_reason, evaluation.candidate_set_digest, timestamp] });
    for (const outcome of evaluation.outcomes) operations.push({ sql: `INSERT INTO opportunity_candidate_outcomes
      (candidate_snapshot_id,workspace_id,workspace_version,outcome,decisive_reason,differentiator,limitation,confidence_basis,priority_change_condition,next_action)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, params: [outcome.candidate_snapshot_id, workspace.workspace_id, version, outcome.outcome, outcome.decisive_reason, outcome.differentiator, outcome.limitation, outcome.confidence_basis, outcome.priority_change_condition, outcome.next_action] });
    operations.push(
      { sql: `INSERT INTO opportunity_workspace_outcomes (workspace_id,workspace_version,result,comparative_explanation,lead_snapshot_id,evaluation_limitations_json) VALUES (?,?,?,?,?,?)`, params: [workspace.workspace_id, version, evaluation.result, evaluation.comparative_explanation, evaluation.lead_snapshot_id, json([])] },
      { sql: 'UPDATE opportunity_workspaces SET lifecycle = ?, current_version = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?', params: ['EVALUATED', version, timestamp, workspace.workspace_id, req.user.id] },
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
    if (!['ACCEPTED','CHALLENGED'].includes(req.body.decision)) throw new WorkspacePolicyError('SELECTION_DECISION_INVALID', 'Selection decision must be ACCEPTED or CHALLENGED.');
    const decisionId = id('selection-decision'); const timestamp = now();
    await dbQuery.transaction([
      { sql: 'INSERT INTO opportunity_selection_decisions (decision_id,workspace_id,workspace_version,user_id,decision,rationale,created_at) VALUES (?,?,?,?,?,?,?)', params: [decisionId, workspace.workspace_id, workspace.current_version, req.user.id, req.body.decision, boundedText(req.body.rationale || '', 'rationale', 1000), timestamp] },
      { sql: 'UPDATE opportunity_workspaces SET lifecycle = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?', params: ['SELECTED', timestamp, workspace.workspace_id, req.user.id] }
    ]);
    res.json({ decision_id: decisionId, decision: req.body.decision, system_outcome_unchanged: true, customer_authored: true });
  } catch (error) { fail(res, error); }
});

router.post('/:id/offer', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    if (req.body.decision) {
      if (!['ACCEPTED','ADAPTED','REJECTED'].includes(req.body.decision)) throw new WorkspacePolicyError('OFFER_DECISION_INVALID', 'Invalid offer decision.');
      const existing = await dbQuery.get('SELECT * FROM opportunity_offer_recommendations WHERE workspace_id = ? AND workspace_version = ?', [workspace.workspace_id, workspace.current_version]);
      if (!existing) throw new WorkspacePolicyError('OFFER_REQUIRED', 'Create an offer before recording a decision.');
      const decisionId = id('offer-decision');
      await dbQuery.run('INSERT INTO opportunity_offer_decisions (decision_id,offer_id,user_id,decision,adaptation_text,rationale,created_at) VALUES (?,?,?,?,?,?,?)', [decisionId, existing.offer_id, req.user.id, req.body.decision, req.body.adaptation_text || null, req.body.rationale || null, now()]);
      return res.json({ decision_id: decisionId, decision: req.body.decision, customer_authored: true });
    }
    const outcome = await dbQuery.get('SELECT * FROM opportunity_workspace_outcomes WHERE workspace_id = ? AND workspace_version = ?', [workspace.workspace_id, workspace.current_version]);
    const candidates = (await dbQuery.all('SELECT * FROM opportunity_candidate_snapshots WHERE workspace_id = ? AND workspace_version = ?', [workspace.workspace_id, workspace.current_version])).map(hydrateCandidate);
    const profile = await latestProfile(req.user.id, workspace.capability_profile_version);
    const offer = buildOffer({ evaluation: { result: outcome.result, lead_snapshot_id: outcome.lead_snapshot_id }, candidates, profile });
    const offerId = id('offer');
    await dbQuery.run(`INSERT INTO opportunity_offer_recommendations
      (offer_id,workspace_id,workspace_version,candidate_snapshot_id,primary_service_direction,problem_fit,intended_qualitative_outcome,why_first,evidence_nodes_json,assumptions_json,limitations_json,result,policy_version,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [offerId, workspace.workspace_id, workspace.current_version, outcome.lead_snapshot_id, offer.primary_service_direction || null, offer.problem_fit || null, offer.intended_qualitative_outcome || null, offer.why_first || null, json(offer.evidence_nodes || []), json(offer.assumptions || []), json(offer.limitations || []), offer.result, POLICY_VERSION, now()]);
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
    const candidate = hydrateCandidate(await dbQuery.get('SELECT * FROM opportunity_candidate_snapshots WHERE snapshot_id = ?', [offerRow.candidate_snapshot_id]));
    const offer = { ...offerRow, evidence_nodes: parse(offerRow.evidence_nodes_json, []), limitations: parse(offerRow.limitations_json, []) };
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

router.post('/:id/actions', auth, async (req, res) => {
  try {
    const workspace = await ownedWorkspace(req.params.id, req.user.id); if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
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
    await dbQuery.run('UPDATE opportunity_workspaces SET lifecycle = ?, current_version = 0, updated_at = ? WHERE workspace_id = ? AND user_id = ?', ['DRAFT', now(), workspace.workspace_id, req.user.id]);
    res.json({ previous_version: workspace.current_version, current_version: 0, change_explanation: 'Refresh opened a new draft; prior immutable evaluation remains preserved.' });
  } catch (error) { fail(res, error); }
});

module.exports = router;
