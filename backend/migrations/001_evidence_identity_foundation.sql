PRAGMA foreign_keys = ON;

ALTER TABLE leads ADD COLUMN evidence_state TEXT DEFAULT NULL;

CREATE TABLE evidence_authorisations (
  contract_id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  contract_json TEXT NOT NULL,
  supersedes_contract_id TEXT DEFAULT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE evidence_identities (
  evidence_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  standard_version INTEGER NOT NULL,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('SOURCE', 'FRAGMENT', 'DERIVED')),
  subject_business_id TEXT NOT NULL,
  source_namespace TEXT NOT NULL,
  source_locator TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  fragment_locator TEXT NOT NULL DEFAULT '',
  parent_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  derivation_profile TEXT NOT NULL DEFAULT '',
  canonical_payload_digest TEXT NOT NULL UNIQUE,
  provenance_record_id TEXT NOT NULL,
  source_profile_version TEXT NOT NULL,
  derivation_profile_version TEXT DEFAULT NULL,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('ACTIVE', 'SUPERSEDED', 'INVALIDATED')),
  supersedes_evidence_id TEXT DEFAULT NULL,
  superseded_by_evidence_id TEXT DEFAULT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_evidence_identities_subject
  ON evidence_identities (subject_business_id, lifecycle_state);

CREATE TABLE evidence_identity_lifecycle_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_id TEXT NOT NULL,
  from_state TEXT DEFAULT NULL,
  to_state TEXT NOT NULL CHECK (to_state IN ('ACTIVE', 'SUPERSEDED', 'INVALIDATED')),
  reason TEXT NOT NULL,
  responsible_authority TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (evidence_id) REFERENCES evidence_identities(evidence_id)
);
CREATE INDEX idx_evidence_identity_events
  ON evidence_identity_lifecycle_events (evidence_id, event_id);

CREATE TABLE evidence_authorisation_evidence_identities (
  contract_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  lifecycle_state_at_decision TEXT NOT NULL CHECK (lifecycle_state_at_decision IN ('ACTIVE', 'SUPERSEDED', 'INVALIDATED')),
  PRIMARY KEY (contract_id, evidence_id),
  FOREIGN KEY (contract_id) REFERENCES evidence_authorisations(contract_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_id) REFERENCES evidence_identities(evidence_id) ON DELETE RESTRICT
);

CREATE TABLE evidence_identity_integrity_state (
  store_id TEXT PRIMARY KEY CHECK (store_id = 'EVIDENCE_IDENTITY'),
  identity_count INTEGER NOT NULL,
  lifecycle_event_count INTEGER NOT NULL,
  authorisation_link_count INTEGER NOT NULL,
  initialized_at TEXT NOT NULL
);
CREATE TABLE evidence_identity_record_baselines (
  evidence_id TEXT PRIMARY KEY,
  immutable_digest TEXT NOT NULL UNIQUE,
  provenance_record_id TEXT NOT NULL
);
CREATE TABLE evidence_identity_lifecycle_baselines (
  event_digest TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL
);
CREATE TABLE evidence_identity_authorisation_baselines (
  contract_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  snapshot_digest TEXT NOT NULL UNIQUE,
  PRIMARY KEY (contract_id, evidence_id)
);
INSERT INTO evidence_identity_integrity_state
  (store_id, identity_count, lifecycle_event_count, authorisation_link_count, initialized_at)
VALUES ('EVIDENCE_IDENTITY', 0, 0, 0, CURRENT_TIMESTAMP);
