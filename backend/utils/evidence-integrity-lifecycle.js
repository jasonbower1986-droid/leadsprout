const crypto = require('crypto');
const { canonicalJson, BUNDLE_ID, BUNDLE_VERSION, BUNDLE_DIGEST } = require('./evidence-integrity-rule-bundle');

const MATERIAL_TRIGGERS = new Set([
  'RULE_BUNDLE_ID_VERSION_OR_DIGEST_CHANGE',
  'GOVERNING_AUTHORITY_VERSION_CHANGE',
  'EVIDENCE_IDENTITY_REVOKED_INVALIDATED_OR_SUPERSEDED',
  'EVIDENCE_EXPIRY',
  'MATERIAL_CONTRADICTION_ADDED_REMOVED_OR_CHANGED',
  'ACQUISITION_OR_RECONSTRUCTION_INTEGRITY_CHANGE',
  'SOURCE_ATTRIBUTION_OR_PARENT_LINEAGE_CHANGE',
  'REQUESTED_ASSESSMENT_SCOPE_CHANGE',
  'REQUIRED_CLAIM_CLASS_SUPPORT_GAINED_OR_LOST',
  'NORMALISED_DECISION_INPUT_CHANGE',
  'CONFIDENCE_CEILING_DECREASE',
  'REQUIRED_LIMITATION_ADDED_REMOVED_OR_RESCOPED',
  'CANONICAL_PERSISTENCE_OR_RECONSTRUCTION_FAILURE'
]);

function classifyMaterialChange(changes) {
  const triggers = [...new Set((changes || []).filter(change => MATERIAL_TRIGGERS.has(change)))].sort();
  return Object.freeze({ material: triggers.length > 0, triggers });
}

function decisionEventId(body) {
  return `EIL-${crypto.createHash('sha256').update(canonicalJson(body)).digest('hex')}`;
}

async function preserveDecision(dbQuery, subjectId, envelope, options = {}) {
  if (!subjectId || !envelope?.decisionId || !envelope?.decisionDigest) {
    const error = new Error('Canonical Evidence Integrity decision is incomplete.');
    error.code = 'EVIDENCE_INTEGRITY_PERSISTENCE_INPUT_INVALID';
    throw error;
  }
  const prior = options.supersedesDecisionId || null;
  const occurredAt = options.occurredAt;
  if (!occurredAt || !Number.isFinite(Date.parse(occurredAt))) {
    const error = new Error('Controlled lifecycle time is required.');
    error.code = 'EVIDENCE_INTEGRITY_PERSISTENCE_INPUT_INVALID';
    throw error;
  }
  const event = {
    decisionId: envelope.decisionId, subjectId, prior, occurredAt,
    triggerCodes: [...(options.triggerCodes || [])].sort()
  };
  const operations = [];
  if (prior) {
    operations.push({
      sql: `UPDATE evidence_integrity_decisions SET lifecycle_state = 'SUPERSEDED',
        superseded_by_decision_id = ? WHERE decision_id = ? AND subject_id = ? AND lifecycle_state = 'CURRENT'`,
      params: [envelope.decisionId, prior, subjectId]
    });
    operations.push({
      sql: `UPDATE evidence_integrity_dependent_reasoning SET valid = 0, invalidated_at = ?,
        invalidation_reason = ? WHERE decision_id = ? AND valid = 1`,
      params: [occurredAt, 'EVIDENCE_INTEGRITY_SUPERSEDED', prior]
    });
  }
  operations.push({
    sql: `INSERT INTO evidence_integrity_decisions
      (decision_id,subject_id,outcome,envelope_json,decision_digest,bundle_id,bundle_version,bundle_digest,
       supersedes_decision_id,superseded_by_decision_id,lifecycle_state,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,NULL,'CURRENT',?)`,
    params: [envelope.decisionId, subjectId, envelope.outcome, JSON.stringify(envelope), envelope.decisionDigest,
      BUNDLE_ID, BUNDLE_VERSION, BUNDLE_DIGEST, prior, occurredAt]
  });
  for (const evidence of envelope.evidenceLineage || []) {
    operations.push({
      sql: `INSERT INTO evidence_integrity_decision_evidence
        (decision_id,evidence_id,claim_classes_json,parent_evidence_ids_json)
        VALUES (?,?,?,?)`,
      params: [envelope.decisionId, evidence.evidenceId, JSON.stringify(evidence.claimClasses),
        JSON.stringify(evidence.parentEvidenceIds)]
    });
  }
  operations.push({
    sql: `INSERT INTO evidence_integrity_lifecycle_events
      (event_id,subject_id,prior_decision_id,new_decision_id,trigger_codes_json,occurred_at)
      VALUES (?,?,?,?,?,?)`,
    params: [decisionEventId(event), subjectId, prior, envelope.decisionId,
      JSON.stringify(event.triggerCodes), occurredAt]
  });
  try {
    await dbQuery.transaction(operations);
  } catch (error) {
    const failure = new Error('Canonical Evidence Integrity decision persistence failed.');
    failure.code = 'EVIDENCE_INTEGRITY_PERSISTENCE_FAILED';
    failure.cause = error;
    throw failure;
  }
  return Object.freeze({ decisionId: envelope.decisionId, supersedesDecisionId: prior, lifecycleState: 'CURRENT' });
}

