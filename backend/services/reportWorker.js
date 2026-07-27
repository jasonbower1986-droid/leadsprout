const crypto = require('crypto');
const { claimNext, complete, failClaim } = require('./domain-outbox');
const { evaluateGeneration } = require('./reportGenerationPolicy');
const { persistAvailableVersion } = require('./reportRepository');
const { renderReport } = require('./reportRenderer');

class ReportWorkerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReportWorkerError';
    this.code = code;
  }
}

const safeCode = error => /^[A-Z0-9_]{1,80}$/.test(error.code || '')
  ? error.code
  : 'REPORT_GENERATION_FAILED';

async function processNext(db, dependencies, input) {
  const claimed = await claimNext(db, { workerId: input.workerId, at: input.at });
  if (!claimed) return null;
  if (claimed.event_type !== 'REPORT_GENERATION_REQUESTED') {
    await failClaim(db, {
      outboxId: claimed.outbox_id, workerId: input.workerId,
      errorCode: 'OUTBOX_EVENT_UNSUPPORTED'
    });
    throw new ReportWorkerError('OUTBOX_EVENT_UNSUPPORTED');
  }
  try {
    const payload = JSON.parse(claimed.payload_json);
    const attempt = await db.get(
      'SELECT * FROM report_generation_attempts WHERE generation_attempt_id = ?',
      [payload.generationAttemptId]
    );
    const lineage = attempt && await db.get(
      'SELECT * FROM report_lineages WHERE report_id = ?', [attempt.report_id]
    );
    if (!attempt || !lineage) throw new ReportWorkerError('REPORT_ATTEMPT_INVALID');
    await db.run(`UPDATE report_generation_attempts SET state = 'RUNNING',started_at = ?
      WHERE generation_attempt_id = ? AND state = 'PENDING'`, [input.at, attempt.generation_attempt_id]);
    const snapshot = await dependencies.loadSnapshot({
      organizationId: lineage.organization_id, workspaceId: lineage.workspace_id,
      workspaceVersion: attempt.workspace_version
    });
    const integrityVerified = await dependencies.verifyIntegrity(snapshot);
    const decision = evaluateGeneration({
      systemAuthority: 'SYSTEM_CONTROLLED',
      productionEnabled: dependencies.productionEnabled === true,
      workspaceCurrent: snapshot.workspaceCurrent === true,
      customerVisibleJudgement: Boolean(snapshot.judgement),
      accessRetained: await dependencies.verifyAccess(lineage),
      integrityVerified,
      reportId: lineage.report_id,
      priorMaterialDigest: snapshot.priorMaterialDigest,
      snapshot
    });
    if (!decision.eligible) throw new ReportWorkerError('REPORT_NO_MATERIAL_CHANGE');
    const model = dependencies.buildModel(snapshot, decision);
    const bytes = renderReport(model);
    const identity = `report-artifact-${crypto.createHash('sha256')
      .update(attempt.generation_attempt_id).digest('hex').slice(0, 32)}.html`;
    const stored = await dependencies.artifactStore.putImmutable({ identity, bytes });
    await db.run(`UPDATE report_generation_attempts SET state = 'PENDING'
      WHERE generation_attempt_id = ? AND state = 'RUNNING'`, [attempt.generation_attempt_id]);
    const version = await persistAvailableVersion(db, {
      organizationId: lineage.organization_id, workspaceId: lineage.workspace_id,
      userId: snapshot.ownerUserId, systemAuthority: 'SYSTEM_CONTROLLED',
      reportId: lineage.report_id, generationAttemptId: attempt.generation_attempt_id,
      workspaceVersion: attempt.workspace_version, policyVersion: attempt.policy_version,
      candidateSnapshotId: snapshot.candidateSnapshotId,
      reportState: snapshot.partialEvidence ? 'PARTIAL_EVIDENCE' : 'AVAILABLE',
      evidenceAuthoritySnapshotId: snapshot.evidenceAuthoritySnapshotId,
      judgement: model.judgement, evidenceComposition: model.evidenceComposition,
      confidenceClassification: model.confidenceClassification,
      confidenceBasis: model.confidenceBasis, limitations: model.limitations,
      contradictions: model.contradictions, provenance: model.provenance,
      contentDigest: decision.materialDigest,
      renderingContractVersion: model.renderingContractVersion,
      artifactBytes: bytes, artifactChecksum: stored.checksum,
      storageIdentity: stored.storageIdentity, mediaType: 'text/html; charset=utf-8',
      evidence: model.evidence
    }, { generatedAt: input.at });
    await complete(db, { outboxId: claimed.outbox_id, workerId: input.workerId, at: input.at });
    return Object.freeze({ version, outboxId: claimed.outbox_id });
  } catch (error) {
    await db.run(`UPDATE report_generation_attempts
      SET state = 'FAILED',completed_at = ?,non_secret_error_code = ?,retry_eligible = ?
      WHERE generation_attempt_id = (SELECT json_extract(payload_json,'$.generationAttemptId')
        FROM domain_outbox WHERE outbox_id = ?) AND state IN ('PENDING','RUNNING')`,
    [input.at, safeCode(error), error.code === 'REPORT_INTEGRITY_BLOCKED' ? 1 : 0, claimed.outbox_id]);
    await failClaim(db, {
      outboxId: claimed.outbox_id, workerId: input.workerId, errorCode: safeCode(error)
    });
    throw error;
  }
}

module.exports = { ReportWorkerError, processNext };
