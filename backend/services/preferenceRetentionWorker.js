const { stableId } = require('./preferenceRetentionService');

class PreferenceRetentionWorkerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PreferenceRetentionWorkerError';
    this.code = code;
  }
}

async function processCase(db, input) {
  if (!input.workerIdentity || input.controlledInternalIdentity !== true) {
    throw new PreferenceRetentionWorkerError('RETENTION_WORKER_AUTHORITY_REQUIRED');
  }
  const row = await db.get(`SELECT * FROM preference_retention_cases
    WHERE retention_case_id=?`, [input.retentionCaseId]);
  if (!row) throw new PreferenceRetentionWorkerError('RETENTION_CASE_NOT_FOUND');
  if (row.state === 'COMPLETED') return { retention_case_id: row.retention_case_id, replay: true };
  if (row.deletion_due_at > input.now) throw new PreferenceRetentionWorkerError('RETENTION_NOT_DUE');
  const activeHold = await db.get(`SELECT 1 AS present FROM preference_retention_holds
    WHERE retention_case_id=? AND state='ACTIVE' LIMIT 1`, [row.retention_case_id]);
  if (activeHold) throw new PreferenceRetentionWorkerError('RETENTION_HELD');

  const preferences = await db.all(`SELECT * FROM user_presentation_preferences
    WHERE organization_id=? AND
      ((?='MEMBERSHIP' AND user_id=?) OR
       (?='WORKSPACE' AND workspace_id=?))`, [
    row.organization_id, row.scope_type, row.user_id, row.scope_type, row.workspace_id
  ]);
  const operations = [{
    sql: `UPDATE preference_retention_cases
      SET state='PENDING',claim_identity=?,claimed_at=?,failure_code=NULL
      WHERE retention_case_id=? AND state IN ('PENDING','FAILED')`,
    params: [input.workerIdentity, input.now, row.retention_case_id]
  }];
  for (const preference of preferences) {
    const subjectId = `audit-subject-${preference.preference_id}`;
    operations.push({
      sql: `INSERT OR IGNORE INTO preference_audit_subjects
        (audit_subject_id,opaque_preference_id,organization_id,user_id,workspace_id,field_name,created_at)
        VALUES (?,?,?,?,?,?,?)`,
      params: [
        subjectId, preference.preference_id, preference.organization_id, preference.user_id,
        preference.workspace_id, preference.field_name, preference.created_at
      ]
    });
    operations.push({
      sql: `INSERT OR IGNORE INTO preference_audit_events
        (audit_event_id,audit_subject_id,controlled_actor_class,controlled_actor_identity,
         occurred_at,update_source,outcome,retention_case_id)
        VALUES (?,?, 'RETENTION_WORKER',?,?,'RETENTION','DELETED',?)`,
      params: [
        stableId('retention-audit', `${row.retention_case_id}|${preference.preference_id}`),
        subjectId, input.workerIdentity, input.now, row.retention_case_id
      ]
    });
  }
  operations.push({
    sql: `DELETE FROM user_presentation_preferences WHERE organization_id=? AND
      ((?='MEMBERSHIP' AND user_id=?) OR
       (?='WORKSPACE' AND workspace_id=?))`,
    params: [row.organization_id, row.scope_type, row.user_id, row.scope_type, row.workspace_id]
  });
  operations.push({
    sql: `UPDATE preference_retention_cases SET state='COMPLETED',completed_at=?,
      claim_identity=?,claimed_at=?,failure_code=NULL WHERE retention_case_id=?`,
    params: [input.now, input.workerIdentity, input.now, row.retention_case_id]
  });
  await db.transaction(operations);
  const remaining = await db.get(`SELECT COUNT(*) AS count FROM user_presentation_preferences
    WHERE organization_id=? AND
      ((?='MEMBERSHIP' AND user_id=?) OR
       (?='WORKSPACE' AND workspace_id=?))`, [
    row.organization_id, row.scope_type, row.user_id, row.scope_type, row.workspace_id
  ]);
  if (Number(remaining.count) !== 0) {
    throw new PreferenceRetentionWorkerError('RETENTION_CONTENT_REMAINS');
  }
  return { retention_case_id: row.retention_case_id, replay: false, deleted: preferences.length };
}

module.exports = { PreferenceRetentionWorkerError, processCase };
