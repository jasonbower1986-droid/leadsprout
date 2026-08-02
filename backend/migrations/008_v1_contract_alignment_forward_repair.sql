-- Forward repair for protected V1 tables whose physical definitions reflect
-- earlier revisions of mutable migration artifacts 002 and 006, plus a
-- preference_retention_cases definition that did not acquire migration 007's
-- canonical scope-shape CHECK. This is not a replay of prior migrations.
--
-- The controlled runner must disable foreign-key enforcement before beginning
-- the transaction, re-enable it only after commit, and require a clean
-- PRAGMA foreign_key_check before accepting the result.

CREATE TABLE v1_contract_alignment_guard (
  workspace_source_rows INTEGER NOT NULL,
  selection_source_rows INTEGER NOT NULL,
  contact_source_rows INTEGER NOT NULL,
  retention_case_source_rows INTEGER NOT NULL,
  retention_hold_source_rows INTEGER NOT NULL,
  contact_null_provenance_rows INTEGER NOT NULL CHECK (contact_null_provenance_rows = 0),
  selection_dangling_candidate_rows INTEGER NOT NULL CHECK (selection_dangling_candidate_rows = 0),
  retention_case_shape_violation_rows INTEGER NOT NULL CHECK (retention_case_shape_violation_rows = 0),
  retention_hold_state_violation_rows INTEGER NOT NULL CHECK (retention_hold_state_violation_rows = 0),
  retention_hold_dangling_case_rows INTEGER NOT NULL CHECK (retention_hold_dangling_case_rows = 0),
  pre_repair_trigger_count INTEGER NOT NULL CHECK (pre_repair_trigger_count = 17),
  workspace_copied_rows INTEGER CHECK (workspace_copied_rows IS NULL OR workspace_copied_rows = workspace_source_rows),
  selection_copied_rows INTEGER CHECK (selection_copied_rows IS NULL OR selection_copied_rows = selection_source_rows),
  contact_copied_rows INTEGER CHECK (contact_copied_rows IS NULL OR contact_copied_rows = contact_source_rows),
  retention_case_copied_rows INTEGER CHECK (retention_case_copied_rows IS NULL OR retention_case_copied_rows = retention_case_source_rows),
  retention_hold_copied_rows INTEGER CHECK (retention_hold_copied_rows IS NULL OR retention_hold_copied_rows = retention_hold_source_rows),
  workspace_final_rows INTEGER CHECK (workspace_final_rows IS NULL OR workspace_final_rows = workspace_source_rows),
  selection_final_rows INTEGER CHECK (selection_final_rows IS NULL OR selection_final_rows = selection_source_rows),
  contact_final_rows INTEGER CHECK (contact_final_rows IS NULL OR contact_final_rows = contact_source_rows),
  retention_case_final_rows INTEGER CHECK (retention_case_final_rows IS NULL OR retention_case_final_rows = retention_case_source_rows),
  retention_hold_final_rows INTEGER CHECK (retention_hold_final_rows IS NULL OR retention_hold_final_rows = retention_hold_source_rows),
  post_repair_trigger_count INTEGER CHECK (post_repair_trigger_count IS NULL OR post_repair_trigger_count = 17),
  post_repair_canonical_trigger_count INTEGER CHECK (post_repair_canonical_trigger_count IS NULL OR post_repair_canonical_trigger_count = 17)
);

