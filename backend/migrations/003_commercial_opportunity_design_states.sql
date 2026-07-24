CREATE TABLE IF NOT EXISTS opportunity_commercial_estimates (
  estimate_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  workspace_version INTEGER NOT NULL,
  estimate_type TEXT NOT NULL CHECK(estimate_type IN ('CONSULTANT_FEE','CLIENT_UPSIDE')),
  value_low INTEGER,
  value_high INTEGER,
  currency TEXT,
  period TEXT,
  inputs_json TEXT NOT NULL,
  assumptions_json TEXT NOT NULL,
  unavailable_information_json TEXT NOT NULL,
  method TEXT NOT NULL,
  confidence TEXT NOT NULL,
  evidence_references_json TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id,workspace_version,estimate_type),
  FOREIGN KEY(workspace_id,workspace_version)
    REFERENCES opportunity_workspace_versions(workspace_id,version) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_commercial_estimates_current
  ON opportunity_commercial_estimates(workspace_id,workspace_version,estimate_type);

CREATE TABLE IF NOT EXISTS opportunity_contact_snapshots (
  contact_snapshot_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  workspace_version INTEGER NOT NULL,
  contact_json TEXT NOT NULL,
  field_states_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id,workspace_version),
  FOREIGN KEY(workspace_id,workspace_version)
    REFERENCES opportunity_workspace_versions(workspace_id,version) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_contact_snapshots_current
  ON opportunity_contact_snapshots(workspace_id,workspace_version);

CREATE TABLE IF NOT EXISTS opportunity_attribution_snapshots (
  attribution_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  workspace_version INTEGER NOT NULL,
  metric_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_reference TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id,workspace_version,metric_key),
  FOREIGN KEY(workspace_id,workspace_version)
    REFERENCES opportunity_workspace_versions(workspace_id,version) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_attribution_dashboard
  ON opportunity_attribution_snapshots(workspace_id,workspace_version,metric_key);

CREATE TABLE IF NOT EXISTS opportunity_proposal_summaries (
  proposal_summary_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  workspace_version INTEGER NOT NULL,
  offer_decision_id TEXT NOT NULL,
  completion_id TEXT NOT NULL,
  content_json TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id,workspace_version,offer_decision_id,completion_id),
  FOREIGN KEY(offer_decision_id) REFERENCES opportunity_offer_decisions(decision_id) ON DELETE RESTRICT,
  FOREIGN KEY(completion_id) REFERENCES opportunity_review_completions(completion_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_proposal_summary_current
  ON opportunity_proposal_summaries(workspace_id,workspace_version,completion_id);
