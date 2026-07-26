PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS evidence_integrity_decisions (
  decision_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('ELIGIBLE','LIMITED','REFUSED','REASSESSMENT_REQUIRED')),
  envelope_json TEXT NOT NULL,
  decision_digest TEXT NOT NULL UNIQUE,
  bundle_id TEXT NOT NULL,
  bundle_version TEXT NOT NULL,
  bundle_digest TEXT NOT NULL,
  supersedes_decision_id TEXT,
  superseded_by_decision_id TEXT,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('CURRENT','SUPERSEDED','INVALIDATED')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (supersedes_decision_id) REFERENCES evidence_integrity_decisions(decision_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_integrity_current_subject
  ON evidence_integrity_decisions(subject_id) WHERE lifecycle_state = 'CURRENT';

CREATE TABLE IF NOT EXISTS evidence_integrity_decision_evidence (
  decision_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  claim_classes_json TEXT NOT NULL,
  parent_evidence_ids_json TEXT NOT NULL,
  PRIMARY KEY (decision_id,evidence_id),
  FOREIGN KEY (decision_id) REFERENCES evidence_integrity_decisions(decision_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS evidence_integrity_dependent_reasoning (
  reasoning_id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  output_digest TEXT NOT NULL,
  valid INTEGER NOT NULL CHECK (valid IN (0,1)),
  invalidated_at TEXT,
  invalidation_reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (decision_id) REFERENCES evidence_integrity_decisions(decision_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS evidence_integrity_lifecycle_events (
  event_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  prior_decision_id TEXT,
  new_decision_id TEXT NOT NULL,
  trigger_codes_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (prior_decision_id) REFERENCES evidence_integrity_decisions(decision_id),
  FOREIGN KEY (new_decision_id) REFERENCES evidence_integrity_decisions(decision_id)
);
