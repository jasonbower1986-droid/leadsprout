CREATE TABLE IF NOT EXISTS customer_capability_profiles (
  profile_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, version INTEGER NOT NULL,
  service_capabilities_json TEXT NOT NULL, delivery_constraints_json TEXT NOT NULL,
  geography_json TEXT NOT NULL, capacity TEXT NOT NULL, exclusions_json TEXT NOT NULL,
  disqualifiers_json TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(user_id, version), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_capability_profiles_owner ON customer_capability_profiles(user_id, version);

CREATE TABLE IF NOT EXISTS opportunity_workspaces (
  workspace_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK(lifecycle IN ('DRAFT','EVALUATED','SELECTED','PREPARED','CLOSED')),
  current_version INTEGER NOT NULL DEFAULT 0, capability_profile_version INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_opportunity_workspaces_owner ON opportunity_workspaces(user_id, updated_at);

CREATE TABLE IF NOT EXISTS opportunity_workspace_versions (
  workspace_id TEXT NOT NULL, version INTEGER NOT NULL, policy_version TEXT NOT NULL,
  evidence_window TEXT NOT NULL, evaluation_status TEXT NOT NULL,
  lead_candidate_snapshot_id TEXT, no_winner_reason TEXT, candidate_set_digest TEXT NOT NULL,
  superseded_version INTEGER, change_explanation TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, version), FOREIGN KEY(workspace_id) REFERENCES opportunity_workspaces(workspace_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS opportunity_candidate_snapshots (
  snapshot_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, workspace_version INTEGER NOT NULL,
  lead_id TEXT NOT NULL, subject_identity_json TEXT NOT NULL, evidence_authorisation_id TEXT,
  evidence_references_json TEXT NOT NULL, opportunity_understanding_json TEXT NOT NULL,
  evidence_digest TEXT NOT NULL, freshness TEXT NOT NULL, contradictions_json TEXT NOT NULL,
  eligibility_status TEXT NOT NULL, comparison_context TEXT NOT NULL, captured_at TEXT NOT NULL,
  UNIQUE(workspace_id, workspace_version, lead_id),
  FOREIGN KEY(workspace_id) REFERENCES opportunity_workspaces(workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(lead_id) REFERENCES leads(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_candidate_snapshots_version ON opportunity_candidate_snapshots(workspace_id, workspace_version);

CREATE TABLE IF NOT EXISTS opportunity_decision_nodes (
  node_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, workspace_version INTEGER NOT NULL,
  candidate_snapshot_id TEXT NOT NULL, type TEXT NOT NULL,
  statement TEXT NOT NULL, confidence TEXT NOT NULL, evidence_references_json TEXT NOT NULL,
  parent_node_references_json TEXT NOT NULL, assumptions_json TEXT NOT NULL,
  limitations_json TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(candidate_snapshot_id) REFERENCES opportunity_candidate_snapshots(snapshot_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS opportunity_candidate_outcomes (
  candidate_snapshot_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, workspace_version INTEGER NOT NULL,
  outcome TEXT NOT NULL, decisive_reason TEXT NOT NULL, differentiator TEXT NOT NULL,
  limitation TEXT, confidence_basis TEXT NOT NULL, priority_change_condition TEXT NOT NULL,
  next_action TEXT NOT NULL,
  FOREIGN KEY(candidate_snapshot_id) REFERENCES opportunity_candidate_snapshots(snapshot_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS opportunity_workspace_outcomes (
  workspace_id TEXT NOT NULL, workspace_version INTEGER NOT NULL, result TEXT NOT NULL,
  comparative_explanation TEXT NOT NULL, lead_snapshot_id TEXT, evaluation_limitations_json TEXT NOT NULL,
  PRIMARY KEY(workspace_id, workspace_version),
  FOREIGN KEY(workspace_id, workspace_version) REFERENCES opportunity_workspace_versions(workspace_id, version) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS opportunity_offer_recommendations (
  offer_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, workspace_version INTEGER NOT NULL,
  candidate_snapshot_id TEXT, primary_service_direction TEXT, problem_fit TEXT,
  intended_qualitative_outcome TEXT, why_first TEXT, evidence_nodes_json TEXT NOT NULL,
  assumptions_json TEXT NOT NULL, limitations_json TEXT NOT NULL, result TEXT NOT NULL,
  policy_version TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(workspace_id, workspace_version),
  FOREIGN KEY(candidate_snapshot_id) REFERENCES opportunity_candidate_snapshots(snapshot_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS opportunity_offer_decisions (
  decision_id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, user_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('ACCEPTED','ADAPTED','REJECTED')), adaptation_text TEXT, rationale TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY(offer_id) REFERENCES opportunity_offer_recommendations(offer_id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS opportunity_conversation_preparations (
  conversation_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, workspace_version INTEGER NOT NULL,
  offer_id TEXT NOT NULL, target_role_category TEXT NOT NULL, observed_condition TEXT NOT NULL,
  business_relevance TEXT NOT NULL, bounded_question TEXT NOT NULL, offer_to_explore TEXT NOT NULL,
  evidence_nodes_json TEXT NOT NULL, confidence_language TEXT NOT NULL, limitations_json TEXT NOT NULL,
  system_version TEXT NOT NULL, customer_adaptation TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY(offer_id) REFERENCES opportunity_offer_recommendations(offer_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS opportunity_next_actions (
  action_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, workspace_version INTEGER NOT NULL,
  user_id TEXT NOT NULL, type TEXT NOT NULL, owner TEXT NOT NULL, state TEXT NOT NULL,
  rationale TEXT NOT NULL, due_at TEXT, occurred_at TEXT, outcome_note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES opportunity_workspaces(workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS opportunity_next_action_events (
  event_id TEXT PRIMARY KEY, action_id TEXT NOT NULL, user_id TEXT NOT NULL,
  from_state TEXT, to_state TEXT NOT NULL, occurred_at TEXT NOT NULL,
  FOREIGN KEY(action_id) REFERENCES opportunity_next_actions(action_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS opportunity_workspace_events (
  event_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, workspace_version INTEGER,
  user_id TEXT NOT NULL, event_type TEXT NOT NULL, result_category TEXT NOT NULL,
  correlation_id TEXT NOT NULL, duration_ms INTEGER, created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES opportunity_workspaces(workspace_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_workspace_events_owner ON opportunity_workspace_events(user_id, workspace_id, created_at);
