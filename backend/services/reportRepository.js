const crypto = require('crypto');
const { resolveWorkspaceAccess } = require('./reportAccess');
const { outboxInsertOperation, stableJson } = require('./domain-outbox');

class ReportRepositoryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReportRepositoryError';
    this.code = code;
  }
}

const identifier = prefix => `${prefix}-${crypto.randomUUID()}`;
const timestamp = clock => clock ? clock() : new Date().toISOString();

function requireSystem(input) {
  if (input.systemAuthority !== 'SYSTEM_CONTROLLED') {
    throw new ReportRepositoryError('REPORT_SYSTEM_AUTHORITY_REQUIRED');
  }
}

async function resolveLineage(db, input) {
  await resolveWorkspaceAccess(db, input);
  const lineage = await db.get(
    'SELECT * FROM report_lineages WHERE report_id = ? AND organization_id = ? AND workspace_id = ?',
    [input.reportId, input.organizationId, input.workspaceId]
  );
  if (!lineage) throw new ReportRepositoryError('REPORT_NOT_FOUND');
  return lineage;
}

async function createLineage(db, input, options = {}) {
  requireSystem(input);
  await resolveWorkspaceAccess(db, input);
  const reportId = options.reportId || identifier('report');
  const createdAt = options.createdAt || timestamp(options.clock);
  try {
    await db.run(`INSERT INTO report_lineages
      (report_id,organization_id,workspace_id,current_report_version_id,created_at)
      VALUES (?,?,?,NULL,?)`,
    [reportId, input.organizationId, input.workspaceId, createdAt]);
  } catch (error) {
    if (!/UNIQUE constraint failed/.test(error.message || '')) throw error;
  }
  return db.get(
    'SELECT * FROM report_lineages WHERE organization_id = ? AND workspace_id = ?',
    [input.organizationId, input.workspaceId]
  );
}

async function queueGeneration(db, input, options = {}) {
  requireSystem(input);
  await resolveLineage(db, input);
  const existing = await db.get(
    'SELECT * FROM report_generation_attempts WHERE idempotency_key = ?',
    [input.idempotencyKey]
  );
  if (existing) {
    const equivalent = existing.report_id === input.reportId &&
      Number(existing.workspace_version) === Number(input.workspaceVersion) &&
      existing.policy_version === input.policyVersion;
    if (!equivalent) throw new ReportRepositoryError('REPORT_IDEMPOTENCY_CONFLICT');
    return Object.freeze({ ...existing, replay: true });
  }
  const attemptSequenceRow = await db.get(
    'SELECT COALESCE(MAX(attempt_sequence),0) + 1 AS next_sequence FROM report_generation_attempts WHERE report_id = ? AND workspace_version = ? AND policy_version = ?',
    [input.reportId, input.workspaceVersion, input.policyVersion]
  );
  const generationAttemptId = options.generationAttemptId || identifier('report-attempt');
  const createdAt = options.createdAt || timestamp(options.clock);
  const outbox = outboxInsertOperation({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    aggregateType: 'REPORT',
    aggregateId: input.reportId,
    eventType: 'REPORT_GENERATION_REQUESTED',
    payload: {
      generationAttemptId,
      reportId: input.reportId,
      workspaceVersion: Number(input.workspaceVersion)
    },
    policyVersion: input.policyVersion,
    idempotencyKey: `report-generation:${input.idempotencyKey}`
  }, {
    outboxId: options.outboxId,
    createdAt
  });
  await db.transaction([
    {
      sql: `INSERT INTO report_generation_attempts
        (generation_attempt_id,report_id,workspace_version,policy_version,attempt_sequence,
         state,idempotency_key,retry_eligible,created_at)
        VALUES (?,?,?,?,?,'PENDING',?,0,?)`,
      params: [
        generationAttemptId, input.reportId, input.workspaceVersion, input.policyVersion,
        Number(attemptSequenceRow.next_sequence), input.idempotencyKey, createdAt
      ]
    },
    outbox.operation
  ]);
  return Object.freeze({
    generation_attempt_id: generationAttemptId,
    report_id: input.reportId,
    workspace_version: Number(input.workspaceVersion),
    policy_version: input.policyVersion,
    attempt_sequence: Number(attemptSequenceRow.next_sequence),
    state: 'PENDING',
    idempotency_key: input.idempotencyKey,
    replay: false
  });
}

