/* global process */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const evidenceDir = process.env.REPORTS_EVIDENCE_DIR || path.resolve('../outputs/increment-4-settings');
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

async function setupSettings(page, mode = 'ready') {
  await setup(page);
  const preferences = {
    evidence_density: { value: 'BALANCED', revision: 0, persisted: false },
    reduced_motion: { value: false, revision: 0, persisted: false },
    material_change_notifications: { value: 'ENABLED', revision: 0, persisted: false }
  };
  await page.route('**/api/settings/preferences', async route => {
    if (mode === 'unavailable') {
      return route.fulfill({ status: 503, json: { code: 'PREFERENCES_UNAVAILABLE' } });
    }
    if (route.request().method() === 'PUT') {
      if (mode === 'save-failure') {
        return route.fulfill({ status: 409, json: { code: 'STALE_WRITE' } });
      }
      const input = route.request().postDataJSON();
      return route.fulfill({ json: { preference: {
        field_name: input.field_name,
        field_value: input.field_value,
        revision: input.expected_revision + 1
      } } });
    }
    return route.fulfill({ json: {
      organization_id: 'org-controlled', user_id: 'user-controlled', preferences,
      read_only: {
        data_provenance_summary: 'Evidence provenance and integrity are system-governed and cannot be changed here.',
        role_assignment_summary: 'Current organisation role: MEMBER. Role assignments are read-only.',
        accessibility_target: 'LeadSprout targets WCAG 2.2 AA. This is a target, not a certification.',
        feature_state: 'ENABLED'
      }
    } });
  });
}

const activityEvents = [
  {
    activity_event_id: 'activity-current', event_category: 'REVIEW_COMPLETED',
    actor: { class: 'CUSTOMER_USER', display_name: 'Customer reviewer' },
    affected_object: { type: 'WORKSPACE', id: 'workspace-controlled-a', state: 'ACCESSIBLE' },
    event_summary: 'Review completed for the current workspace version',
    commercial_consequence: 'Preparation is now eligible',
    communication_status: 'NOT_RECORDED', evidence_integrity_state: 'AUTHORISED',
    workspace_version: 4, occurred_at: '2026-07-28T10:42:00Z', recorded_at: '2026-07-28T10:42:01Z',
    correction_of_activity_event_id: null, supersedes_activity_event_id: null,
    causal_chain: { state: 'AVAILABLE', sources: [{ type: 'WORKSPACE', id: 'workspace-controlled-a', relationship: 'CAUSE' }] }
  },
  {
    activity_event_id: 'activity-blocked', event_category: 'EVIDENCE_INTEGRITY_BLOCKED',
    actor: { class: 'SYSTEM_SERVICE', display_name: 'LeadSprout' },
    affected_object: { type: 'RESTRICTED', state: 'RESTRICTED', label: 'Restricted affected object' },
    event_summary: 'Evidence Integrity authority became unavailable',
    commercial_consequence: 'Preparation and progression are withheld',
    communication_status: 'NOT_RECORDED', evidence_integrity_state: 'BLOCKED',
    workspace_version: 4, occurred_at: '2026-07-28T09:12:00Z', recorded_at: '2026-07-28T09:12:01Z',
    correction_of_activity_event_id: null, supersedes_activity_event_id: null,
    causal_chain: { state: 'PARTIAL', detail: 'One or more causal objects are not accessible.' }
  },
  {
    activity_event_id: 'activity-superseded', event_category: 'WORKSPACE_VERSION_SUPERSEDED',
    actor: { class: 'SYSTEM_SERVICE', display_name: 'LeadSprout' },
    affected_object: { type: 'WORKSPACE', id: 'workspace-controlled-a', state: 'ACCESSIBLE' },
    event_summary: 'Earlier workspace authority was superseded',
    commercial_consequence: 'Review invalidated',
    communication_status: 'NOT_RECORDED', evidence_integrity_state: 'AUTHORISED',
    workspace_version: 3, occurred_at: '2026-07-27T09:12:00Z', recorded_at: '2026-07-27T09:12:01Z',
    correction_of_activity_event_id: null, supersedes_activity_event_id: 'activity-earlier',
    causal_chain: { state: 'NOT_RECORDED', sources: [] }
  }
];

