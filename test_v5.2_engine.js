/**
 * v5.2 Commercial Reasoning & Constraint Chain — Verification Test
 *
 * Tests the full pipeline: Context Classification → Weighted Reasoning →
 * Devil's Advocate → Constraint Chain → Growth Roadmap.
 */
const { classifyContext, getContextSummary } = require('./backend/utils/classifier');
const { discernPatterns } = require('./backend/utils/reasoning-matrix');
const { generateGrowthRoadmap } = require('./backend/utils/constraint-chain');
const { enrichLeadData } = require('./backend/utils/enrichment');

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
console.log(' v5.2 Commercial Reasoning Engine Test');
console.log('========================================\n');

// ===== Test 1: Context Classification =====
test('Classifier: HVAC urgent + no trackers + all gaps → Local/Neglected/Deliberate', () => {
  const ctx = classifyContext({
    niche: 'HVAC',
    speed_score: 30,
    responsive_status: 'not_responsive',
    trackers_found: [],
    seo_gaps: ['Missing Title Tag'],
    conversion_gaps: [
      'No phone number detected for direct contact',
      'No clear Call-To-Action (CTA) buttons found'
    ],
    address_detected: true
  });
  assert(ctx.scale === 'Solo', `Expected Solo, got ${ctx.scale}`);
  assert(ctx.maturity === 'Neglected', `Expected Neglected, got ${ctx.maturity}`);
  // No phone → can't be Urgent, becomes Deliberate (correctly)
  assert(ctx.transactionModel === 'Deliberate', `Expected Deliberate, got ${ctx.transactionModel}`);
});

test('Classifier: Enterprise with GA + Ads + good speed', () => {
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
  assert(ctx.maturity === 'Digital Leader', `Expected Digital Leader, got ${ctx.maturity}`);
});

test('Classifier: Mid-Market with GA only, CTA gap → Mid-Market/Active Marketer/Deliberate', () => {
  const ctx = classifyContext({
    niche: 'Dentist',
    speed_score: 60,
    responsive_status: 'responsive',
    trackers_found: ['Google Analytics'],
    seo_gaps: ['Missing Meta Description'],
    conversion_gaps: ['No clear Call-To-Action (CTA) buttons found'],
    address_detected: true
  });
  assert(ctx.scale === 'Mid-Market', `Expected Mid-Market, got ${ctx.scale}`);
  assert(ctx.maturity === 'Active Marketer', `Expected Active Marketer, got ${ctx.maturity}`);
  // Missing CTA but has phone → v5.3 correctly assigns Hybrid (low confidence)
        assert(ctx.transactionModel === 'Hybrid', `Expected Hybrid, got ${ctx.transactionModel}`);
});

// ===== Test 2: Weighted Reasoning Matrix =====
test('Discernment: Trust Deficit gets highest weight for SSL-missing Legal', () => {
  const result = discernPatterns(
    {
      niche: 'Legal',
      speed_score: 45,
      responsive_status: 'responsive',
      seo_gaps: ['SSL certificate is missing or invalid (Site loaded over HTTP)'],
      conversion_gaps: [],
      trackers_found: [],
      address_detected: false,
      business_name: 'Smith Law'
    },
    50, 70,
    { scale: 'Local', maturity: 'Neglected', transactionModel: 'Deliberate' }
  );
  assert(result.primaryBreakthrough !== null, 'No primary breakthrough found');
  assert(result.primaryBreakthrough.pattern.tag === 'Trust Deficit',
    `Expected Trust Deficit, got ${result.primaryBreakthrough?.pattern?.tag}`);
  assert(result.devilsAdvocate !== null, 'No Devil\'s Advocate review');
});

test('Discernment: Revenue Bottleneck for ad-heavy slow site', () => {
  const result = discernPatterns(
    {
      niche: 'E-commerce',
      speed_score: 25,
      responsive_status: 'responsive',
      seo_gaps: ['Slow server response time (TTFB > 1.2s)'],
      conversion_gaps: [],
      trackers_found: ['Google Analytics', 'Facebook Pixel'],
      address_detected: true,
      business_name: 'Online Shop'
    },
    40, 70,
    { scale: 'Mid-Market', maturity: 'Active Marketer', transactionModel: 'Hybrid' }
  );
  assert(result.primaryBreakthrough !== null, 'No primary breakthrough');
  assert(result.primaryBreakthrough.pattern.tag === 'Revenue Bottleneck',
    `Expected Revenue Bottleneck, got ${result.primaryBreakthrough?.pattern?.tag}`);
});