async function recordDependentReasoning(dbQuery, reasoningId, decisionId, outputDigest, createdAt) {
  if (!reasoningId || !decisionId || !/^[a-f0-9]{64}$/.test(outputDigest || '') ||
      !Number.isFinite(Date.parse(createdAt))) {
    const error = new Error('Dependent reasoning identity is incomplete.');
    error.code = 'EVIDENCE_INTEGRITY_REASONING_INVALID';
    throw error;
  }
  const current = await dbQuery.get(
    "SELECT decision_id FROM evidence_integrity_decisions WHERE decision_id = ? AND lifecycle_state = 'CURRENT'",
    [decisionId]
  );
  if (!current) {
    const error = new Error('Stale Evidence Integrity decision cannot authorise new reasoning.');
    error.code = 'EVIDENCE_INTEGRITY_STALE_DECISION';
    throw error;
  }
  await dbQuery.run(`INSERT INTO evidence_integrity_dependent_reasoning
    (reasoning_id,decision_id,output_digest,valid,created_at) VALUES (?,?,?,1,?)`,
  [reasoningId, decisionId, outputDigest, createdAt]);
  return Object.freeze({ reasoningId, decisionId, valid: true });
}

async function replayDecision(dbQuery, decisionId) {
  const row = await dbQuery.get('SELECT * FROM evidence_integrity_decisions WHERE decision_id = ?', [decisionId]);
  if (!row) return null;
  const envelope = JSON.parse(row.envelope_json);
  const material = {
    schema: envelope.schema,
    ruleBundle: envelope.ruleBundle,
    outcome: envelope.outcome,
    authorisedScope: envelope.authorisedScope,
    confidenceCeiling: envelope.confidenceCeiling,
    limitations: envelope.limitations,
    uncertainty: envelope.uncertainty,
    orderedReasonCodes: envelope.orderedReasonCodes,
    evidenceLineage: envelope.evidenceLineage,
    completeness: envelope.completeness
  };
  const reconstructedDigest = crypto.createHash('sha256').update(canonicalJson(material)).digest('hex');
  if (envelope.decisionDigest !== row.decision_digest ||
      envelope.decisionDigest !== reconstructedDigest ||
      envelope.decisionId !== `EIA-${reconstructedDigest}`) {
    const error = new Error('Historical Evidence Integrity decision failed reconstruction.');
    error.code = 'EVIDENCE_INTEGRITY_HISTORICAL_REPLAY_FAILED';
    throw error;
  }
  return Object.freeze({ envelope, lifecycleState: row.lifecycle_state, supersededByDecisionId: row.superseded_by_decision_id });
}

module.exports = {
  MATERIAL_TRIGGERS, classifyMaterialChange, preserveDecision,
  recordDependentReasoning, replayDecision
};