async function setupActivity(page, mode = 'ready') {
  await setup(page);
  await page.route('**/api/activity?*', async route => {
    if (mode === 'loading') {
      await new Promise(resolve => setTimeout(resolve, 1500));
      return route.fulfill({ json: { events: activityEvents, next_cursor: null, history_boundary: { retention_months: 24, complete: true } } });
    }
    if (mode === 'error') return route.fulfill({ status: 503, json: { code: 'ACTIVITY_UNAVAILABLE' } });
    return route.fulfill({ json: {
      events: mode === 'empty' ? [] : activityEvents,
      next_cursor: null, history_boundary: { retention_months: 24, complete: true }
    } });
  });
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

test('authenticated shell has exactly five authorised destinations', async ({ page }) => {
  await setupSettings(page); await page.goto('/settings');
  const navigation = page.getByRole('navigation');
  await expect(navigation.getByRole('link')).toHaveCount(5);
  for (const destination of ['Opportunities', 'Workspace', 'Reports', 'Activity Feed', 'Settings']) {
    await expect(navigation.getByRole('link', { name: destination, exact: true })).toBeVisible();
  }
  await expect(navigation.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Home' })).toHaveCount(0);
  await verify(page, 'settings-desktop-1440x1000.png', 1440, 1000);
  await verify(page, 'settings-mobile-390x844.png', 390, 844, { keyboard: true });
});

test('Settings load, save, failure and prohibited-control states are governed', async ({ page }) => {
  await setupSettings(page); await page.goto('/settings');
  await expect(page.getByText('Settings loaded and confirmed.')).toBeVisible();
  await page.getByLabel('Evidence density').selectOption('EXPANDED');
  await expect(page.getByText('You have unsaved presentation settings.')).toBeVisible();
  await page.getByRole('button', { name: 'Save evidence density' }).click();
  await expect(page.getByText('Preference saved.')).toBeVisible();
  await expect(page.getByText(/\b(billing|integration|export|delete account|activate feature|role editor)\b/i)).toHaveCount(0);
});

test('Settings unavailable and save-failure states preserve safe selections', async ({ page }) => {
  await setupSettings(page, 'unavailable'); await page.goto('/settings');
  await expect(page.getByText(/Safe defaults are shown and have not been saved/)).toBeVisible();
  await expect(page.getByLabel('Evidence density')).toHaveValue('BALANCED');
  await page.unroute('**/api/settings/preferences');
  await setupSettings(page, 'save-failure'); await page.reload();
  await page.getByLabel('Evidence density').selectOption('COMPACT');
  await page.getByRole('button', { name: 'Save evidence density' }).click();
  await expect(page.getByText(/selection is retained locally/)).toBeVisible();
  await expect(page.getByLabel('Evidence density')).toHaveValue('COMPACT');
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

test('Activity Feed desktop and mobile preserve governed meaning and event order', async ({ page }) => {
  await setupActivity(page); await page.goto('/activity');
  await expect(page.getByRole('heading', { name: 'Change intelligence' })).toBeVisible();
  await expect(page.locator('.act-item').nth(0)).toContainText('Review completed');
  await expect(page.locator('.act-item').nth(1)).toContainText('Evidence Integrity blocked');
  await expect(page.getByText('Communication: not recorded')).toHaveCount(3);
  await expect(page.getByText('Causal detail restricted')).toBeVisible();
  const restricted = page.locator('.act-item').filter({ hasText: 'Evidence Integrity authority became unavailable' });
  await expect(restricted.getByText('Restricted affected object')).toBeVisible();
  await expect(restricted.getByRole('link', { name: /Open affected object/ })).toHaveCount(0);
  await expect(page.getByText(/page view|retry|diagnostic/i)).toHaveCount(0);
  await verify(page, 'activity-feed-desktop-1440x1000.png', 1440, 1000);
  await verify(page, 'activity-feed-mobile-390x844.png', 390, 844, { keyboard: true });
});

for (const state of ['loading', 'empty', 'error']) {
  test(`Activity Feed ${state} state is explicit and overflow-free`, async ({ page }) => {
    await setupActivity(page, state); await page.goto('/activity');
    if (state === 'loading') await expect(page.getByText('Loading governed activity…')).toBeVisible();
    if (state === 'empty') await expect(page.getByText('No material activity recorded')).toBeVisible();
    if (state === 'error') await expect(page.getByText('Activity is unavailable')).toBeVisible();
    await verify(page, `activity-feed-${state}-mobile-390x844.png`, 390, 844);
  });
}
