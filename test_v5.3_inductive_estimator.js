/**
 * test_v5.3_inductive_estimator.js
 * 
 * Tests the v5.3 Inductive Conclusion and Confidence-Gated Revenue Leak Estimator:
 * 1. inductiveConclusion() — severity → pattern mapping
 * 2. calculateEvidenceConfidence() — data completeness scoring
 * 3. calculateRevenueLeak() — 40% confidence gate
 * 4. Full pipeline integration via enrichLeadData()
 */

const { inductiveConclusion, DIMENSION_PATTERN_MAP } = require('./backend/utils/reasoning-matrix');
const { calculateRevenueLeak, calculateEvidenceConfidence, calculateSimpleRevenueLeak } = require('./backend/utils/calculators');
const { investigate } = require('./backend/utils/v5/investigation');
const { enrichLeadData } = require('./backend/utils/enrichment');
const { classifyContext } = require('./backend/utils/classifier');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  const pass = actual === expected;
  if (pass) {
    passed++;
    console.log(`  ✓ ${message} (${JSON.stringify(actual)})`);
  } else {
    failed++;
    console.log(`  ✗ ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertNotNull(value, message) {
  if (value !== null && value !== undefined) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message} — expected non-null, got ${value}`);
  }
}

function assertNull(value, message) {
  if (value === null || value === undefined) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message} — expected null, got ${JSON.stringify(value)}`);
  }
}

console.log('\n=== v5.3 Inductive Conclusion & Confidence-Gated Revenue Estimator Tests ===\n');

// ============================================
// Test 1: DIMENSION_PATTERN_MAP completeness
// ============================================
console.log('--- Test 1: DIMENSION_PATTERN_MAP completeness ---');
assertNotNull(DIMENSION_PATTERN_MAP, 'DIMENSION_PATTERN_MAP is defined');
assertNotNull(DIMENSION_PATTERN_MAP.accessibility, '  accessibility dimension mapped');
assertNotNull(DIMENSION_PATTERN_MAP.trust, '  trust dimension mapped');
assertNotNull(DIMENSION_PATTERN_MAP.conversion, '  conversion dimension mapped');
assertNotNull(DIMENSION_PATTERN_MAP.localSEO, '  localSEO dimension mapped');
assertEqual(DIMENSION_PATTERN_MAP.accessibility.high.tag, 'Mobile Confidence Breakdown', '  accessibility.high → Mobile Confidence Breakdown');
assertEqual(DIMENSION_PATTERN_MAP.trust.any.tag, 'Trust Deficit', '  trust.any → Trust Deficit');
assertEqual(DIMENSION_PATTERN_MAP.conversion.critical.tag, 'High-Traffic, Low-Conversion Opportunity', '  conversion.critical → High-Traffic, Low-Conversion');
assertEqual(DIMENSION_PATTERN_MAP.localSEO.any.tag, 'Local Visibility Gap', '  localSEO.any → Local Visibility Gap');

// ============================================
// Test 2: inductiveConclusion with null/empty input
// ============================================
console.log('\n--- Test 2: inductiveConclusion edge cases ---');
const nullResult = inductiveConclusion(null, {});
assertNull(nullResult.primaryBottleneck, '  null investigation returns null bottleneck');
assertEqual(nullResult.conclusion, 'Insufficient data for analysis', '  null investigation returns correct message');

const emptyResult = inductiveConclusion({ dimensions: null }, {});
assertNull(emptyResult.primaryBottleneck, '  missing dimensions returns null bottleneck');

const noDimResult = inductiveConclusion({ dimensions: {} }, {});
assertNull(noDimResult.primaryBottleneck, '  empty dimensions returns null bottleneck');

// ============================================
// Test 3: inductiveConclusion with low severity (all < 3.0)
// ============================================
console.log('\n--- Test 3: Low severity (no commercial issue) ---');
const cleanReport = {
  dimensions: {
    accessibility: { score: 1, findings: [] },
    trust: { score: 0, findings: [] },
    conversion: { score: 2, findings: [] },
    localSEO: { score: 1.5, findings: [] }
  },
  summary: { totalScore: 4.5, maxSeverity: 2 },
  overallAssessment: 'Minor issues detected'
};
const cleanInductive = inductiveConclusion(cleanReport, {});
assertNull(cleanInductive.primaryBottleneck, '  low severity returns null bottleneck');
assertEqual(cleanInductive.conclusion, 'No Commercially Significant Issue Detected', '  returns clean report message');

// ============================================
// Test 4: inductiveConclusion with high severity (accessibility)
// ============================================
console.log('\n--- Test 4: High severity accessibility bottleneck ---');
const highAccessibilityReport = {
  dimensions: {
    accessibility: { score: 9, findings: ['Speed score: 25/100', 'Not responsive'] },
    trust: { score: 4, findings: ['SSL present'] },
    conversion: { score: 3, findings: ['Has phone'] },
    localSEO: { score: 2, findings: ['Missing schema'] }
  },
  summary: { totalScore: 18, maxSeverity: 9 },
  overallAssessment: 'Critical issues detected'
};
const accessInductive = inductiveConclusion(highAccessibilityReport, {});
assertNotNull(accessInductive.primaryBottleneck, '  has primary bottleneck');
assertEqual(accessInductive.primaryBottleneck.dimension, 'accessibility', '  bottleneck is accessibility');
assertEqual(accessInductive.primaryBottleneck.label, 'critical', '  severity label is critical');
assertNotNull(accessInductive.patternLabel, '  has pattern label');
assertEqual(accessInductive.patternLabel.tag, 'Neglected Digital Storefront', '  pattern is Neglected Digital Storefront');

// ============================================
// Test 5: inductiveConclusion with trust bottleneck
// ============================================
console.log('\n--- Test 5: Trust bottleneck ---');
const trustReport = {
  dimensions: {
    accessibility: { score: 2, findings: [] },
    trust: { score: 8, findings: ['SSL missing', 'No address found'] },
    conversion: { score: 1, findings: [] },
    localSEO: { score: 3, findings: [] }
  },
  summary: { totalScore: 14, maxSeverity: 8 },
  overallAssessment: 'Trust issues detected'
};
const trustInductive = inductiveConclusion(trustReport, {});
assertEqual(trustInductive.primaryBottleneck.dimension, 'trust', '  bottleneck is trust');
assertEqual(trustInductive.patternLabel.tag, 'Trust Deficit', '  pattern is Trust Deficit');

// ============================================
// Test 6: inductiveConclusion with conversion bottleneck
// ============================================
console.log('\n--- Test 6: Conversion bottleneck (medium severity) ---');
const convReport = {
  dimensions: {
    accessibility: { score: 2, findings: [] },
    trust: { score: 3, findings: [] },
    conversion: { score: 6, findings: ['No phone found', 'No contact form'] },
    localSEO: { score: 1, findings: [] }
  },
  summary: { totalScore: 12, maxSeverity: 6 },
  overallAssessment: 'Conversion issues detected'
};
const convInductive = inductiveConclusion(convReport, {});
assertEqual(convInductive.primaryBottleneck.dimension, 'conversion', '  bottleneck is conversion');
assertEqual(convInductive.primaryBottleneck.label, 'high', '  severity label is high');
assertEqual(convInductive.patternLabel.tag, 'Booking Friction', '  pattern is Booking Friction');

// ============================================
// Test 7: inductiveConclusion with localSEO bottleneck
// ============================================
console.log('\n--- Test 7: Local SEO bottleneck ---');
const seoReport = {
  dimensions: {
    accessibility: { score: 2, findings: [] },
    trust: { score: 3, findings: [] },
    conversion: { score: 1, findings: [] },
    localSEO: { score: 7, findings: ['No schema', 'No title tag'] }
  },
  summary: { totalScore: 13, maxSeverity: 7 },
  overallAssessment: 'Local SEO issues detected'
};
const seoInductive = inductiveConclusion(seoReport, {});
assertEqual(seoInductive.primaryBottleneck.dimension, 'localSEO', '  bottleneck is localSEO');
assertEqual(seoInductive.patternLabel.tag, 'Local Visibility Gap', '  pattern is Local Visibility Gap');

// ============================================
// Test 8: calculateEvidenceConfidence
// ============================================
console.log('\n--- Test 8: Evidence Confidence Scoring ---');

// Full data lead
const fullLead = {
  speed_score: 45,
  responsive_status: 'not_responsive',
  trackers_found: ['Google Analytics'],
  seo_gaps: ['Missing title tag'],
  conversion_gaps: ['No phone number'],
  verified_emails: ['test@example.com']
};
const fullConfidence = calculateEvidenceConfidence(fullLead, { dimensions: {} });
assertEqual(fullConfidence.score, 100, '  full data → 100% confidence');
assert(fullConfidence.isReliable, '  full data → isReliable');

// Sparse lead (below 40%)
const sparseLead = {
  speed_score: null,
  responsive_status: null,
  trackers_found: [],
  seo_gaps: [],
  conversion_gaps: [],
  verified_emails: []
};
const sparseConfidence = calculateEvidenceConfidence(sparseLead, null);
assert(sparseConfidence.score < 40, `  sparse data → ${sparseConfidence.score}% (< 40%)`);
assert(!sparseConfidence.isReliable, '  sparse data → not reliable');

// Partial lead (speed + responsive only = 40%, exactly at gate)
const partialLead = {
  speed_score: 45,
  responsive_status: 'responsive',
  trackers_found: [],
  seo_gaps: [],
  conversion_gaps: [],
  verified_emails: []
};
const partialConfidence = calculateEvidenceConfidence(partialLead, null);
assertEqual(partialConfidence.score, 40, '  partial data → 40%');
assert(partialConfidence.isReliable, '  partial data → isReliable (at threshold)');

// ============================================
// Test 9: Revenue Leak — gated below 40% confidence
// ============================================
console.log('\n--- Test 9: Confidence-Gated Revenue Leak (below threshold) ---');
const gatedResult = calculateRevenueLeak(sparseLead, null, null, null);
assert(gatedResult.isGated, '  sparse data → isGated');
assertNull(gatedResult.revenue_leak, '  sparse data → revenue_leak is null');
assert(gatedResult.explanation.length > 0, '  has explanation');
assertEqual(gatedResult.confidence, sparseConfidence.score, '  matches confidence score');

// ============================================
// Test 10: Revenue Leak — above threshold with full data
// ============================================
console.log('\n--- Test 10: Revenue Leak (above threshold) ---');
const fullResult = calculateRevenueLeak(
  { ...fullLead, niche: 'HVAC' },
  { scale: 'Mid-Market', maturity: 'Active Marketer' },
  { dimensions: {} },
  {
    primaryBottleneck: { dimension: 'accessibility', severity: 8, label: 'critical' }
  }
);
assert(!fullResult.isGated, '  full data → not gated');
assertNotNull(fullResult.revenue_leak, '  full data → has revenue_leak');
assert(fullResult.revenue_leak.monthly_revenue_leak > 0, '  revenue leak > 0');
assertEqual(fullResult.confidence, 100, '  100% confidence');
assert(fullResult.confidenceDetails.trafficSource.includes('Mid-Market'), '  uses Mid-Market traffic estimates');
assert(fullResult.confidenceDetails.primarySeverity === 8, '  uses primary severity 8');

// ============================================
// Test 11: Revenue Leak — severity determines loss %
// ============================================
console.log('\n--- Test 11: Severity → loss percentage mapping ---');
const lowSeverityResult = calculateRevenueLeak(
  { ...fullLead, niche: 'HVAC' },
  { scale: 'Solo', maturity: 'Neglected' },
  { dimensions: {} },
  { primaryBottleneck: { dimension: 'conversion', severity: 3, label: 'medium' } }
);
assertEqual(lowSeverityResult.confidenceDetails.lossPercentage, 0.10, '  severity 3 → 10% loss');

const highSeverityResult = calculateRevenueLeak(
  { ...fullLead, niche: 'HVAC' },
  { scale: 'Solo', maturity: 'Neglected' },
  { dimensions: {} },
  { primaryBottleneck: { dimension: 'conversion', severity: 8.5, label: 'critical' } }
);
assertEqual(highSeverityResult.confidenceDetails.lossPercentage, 0.40, '  severity 8.5 → 40% loss');

// ============================================
// Test 12: Legacy backward compatibility — calculateSimpleRevenueLeak
// ============================================
console.log('\n--- Test 12: Legacy simple revenue leak ---');
const simpleLeak = calculateSimpleRevenueLeak(30, 'Dentist');
assertNotNull(simpleLeak, '  simple leak returns result');
assertEqual(simpleLeak.loss_percentage, 40, '  speed < 40 → 40% loss');
assert(simpleLeak.formatted_leak.includes('$'), '  formats as currency');
assert(simpleLeak.sentence.includes('Dentist'), '  includes niche in sentence');

const mediumLeak = calculateSimpleRevenueLeak(55, 'Dentist');
assertEqual(mediumLeak.loss_percentage, 20, '  speed < 70 → 20% loss');

const lowLeak = calculateSimpleRevenueLeak(85, 'Dentist');
assertEqual(lowLeak.loss_percentage, 5, '  speed >= 70 → 5% loss');

// ============================================
// Test 13: Dimension scores output from inductiveConclusion
// ============================================
console.log('\n--- Test 13: Dimension scores output ---');
const dimScoreTest = inductiveConclusion(highAccessibilityReport, {});
assertNotNull(dimScoreTest.dimensionScores, '  has dimensionScores');
assertEqual(dimScoreTest.dimensionScores.length, 4, '  4 dimensions scored');
assertEqual(dimScoreTest.dimensionScores[0].dimension, 'accessibility', '  sorted: accessibility first');
assert(dimScoreTest.dimensionScores[0].score === 9, '  accessibility score = 9');

// ============================================
// Test 14: Full enrichment pipeline integration (smoke test)
// ============================================
console.log('\n--- Test 14: Full enrichment pipeline integration ---');
const sampleLead = {
  url: 'https://example-hvac.com',
  niche: 'HVAC',
  speed_score: 35,
  responsive_status: 'not_responsive',
  trackers_found: ['Google Analytics', 'Facebook Pixel'],
  seo_gaps: ['Missing meta description', 'Missing schema markup'],
  conversion_gaps: ['No phone number', 'No contact form'],
  verified_emails: ['owner@example-hvac.com'],
  location: 'Chicago, IL',
  details: { ssl_present: true, ssl_status: 'valid' }
};

try {
  const enriched = enrichLeadData(sampleLead, { avg_seo_score: 65 });
  assertNotNull(enriched, '  enrichment completed');
  assertNotNull(enriched.investigation, '  has investigation block');
  assertNotNull(enriched.inductive_conclusion, '  has inductive_conclusion block');
  assertNotNull(enriched.investigation.dimensions.accessibility, '  has accessibility dimension');
  assertNotNull(enriched.inductive_conclusion.primaryBottleneck, '  has primary bottleneck');
  assert(enriched.revenue_leak.revenue_leak !== undefined, '  has revenue_leak in output');
  assertNotNull(enriched.strategy_report, '  has strategy_report (backward compat)');
  assertNotNull(enriched.discernment, '  has discernment (backward compat)');
  assertNotNull(enriched.growth_roadmap, '  has growth_roadmap (backward compat)');
  assertNotNull(enriched.opportunity_brief, '  has opportunity_brief (backward compat)');
} catch (e) {
  failed++;
  console.log(`  ✗ enrichment failed: ${e.message}`);
}

// ============================================
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);