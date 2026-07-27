const crypto = require('crypto');
const { stableJson } = require('./domain-outbox');

class ReportGenerationPolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReportGenerationPolicyError';
    this.code = code;
  }
}

const MATERIAL_FIELDS = Object.freeze([
  'candidateSnapshotId', 'candidateOutcome', 'recommendation', 'evidence',
  'contradictions', 'limitations', 'confidenceClassification', 'confidenceBasis',
  'includedOfferDecision', 'reviewValidity', 'policyVersion', 'workspaceVersion',
  'evidenceIntegrityState'
]);

function materialDigest(snapshot) {
  const material = Object.fromEntries(MATERIAL_FIELDS.map(field => [field, snapshot[field] ?? null]));
  return crypto.createHash('sha256').update(stableJson(material)).digest('hex');
}

function evaluateGeneration(input) {
  if (input.systemAuthority !== 'SYSTEM_CONTROLLED') throw new ReportGenerationPolicyError('REPORT_SYSTEM_AUTHORITY_REQUIRED');
  if (!input.productionEnabled) throw new ReportGenerationPolicyError('REPORT_PRODUCTION_DISABLED');
  if (!input.workspaceCurrent || !input.customerVisibleJudgement) throw new ReportGenerationPolicyError('REPORT_SOURCE_INELIGIBLE');
  if (!input.accessRetained) throw new ReportGenerationPolicyError('REPORT_ACCESS_REVOKED');
  if (!input.integrityVerified) throw new ReportGenerationPolicyError('REPORT_INTEGRITY_BLOCKED');
  const digest = materialDigest(input.snapshot);
  return Object.freeze({
    eligible: digest !== input.priorMaterialDigest,
    materialDigest: digest,
    idempotencyKey: `${input.reportId}:${input.snapshot.workspaceVersion}:${input.snapshot.policyVersion}`
  });
}

module.exports = { MATERIAL_FIELDS, ReportGenerationPolicyError, evaluateGeneration, materialDigest };
