/* global process */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const evidenceDir = process.env.REPORTS_EVIDENCE_DIR || path.resolve('../outputs/increment-2-reports');
const candidateRevision = process.env.REPORTS_CANDIDATE_REVISION || 'UNBOUND';
fs.mkdirSync(evidenceDir, { recursive: true });

const verified = {
  state: 'CURRENT_VERIFIED', snapshot_decision_id: 'authority-controlled-a',
  current_decision_id: 'authority-controlled-restored', outcome: 'LIMITED',
  message: 'Current Evidence Integrity authority verified.'
};
const blocked = {
  state: 'BLOCKED', snapshot_decision_id: 'authority-controlled-a',
  current_decision_id: null, outcome: null,
  message: 'Historical report data is not currently verified. Download and progression are withheld.'
};
const indexRecord = {
  report_id: 'report-controlled-a', report_version_id: 'version-controlled-2',
  report_version_sequence: 2, workspace_id: 'workspace-controlled-a', workspace_version: 4,
  report_state: 'AVAILABLE', stored_report_state: 'AVAILABLE', current: true, historical: false,
  currently_verified: true, download_allowed: true, progression_allowed: true,
  artifact_state: 'AVAILABLE', stored_artifact_state: 'AVAILABLE', integrity: verified,
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
  artifact: { state: 'AVAILABLE', stored_state: 'AVAILABLE', checksum: 'a'.repeat(64),
    checksum_algorithm: 'SHA-256',
    checksum_meaning: 'Exact artifact byte identity only; not evidence truth or Product approval.' },
  history: [
    { ...indexRecord },
    { ...indexRecord, report_version_id: 'version-controlled-1', report_version_sequence: 1,
      report_state: 'SUPERSEDED', stored_report_state: 'SUPERSEDED', current: false, historical: true,
      progression_allowed: false, generated_at: '2026-07-26T20:00:00Z' }
  ]
};

const governed = (record, mode) => {
  if (mode === 'blocked') return {
    ...record, report_state: 'INTEGRITY_BLOCKED', current: false, historical: true,
    currently_verified: false, download_allowed: false, progression_allowed: false,
    artifact_state: 'WITHHELD', integrity: blocked,
    ...(record.history ? { history: record.history.map(item => governed(item, mode)) } : {}),
    ...(record.artifact ? { artifact: { ...record.artifact, state: 'WITHHELD' } } : {})
  };
  if (mode === 'partial') return { ...record, report_state: 'PARTIAL_EVIDENCE', stored_report_state: 'PARTIAL_EVIDENCE' };
  if (mode === 'stale') return {
    ...record, report_state: 'STALE', stored_report_state: 'STALE',
    current: false, historical: true, progression_allowed: false
  };
  if (mode === 'superseded') return {
    ...record, report_state: 'SUPERSEDED', stored_report_state: 'SUPERSEDED',
    current: false, historical: true, progression_allowed: false
  };
  return record;
};

async function setup(page, mode = 'available') {
  await page.addInitScript(() => localStorage.setItem('token', 'controlled-render-token'));
  await page.route('**/api/config/features', route => route.fulfill({ json: { opportunity_workspace: true } }));
  await page.route('**/api/config/personas', route => route.fulfill({ json: {} }));
  await page.route('**/api/auth/me', route => route.fulfill({
    json: { user: { id: 'user-controlled', email: 'reports@fixture.test', plan: 'agency' } }
  }));
  await page.route('**/api/reports', async route => {
    if (mode === 'loading') {
      await new Promise(resolve => setTimeout(resolve, 1500));
      return route.fulfill({ json: { reports: [indexRecord] } });
    }
    return route.fulfill(mode === 'empty'
      ? { json: { reports: [] } }
      : mode === 'failed' ? { status: 503, json: { error: 'Reports unavailable' } }
        : { json: { reports: [governed(indexRecord, mode)] } });
  });
  await page.route('**/api/reports/report-controlled-a', route => {
    if (mode === 'restricted') return route.fulfill({ status: 404, json: { error: 'Report not found' } });
    return route.fulfill({ json: { report: governed(detailRecord, mode) } });
  });
  await page.route('**/api/reports/report-controlled-a/versions/*', route => route.fulfill({
    json: { report: governed({
      ...detailRecord, report_state: 'SUPERSEDED', stored_report_state: 'SUPERSEDED',
      current: false, historical: true, progression_allowed: false,
      report_version_sequence: 1, report_version_id: 'version-controlled-1',
      superseded_by_report_version_id: 'version-controlled-2'
    }, mode) }
  }));
}