async function persistAvailableVersion(db, input, options = {}) {
  requireSystem(input);
  const lineage = await resolveLineage(db, input);
  const attempt = await db.get(
    'SELECT * FROM report_generation_attempts WHERE generation_attempt_id = ? AND report_id = ?',
    [input.generationAttemptId, input.reportId]
  );
  if (!attempt || attempt.state !== 'PENDING' ||
      Number(attempt.workspace_version) !== Number(input.workspaceVersion) ||
      attempt.policy_version !== input.policyVersion) {
    throw new ReportRepositoryError('REPORT_ATTEMPT_INVALID');
  }
  if (!['AVAILABLE', 'PARTIAL_EVIDENCE'].includes(input.reportState)) {
    throw new ReportRepositoryError('REPORT_STATE_INVALID');
  }
  if (!Buffer.isBuffer(input.artifactBytes)) {
    throw new ReportRepositoryError('REPORT_ARTIFACT_INVALID');
  }
  const checksum = crypto.createHash('sha256').update(input.artifactBytes).digest('hex');
  if (input.artifactChecksum && input.artifactChecksum !== checksum) {
    throw new ReportRepositoryError('REPORT_ARTIFACT_CHECKSUM');
  }
  const sequenceRow = await db.get(
    'SELECT COALESCE(MAX(report_version_sequence),0) + 1 AS next_sequence FROM report_versions WHERE report_id = ?',
    [input.reportId]
  );
  const reportVersionId = options.reportVersionId || identifier('report-version');
  const artifactId = options.artifactId || identifier('report-artifact');
  const generatedAt = options.generatedAt || timestamp(options.clock);
  const sequence = Number(sequenceRow.next_sequence);
  const operations = [];
  if (lineage.current_report_version_id) {
    operations.push({
      sql: `UPDATE report_versions
        SET is_current = 0,report_state = 'SUPERSEDED',superseded_by_report_version_id = ?,superseded_at = ?
        WHERE report_version_id = ? AND is_current = 1`,
      params: [reportVersionId, generatedAt, lineage.current_report_version_id]
    });
  }
  operations.push({
    sql: `INSERT INTO report_versions
      (report_version_id,report_id,report_version_sequence,organization_id,workspace_id,
       workspace_version,candidate_snapshot_id,policy_version,evidence_authority_snapshot_id,
       generation_attempt_id,report_state,is_current,judgement_json,evidence_composition_json,
       confidence_classification,confidence_basis,limitations_json,contradictions_json,
       provenance_json,content_digest,rendering_contract_version,generated_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?)`,
    params: [
      reportVersionId, input.reportId, sequence, input.organizationId, input.workspaceId,
      input.workspaceVersion, input.candidateSnapshotId || null, input.policyVersion,
      input.evidenceAuthoritySnapshotId, input.generationAttemptId, input.reportState,
      stableJson(input.judgement), stableJson(input.evidenceComposition),
      input.confidenceClassification, input.confidenceBasis,
      stableJson(input.limitations || []), stableJson(input.contradictions || []),
      stableJson(input.provenance), input.contentDigest, input.renderingContractVersion,
      generatedAt, generatedAt
    ]
  });
  operations.push({
    sql: `INSERT INTO report_artifacts
      (artifact_id,report_version_id,artifact_state,storage_identity,media_type,byte_length,
       artifact_checksum,checksum_algorithm,checksum_verified_at,created_at)
      VALUES (?,?,'AVAILABLE',?,?,?,?, 'SHA-256',?,?)`,
    params: [
      artifactId, reportVersionId, input.storageIdentity, input.mediaType,
      input.artifactBytes.length, checksum, generatedAt, generatedAt
    ]
  });
  for (const evidence of input.evidence || []) {
    operations.push({
      sql: `INSERT INTO report_version_evidence
        (report_version_id,evidence_id,evidence_classification,provenance_reference)
        VALUES (?,?,?,?)`,
      params: [
        reportVersionId, evidence.evidenceId, evidence.classification,
        evidence.provenanceReference
      ]
    });
  }
  operations.push({
    sql: 'UPDATE report_lineages SET current_report_version_id = ? WHERE report_id = ?',
    params: [reportVersionId, input.reportId]
  });
  operations.push({
    sql: `UPDATE report_generation_attempts
      SET state = 'SUCCEEDED',completed_at = ?,retry_eligible = 0
      WHERE generation_attempt_id = ? AND state = 'PENDING'`,
    params: [generatedAt, input.generationAttemptId]
  });
  await db.transaction(operations);
  return Object.freeze({
    ...(await db.get('SELECT * FROM report_versions WHERE report_version_id = ?', [reportVersionId])),
    artifact_checksum: checksum
  });
}

module.exports = {
  ReportRepositoryError,
  createLineage,
  persistAvailableVersion,
  queueGeneration
};
