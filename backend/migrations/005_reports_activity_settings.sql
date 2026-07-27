PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  organization_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  membership_state TEXT NOT NULL CHECK (membership_state IN ('ACTIVE','INACTIVE')),
  role_class TEXT NOT NULL CHECK (role_class IN ('MEMBER','ADMIN','OWNER')),
  created_at TEXT NOT NULL,
  ended_at TEXT,
  PRIMARY KEY (organization_id,user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (
    (membership_state = 'ACTIVE' AND ended_at IS NULL) OR
    (membership_state = 'INACTIVE' AND ended_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_organization_memberships_user
  ON organization_memberships(user_id,organization_id,membership_state);

CREATE TABLE IF NOT EXISTS workspace_organization_access (
  workspace_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  access_state TEXT NOT NULL CHECK (access_state IN ('ACTIVE','REVOKED')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (workspace_id,organization_id),
  FOREIGN KEY (workspace_id) REFERENCES opportunity_workspaces(workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,owner_user_id)
    REFERENCES organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  CHECK (
    (access_state = 'ACTIVE' AND revoked_at IS NULL) OR
    (access_state = 'REVOKED' AND revoked_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_workspace_organization_access_org
  ON workspace_organization_access(organization_id,workspace_id,access_state);

CREATE TABLE IF NOT EXISTS domain_outbox (
  outbox_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('PENDING','CLAIMED','COMPLETED','FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TEXT NOT NULL,
  locked_by TEXT,
  locked_at TEXT,
  completed_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id,organization_id)
    REFERENCES workspace_organization_access(workspace_id,organization_id) ON DELETE RESTRICT,
  CHECK (
    (state = 'CLAIMED' AND locked_by IS NOT NULL AND locked_at IS NOT NULL) OR
    (state <> 'CLAIMED' AND locked_by IS NULL AND locked_at IS NULL)
  ),
  CHECK (state <> 'COMPLETED' OR completed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_domain_outbox_claim
  ON domain_outbox(state,available_at,created_at,outbox_id);

CREATE TABLE IF NOT EXISTS report_lineages (
  report_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  current_report_version_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id,workspace_id),
  FOREIGN KEY (workspace_id,organization_id)
    REFERENCES workspace_organization_access(workspace_id,organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS report_generation_attempts (
  generation_attempt_id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  workspace_version INTEGER NOT NULL CHECK (workspace_version > 0),
  policy_version TEXT NOT NULL,
  attempt_sequence INTEGER NOT NULL CHECK (attempt_sequence > 0),
  state TEXT NOT NULL CHECK (state IN ('PENDING','RUNNING','SUCCEEDED','FAILED','INTERRUPTED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  non_secret_error_code TEXT,
  retry_eligible INTEGER NOT NULL DEFAULT 0 CHECK (retry_eligible IN (0,1)),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (report_id,workspace_version,policy_version,attempt_sequence),
  FOREIGN KEY (report_id) REFERENCES report_lineages(report_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS report_versions (
  report_version_id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  report_version_sequence INTEGER NOT NULL CHECK (report_version_sequence > 0),
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workspace_version INTEGER NOT NULL CHECK (workspace_version > 0),
  candidate_snapshot_id TEXT,
  policy_version TEXT NOT NULL,
  evidence_authority_snapshot_id TEXT NOT NULL,
  generation_attempt_id TEXT NOT NULL UNIQUE,
  report_state TEXT NOT NULL CHECK (
    report_state IN ('GENERATING','AVAILABLE','UNAVAILABLE','FAILED','PARTIAL_EVIDENCE','STALE','SUPERSEDED')
  ),
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
  judgement_json TEXT NOT NULL,
  evidence_composition_json TEXT NOT NULL,
  confidence_classification TEXT NOT NULL CHECK (
    confidence_classification IN ('STRONG','MODERATE','LIMITED','UNDETERMINED')
  ),
  confidence_basis TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  contradictions_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  rendering_contract_version TEXT NOT NULL,
  generated_at TEXT,
  superseded_by_report_version_id TEXT,
  superseded_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (report_id,report_version_sequence),
  UNIQUE (report_id,workspace_version,policy_version),
  FOREIGN KEY (report_id) REFERENCES report_lineages(report_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id,workspace_version)
    REFERENCES opportunity_workspace_versions(workspace_id,version) ON DELETE RESTRICT,
  FOREIGN KEY (candidate_snapshot_id) REFERENCES opportunity_candidate_snapshots(snapshot_id) ON DELETE RESTRICT,
  FOREIGN KEY (generation_attempt_id)
    REFERENCES report_generation_attempts(generation_attempt_id) ON DELETE RESTRICT,
  FOREIGN KEY (superseded_by_report_version_id)
    REFERENCES report_versions(report_version_id) ON DELETE RESTRICT,
  CHECK (is_current = 0 OR report_state IN ('AVAILABLE','PARTIAL_EVIDENCE')),
  CHECK (
    (report_state IN ('AVAILABLE','PARTIAL_EVIDENCE') AND generated_at IS NOT NULL) OR
    report_state NOT IN ('AVAILABLE','PARTIAL_EVIDENCE')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_versions_one_current
  ON report_versions(report_id) WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS idx_report_versions_source
  ON report_versions(organization_id,workspace_id,workspace_version,report_version_sequence);

CREATE TABLE IF NOT EXISTS report_artifacts (
  artifact_id TEXT PRIMARY KEY,
  report_version_id TEXT NOT NULL UNIQUE,
  artifact_state TEXT NOT NULL CHECK (
    artifact_state IN ('AVAILABLE','NOT_CREATED','WITHHELD','DELETED','VERIFICATION_FAILED')
  ),
  storage_identity TEXT,
  media_type TEXT,
  byte_length INTEGER CHECK (byte_length IS NULL OR byte_length >= 0),
  artifact_checksum TEXT,
  checksum_algorithm TEXT,
  checksum_verified_at TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (report_version_id) REFERENCES report_versions(report_version_id) ON DELETE RESTRICT,
  CHECK (
    artifact_state <> 'AVAILABLE' OR
    (
      storage_identity IS NOT NULL AND media_type IS NOT NULL AND
      byte_length IS NOT NULL AND artifact_checksum IS NOT NULL AND
      checksum_algorithm = 'SHA-256' AND checksum_verified_at IS NOT NULL
    )
  ),
  CHECK (artifact_state <> 'DELETED' OR deleted_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS report_version_evidence (
  report_version_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  evidence_classification TEXT NOT NULL CHECK (
    evidence_classification IN ('VERIFIED_OBSERVATION','BOUNDED_INFERENCE','MATERIAL_LIMITATION','CONTRADICTION','UNAVAILABLE_INFORMATION')
  ),
  provenance_reference TEXT NOT NULL,
  PRIMARY KEY (report_version_id,evidence_id,evidence_classification),
  FOREIGN KEY (report_version_id) REFERENCES report_versions(report_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_id) REFERENCES evidence_identities(evidence_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS customer_activity_events (
  activity_event_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workspace_version INTEGER,
  source_event_id TEXT NOT NULL,
  source_event_type TEXT NOT NULL,
  event_category TEXT NOT NULL CHECK (
    event_category IN (
      'REVIEW_COMPLETED','REVIEW_INVALIDATED','PREPARATION_SELECTED',
      'NEXT_ACTION_CREATED','NEXT_ACTION_CHANGED','NEXT_ACTION_COMPLETED','NEXT_ACTION_CANCELLED',
      'REPORT_AVAILABLE','REPORT_PARTIAL_EVIDENCE','REPORT_FAILED','REPORT_SUPERSEDED',
      'EVIDENCE_INTEGRITY_LOST','EVIDENCE_INTEGRITY_RESTORED'
    )
  ),
  actor_class TEXT NOT NULL CHECK (
    actor_class IN ('AUTHENTICATED_USER','SYSTEM','AUTHORISED_OPERATOR','AUTHORISED_INTEGRATION','UNAVAILABLE')
  ),
  actor_user_id TEXT,
  actor_display_name TEXT,
  affected_object_type TEXT NOT NULL,
  affected_object_id TEXT NOT NULL,
  event_summary TEXT NOT NULL,
  commercial_consequence TEXT,
  communication_status TEXT NOT NULL CHECK (
    communication_status IN ('NOT_RECORDED','PLANNED','RECORDED','FAILED','UNAVAILABLE')
  ),
  evidence_integrity_state TEXT NOT NULL CHECK (
    evidence_integrity_state IN ('AUTHORISED','BLOCKED','RESTORED','UNAVAILABLE')
  ),
  projection_policy_version TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  correction_of_activity_event_id TEXT,
  supersedes_activity_event_id TEXT,
  UNIQUE (source_event_id,event_category,projection_policy_version),
  FOREIGN KEY (workspace_id,organization_id)
    REFERENCES workspace_organization_access(workspace_id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (correction_of_activity_event_id)
    REFERENCES customer_activity_events(activity_event_id) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_activity_event_id)
    REFERENCES customer_activity_events(activity_event_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_customer_activity_feed
  ON customer_activity_events(organization_id,occurred_at DESC,activity_event_id DESC);
CREATE INDEX IF NOT EXISTS idx_customer_activity_workspace
  ON customer_activity_events(workspace_id,occurred_at DESC,activity_event_id DESC);

CREATE TABLE IF NOT EXISTS activity_event_sources (
  activity_event_id TEXT NOT NULL,
  source_object_type TEXT NOT NULL,
  source_object_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL CHECK (
    relationship_type IN ('CAUSE','AFFECTED_OBJECT','EVIDENCE','REPORT','CORRECTION','SUPERSESSION')
  ),
  PRIMARY KEY (activity_event_id,source_object_type,source_object_id,relationship_type),
  FOREIGN KEY (activity_event_id)
    REFERENCES customer_activity_events(activity_event_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS user_presentation_preferences (
  preference_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  field_name TEXT NOT NULL CHECK (
    field_name IN ('evidence_density','reduced_motion','material_change_notifications')
  ),
  field_value TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id,user_id)
    REFERENCES organization_memberships(organization_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id,organization_id)
    REFERENCES workspace_organization_access(workspace_id,organization_id) ON DELETE RESTRICT,
  CHECK (
    (field_name = 'evidence_density' AND field_value IN ('COMPACT','BALANCED','EXPANDED')) OR
    (field_name = 'reduced_motion' AND field_value IN ('true','false') AND workspace_id IS NULL) OR
    (field_name = 'material_change_notifications' AND field_value IN ('ENABLED','DISABLED'))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_preferences_user_wide
  ON user_presentation_preferences(organization_id,user_id,field_name)
  WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_preferences_workspace
  ON user_presentation_preferences(organization_id,user_id,workspace_id,field_name)
  WHERE workspace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS preference_audit_events (
  audit_event_id TEXT PRIMARY KEY,
  preference_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  field_name TEXT NOT NULL,
  prior_value TEXT,
  new_value TEXT NOT NULL,
  prior_revision INTEGER NOT NULL CHECK (prior_revision >= 0),
  new_revision INTEGER NOT NULL CHECK (new_revision = prior_revision + 1),
  update_source TEXT NOT NULL CHECK (update_source IN ('CUSTOMER','SYSTEM_RECOVERY')),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (preference_id)
    REFERENCES user_presentation_preferences(preference_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,user_id)
    REFERENCES organization_memberships(organization_id,user_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_preference_audit_owner
  ON preference_audit_events(organization_id,user_id,occurred_at,audit_event_id);

CREATE TRIGGER IF NOT EXISTS trg_report_versions_available_immutable
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

CREATE TRIGGER IF NOT EXISTS trg_report_versions_no_delete
BEFORE DELETE ON report_versions
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_REPORT_VERSION');
END;

CREATE TRIGGER IF NOT EXISTS trg_report_artifacts_available_immutable
BEFORE UPDATE ON report_artifacts
WHEN OLD.artifact_state = 'AVAILABLE' AND NEW.artifact_state NOT IN ('DELETED')
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_REPORT_ARTIFACT');
END;

CREATE TRIGGER IF NOT EXISTS trg_customer_activity_no_update
BEFORE UPDATE ON customer_activity_events
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ACTIVITY_EVENT');
END;

CREATE TRIGGER IF NOT EXISTS trg_customer_activity_no_delete
BEFORE DELETE ON customer_activity_events
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ACTIVITY_EVENT');
END;

CREATE TRIGGER IF NOT EXISTS trg_activity_sources_no_update
BEFORE UPDATE ON activity_event_sources
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ACTIVITY_SOURCE');
END;

CREATE TRIGGER IF NOT EXISTS trg_activity_sources_no_delete
BEFORE DELETE ON activity_event_sources
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_ACTIVITY_SOURCE');
END;

CREATE TRIGGER IF NOT EXISTS trg_preference_audit_no_update
BEFORE UPDATE ON preference_audit_events
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PREFERENCE_AUDIT');
END;

CREATE TRIGGER IF NOT EXISTS trg_preference_audit_no_delete
BEFORE DELETE ON preference_audit_events
BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_PREFERENCE_AUDIT');
END;
