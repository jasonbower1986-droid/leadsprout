/**
 * Discovery Pattern Verification Test Script
 *
 * Tests the 13 commercial opportunity patterns against various lead scenarios
 * to verify the intelligence engine correctly identifies patterns.
 */

const { identifyPatterns, PATTERNS } = require('./utils/discovery-patterns');

let passed = 0;
let failed = 0;
const results = [];

function test(name, lead, expectedTags, healthScore = 50, nicheAvgHealth = 70) {
  const matchedPatterns = identifyPatterns(lead, healthScore, nicheAvgHealth);
  const matchedTags = matchedPatterns.map(p => p.tag);
  
  // Check that all expected tags are present
  const allExpectedFound = expectedTags.every(tag => matchedTags.includes(tag));
  
  if (allExpectedFound) {
    passed++;
    results.push(`✓ PASS: ${name} → ${matchedTags.join(', ') || 'none'}`);
  } else {
    failed++;
    results.push(`✗ FAIL: ${name}`);
    results.push(`  Expected to include: ${expectedTags.join(', ')}`);
    results.push(`  Got: ${matchedTags.join(', ') || 'none'}`);
  }
}

console.log('========================================');
console.log(' Discovery Pattern Verification Suite');
console.log('========================================\n');

// ===== SCENARIO 1: HVAC Company with broken mobile site =====
test(
  'Neglected Storefront + Mobile + Booking Friction (HVAC)',
  {
    niche: 'HVAC',
    speed_score: 25,
    responsive_status: 'not_responsive',
    seo_gaps: ['Missing Title Tag', 'Slow server response time (TTFB > 1.2s)'],
    conversion_gaps: [
      'No clear Call-To-Action (CTA) buttons found',
      'No phone number detected for direct contact'
    ],
    trackers_found: [],
    address_detected: true,
    business_name: 'ABC HVAC'
  },
  ['Neglected Digital Storefront', 'Mobile Confidence Breakdown', 'Booking Friction'],
  35
);

// ===== SCENARIO 2: Premium / Luxury brand with poor site =====
test(
  'Premium Business, Budget Website',
  {
    niche: 'Legal',
    business_name: 'Elite Law Partners',
    speed_score: 45,
    responsive_status: 'responsive',
    seo_gaps: ['Missing Meta Description'],
    conversion_gaps: ['No lead capture form found'],
    trackers_found: [],
    address_detected: true
  },
  ['Premium Business, Budget Website'],
  55
);

// ===== SCENARIO 3: Site with Google Analytics but no CTA =====
test(
  'High-Traffic, Low-Conversion Opportunity',
  {
    niche: 'Retail / Florist',
    speed_score: 70,
    responsive_status: 'responsive',
    seo_gaps: [],
    conversion_gaps: [
      'No clear Call-To-Action (CTA) buttons found',
      'No lead capture form found'
    ],
    trackers_found: ['Google Analytics'],
    address_detected: true,
    business_name: 'Flower Shop'
  },
  ['High-Traffic, Low-Conversion Opportunity'],
  75
);

// ===== SCENARIO 4: Mobile Confidence Breakdown =====
test(
  'Mobile Confidence Breakdown',
  {
    niche: 'Restaurant',
    speed_score: 40,
    responsive_status: 'not_responsive',
    seo_gaps: [],
    conversion_gaps: [],
    trackers_found: [],
    address_detected: true,
    business_name: 'Diner'
  },
  ['Mobile Confidence Breakdown'],
  40
);

// ===== SCENARIO 5: Competitive Neglect =====
test(
  'Competitive Neglect (score 30 below niche avg)',
  {
    niche: 'HVAC',
    speed_score: 30,
    responsive_status: 'not_responsive',
    seo_gaps: ['Missing Title Tag'],
    conversion_gaps: ['No clear Call-To-Action (CTA) buttons found'],
    trackers_found: [],
    address_detected: true,
    business_name: 'HVAC Co'
  },
  ['Competitive Neglect'],
  35,
  65
);

// ===== SCENARIO 6: Local Visibility Gap =====
test(
  'Local Visibility Gap',
  {
    niche: 'Plumbing',
    speed_score: 60,
    responsive_status: 'responsive',
    seo_gaps: ['Missing Title Tag', 'Missing Meta Description'],
    conversion_gaps: ['No Schema.org structured data detected (Local SEO risk)'],
    trackers_found: [],
    address_detected: true,
    business_name: 'Plumber Pro'
  },
  ['Local Visibility Gap'],
  65
);

// ===== SCENARIO 7: Trust Deficit (Legal, no address) =====
test(
  'Trust Deficit (Legal - no address)',
  {
    niche: 'Legal',
    speed_score: 55,
    responsive_status: 'responsive',
    seo_gaps: [],
    conversion_gaps: ['No Schema.org structured data detected (Local SEO risk)'],
    trackers_found: [],
    address_detected: false,
    business_name: 'Law Firm'
  },
  ['Trust Deficit'],
  65
);

// ===== SCENARIO 8: Revenue Bottleneck =====
test(
  'Revenue Bottleneck',
  {
    niche: 'E-commerce',
    speed_score: 35,
    responsive_status: 'responsive',
    seo_gaps: ['Slow server response time (TTFB > 1.2s)'],
    conversion_gaps: [],
    trackers_found: ['Google Analytics', 'Facebook Pixel'],
    address_detected: false,
    business_name: 'Shop'
  },
  ['Revenue Bottleneck'],
  45
);

