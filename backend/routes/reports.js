const express = require('express');
const auth = require('../middleware/auth');
const { dbQuery } = require('../database');
const { listReports, reportVersion } = require('../services/reportService');
const { createArtifactStore, ReportArtifactStoreError } = require('../services/reportArtifactStore');

const router = express.Router();
const notFound = res => res.status(404).json({ error: 'Report not found', code: 'OBJECT_NOT_FOUND' });
const artifactEligibility = report => {
  if (!report?.currently_verified || !report?.download_allowed) {
    return { allowed: false, code: 'REPORT_INTEGRITY_BLOCKED' };
  }
  if (!['AVAILABLE', 'PARTIAL_EVIDENCE'].includes(report.stored_report_state) ||
      report.stored_artifact_state !== 'AVAILABLE') {
    return { allowed: false, code: 'ARTIFACT_UNAVAILABLE' };
  }
  return { allowed: true, code: null };
};

router.get('/', auth, async (req, res) => {
  try {
    res.json({ reports: await listReports(dbQuery, { userId: req.user.id }) });
  } catch (error) {
    console.error('[Reports]', error.code || error.message);
    res.status(503).json({ error: 'Reports unavailable', code: 'REPORTS_UNAVAILABLE' });
  }
});

router.get('/:reportId', auth, async (req, res) => {
  try {
    const report = await reportVersion(dbQuery, { userId: req.user.id, reportId: req.params.reportId });
    return report ? res.json({ report }) : notFound(res);
  } catch (_) { return notFound(res); }
});

router.get('/:reportId/versions/:reportVersionId', auth, async (req, res) => {
  try {
    const report = await reportVersion(dbQuery, {
      userId: req.user.id, reportId: req.params.reportId,
      reportVersionId: req.params.reportVersionId
    });
    return report ? res.json({ report }) : notFound(res);
  } catch (_) { return notFound(res); }
});

router.get('/:reportId/versions/:reportVersionId/artifact', auth, async (req, res) => {
  try {
    const report = await reportVersion(dbQuery, {
      userId: req.user.id, reportId: req.params.reportId,
      reportVersionId: req.params.reportVersionId
    });
    if (!report) return notFound(res);
    const eligibility = artifactEligibility(report);
    if (!eligibility.allowed) {
      return res.status(409).json({
        error: eligibility.code === 'REPORT_INTEGRITY_BLOCKED'
          ? 'Current Evidence Integrity authority is unavailable' : 'Artifact unavailable',
        code: eligibility.code
      });
    }
    const row = await dbQuery.get(`SELECT storage_identity,artifact_checksum,media_type
      FROM report_artifacts WHERE report_version_id = ? AND artifact_state = 'AVAILABLE'`,
    [report.report_version_id]);
    const bytes = await createArtifactStore().readVerified({
      identity: row.storage_identity, expectedChecksum: row.artifact_checksum
    });
    res.set('Content-Type', row.media_type);
    res.set('Content-Disposition', `attachment; filename="report-v${report.report_version_sequence}.html"`);
    return res.send(bytes);
  } catch (error) {
    if (error instanceof ReportArtifactStoreError) {
      return res.status(409).json({ error: 'Artifact verification failed', code: error.code });
    }
    return notFound(res);
  }
});

module.exports = router;
module.exports.artifactEligibility = artifactEligibility;