INSERT INTO v1_contract_alignment_guard (
  workspace_source_rows,
  selection_source_rows,
  contact_source_rows,
  retention_case_source_rows,
  retention_hold_source_rows,
  contact_null_provenance_rows,
  selection_dangling_candidate_rows,
  retention_case_shape_violation_rows,
  retention_hold_state_violation_rows,
  retention_hold_dangling_case_rows,
  pre_repair_trigger_count
)
SELECT
  (SELECT COUNT(*) FROM opportunity_workspaces),
  (SELECT COUNT(*) FROM opportunity_selection_decisions),
  (SELECT COUNT(*) FROM opportunity_contact_verification_snapshots),
  (SELECT COUNT(*) FROM preference_retention_cases),
  (SELECT COUNT(*) FROM preference_retention_holds),
  (SELECT COUNT(*) FROM opportunity_contact_verification_snapshots WHERE provenance_json IS NULL),
  (SELECT COUNT(*) FROM opportunity_selection_decisions AS decision
    WHERE decision.selected_candidate_snapshot_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM opportunity_candidate_snapshots AS candidate
        WHERE candidate.snapshot_id = decision.selected_candidate_snapshot_id
      )),
  (SELECT COUNT(*) FROM preference_retention_cases
    WHERE NOT (
      (scope_type='MEMBERSHIP' AND user_id IS NOT NULL AND workspace_id IS NULL) OR
      (scope_type='WORKSPACE' AND workspace_id IS NOT NULL)
    )),
  (SELECT COUNT(*) FROM preference_retention_holds
    WHERE NOT (
      (state='ACTIVE' AND released_at IS NULL AND verified_release_actor_identity IS NULL) OR
      (state='RELEASED' AND released_at IS NOT NULL AND verified_release_actor_identity IS NOT NULL)
    )),
  (SELECT COUNT(*) FROM preference_retention_holds AS hold
    WHERE NOT EXISTS (
      SELECT 1 FROM preference_retention_cases AS retention_case
      WHERE retention_case.retention_case_id = hold.retention_case_id
    )),
  (SELECT COUNT(*) FROM sqlite_schema WHERE type='trigger');

DROP TRIGGER IF EXISTS preference_membership_inactivated;
DROP TRIGGER IF EXISTS preference_workspace_revoked;
DROP TRIGGER IF EXISTS preference_audit_subjects_no_update;
DROP TRIGGER IF EXISTS preference_audit_subjects_no_delete;
DROP TRIGGER IF EXISTS preference_audit_events_no_update;
DROP TRIGGER IF EXISTS preference_audit_events_no_delete;
DROP TRIGGER IF EXISTS preference_retention_holds_release_only;
DROP TRIGGER IF EXISTS preference_retention_holds_no_delete;
DROP TRIGGER IF EXISTS preference_retention_hold_active;
DROP TRIGGER IF EXISTS preference_retention_hold_released;

CREATE TABLE opportunity_workspaces_contract_repair (
  workspace_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK(lifecycle IN ('DRAFT','EVALUATED','SELECTED','PREPARED','CLOSED')),
  current_version INTEGER NOT NULL DEFAULT 0, capability_profile_version INTEGER NOT NULL,
  pending_change_explanation TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
);

INSERT INTO opportunity_workspaces_contract_repair (
  workspace_id,user_id,title,lifecycle,current_version,capability_profile_version,
  pending_change_explanation,created_at,updated_at
)
SELECT
  workspace_id,user_id,title,lifecycle,current_version,capability_profile_version,
  pending_change_explanation,created_at,updated_at
FROM opportunity_workspaces;

UPDATE v1_contract_alignment_guard SET workspace_copied_rows =
  (SELECT COUNT(*) FROM opportunity_workspaces_contract_repair);

CREATE TABLE opportunity_selection_decisions_contract_repair (
  decision_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, workspace_version INTEGER NOT NULL,
  user_id TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('ACCEPTED','CHALLENGED')),
  selected_candidate_snapshot_id TEXT,
  resolution_route TEXT CHECK(resolution_route IS NULL OR resolution_route IN ('REASSESSMENT','CHANGED_INPUT','FURTHER_EVIDENCE','ALTERNATIVE_DECISION')),
  rationale TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id,workspace_version) REFERENCES opportunity_workspace_versions(workspace_id,version) ON DELETE RESTRICT,
  FOREIGN KEY(selected_candidate_snapshot_id) REFERENCES opportunity_candidate_snapshots(snapshot_id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
);