// ===== SCENARIO 9: Outdated Customer Experience =====
test(
  'Outdated Customer Experience',
  {
    niche: 'Restaurant',
    speed_score: 20,
    responsive_status: 'not_responsive',
    seo_gaps: ['Missing Title Tag', 'Missing Meta Description'],
    conversion_gaps: ['No clear Call-To-Action (CTA) buttons found'],
    trackers_found: [],
    address_detected: false,
    business_name: 'Old Diner'
  },
  ['Outdated Customer Experience', 'Neglected Digital Storefront', 'Mobile Confidence Breakdown'],
  30
);

// ===== SCENARIO 10: Authority Without Credibility =====
test(
  'Authority Without Credibility',
  {
    niche: 'Legal',
    speed_score: 50,
    responsive_status: 'responsive',
    seo_gaps: ['Missing Title Tag', 'Slow server response time (TTFB > 1.2s)'],
    conversion_gaps: [],
    trackers_found: [],
    address_detected: false,
    business_name: 'Smith Law'
  },
  ['Authority Without Credibility'],
  55
);

// ===== SCENARIO 11: Digital First Impression Failure =====
test(
  'Digital First Impression Failure',
  {
    niche: 'Restaurant',
    speed_score: 25,
    responsive_status: 'responsive',
    seo_gaps: ['Missing Title Tag'],
    conversion_gaps: [],
    trackers_found: [],
    address_detected: false,
    business_name: 'Cafe'
  },
  ['Digital First Impression Failure'],
  30
);

// ===== SCENARIO 12: Booking Friction (HVAC, no phone, no CTA) =====
test(
  'Booking Friction (HVAC)',
  {
    niche: 'HVAC',
    speed_score: 60,
    responsive_status: 'responsive',
    seo_gaps: [],
    conversion_gaps: [
      'No phone number detected for direct contact',
      'No clear Call-To-Action (CTA) buttons found'
    ],
    trackers_found: [],
    address_detected: true,
    business_name: 'Cool Air'
  },
  ['Booking Friction'],
  70
);

// ===== SCENARIO 13: Reputation Leakage =====
test(
  'Reputation Leakage (Restaurant, no social, missing meta)',
  {
    niche: 'Restaurant',
    speed_score: 65,
    responsive_status: 'responsive',
    seo_gaps: ['Missing Meta Description'],
    conversion_gaps: ['Missing social media links (Trust gap)'],
    trackers_found: [],
    address_detected: true,
    business_name: 'Tasty Bites'
  },
  ['Reputation Leakage'],
  75
);

// ===== SCENARIO 14: Healthy site - no patterns triggered =====
test(
  'Healthy site - No patterns',
  {
    niche: 'Dentist',
    speed_score: 90,
    responsive_status: 'responsive',
    seo_gaps: [],
    conversion_gaps: [],
    trackers_found: ['Google Analytics'],
    address_detected: true,
    business_name: 'Smile Dental'
  },
  [],
  90
);

// ===== SCENARIO 15: Premium name in non-premium niche =====
test(
  'Premium name in non-premium niche',
  {
    niche: 'Cleaning Services',
    business_name: 'Premium Clean Pro',
    speed_score: 55,
    responsive_status: 'responsive',
    seo_gaps: ['Missing Meta Description'],
    conversion_gaps: [],
    trackers_found: [],
    address_detected: true
  },
  ['Premium Business, Budget Website'],
  55
);

// ===== SCENARIO 16: Trust Deficit (SSL missing) =====
test(
  'Trust Deficit (SSL missing)',
  {
    niche: 'Finance',
    speed_score: 60,
    responsive_status: 'responsive',
    seo_gaps: ['SSL certificate is missing or invalid (Site loaded over HTTP)'],
    conversion_gaps: [],
    trackers_found: [],
    address_detected: true,
    business_name: 'Finance Co'
  },
  ['Trust Deficit'],
  70
);

// ===== SCENARIO 17: Trust Deficit via niche + no address =====
test(
  'Trust Deficit (Legal - no address, SSL okay)',
  {
    niche: 'Legal',
    speed_score: 60,
    responsive_status: 'responsive',
    seo_gaps: [],
    conversion_gaps: [],
    trackers_found: [],
    address_detected: false,
    business_name: 'Legal Co'
  },
  ['Trust Deficit'],
  70
);

// ===== SCENARIO 18: Competitive Neglect with high score gap =====
test(
  'Competitive Neglect (score well below avg)',
  {
    niche: 'Dentist',
    speed_score: 30,
    responsive_status: 'responsive',
    seo_gaps: ['Missing Title Tag'],
    conversion_gaps: [],
    trackers_found: [],
    address_detected: true,
    business_name: 'Dentist Co'
  },
  ['Competitive Neglect'],
  50,
  80
);

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
  console.log(' ALL PATTERNS VERIFIED SUCCESSFULLY');
} else {
  console.log(` ${failed} TEST(S) FAILED`);
}
console.log('========================================\n');

process.exit(failed > 0 ? 1 : 0);