async function verify(page, file, width, height, options = {}) {
  await page.setViewportSize({ width, height });
  const overflow = await page.evaluate(() => Math.max(
    document.body.scrollWidth, document.documentElement.scrollWidth
  ) - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([]);
  expect(page.getByText(/\b(Generate|Regenerate|Create report|Retry generation)\b/)).toHaveCount(0);
  let focus = null;
  if (options.keyboard) {
    await page.keyboard.press('Tab');
    focus = await page.evaluate(() => {
      const active = document.activeElement;
      const style = getComputedStyle(active);
      return {
        tag: active?.tagName || null, text: active?.textContent?.trim().slice(0, 80) || null,
        visible: Boolean(active && active.getBoundingClientRect().width && active.getBoundingClientRect().height),
        outline: style.outlineStyle !== 'none' || style.boxShadow !== 'none'
      };
    });
    expect(focus.visible).toBe(true);
    expect(focus.outline).toBe(true);
  }
  const target = path.join(evidenceDir, file);
  const bytes = await page.screenshot({ path: target, fullPage: false });
  fs.writeFileSync(`${target}.json`, JSON.stringify({
    candidate_revision: candidateRevision, route: page.url(), viewport: { width, height },
    overflow, keyboard_focus: focus, screenshot_sha256: crypto.createHash('sha256').update(bytes).digest('hex')
  }, null, 2));
}

test('Reports Index desktop and mobile are accessible and overflow-free', async ({ page }) => {
  await setup(page); await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await verify(page, 'reports-index-restored-desktop-1440x1000.png', 1440, 1000);
  await verify(page, 'reports-index-restored-mobile-390x844.png', 390, 844, { keyboard: true });
});

test('current and historical Report Detail expose verified authority and immutable history', async ({ page }) => {
  await setup(page); await page.goto('/reports/report-controlled-a');
  await expect(page.getByRole('heading', { name: 'Controlled Fixture Business' })).toBeVisible();
  const lineage = page.locator('section.rpt-card').filter({ hasText: 'Report lineage' });
  await expect(lineage.getByText('Current · Available', { exact: true })).toHaveCount(1);
  const historicalEntry = lineage.locator('li').filter({ hasText: 'Version 1' });
  await expect(historicalEntry.getByText('Current · Available', { exact: true })).toHaveCount(0);
  await verify(page, 'report-detail-current-desktop-1440x1000.png', 1440, 1000);
  await verify(page, 'report-detail-current-mobile-390x844.png', 390, 844, { keyboard: true });
  await page.goto('/reports/report-controlled-a/versions/version-controlled-1');
  await expect(page.getByText('Historical version')).toBeVisible();
  await verify(page, 'report-detail-historical-mobile-390x844.png', 390, 844);
});

test('integrity-blocked and restored presentations are explicit', async ({ page }) => {
  await setup(page, 'blocked'); await page.goto('/reports/report-controlled-a');
  await expect(page.getByText('Evidence Integrity blocked')).toBeVisible();
  await expect(page.getByText('Download unavailable')).toBeVisible();
  const lineage = page.locator('section.rpt-card').filter({ hasText: 'Report lineage' });
  await expect(lineage.getByText('Current · Available', { exact: true })).toHaveCount(0);
  await expect(lineage.getByText('Current · Partial evidence', { exact: true })).toHaveCount(0);
  await verify(page, 'integrity-blocked-desktop-1440x1000.png', 1440, 1000);
  await verify(page, 'integrity-blocked-mobile-390x844.png', 390, 844, { keyboard: true });
});

for (const state of ['loading', 'empty', 'failed']) {
  test(`Reports Index ${state} state is mobile governed`, async ({ page }) => {
    await setup(page, state); await page.goto('/reports');
    await verify(page, `reports-index-${state}-mobile-390x844.png`, 390, 844);
  });
}

for (const state of ['partial', 'stale', 'superseded', 'restricted']) {
  test(`Report Detail ${state} state is mobile governed`, async ({ page }) => {
    await setup(page, state); await page.goto('/reports/report-controlled-a');
    await verify(page, `report-detail-${state}-mobile-390x844.png`, 390, 844);
  });
}