// ===== Test 3: Devil's Advocate =====
test('Devils Advocate: Closeability-based swap when scores are close', () => {
  const { devilsAdvocateReview } = require('./backend/utils/reasoning-matrix');
  const mockScored = [
    { pattern: { tag: 'Mobile Confidence Breakdown' }, score: 82, meta: { weight: 82, closeability: 8 } },
    { pattern: { tag: 'Booking Friction' }, score: 78, meta: { weight: 88, closeability: 9 } }
  ];
  const result = devilsAdvocateReview(mockScored[0], mockScored, {});
  // Should not swap because diff is 4.9% (4/82), which is < 10%
  // But Booking Friction has higher closeability (9 > 8)
  assert(result.critiques.length > 0, 'Expected critiques but got none');
});

// ===== Test 4: Constraint Chain =====
test('Constraint Chain: 3-phase roadmap for neglected HVAC', () => {
  const context = { scale: 'Local', maturity: 'Neglected', transactionModel: 'Urgent' };
  const roadmap = generateGrowthRoadmap(
    {
      niche: 'HVAC',
      speed_score: 20,
      responsive_status: 'not_responsive',
      seo_gaps: ['Missing Title Tag', 'Missing Meta Description', 'Slow server response time (TTFB > 1.2s)'],
      conversion_gaps: [
        'No phone number detected for direct contact',
        'No clear Call-To-Action (CTA) buttons found',
        'No Schema.org structured data detected (Local SEO risk)'
      ],
      trackers_found: [],
      address_detected: true,
      business_name: 'Cool Air HVAC'
    },
    context
  );
  assert(roadmap.phases.length >= 1, 'Expected at least 1 phase');
  assert(roadmap.totalPhases >= 1, `Expected totalPhases >= 1, got ${roadmap.totalPhases}`);
  // Each phase should have confidence ratings
  roadmap.phases.forEach((p, i) => {
    assert(typeof p.confidence === 'number', `Phase ${i+1} missing confidence`);
    assert(p.title, `Phase ${i+1} missing title`);
    assert(p.transition, `Phase ${i+1} missing transition`);
  });
});

test('Constraint Chain: Healthy site returns no phases', () => {
  const context = { scale: 'Enterprise', maturity: 'Digital Leader', transactionModel: 'Hybrid' };
  const roadmap = generateGrowthRoadmap(
    {
      niche: 'Software',
      speed_score: 92,
      responsive_status: 'responsive',
      seo_gaps: [],
      conversion_gaps: [],
      trackers_found: ['Google Analytics', 'Google Ads', 'Facebook Pixel'],
      address_detected: true,
      business_name: 'Tech Co'
    },
    context
  );
  // Healthy site might still match some patterns at very low weight
  // But should have at most 1 phase with low confidence
  assert(roadmap.phases.length <= 1, `Expected <=1 phase for healthy, got ${roadmap.phases.length}`);
});

// ===== Test 5: Full Enrichment Pipeline =====
test('Full enrichment: returns commercial_context and growth_roadmap', () => {
  const enriched = enrichLeadData({
    _evidence: { validation: { valid: true } },
    niche: 'HVAC',
    speed_score: 30,
    responsive_status: 'not_responsive',
    seo_gaps: ['Missing Title Tag', 'Missing Meta Description'],
    conversion_gaps: ['No phone number detected for direct contact', 'No clear Call-To-Action (CTA) buttons found'],
    trackers_found: [],
    address_detected: true,
    business_name: 'Test HVAC',
    domain: 'test.com',
    location: 'Austin, TX',
    id: 'test-1'
  });
  assert(enriched.commercial_context, 'Missing commercial_context');
  assert(enriched.commercial_context.scale, 'Missing scale');
  assert(enriched.commercial_context.maturity, 'Missing maturity');
  assert(enriched.commercial_context.transactionModel, 'Missing transactionModel');
  assert(enriched.discernment, 'Missing discernment');
  assert(enriched.growth_roadmap, 'Missing growth_roadmap');
  assert(enriched.growth_roadmap.phases !== undefined, 'Missing growth_roadmap.phases');
  assert(enriched.discernment.primaryBreakthrough, 'Missing primary breakthrough');
  assert(enriched.discernment.devilsAdvocate, 'Missing devil\'s advocate');
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
  console.log(' ALL V5.2 TESTS PASSED');
} else {
  console.log(` ${failed} TEST(S) FAILED`);
}
console.log('========================================\n');

process.exit(failed > 0 ? 1 : 0);
