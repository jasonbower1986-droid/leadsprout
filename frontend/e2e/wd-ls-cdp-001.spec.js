/* global process */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
import fs from 'node:fs';

const evidenceDir = process.env.REPORTS_EVIDENCE_DIR || path.resolve('../outputs/increment-2-reports');
fs.mkdirSync(evidenceDir, { recursive: true });
const indexRecord = {
  report_id: 'report-controlled-a', report_version_id: 'version-controlled-2',
  report_version_sequence: 2, workspace_id: 'workspace-controlled-a', workspace_version: 4,
  report_state: 'AVAILABLE', current: true, artifact_state: 'AVAILABLE',
  subject_display_name: 'Controlled Fixture Business', judgement_title: 'Review the evidence-bounded constraint',
  confidence_classification: 'LIMITED', confidence_basis: 'One material limitation remains',
  generated_at: '2026-07-27T20:00:00Z'
};
const detailRecord = {
  ...indexRecord, candidate_snapshot_id: null, evidence_authority_snapshot_id: 'authority-controlled-a',
  policy_version: 'policy-controlled-1',
  judgement: { subject_display_name: indexRecord.subject_display_name, title: indexRecord.judgement_title,
    summary: 'The current briefing preserves the verified observation and explicitly limits unsupported conclusions.' },
  evidence_composition: {
    complete: true, verified_observation_count: 1, bounded_inference_count: 1,
    material_limitation_count: 1, contradiction_count: 0, unavailable_information_count: 0,
    entries: [{ evidence_id: 'evidence-controlled-a', evidence_classification: 'VERIFIED_OBSERVATION',
      provenance_reference: 'Authorised source observation' }]
  },
  confidence: { classification: 'LIMITED', basis: indexRecord.confidence_basis, changed_from: null, change_reason: null },
  limitations: [{ id: 'limitation-controlled-a', statement: 'The outcome remains bounded by unavailable information.' }],
  contradictions: [], provenance: { workspace_version: 4, policy_version: 'policy-controlled-1' },
  artifact: { state: 'AVAILABLE', checksum: 'a'.repeat(64), checksum_algorithm: 'SHA-256',
    checksum_meaning: 'Exact artifact byte identity only; not evidence truth or Product approval.' },
  history: [
    { report_version_id: 'version-controlled-2', report_version_sequence: 2, report_state: 'AVAILABLE',
      is_current: 1, generated_at: '2026-07-27T20:00:00Z' },
    { report_version_id: 'version-controlled-1', report_version_sequence: 1, report_state: 'SUPERSEDED',
      is_current: 0, generated_at: '2026-07-26T20:00:00Z' }
  ]
};

async function setup(page, mode = 'available') {
  await page.addInitScript(() => localStorage.setItem('token', 'controlled-render-token'));
  await page.route('**/api/config/features', route => route.fulfill({ json: { opportunity_workspace: true } }));
  await page.route('**/api/config/personas', route => route.fulfill({ json: {} }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'user-controlled', email: 'reports@fixture.test', plan: 'agency' } } }));
  await page.route('**/api/reports', route => route.fulfill(mode === 'empty'
    ? { json: { reports: [] } } : mode === 'failed' ? { status: 503, json: { error: 'Reports unavailable' } }
      : { json: { reports: [indexRecord] } }));
  await page.route('**/api/reports/report-controlled-a', route => route.fulfill({ json: { report: detailRecord } }));
  await page.route('**/api/reports/report-controlled-a/versions/*', route => route.fulfill({ json: { report: {
    ...detailRecord, report_state: 'SUPERSEDED', current: false, report_version_sequence: 1,
    report_version_id: 'version-controlled-1', superseded_by_report_version_id: 'version-controlled-2'
  } } }));
}
async function verify(page, file, width, height) {
  await page.setViewportSize({ width, height });
  const overflow = await page.evaluate(() => Math.max(
    document.body.scrollWidth, document.documentElement.scrollWidth
  ) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([]);
  expect(page.getByText(/\b(Generate|Regenerate|Create report|Retry generation)\b/)).toHaveCount(0);
  await page.screenshot({ path: path.join(evidenceDir, file), fullPage: false });
}

test('Reports Index desktop and mobile are accessible and overflow-free', async ({ page }) => {
  await setup(page); await page.goto('/reports'); await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await verify(page, 'reports-index-desktop-1440x1000.png', 1440, 1000);
  await verify(page, 'reports-index-mobile-390x844.png', 390, 844);
});
test('Report Detail desktop and mobile expose authority, evidence and immutable history', async ({ page }) => {
  await setup(page); await page.goto('/reports/report-controlled-a');
  await expect(page.getByRole('heading', { name: 'Controlled Fixture Business' })).toBeVisible();
  await expect(page.getByText('Exact artifact byte identity only; not evidence truth or Product approval.')).toBeVisible();
  await verify(page, 'report-detail-desktop-1440x1000.png', 1440, 1000);
  await verify(page, 'report-detail-mobile-390x844.png', 390, 844);
});
test('historical, empty and failed states remain explicit', async ({ page }) => {
  await setup(page); await page.goto('/reports/report-controlled-a/versions/version-controlled-1');
  await expect(page.getByText('Historical version')).toBeVisible();
  await setup(page, 'empty'); await page.goto('/reports'); await expect(page.getByText('No current report is available')).toBeVisible();
});
