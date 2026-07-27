const { resolveWorkspaceAccess } = require('./reportAccess');

const parse = (value, fallback) => {
  try { return value == null ? fallback : JSON.parse(value); } catch (_) { return fallback; }
};

async function accessibleMembership(db, userId) {
  return db.get(`SELECT organization_id,user_id,role_class FROM organization_memberships
    WHERE user_id = ? AND membership_state = 'ACTIVE' ORDER BY organization_id LIMIT 1`, [userId]);
}

async function resolveCurrentIntegrityAuthority(db, snapshotDecisionId) {
  if (!snapshotDecisionId) return Object.freeze({
    state: 'BLOCKED', snapshot_decision_id: snapshotDecisionId || null,
    current_decision_id: null, outcome: null
  });
  const snapshot = await db.get(`SELECT decision_id,subject_id FROM evidence_integrity_decisions
    WHERE decision_id = ?`, [snapshotDecisionId]);
  if (!snapshot) return Object.freeze({
    state: 'BLOCKED', snapshot_decision_id: snapshotDecisionId,
    current_decision_id: null, outcome: null
  });
  const current = await db.get(`SELECT decision_id,outcome FROM evidence_integrity_decisions
    WHERE subject_id = ? AND lifecycle_state = 'CURRENT'`, [snapshot.subject_id]);
  const verified = current && ['ELIGIBLE', 'LIMITED'].includes(current.outcome);
  return Object.freeze({
    state: verified ? 'CURRENT_VERIFIED' : 'BLOCKED',
    snapshot_decision_id: snapshotDecisionId,
    current_decision_id: current?.decision_id || null,
    outcome: current?.outcome || null
  });
}

function applyIntegrityPresentation(presentation, authority) {
  const storedReportState = presentation.report_state;
  const storedArtifactState = presentation.artifact_state;
  const storedCurrent = presentation.current;
  const verified = authority.state === 'CURRENT_VERIFIED';
  return {
    ...presentation,
    report_state: verified ? storedReportState : 'INTEGRITY_BLOCKED',
    stored_report_state: storedReportState,
    artifact_state: verified ? storedArtifactState : 'WITHHELD',
    stored_artifact_state: storedArtifactState,
    current: storedCurrent && verified,
    historical: !storedCurrent || !verified,
    currently_verified: verified,
    download_allowed: verified && ['AVAILABLE', 'PARTIAL_EVIDENCE'].includes(storedReportState) &&
      storedArtifactState === 'AVAILABLE',
    progression_allowed: verified && storedCurrent,
    ...(presentation.artifact ? {
      artifact: {
        ...presentation.artifact,
        state: verified ? presentation.artifact.state : 'WITHHELD',
        stored_state: presentation.artifact.state
      }
    } : {}),
    integrity: {
      ...authority,
      message: verified
        ? 'Current Evidence Integrity authority verified.'
        : 'Historical report data is not currently verified. Download and progression are withheld.'
    }
  };
}

async function listReports(db, { userId }) {
  const membership = await accessibleMembership(db, userId);
  if (!membership) return [];
  const rows = await db.all(`SELECT lineage.*,version.report_version_id,version.report_version_sequence,
      version.report_state,version.is_current,version.workspace_version,
      version.evidence_authority_snapshot_id,version.confidence_classification,
      version.confidence_basis,version.judgement_json,version.generated_at,artifact.artifact_state
    FROM report_lineages lineage
    JOIN workspace_organization_access access ON access.workspace_id = lineage.workspace_id
      AND access.organization_id = lineage.organization_id AND access.access_state = 'ACTIVE'
    JOIN report_versions version ON version.report_version_id = lineage.current_report_version_id
    LEFT JOIN report_artifacts artifact ON artifact.report_version_id = version.report_version_id
    WHERE lineage.organization_id = ? ORDER BY version.generated_at DESC,lineage.report_id`,
  [membership.organization_id]);
  return Promise.all(rows.map(async row => applyIntegrityPresentation(
    presentIndex(row),
    await resolveCurrentIntegrityAuthority(db, row.evidence_authority_snapshot_id)
  )));
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
  const historyRows = await db.all(`SELECT report_version_id,report_version_sequence,report_state,
    is_current,generated_at,superseded_by_report_version_id,superseded_at,evidence_authority_snapshot_id
    FROM report_versions WHERE report_id = ? ORDER BY report_version_sequence DESC`, [reportId]);
  const authority = await resolveCurrentIntegrityAuthority(db, version.evidence_authority_snapshot_id);
  const history = await Promise.all(historyRows.map(async item => {
    const itemAuthority = await resolveCurrentIntegrityAuthority(db, item.evidence_authority_snapshot_id);
    return applyIntegrityPresentation(presentIndex({ ...lineage, ...item }), itemAuthority);
  }));
  return applyIntegrityPresentation(presentDetail(lineage, version, evidence, history), authority);
}

function presentIndex(row) {
  const judgement = parse(row.judgement_json, {});
  return {
    report_id: row.report_id, report_version_id: row.report_version_id,
    report_version_sequence: Number(row.report_version_sequence),
    workspace_id: row.workspace_id, workspace_version: Number(row.workspace_version),
    report_state: row.report_state, current: row.is_current == null ? true : Boolean(row.is_current),
    artifact_state: row.artifact_state || 'NOT_CREATED',
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

module.exports = {
  accessibleMembership, resolveCurrentIntegrityAuthority, applyIntegrityPresentation,
  listReports, reportVersion
};
