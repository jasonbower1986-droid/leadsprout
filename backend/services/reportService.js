const { resolveWorkspaceAccess } = require('./reportAccess');

const parse = (value, fallback) => {
  try { return value == null ? fallback : JSON.parse(value); } catch (_) { return fallback; }
};

async function accessibleMembership(db, userId) {
  return db.get(`SELECT organization_id,user_id,role_class FROM organization_memberships
    WHERE user_id = ? AND membership_state = 'ACTIVE' ORDER BY organization_id LIMIT 1`, [userId]);
}

async function listReports(db, { userId }) {
  const membership = await accessibleMembership(db, userId);
  if (!membership) return [];
  const rows = await db.all(`SELECT lineage.*,version.report_version_id,version.report_version_sequence,
      version.report_state,version.workspace_version,version.confidence_classification,
      version.confidence_basis,version.judgement_json,version.generated_at,artifact.artifact_state
    FROM report_lineages lineage
    JOIN workspace_organization_access access ON access.workspace_id = lineage.workspace_id
      AND access.organization_id = lineage.organization_id AND access.access_state = 'ACTIVE'
    JOIN report_versions version ON version.report_version_id = lineage.current_report_version_id
    LEFT JOIN report_artifacts artifact ON artifact.report_version_id = version.report_version_id
    WHERE lineage.organization_id = ? ORDER BY version.generated_at DESC,lineage.report_id`,
  [membership.organization_id]);
  return rows.map(presentIndex);
}

async function reportVersion(db, { userId, reportId, reportVersionId }) {
  const membership = await accessibleMembership(db, userId);
  if (!membership) return null;
  const lineage = await db.get(
    'SELECT * FROM report_lineages WHERE report_id = ? AND organization_id = ?',
    [reportId, membership.organization_id]
  );
  if (!lineage) return null;
  await resolveWorkspaceAccess(db, {
    organizationId: lineage.organization_id, workspaceId: lineage.workspace_id, userId
  });
  const version = await db.get(`SELECT version.*,artifact.artifact_id,artifact.artifact_state,
      artifact.storage_identity,artifact.media_type,artifact.byte_length,artifact.artifact_checksum,
      artifact.checksum_algorithm,artifact.checksum_verified_at
    FROM report_versions version LEFT JOIN report_artifacts artifact
      ON artifact.report_version_id = version.report_version_id
    WHERE version.report_id = ? AND version.report_version_id = ?`,
  [reportId, reportVersionId || lineage.current_report_version_id]);
  if (!version) return null;
  const evidence = await db.all(`SELECT evidence_id,evidence_classification,provenance_reference
    FROM report_version_evidence WHERE report_version_id = ?
    ORDER BY evidence_classification,evidence_id`, [version.report_version_id]);
  const history = await db.all(`SELECT report_version_id,report_version_sequence,report_state,
    is_current,generated_at,superseded_by_report_version_id,superseded_at
    FROM report_versions WHERE report_id = ? ORDER BY report_version_sequence DESC`, [reportId]);
  return presentDetail(lineage, version, evidence, history);
}

function presentIndex(row) {
  const judgement = parse(row.judgement_json, {});
  return {
    report_id: row.report_id, report_version_id: row.report_version_id,
    report_version_sequence: Number(row.report_version_sequence),
    workspace_id: row.workspace_id, workspace_version: Number(row.workspace_version),
    report_state: row.report_state, current: true, artifact_state: row.artifact_state || 'NOT_CREATED',
    subject_display_name: judgement.subject_display_name || null,
    judgement_title: judgement.title || null, judgement_summary: judgement.summary || null,
    confidence_classification: row.confidence_classification,
    confidence_basis: row.confidence_basis, generated_at: row.generated_at
  };
}

function presentDetail(lineage, row, evidence, history) {
  const judgement = parse(row.judgement_json, {});
  const composition = parse(row.evidence_composition_json, {});
  const counts = {};
  for (const key of [
    'VERIFIED_OBSERVATION', 'BOUNDED_INFERENCE', 'MATERIAL_LIMITATION',
    'CONTRADICTION', 'UNAVAILABLE_INFORMATION'
  ]) counts[key.toLowerCase() + '_count'] = composition.complete === true
    ? new Set(evidence.filter(item => item.evidence_classification === key).map(item => item.evidence_id)).size
    : null;
  return {
    ...presentIndex({ ...lineage, ...row }), candidate_snapshot_id: row.candidate_snapshot_id,
    evidence_authority_snapshot_id: row.evidence_authority_snapshot_id,
    policy_version: row.policy_version, judgement,
    evidence_composition: { complete: composition.complete === true, ...counts, entries: evidence },
    confidence: {
      classification: row.confidence_classification, basis: row.confidence_basis,
      changed_from: judgement.confidence_changed_from || null,
      change_reason: judgement.confidence_change_reason || null
    },
    limitations: parse(row.limitations_json, []), contradictions: parse(row.contradictions_json, []),
    provenance: parse(row.provenance_json, null), content_digest: row.content_digest,
    rendering_contract_version: row.rendering_contract_version,
    artifact: {
      state: row.artifact_state || 'NOT_CREATED', media_type: row.media_type || null,
      byte_length: row.byte_length ?? null, checksum: row.artifact_checksum || null,
      checksum_algorithm: row.checksum_algorithm || null,
      checksum_verified_at: row.checksum_verified_at || null,
      checksum_meaning: 'Exact artifact byte identity only; not evidence truth or Product approval.'
    },
    superseded_by_report_version_id: row.superseded_by_report_version_id || null,
    superseded_at: row.superseded_at || null, history
  };
}

module.exports = { accessibleMembership, listReports, reportVersion };
