/**
 * v5.3 Investigation Engine & Classifier — Verification Test
 */
const { classifyContext, getContextSummary, JOURNEY_FUNNEL } = require('./backend/utils/classifier');
const { investigate } = require('./backend/utils/v5/investigation');

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push(`✓ PASS: ${name}`);
  } catch (e) {
    failed++;
    results.push(`✗ FAIL: ${name} — ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

console.log('========================================');
console.log(' v5.3 Intelligence Core Test');
console.log('========================================\n');

// ===== 1. Classifier Scale (Solo / Mid-Market / Enterprise) =====
test('Classifier: Solo business → no trackers', () => {
  const ctx = classifyContext({
    niche: 'HVAC',
    speed_score: 30,
    responsive_status: 'not_responsive',
    trackers_found: [],
    seo_gaps: ['Missing Title Tag'],
    conversion_gaps: ['No phone number detected for direct contact'],
    address_detected: true
  });
  assert(ctx.scale === 'Solo', `Expected Solo, got ${ctx.scale}`);
});

test('Classifier: Enterprise with GA+Ads+good speed', () => {
  const ctx = classifyContext({
    niche: 'Legal Services',
    speed_score: 75,
    responsive_status: 'responsive',
    trackers_found: ['Google Analytics', 'Google Ads', 'Facebook Pixel'],
    seo_gaps: [],
    conversion_gaps: [],
    address_detected: true
  });
  assert(ctx.scale === 'Enterprise', `Expected Enterprise, got ${ctx.scale}`);
});

test('Classifier: Mid-Market with GA', () => {
  const ctx = classifyContext({
    niche: 'Dentist',
    speed_score: 60,
    responsive_status: 'responsive',
    trackers_found: ['Google Analytics'],
    seo_gaps: ['Missing Meta Description'],
    conversion_gaps: [],
    address_detected: true
  });
  assert(ctx.scale === 'Mid-Market', `Expected Mid-Market, got ${ctx.scale}`);
});

// ===== 2. Journey Funnel Mapping =====
test('Classifier: Urgent journey funnel is "Maps to Mobile Call"', () => {
  const ctx = classifyContext({
    niche: 'HVAC',
    speed_score: 50,
    responsive_status: 'responsive',
    trackers_found: [],
    seo_gaps: [],
    conversion_gaps: [],
    address_detected: true
  });
  // Has phone (no phone gap), is HVAC → Urgent
  assert(ctx.transactionModel === 'Urgent', `Expected Urgent, got ${ctx.transactionModel}`);
  assert(ctx.journeyFunnel.funnel === 'Maps to Mobile Call', 
    `Expected 'Maps to Mobile Call', got ${ctx.journeyFunnel.funnel}`);
  assert(ctx.journeyFunnel.criticalConversionPath.includes('visible_phone'), 'Missing visible_phone in critical path');
});

test('Classifier: Deliberate journey funnel → Legal Services', () => {
  const ctx = classifyContext({
    niche: 'Legal Services',
    speed_score: 50,
    responsive_status: 'responsive',
    trackers_found: [],
    seo_gaps: [],
    conversion_gaps: ['No clear Call-To-Action (CTA) buttons found', 'No phone number detected for direct contact'],
    address_detected: true
  });
  assert(ctx.transactionModel === 'Deliberate', `Expected Deliberate, got ${ctx.transactionModel}`);
  assert(ctx.journeyFunnel.funnel === 'Organic to Credentials Form',
    `Expected 'Organic to Credentials Form', got ${ctx.journeyFunnel.funnel}`);
});

test('Classifier: Hybrid journey funnel', () => {
  const ctx = classifyContext({
    niche: 'Restaurant',
    speed_score: 70,
    responsive_status: 'responsive',
    trackers_found: [],
    seo_gaps: [],
    conversion_gaps: [],
    address_detected: true
  });
  // Has phone and CTA (no gaps) + responsive → Hybrid
  assert(ctx.transactionModel === 'Hybrid', `Expected Hybrid, got ${ctx.transactionModel}`);
  assert(ctx.journeyFunnel.funnel === 'Search → Verify → Call or Book',
    `Expected 'Search → Verify → Call or Book', got ${ctx.journeyFunnel.funnel}`);
});

// ===== 3. Investigation Engine - Weighted Severity =====
test('Investigation: Missing phone is 10/10 for Urgent, 3/10 for Deliberate', () => {
  const { assessConversion } = require('./backend/utils/v5/investigation');
  
  const urgentResult = assessConversion(
    { conversion_gaps: ['No phone number detected for direct contact'] },
    'Urgent',
    ['No phone number detected for direct contact']
  );
  const phoneFindingsUrgent = urgentResult.findings.filter(f => f.signal === 'no_phone');
  assert(phoneFindingsUrgent.length > 0, 'No phone finding in Urgent');
  assert(phoneFindingsUrgent[0].severity === 10, `Expected 10 for Urgent phone, got ${phoneFindingsUrgent[0].severity}`);

  const deliberateResult = assessConversion(
    { conversion_gaps: ['No phone number detected for direct contact'] },
    'Deliberate',
    ['No phone number detected for direct contact']
  );
  const phoneFindingsDelib = deliberateResult.findings.filter(f => f.signal === 'no_phone');
  assert(phoneFindingsDelib[0].severity === 3, `Expected 3 for Deliberate phone, got ${phoneFindingsDelib[0].severity}`);
});

test('Investigation: Missing SSL is 9/10 for Deliberate, 5/10 for Urgent', () => {
  const { assessTrust } = require('./backend/utils/v5/investigation');

  const deliberateResult = assessTrust(
    { address_detected: true },
    'Deliberate',
    ['SSL certificate is missing or invalid (Site loaded over HTTP)']
  );
  const sslFindings = deliberateResult.findings.filter(f => f.signal === 'missing_ssl');
  assert(sslFindings.length > 0, 'No SSL finding');
  assert(sslFindings[0].severity === 9, `Expected 9 for Deliberate SSL, got ${sslFindings[0].severity}`);

  const urgentResult = assessTrust(
    { address_detected: true },
    'Urgent',
    ['SSL certificate is missing or invalid (Site loaded over HTTP)']
  );
  const sslUrgent = urgentResult.findings.filter(f => f.signal === 'missing_ssl');
  assert(sslUrgent[0].severity === 5, `Expected 5 for Urgent SSL, got ${sslUrgent[0].severity}`);
});

// ===== 4. Full Investigation Pipeline =====
test('Investigation: Full report for neglected HVAC', () => {
  const context = classifyContext({
    niche: 'HVAC',
    speed_score: 20,
    responsive_status: 'not_responsive',
    trackers_found: [],
    seo_gaps: ['Missing Title Tag', 'Missing Meta Description'],
    conversion_gaps: ['No phone number detected for direct contact', 'No clear Call-To-Action (CTA) buttons found'],
    address_detected: true
  });
  const report = investigate({
    speed_score: 20,
    responsive_status: 'not_responsive',
    seo_gaps: ['Missing Title Tag', 'Missing Meta Description'],
    conversion_gaps: ['No phone number detected for direct contact', 'No clear Call-To-Action (CTA) buttons found'],
    address_detected: true
  }, context);

  assert(report.dimensions, 'Missing dimensions');
  assert(report.dimensions.accessibility.score >= 0, 'Missing accessibility score');
  assert(report.dimensions.trust.score >= 0, 'Missing trust score');
  assert(report.dimensions.conversion.score >= 0, 'Missing conversion score');
  assert(report.dimensions.localSEO.score >= 0, 'Missing localSEO score');
  assert(report.overall.healthScore >= 0, 'Missing overall health score');
  assert(report.overall.totalFindings > 0, 'Expected findings');
  assert(report.scoredForModel === 'Deliberate' || report.scoredForModel === 'Urgent' || report.scoredForModel === 'Hybrid',
    'Missing scoredForModel');
});

test('Investigation: Healthy site → low scores, few findings', () => {
  const context = classifyContext({
    niche: 'Software',
    speed_score: 92,
    responsive_status: 'responsive',
    trackers_found: ['Google Analytics', 'Google Ads', 'Facebook Pixel'],
    seo_gaps: [],
    conversion_gaps: [],
    address_detected: true
  });
  const report = investigate({
    speed_score: 92,
    responsive_status: 'responsive',
    seo_gaps: [],
    conversion_gaps: [],
    trackers_found: ['Google Analytics', 'Google Ads', 'Facebook Pixel'],
    address_detected: true
  }, context);

  assert(report.overall.totalFindings === 0 || report.overall.totalFindings < 3,
    `Expected few findings for healthy site, got ${report.overall.totalFindings}`);
  assert(report.overall.healthScore >= 70, `Expected healthScore >= 70, got ${report.overall.healthScore}`);
});

// ===== 5. Confidence Tracking =====
test('Classifier: Confidence levels reported for all dimensions', () => {
  const ctx = classifyContext({
    niche: 'Dentist',
    speed_score: 60,
    responsive_status: 'responsive',
    trackers_found: ['Google Analytics'],
    seo_gaps: [],
    conversion_gaps: [],
    address_detected: true
  });
  assert(ctx.confidence, 'Missing confidence block');
  assert(ctx.confidence.scale, 'Missing scale confidence');
  assert(ctx.confidence.maturity, 'Missing maturity confidence');
  assert(ctx.confidence.transactionModel, 'Missing transactionModel confidence');
});

console.log('\n========================================');
console.log(' Results Summary');
console.log('========================================\n');
console.log(`Total: ${passed + failed} tests`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log('');

results.forEach(r => console.log(r));

console.log('\n========================================');
if (failed === 0) {
  console.log(' ALL V5.3 TESTS PASSED');
} else {
  console.log(` ${failed} TEST(S) FAILED`);
}
console.log('========================================\n');

process.exit(failed > 0 ? 1 : 0);
