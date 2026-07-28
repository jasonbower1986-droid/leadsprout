const { INTERNAL_SOURCE_TYPES, storeProjectedEvent } = require('./activityRepository');

const EVENT_POLICY = Object.freeze({
  WORKSPACE_VERSION_BECAME_CURRENT: ['WORKSPACE_VERSION_CURRENT', 'NO_CUSTOMER_ACTION_CHANGE'],
  WORKSPACE_VERSION_WAS_SUPERSEDED: ['WORKSPACE_VERSION_SUPERSEDED', 'REVIEW_INVALIDATED'],
  RECOMMENDATION_MATERIALLY_CHANGED: ['RECOMMENDATION_CHANGED', 'REVIEW_REQUIRED'],
  EVIDENCE_AUTHORITY_CHANGED: ['EVIDENCE_STATE_CHANGED', 'REVIEW_REQUIRED'],
  REVIEW_VALIDLY_COMPLETED: ['REVIEW_COMPLETED', 'PREPARATION_ELIGIBLE'],
  REVIEW_BECAME_INVALID: ['REVIEW_INVALIDATED', 'REVIEW_INVALIDATED'],
  OFFER_DECISION_AUTHORITATIVELY_RECORDED: ['OFFER_DECISION_RECORDED', 'REVIEW_REQUIRED'],
  PREPARATION_WAS_SELECTED: ['PREPARATION_SELECTED', 'PREPARATION_ELIGIBLE'],
  NEXT_ACTION_WAS_PLANNED: ['NEXT_ACTION_PLANNED', 'NEXT_ACTION_CHANGED'],
  NEXT_ACTION_WAS_CHANGED: ['NEXT_ACTION_CHANGED', 'NEXT_ACTION_CHANGED'],
  NEXT_ACTION_WAS_COMPLETED: ['NEXT_ACTION_COMPLETED', 'NO_CUSTOMER_ACTION_CHANGE'],
  NEXT_ACTION_WAS_CANCELLED: ['NEXT_ACTION_CANCELLED', 'NEXT_ACTION_CHANGED'],
  REPORT_BECAME_AVAILABLE: ['REPORT_AVAILABLE', 'REPORT_UPDATED'],
  REPORT_HAS_PARTIAL_EVIDENCE: ['REPORT_PARTIAL_EVIDENCE', 'REPORT_UPDATED'],
  REPORT_GENERATION_FAILED: ['REPORT_FAILED', 'UNDETERMINED'],
  REPORT_WAS_SUPERSEDED: ['REPORT_SUPERSEDED', 'REPORT_UPDATED'],
  EVIDENCE_INTEGRITY_LOST: ['EVIDENCE_INTEGRITY_BLOCKED', 'PREPARATION_WITHHELD'],
  EVIDENCE_INTEGRITY_RESTORED: ['EVIDENCE_INTEGRITY_RESTORED', 'REVIEW_REQUIRED'],
  AUTHORITATIVE_COMMUNICATION_RECORDED: ['COMMUNICATION_RECORDED', 'NO_CUSTOMER_ACTION_CHANGE']
});

class ActivityProjectionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ActivityProjectionError';
    this.code = code;
  }
}

const ACTOR_AUTHORITY = Object.freeze({
  SYSTEM: Object.freeze({
    sourceObjectType: 'ACTOR_AUTHORITY_SYSTEM',
    sourceObjectId: 'LEADSPROUT'
  }),
  AUTHORISED_OPERATOR: Object.freeze({
    sourceObjectType: 'ACTOR_AUTHORITY_OPERATOR'
  }),
  AUTHORISED_INTEGRATION: Object.freeze({
    sourceObjectType: 'ACTOR_AUTHORITY_INTEGRATION'
  })
});

function hasVerifiedActorAuthority(event, sources) {
  const expected = ACTOR_AUTHORITY[event.actorClass];
  if (!expected) return true;
  if (event.actorClass !== 'SYSTEM' && !event.actorUserId) return false;
  const expectedId = expected.sourceObjectId || event.actorUserId;
  return sources.some(source =>
    source.sourceObjectType === expected.sourceObjectType &&
    source.sourceObjectId === expectedId &&
    source.relationshipType === 'CAUSE' &&
    source.verifiedRelationship === true);
}