INSERT INTO opportunity_selection_decisions_contract_repair (
  decision_id,workspace_id,workspace_version,user_id,decision,
  selected_candidate_snapshot_id,resolution_route,rationale,created_at
)
SELECT
  decision_id,workspace_id,workspace_version,user_id,decision,
  selected_candidate_snapshot_id,resolution_route,rationale,created_at
FROM opportunity_selection_decisions;

UPDATE v1_contract_alignment_guard SET selection_copied_rows =
  (SELECT COUNT(*) FROM opportunity_selection_decisions_contract_repair);

CREATE TABLE opportunity_contact_verification_snapshots_contract_repair (
  snapshot_id TEXT PRIMARY KEY, review_id TEXT NOT NULL, field_states_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL, snapshot_digest TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(review_id) REFERENCES opportunity_reviews(review_id) ON DELETE RESTRICT
);

INSERT INTO opportunity_contact_verification_snapshots_contract_repair (
  snapshot_id,review_id,field_states_json,provenance_json,snapshot_digest,created_at
)
SELECT snapshot_id,review_id,field_states_json,provenance_json,snapshot_digest,created_at
FROM opportunity_contact_verification_snapshots;

UPDATE v1_contract_alignment_guard SET contact_copied_rows =
  (SELECT COUNT(*) FROM opportunity_contact_verification_snapshots_contract_repair);

CREATE TABLE preference_retention_cases_contract_repair (
  retention_case_id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('MEMBERSHIP','WORKSPACE')),
  organization_id TEXT NOT NULL,
  user_id TEXT,
  workspace_id TEXT,
  inactive_at TEXT NOT NULL,
  deletion_due_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PENDING','HELD','COMPLETED','FAILED')),
  claim_identity TEXT,
  claimed_at TEXT,
  completed_at TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(scope_type,organization_id,user_id,workspace_id,inactive_at),
  CHECK (
    (scope_type='MEMBERSHIP' AND user_id IS NOT NULL AND workspace_id IS NULL) OR
    (scope_type='WORKSPACE' AND workspace_id IS NOT NULL)
  )
);

INSERT INTO preference_retention_cases_contract_repair (
  retention_case_id,scope_type,organization_id,user_id,workspace_id,inactive_at,
  deletion_due_at,state,claim_identity,claimed_at,completed_at,failure_code,created_at
)
SELECT
  retention_case_id,scope_type,organization_id,user_id,workspace_id,inactive_at,
  deletion_due_at,state,claim_identity,claimed_at,completed_at,failure_code,created_at
FROM preference_retention_cases;

UPDATE v1_contract_alignment_guard SET retention_case_copied_rows =
  (SELECT COUNT(*) FROM preference_retention_cases_contract_repair);

CREATE TABLE preference_retention_holds_contract_repair (
  retention_hold_id TEXT PRIMARY KEY,
  retention_case_id TEXT NOT NULL,
  authority_domain TEXT NOT NULL CHECK (authority_domain IN ('LEGAL','SECURITY')),
  external_record_reference TEXT NOT NULL,
  external_record_digest TEXT NOT NULL,
  reason_class TEXT NOT NULL,
  verified_actor_identity TEXT NOT NULL,
  verified_release_actor_identity TEXT,
  state TEXT NOT NULL CHECK (state IN ('ACTIVE','RELEASED')),
  created_at TEXT NOT NULL,
  released_at TEXT,
  CHECK (
    (state='ACTIVE' AND released_at IS NULL AND verified_release_actor_identity IS NULL) OR
    (state='RELEASED' AND released_at IS NOT NULL AND verified_release_actor_identity IS NOT NULL)
  ),
  FOREIGN KEY(retention_case_id) REFERENCES preference_retention_cases(retention_case_id) ON DELETE RESTRICT
);

