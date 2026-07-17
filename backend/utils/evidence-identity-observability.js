const EVENT_NAMES = Object.freeze({
  ISSUANCE_REQUESTED: 'identity_issuance_requested',
  EXISTING_RETURNED: 'existing_identity_returned',
  ISSUED: 'identity_issued',
  VALIDATION_FAILED: 'identity_validation_failed',
  CONFLICT: 'identity_conflict_detected',
  LIFECYCLE_TRANSITIONED: 'lifecycle_transitioned',
  SUPERSEDED: 'evidence_superseded',
  INVALIDATED: 'evidence_invalidated',
  PROVENANCE_MISMATCH: 'provenance_mismatch_detected',
  DOWNSTREAM_REJECTED: 'downstream_reference_rejected'
});

function boundedEvent(name, context = {}) {
  return {
    event: name,
    correlation_id: context.correlation_id || 'unassigned',
    evidence_id: context.evidence_id || null,
    item_kind: context.item_kind || null,
    source_namespace: context.source_namespace || null,
    standard_version: context.standard_version || 1,
    profile_version: context.profile_version || null,
    lifecycle_state: context.lifecycle_state || null,
    result_category: context.result_category || 'UNSPECIFIED'
  };
}

function createEvidenceIdentityObserver(sink = console.info) {
  const metrics = new Map();
  return {
    emit(name, context) {
      const event = boundedEvent(name, context);
      const metricKey = `${name}:${event.result_category}`;
      metrics.set(metricKey, (metrics.get(metricKey) || 0) + 1);
      sink('[EvidenceIdentity]', event);
      return event;
    },
    metricSnapshot() {
      return Object.fromEntries([...metrics.entries()].sort(([left], [right]) => left.localeCompare(right)));
    }
  };
}

module.exports = { EVENT_NAMES, boundedEvent, createEvidenceIdentityObserver };