function projectDomainEvent(event) {
  if (!event?.sourceEventType || INTERNAL_SOURCE_TYPES.has(event.sourceEventType)) return null;
  const policy = EVENT_POLICY[event.sourceEventType];
  if (!policy || event.materialChange !== true) return null;
  if (!event.sourceEventId || !event.organizationId || !event.workspaceId ||
      !event.affectedObjectType || !event.affectedObjectId || !event.occurredAt) {
    throw new ActivityProjectionError('ACTIVITY_SOURCE_INCOMPLETE');
  }
  if (event.causalSources?.some(source => source.verifiedRelationship !== true)) {
    throw new ActivityProjectionError('ACTIVITY_CAUSAL_AUTHORITY_REQUIRED');
  }
  const [eventCategory, defaultConsequence] = policy;
  const communication = eventCategory === 'COMMUNICATION_RECORDED';
  if (communication && event.communicationAuthority !== 'AUTHORITATIVE_COMMUNICATION_SOURCE') {
    throw new ActivityProjectionError('ACTIVITY_COMMUNICATION_SOURCE_REQUIRED');
  }
  const sources = event.causalSources || [];
  if (!hasVerifiedActorAuthority(event, sources)) {
    throw new ActivityProjectionError('ACTIVITY_ACTOR_AUTHORITY_REQUIRED');
  }
  const hasVerifiedDecisionBoundary = event.decisionBoundaryChanged === true &&
    sources.some(source => source.sourceObjectType === 'DECISION_BOUNDARY_BEFORE' &&
      source.relationshipType === 'CAUSE' && source.verifiedRelationship === true) &&
    sources.some(source => source.sourceObjectType === 'DECISION_BOUNDARY_AFTER' &&
      source.relationshipType === 'CAUSE' && source.verifiedRelationship === true);
  if (event.decisionBoundaryChanged === true && !hasVerifiedDecisionBoundary) {
    throw new ActivityProjectionError('ACTIVITY_DECISION_BOUNDARY_AUTHORITY_REQUIRED');
  }
  return Object.freeze({
    organizationId: event.organizationId,
    workspaceId: event.workspaceId,
    userId: event.userId,
    projectionAuthority: 'POLICY_PROJECTED',
    workspaceVersion: event.workspaceVersion,
    sourceEventId: event.sourceEventId,
    sourceEventType: event.sourceEventType,
    eventCategory,
    actorClass: event.actorClass || 'UNAVAILABLE',
    actorUserId: event.actorClass === 'SYSTEM' ? null : (event.actorUserId || null),
    actorDisplayName: null,
    affectedObjectType: event.affectedObjectType,
    affectedObjectId: event.affectedObjectId,
    eventSummary: event.eventSummary,
    commercialConsequence: hasVerifiedDecisionBoundary
      ? defaultConsequence : 'NO_CUSTOMER_ACTION_CHANGE',
    communicationStatus: communication ? 'RECORDED' : 'NOT_RECORDED',
    communicationAuthority: event.communicationAuthority,
    evidenceIntegrityState: event.evidenceIntegrityState || 'AUTHORISED',
    projectionPolicyVersion: event.projectionPolicyVersion || 'activity-1',
    occurredAt: event.occurredAt,
    correctionOfActivityEventId: event.correctionOfActivityEventId || null,
    supersedesActivityEventId: event.supersedesActivityEventId || null,
    sources: sources.map(source => ({
      sourceObjectType: source.sourceObjectType,
      sourceObjectId: source.sourceObjectId,
      relationshipType: source.relationshipType
    }))
  });
}

async function projectAndStore(db, event, options) {
  const projected = projectDomainEvent(event);
  return projected ? storeProjectedEvent(db, projected, options) : null;
}

module.exports = {
  ACTOR_AUTHORITY,
  ActivityProjectionError,
  EVENT_POLICY,
  projectDomainEvent,
  projectAndStore
};
