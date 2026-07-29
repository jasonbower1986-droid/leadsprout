-- Forward repair for a migration-006 preference_retention_cases definition that
-- is missing the canonical scope-shape CHECK. This is not a replay of 006.
--
-- The controlled runner must disable foreign-key enforcement before beginning
-- the transaction and must re-enable it only after commit. A foreign_key_check
-- is a mandatory postcondition.

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

DROP TABLE preference_retention_cases;
ALTER TABLE preference_retention_cases_forward_repair
  RENAME TO preference_retention_cases;

CREATE INDEX idx_preference_retention_due
  ON preference_retention_cases(state,deletion_due_at,retention_case_id);

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