INSERT INTO preference_retention_holds_contract_repair (
  retention_hold_id,retention_case_id,authority_domain,external_record_reference,
  external_record_digest,reason_class,verified_actor_identity,
  verified_release_actor_identity,state,created_at,released_at
)
SELECT
  retention_hold_id,retention_case_id,authority_domain,external_record_reference,
  external_record_digest,reason_class,verified_actor_identity,
  verified_release_actor_identity,state,created_at,released_at
FROM preference_retention_holds;

UPDATE v1_contract_alignment_guard SET retention_hold_copied_rows =
  (SELECT COUNT(*) FROM preference_retention_holds_contract_repair);

DROP TABLE opportunity_contact_verification_snapshots;
ALTER TABLE opportunity_contact_verification_snapshots_contract_repair
  RENAME TO opportunity_contact_verification_snapshots;

DROP TABLE opportunity_selection_decisions;
ALTER TABLE opportunity_selection_decisions_contract_repair
  RENAME TO opportunity_selection_decisions;

DROP TABLE opportunity_workspaces;
ALTER TABLE opportunity_workspaces_contract_repair RENAME TO opportunity_workspaces;
CREATE INDEX idx_opportunity_workspaces_owner
  ON opportunity_workspaces(user_id,updated_at);

DROP TABLE preference_retention_holds;
DROP TABLE preference_retention_cases;
ALTER TABLE preference_retention_cases_contract_repair RENAME TO preference_retention_cases;
ALTER TABLE preference_retention_holds_contract_repair RENAME TO preference_retention_holds;
CREATE INDEX idx_preference_retention_due
  ON preference_retention_cases(state,deletion_due_at,retention_case_id);
CREATE INDEX idx_preference_retention_holds_case
  ON preference_retention_holds(retention_case_id,state);

UPDATE v1_contract_alignment_guard
SET
  workspace_final_rows = (SELECT COUNT(*) FROM opportunity_workspaces),
  selection_final_rows = (SELECT COUNT(*) FROM opportunity_selection_decisions),
  contact_final_rows = (SELECT COUNT(*) FROM opportunity_contact_verification_snapshots),
  retention_case_final_rows = (SELECT COUNT(*) FROM preference_retention_cases),
  retention_hold_final_rows = (SELECT COUNT(*) FROM preference_retention_holds);

CREATE TRIGGER preference_membership_inactivated
AFTER UPDATE OF membership_state,ended_at ON organization_memberships
WHEN OLD.membership_state='ACTIVE' AND NEW.membership_state='INACTIVE'
BEGIN
  INSERT OR IGNORE INTO preference_retention_cases
    (retention_case_id,scope_type,organization_id,user_id,workspace_id,inactive_at,
     deletion_due_at,state,created_at)
  VALUES (
    'membership-' || NEW.organization_id || '-' || NEW.user_id || '-' || NEW.ended_at,
    'MEMBERSHIP',NEW.organization_id,NEW.user_id,NULL,NEW.ended_at,
    strftime('%Y-%m-%dT%H:%M:%SZ',NEW.ended_at,'+30 days'),'PENDING',
    strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );
END;

CREATE TRIGGER preference_workspace_revoked
AFTER UPDATE OF access_state,revoked_at ON workspace_organization_access
WHEN OLD.access_state='ACTIVE' AND NEW.access_state='REVOKED'
BEGIN
  INSERT OR IGNORE INTO preference_retention_cases
    (retention_case_id,scope_type,organization_id,user_id,workspace_id,inactive_at,
     deletion_due_at,state,created_at)
  SELECT 'workspace-' || NEW.organization_id || '-' || NEW.workspace_id || '-' || NEW.revoked_at,
    'WORKSPACE',NEW.organization_id,owner_user_id,NEW.workspace_id,NEW.revoked_at,
    strftime('%Y-%m-%dT%H:%M:%SZ',NEW.revoked_at,'+30 days'),'PENDING',
    strftime('%Y-%m-%dT%H:%M:%SZ','now')
  FROM workspace_organization_access WHERE workspace_id=NEW.workspace_id;
