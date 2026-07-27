const crypto = require('crypto');
const { resolveWorkspaceAccess } = require('./reportAccess');

class ActivityRepositoryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ActivityRepositoryError';
    this.code = code;
  }
}

const CATEGORIES = new Set([
  'WORKSPACE_VERSION_CURRENT', 'WORKSPACE_VERSION_SUPERSEDED',
  'REVIEW_COMPLETED', 'REVIEW_INVALIDATED', 'PREPARATION_SELECTED',
  'RECOMMENDATION_CHANGED', 'EVIDENCE_STATE_CHANGED', 'OFFER_DECISION_RECORDED',
  'NEXT_ACTION_PLANNED', 'NEXT_ACTION_CHANGED', 'NEXT_ACTION_COMPLETED', 'NEXT_ACTION_CANCELLED',
  'COMMUNICATION_RECORDED',
  'REPORT_AVAILABLE', 'REPORT_PARTIAL_EVIDENCE', 'REPORT_FAILED', 'REPORT_SUPERSEDED',
  'EVIDENCE_INTEGRITY_BLOCKED', 'EVIDENCE_INTEGRITY_RESTORED'
]);

const INTERNAL_SOURCE_TYPES = new Set([
  'EVALUATION', 'REVIEW_OPENED', 'PAGE_VIEW', 'RETRY', 'POLL', 'DIAGNOSTIC',
  'MIGRATION', 'STARTUP', 'NOTIFICATION_ATTEMPT'
]);

const timestamp = clock => clock ? clock() : new Date().toISOString();

async function storeProjectedEvent(db, input, options = {}) {
  if (input.projectionAuthority !== 'POLICY_PROJECTED') {
    throw new ActivityRepositoryError('ACTIVITY_PROJECTION_AUTHORITY_REQUIRED');
  }
  if (!CATEGORIES.has(input.eventCategory) || INTERNAL_SOURCE_TYPES.has(input.sourceEventType)) {
    throw new ActivityRepositoryError('ACTIVITY_EVENT_NOT_CUSTOMER_VISIBLE');
  }
  if (input.eventCategory === 'COMMUNICATION_RECORDED' &&
      input.communicationAuthority !== 'AUTHORITATIVE_COMMUNICATION_SOURCE') {
    throw new ActivityRepositoryError('ACTIVITY_COMMUNICATION_SOURCE_REQUIRED');
  }
  await resolveWorkspaceAccess(db, input);
  const activityEventId = options.activityEventId || `activity-${crypto.randomUUID()}`;
  const recordedAt = options.recordedAt || timestamp(options.clock);
  const operations = [{
    sql: `INSERT INTO customer_activity_events
      (activity_event_id,organization_id,workspace_id,workspace_version,source_event_id,
       source_event_type,event_category,actor_class,actor_user_id,actor_display_name,
       affected_object_type,affected_object_id,event_summary,commercial_consequence,
       communication_status,evidence_integrity_state,projection_policy_version,occurred_at,
       recorded_at,correction_of_activity_event_id,supersedes_activity_event_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    params: [
      activityEventId, input.organizationId, input.workspaceId, input.workspaceVersion || null,
      input.sourceEventId, input.sourceEventType, input.eventCategory, input.actorClass,
      input.actorUserId || null, input.actorDisplayName || null, input.affectedObjectType,
      input.affectedObjectId, input.eventSummary, input.commercialConsequence || null,
      input.communicationStatus, input.evidenceIntegrityState, input.projectionPolicyVersion,
      input.occurredAt, recordedAt, input.correctionOfActivityEventId || null,
      input.supersedesActivityEventId || null
    ]
  }];
  for (const source of input.sources || []) {
    if (!source.sourceObjectType || !source.sourceObjectId || !source.relationshipType) {
      throw new ActivityRepositoryError('ACTIVITY_SOURCE_INVALID');
    }
    operations.push({
      sql: `INSERT INTO activity_event_sources
        (activity_event_id,source_object_type,source_object_id,relationship_type)
        VALUES (?,?,?,?)`,
      params: [
        activityEventId, source.sourceObjectType, source.sourceObjectId, source.relationshipType
      ]
    });
  }
  try {
    await db.transaction(operations);
  } catch (error) {
    if (!/UNIQUE constraint failed/.test(error.message || '')) throw error;
    const existing = await db.get(`SELECT * FROM customer_activity_events
      WHERE source_event_id = ? AND event_category = ? AND projection_policy_version = ?`,
    [input.sourceEventId, input.eventCategory, input.projectionPolicyVersion]);
    if (!existing || existing.organization_id !== input.organizationId ||
        existing.workspace_id !== input.workspaceId ||
        existing.affected_object_id !== input.affectedObjectId) {
      throw new ActivityRepositoryError('ACTIVITY_IDEMPOTENCY_CONFLICT');
    }
    return Object.freeze({ ...existing, replay: true });
  }
  return Object.freeze({
    ...(await db.get('SELECT * FROM customer_activity_events WHERE activity_event_id = ?', [
      activityEventId
    ])),
    replay: false
  });
}

module.exports = {
  ActivityRepositoryError,
  CATEGORIES,
  INTERNAL_SOURCE_TYPES,
  storeProjectedEvent
};
