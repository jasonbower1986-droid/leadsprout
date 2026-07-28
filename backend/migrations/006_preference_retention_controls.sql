PRAGMA foreign_keys = ON;

ALTER TABLE preference_audit_events RENAME TO preference_audit_events_protected_legacy;

CREATE TABLE preference_audit_subjects (
  audit_subject_id TEXT PRIMARY KEY,
  opaque_preference_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  field_name TEXT NOT NULL CHECK (
    field_name IN ('evidence_density','reduced_motion','material_change_notifications')
  ),
  created_at TEXT NOT NULL
);

CREATE TABLE preference_audit_events (
  audit_event_id TEXT PRIMARY KEY,
  audit_subject_id TEXT NOT NULL,
  controlled_actor_class TEXT NOT NULL CHECK (
    controlled_actor_class IN ('CUSTOMER','SYSTEM_RECOVERY','RETENTION_WORKER')
  ),
  controlled_actor_identity TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  update_source TEXT NOT NULL CHECK (
    update_source IN ('CUSTOMER','SYSTEM_RECOVERY','RETENTION')
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('CREATED','UPDATED','DELETED')),
  retention_case_id TEXT,
  FOREIGN KEY (audit_subject_id) REFERENCES preference_audit_subjects(audit_subject_id) ON DELETE RESTRICT
);

INSERT INTO preference_audit_subjects
  (audit_subject_id,opaque_preference_id,organization_id,user_id,workspace_id,field_name,created_at)
SELECT 'audit-subject-' || preference_id,preference_id,organization_id,user_id,workspace_id,field_name,
       MIN(occurred_at)
FROM preference_audit_events_protected_legacy
GROUP BY preference_id,organization_id,user_id,workspace_id,field_name;

INSERT INTO preference_audit_events
  (audit_event_id,audit_subject_id,controlled_actor_class,controlled_actor_identity,
   occurred_at,update_source,outcome,retention_case_id)
SELECT audit_event_id,'audit-subject-' || preference_id,
       CASE update_source WHEN 'CUSTOMER' THEN 'CUSTOMER' ELSE 'SYSTEM_RECOVERY' END,
       CASE update_source WHEN 'CUSTOMER' THEN user_id ELSE 'controlled-system-recovery' END,
       occurred_at,update_source,
       CASE WHEN prior_revision=0 THEN 'CREATED' ELSE 'UPDATED' END,NULL
FROM preference_audit_events_protected_legacy;

DROP TABLE preference_audit_events_protected_legacy;

CREATE TABLE preference_retention_cases (
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

CREATE TABLE preference_retention_holds (
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
  FOREIGN KEY (retention_case_id) REFERENCES preference_retention_cases(retention_case_id) ON DELETE RESTRICT
);

CREATE INDEX idx_preference_retention_due
  ON preference_retention_cases(state,deletion_due_at,retention_case_id);
CREATE INDEX idx_preference_retention_holds_case
  ON preference_retention_holds(retention_case_id,state);

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