END;

CREATE TRIGGER preference_audit_subjects_no_update
BEFORE UPDATE ON preference_audit_subjects BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AUDIT_SUBJECT'); END;
CREATE TRIGGER preference_audit_subjects_no_delete
BEFORE DELETE ON preference_audit_subjects BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AUDIT_SUBJECT'); END;
CREATE TRIGGER preference_audit_events_no_update
BEFORE UPDATE ON preference_audit_events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PREFERENCE_AUDIT'); END;
CREATE TRIGGER preference_audit_events_no_delete
BEFORE DELETE ON preference_audit_events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PREFERENCE_AUDIT'); END;
CREATE TRIGGER preference_retention_holds_release_only
BEFORE UPDATE ON preference_retention_holds
WHEN NOT (
  OLD.state='ACTIVE' AND NEW.state='RELEASED' AND OLD.released_at IS NULL AND
  NEW.released_at IS NOT NULL AND
  OLD.retention_case_id=NEW.retention_case_id AND
  OLD.authority_domain=NEW.authority_domain AND
  OLD.external_record_reference=NEW.external_record_reference AND
  OLD.external_record_digest=NEW.external_record_digest AND
  OLD.reason_class=NEW.reason_class AND
  OLD.verified_actor_identity=NEW.verified_actor_identity AND
  OLD.verified_release_actor_identity IS NULL AND
  NEW.verified_release_actor_identity IS NOT NULL AND
  OLD.created_at=NEW.created_at
)
BEGIN SELECT RAISE(ABORT,'RETENTION_HOLD_IMMUTABLE'); END;
CREATE TRIGGER preference_retention_holds_no_delete
BEFORE DELETE ON preference_retention_holds BEGIN SELECT RAISE(ABORT,'RETENTION_HOLD_IMMUTABLE'); END;
CREATE TRIGGER preference_retention_hold_active
AFTER INSERT ON preference_retention_holds
WHEN NEW.state='ACTIVE'
BEGIN
  UPDATE preference_retention_cases SET state='HELD'
  WHERE retention_case_id=NEW.retention_case_id AND state IN ('PENDING','FAILED');
END;
CREATE TRIGGER preference_retention_hold_released
AFTER UPDATE OF state ON preference_retention_holds
WHEN OLD.state='ACTIVE' AND NEW.state='RELEASED'
BEGIN
  UPDATE preference_retention_cases SET state='PENDING',claim_identity=NULL,claimed_at=NULL
  WHERE retention_case_id=NEW.retention_case_id
    AND NOT EXISTS (
      SELECT 1 FROM preference_retention_holds
      WHERE retention_case_id=NEW.retention_case_id AND state='ACTIVE'
    );
END;

UPDATE v1_contract_alignment_guard
SET
  post_repair_trigger_count = (SELECT COUNT(*) FROM sqlite_schema WHERE type='trigger'),
  post_repair_canonical_trigger_count = (
    SELECT COUNT(*) FROM sqlite_schema
    WHERE type='trigger' AND name IN (
      'trg_report_versions_available_immutable',
      'trg_report_versions_no_delete',
      'trg_report_artifacts_available_immutable',
      'trg_customer_activity_no_update',
      'trg_customer_activity_no_delete',
      'trg_activity_sources_no_update',
      'trg_activity_sources_no_delete',
      'preference_membership_inactivated',
      'preference_workspace_revoked',
      'preference_audit_subjects_no_update',
      'preference_audit_subjects_no_delete',
      'preference_audit_events_no_update',
      'preference_audit_events_no_delete',
      'preference_retention_holds_release_only',
      'preference_retention_holds_no_delete',
      'preference_retention_hold_active',
      'preference_retention_hold_released'
    )
  );

DROP TABLE v1_contract_alignment_guard;
