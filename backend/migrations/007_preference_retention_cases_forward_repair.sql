-- Forward repair for a migration-006 preference_retention_cases definition that
-- is missing the canonical scope-shape CHECK. This is not a replay of 006.
--
-- The controlled runner must disable foreign-key enforcement before beginning
-- the transaction and must re-enable it only after commit. A foreign_key_check
-- is a mandatory postcondition.

CREATE TEMP TABLE preference_retention_forward_repair_guard (
  source_row_count INTEGER NOT NULL,
  source_violation_count INTEGER NOT NULL CHECK (source_violation_count = 0),
  pre_repair_trigger_count INTEGER NOT NULL CHECK (
    pre_repair_trigger_count IN (0, 17)
  ),
  copied_row_count INTEGER CHECK (
    copied_row_count IS NULL OR copied_row_count = source_row_count
  ),
  final_row_count INTEGER CHECK (
    final_row_count IS NULL OR final_row_count = source_row_count
  ),
  post_repair_trigger_count INTEGER CHECK (
    post_repair_trigger_count IS NULL OR post_repair_trigger_count = 17
  ),
  post_repair_canonical_trigger_count INTEGER CHECK (
    post_repair_canonical_trigger_count IS NULL OR
    post_repair_canonical_trigger_count = 17
  )
);

INSERT INTO preference_retention_forward_repair_guard (
  source_row_count,
  source_violation_count,
  pre_repair_trigger_count
)
SELECT
  COUNT(*),
  COALESCE(SUM(CASE WHEN
    (scope_type='MEMBERSHIP' AND user_id IS NOT NULL AND workspace_id IS NULL) OR
    (scope_type='WORKSPACE' AND workspace_id IS NOT NULL)
  THEN 0 ELSE 1 END), 0),
  (
    SELECT COUNT(*)
    FROM sqlite_schema
    WHERE type='trigger'
  )
FROM preference_retention_cases;

DROP TRIGGER IF EXISTS trg_report_versions_available_immutable;
DROP TRIGGER IF EXISTS trg_report_versions_no_delete;
DROP TRIGGER IF EXISTS trg_report_artifacts_available_immutable;
DROP TRIGGER IF EXISTS trg_customer_activity_no_update;
DROP TRIGGER IF EXISTS trg_customer_activity_no_delete;
DROP TRIGGER IF EXISTS trg_activity_sources_no_update;
DROP TRIGGER IF EXISTS trg_activity_sources_no_delete;
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

CREATE TABLE preference_retention_cases_forward_repair (
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

INSERT INTO preference_retention_cases_forward_repair (
  retention_case_id,
  scope_type,
  organization_id,
  user_id,
  workspace_id,
  inactive_at,
  deletion_due_at,
  state,
  claim_identity,
  claimed_at,
  completed_at,
  failure_code,
  created_at
)
SELECT
  retention_case_id,
  scope_type,
  organization_id,
  user_id,
  workspace_id,
  inactive_at,
  deletion_due_at,
  state,
  claim_identity,
  claimed_at,
  completed_at,
  failure_code,
  created_at
FROM preference_retention_cases;

UPDATE preference_retention_forward_repair_guard
SET copied_row_count = (
  SELECT COUNT(*) FROM preference_retention_cases_forward_repair
);

DROP TABLE preference_retention_cases;
ALTER TABLE preference_retention_cases_forward_repair
  RENAME TO preference_retention_cases;

UPDATE preference_retention_forward_repair_guard
SET final_row_count = (
  SELECT COUNT(*) FROM preference_retention_cases
);

CREATE INDEX idx_preference_retention_due
  ON preference_retention_cases(state,deletion_due_at,retention_case_id);

CREATE TRIGGER trg_report_versions_available_immutable
BEFORE UPDATE ON report_versions
WHEN OLD.report_state IN ('AVAILABLE','PARTIAL_EVIDENCE') AND (
  NEW.report_version_id IS NOT OLD.report_version_id OR
  NEW.report_id IS NOT OLD.report_id OR
  NEW.report_version_sequence IS NOT OLD.report_version_sequence OR
  NEW.organization_id IS NOT OLD.organization_id OR
  NEW.workspace_id IS NOT OLD.workspace_id OR
  NEW.workspace_version IS NOT OLD.workspace_version OR
  NEW.candidate_snapshot_id IS NOT OLD.candidate_snapshot_id OR
  NEW.policy_version IS NOT OLD.policy_version OR
  NEW.evidence_authority_snapshot_id IS NOT OLD.evidence_authority_snapshot_id OR
  NEW.generation_attempt_id IS NOT OLD.generation_attempt_id OR
  NEW.judgement_json IS NOT OLD.judgement_json OR
  NEW.evidence_composition_json IS NOT OLD.evidence_composition_json OR
  NEW.confidence_classification IS NOT OLD.confidence_classification OR
  NEW.confidence_basis IS NOT OLD.confidence_basis OR
  NEW.limitations_json IS NOT OLD.limitations_json OR
  NEW.contradictions_json IS NOT OLD.contradictions_json OR
  NEW.provenance_json IS NOT OLD.provenance_json OR
  NEW.content_digest IS NOT OLD.content_digest OR
  NEW.rendering_contract_version IS NOT OLD.rendering_contract_version OR
  NEW.generated_at IS NOT OLD.generated_at OR
  NEW.created_at IS NOT OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_REPORT_VERSION');
END;

CREATE TRIGGER trg_report_versions_no_delete
BEFORE DELETE ON report_versions
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_REPORT_VERSION');
END;

CREATE TRIGGER trg_report_artifacts_available_immutable
BEFORE UPDATE ON report_artifacts
WHEN OLD.artifact_state = 'AVAILABLE' AND NEW.artifact_state NOT IN ('DELETED')
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_REPORT_ARTIFACT');
END;

CREATE TRIGGER trg_customer_activity_no_update
BEFORE UPDATE ON customer_activity_events
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ACTIVITY_EVENT');
END;

CREATE TRIGGER trg_customer_activity_no_delete
BEFORE DELETE ON customer_activity_events
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ACTIVITY_EVENT');
END;

CREATE TRIGGER trg_activity_sources_no_update
BEFORE UPDATE ON activity_event_sources
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ACTIVITY_SOURCE');
END;

CREATE TRIGGER trg_activity_sources_no_delete
BEFORE DELETE ON activity_event_sources
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ACTIVITY_SOURCE');
END;

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

UPDATE preference_retention_forward_repair_guard
SET
  post_repair_trigger_count = (
    SELECT COUNT(*)
    FROM sqlite_schema
    WHERE type='trigger'
  ),
  post_repair_canonical_trigger_count = (
    SELECT COUNT(*)
    FROM sqlite_schema
    WHERE type='trigger'
      AND name IN (
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

DROP TABLE preference_retention_forward_repair_guard;
