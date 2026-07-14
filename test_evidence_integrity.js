/**
 * Evidence Integrity Pipeline — Verification Test Suite
 *
 * Tests all required verification scenarios:
 * 1. Valid business website → commercial report generated
 * 2. 403 Access Denied → explicit evidence failure; no Commercial Intelligence
 * 3. 404 page → explicit evidence failure
 * 4. Login page → explicit evidence failure
 * 5. CDN/bot protection page → explicit evidence failure
 * 6. Complete retrieval failure → no Commercial Intelligence; no synthetic commercial report
 * 7. Existing lead refresh with failed retrieval → previously valid data preserved
 */

const { validateEvidence, isSyntheticAudit, isExplicitAccessDenied, 
        isCdnBotProtection, scanHtmlPatterns, shouldPreservePreviousData,
        BLOCKED_PAGE_PATTERNS } = require('./backend/utils/evidence-validator');
const { enrichLeadData, assertValidEvidence } = require('./backend/utils/enrichment');
const { analyzeWebsite, normalizeUrl } = require('./backend/scraper');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL: ${message}`);
  }
}

// ======================================================
// Test 1: Valid business website → commercial report generated
// ======================================================
console.log('\n=== Test 1: Valid business website generates commercial report ===');

// Simulate a valid audit result (as if from a real successful scrape)
const validAudit = {
  domain: 'example.com',
  business_name: 'Example Business',
  speed_score: 72,
  responsive_status: 'responsive',
  seo_gaps: ['Missing Title Tag', 'Missing Meta Description'],
  conversion_gaps: ['No clear Call-To-Action (CTA) buttons found'],
  verified_emails: ['info@example.com'],
  trackers_found: ['Google Analytics'],
  address_detected: true,
  details: {
    title: 'Example Business',
    description: 'A description',
    h1_count: 1,
    total_images: 5,
    missing_alt_count: 1,
    ssl_present: true,
    load_time_ms: 350,
    status_code: 200,
    redirected: false,
    final_url: 'https://example.com'
  }
};

// Validate it
const validResult = validateEvidence(validAudit);
assert(validResult.valid === true, 'Valid audit should pass evidence validation');
assert(validResult.evidenceFailure === null, 'No evidence failure for valid audit');

// Enrich it — should produce commercial output
const enriched = enrichLeadData(validAudit, null, 'web_agency', 'Test');
assert(enriched.visibility_health !== null, 'Commercial report should have visibility_health');
assert(enriched.strategy_report !== null, 'Commercial report should have strategy_report');
assert(enriched.revenue_leak !== null, 'Commercial report should have revenue_leak');
assert(!enriched._evidenceFailure, 'No evidence failure flag on valid enrichment');

// ======================================================
// Test 2: 403 Access Denied → explicit evidence failure
// ======================================================
console.log('\n=== Test 2: 403 Access Denied → no Commercial Intelligence ===');

const accessDeniedHtml = '<html><body><h1>403 Forbidden</h1><p>Access Denied</p></body></html>';
const deniedAudit = {
  domain: 'blocked-site.com',
  details: { status_code: 403, ssl_present: true, load_time_ms: 200, redirected: false, final_url: 'https://blocked-site.com' }
};
const deniedResult = validateEvidence(deniedAudit, accessDeniedHtml);
assert(deniedResult.valid === false, '403 should fail evidence validation');
assert(deniedResult.evidenceFailure === 'access_denied', 'Evidence failure should be access_denied');

const isDenied = isExplicitAccessDenied(403, accessDeniedHtml);
assert(isDenied === true, 'isExplicitAccessDenied should detect 403');

// Enrichment should skip CI
const enrichedDenied = enrichLeadData(deniedAudit);
assert(enrichedDenied._evidenceFailure !== undefined, 'Enrichment should flag evidence failure');
assert(enrichedDenied.strategy_report === null, 'No strategy report for invalid evidence');
assert(enrichedDenied.revenue_leak === null, 'No revenue leak for invalid evidence');

// ======================================================
// Test 3: 404 page → explicit evidence failure
// ======================================================
console.log('\n=== Test 3: 404 page → explicit evidence failure ===');

const notFoundHtml = '<html><body><h1>404 Not Found</h1><p>Page not found</p></body></html>';
const notFoundAudit = {
  domain: 'missing-page.com',
  details: { status_code: 404, ssl_present: true, load_time_ms: 150, redirected: false, final_url: 'https://missing-page.com' }
};
const notFoundResult = validateEvidence(notFoundAudit, notFoundHtml);
assert(notFoundResult.valid === false, '404 should fail evidence validation');
assert(notFoundResult.evidenceFailure === 'access_denied', 'Evidence failure for 404');

const enrichedNotFound = enrichLeadData(notFoundAudit);
assert(enrichedNotFound._evidenceFailure !== undefined, 'Enrichment should have evidence failure flag');

// ======================================================
// Test 4: Login page → explicit evidence failure (regardless of content length)
// ======================================================
console.log('\n=== Test 4: Login page → explicit evidence failure ===');

// Realistic login page with substantial content (>20 meaningful words)
const loginHtml = '<!DOCTYPE html><html><body><header><h1>Client Portal</h1></header><main><form action="/login" method="POST"><div><label for="username">Username or Email Address</label><input type="text" id="username" name="username" placeholder="Enter your username"/></div><div><label for="password">Password</label><input type="password" id="password" name="password" placeholder="Enter your password"/></div><div><button type="submit">Sign In to Your Account</button></div><div><a href="/forgot-password">Forgot your password?</a></div></form><p>Welcome to our secure client portal. Please sign in to access your dashboard, manage your account settings, view billing history, and submit support tickets. If you don\'t have an account yet, please contact your account manager.</p></main></body></html>';
const loginAudit = {
  domain: 'login-portal.com',
  details: { status_code: 200, ssl_present: true, load_time_ms: 300, redirected: false, final_url: 'https://login-portal.com' }
};
const loginResult = validateEvidence(loginAudit, loginHtml);
assert(loginResult.valid === false, 'Login page (long content) should fail evidence validation');
assert(loginResult.evidenceFailure === 'login_page', 'Evidence failure should be login_page');

// Enrichment must not produce Commercial Intelligence output for login pages
// Simulate what the route does: attach _evidence.validation marker from validateEvidence
const enrichedLogin = enrichLeadData({
  ...loginAudit,
  _evidence: { validation: { valid: false, evidenceFailure: 'login_page', failureReason: 'Login/authentication page detected' } }
});
assert(enrichedLogin._evidenceFailure !== undefined, 'Login: enrichment should flag evidence failure');
assert(enrichedLogin.strategy_report === null, 'Login: no strategy report');
assert(enrichedLogin.revenue_leak === null, 'Login: no revenue leak');
assert(enrichedLogin.discovery_tags.length === 0, 'Login: no discovery tags');
assert(enrichedLogin.visibility_health === null, 'Login: no health score');

// ======================================================
// Test 4b: Checkout/Payment routing page → explicit evidence failure
// ======================================================
console.log('\n=== Test 4b: Checkout/Payment page → explicit evidence failure ===');

const checkoutHtml = '<!DOCTYPE html><html><body><header><h1>Secure Checkout</h1></header><main><form action="/checkout/process" method="POST"><h2>Review Your Order</h2><p>Items in your cart will be shipped to your billing address.</p><div><label>Card Number</label><input type="text" name="card_number" placeholder="1234 5678 9012 3456"/></div><div><label>Expiry Date</label><input type="text" name="expiry" placeholder="MM/YY"/></div><div><label>CVV</label><input type="text" name="cvv" placeholder="123"/></div><button type="submit">Pay Now - Place Your Order</button></form><p>Your order includes 3 items with a total of $149.97. Free shipping applies to orders over $50. Estimated delivery is 3-5 business days. You will receive a confirmation email once your payment is processed successfully.</p></main></body></html>';
const checkoutAudit = {
  domain: 'shop-online.com/checkout',
  details: { status_code: 200, ssl_present: true, load_time_ms: 400, redirected: false, final_url: 'https://shop-online.com/checkout' }
};
const checkoutResult = validateEvidence(checkoutAudit, checkoutHtml);
assert(checkoutResult.valid === false, 'Checkout page should fail evidence validation');
assert(checkoutResult.evidenceFailure === 'checkout_page', 'Evidence failure should be checkout_page');

// Enrichment must not produce Commercial Intelligence output for checkout pages
// Simulate what the route does: attach _evidence.validation marker from validateEvidence
const enrichedCheckout = enrichLeadData({
  ...checkoutAudit,
  _evidence: { validation: { valid: false, evidenceFailure: 'checkout_page', failureReason: 'Checkout/payment routing page detected' } }
});
assert(enrichedCheckout._evidenceFailure !== undefined, 'Checkout: enrichment should flag evidence failure');
assert(enrichedCheckout.strategy_report === null, 'Checkout: no strategy report');
assert(enrichedCheckout.revenue_leak === null, 'Checkout: no revenue leak');
assert(enrichedCheckout.discovery_tags.length === 0, 'Checkout: no discovery tags');
assert(enrichedCheckout.visibility_health === null, 'Checkout: no health score');

// ======================================================
// Test 5: CDN/bot protection page → explicit evidence failure
// ======================================================
console.log('\n=== Test 5: CDN/bot protection page → explicit evidence failure ===');

const cdnHtml = '<html><body><h1>Checking your browser before accessing</h1><p>Cloudflare</p><script>var cf = true;</script></body></html>';
const cdnAudit = {
  domain: 'protected-site.com',
  details: { status_code: 200, ssl_present: true, load_time_ms: 500, redirected: false, final_url: 'https://protected-site.com' }
};

const cdnResult = validateEvidence(cdnAudit, cdnHtml);
assert(cdnResult.valid === false, 'CDN protection page should fail evidence validation');
assert(cdnResult.evidenceFailure === 'cdn_bot_protection', 'Evidence failure should be cdn_bot_protection');

const isCdn = isCdnBotProtection(cdnHtml, 200);
assert(isCdn === true, 'isCdnBotProtection should detect Cloudflare challenge');

// No enrichment for CDN protected
const enrichedCdn = enrichLeadData(cdnAudit);
// CDN detection happens at the route level via validateEvidence (HTML content analysis),
// not in the lighter enrichment guard. The enrichment guard (assertValidEvidence) is a
// secondary check for obvious markers. Route-level validation catches CDN before enrichment.
// This test confirms that without route-level validation, CDN-only leads pass the enrichment guard.
assert(enrichedCdn._evidenceFailure === undefined, 'CDN-only (without _evidence marker) passes enrichment guard — route-level validation handles CDN');

// ======================================================
// Test 5b: CDN classifier — true-positive preservation (Cloudflare JS challenge tokens)
// ======================================================
console.log('\n=== Test 5b: CDN classifier — true-positive: Cloudflare JS challenge page ===');

// A real Cloudflare JS challenge page includes challenge-specific JS tokens.
const cfJsChallengeHtml = '<html><head><title>Just a moment...</title></head><body>' +
  '<script>var cf_chl_opt={"cType":1,"nonce":"abc123"};</script>' +
  '<noscript>Please enable JavaScript to continue.</noscript>' +
  '</body></html>';
assert(isCdnBotProtection(cfJsChallengeHtml, 200) === true,
  'True positive: Cloudflare JS challenge page (cf_chl_opt token) classifies as cdn_bot_protection');

const cfRequestIdHtml = '<html><body><meta name="cf-request-id" content="xyz"/>' +
  '<h1>Checking your browser</h1></body></html>';
assert(isCdnBotProtection(cfRequestIdHtml, 200) === true,
  'True positive: cf-request-id meta tag classifies as cdn_bot_protection');

// ======================================================
// Test 5c: CDN classifier — false-positive prevention (incidental Cloudflare mention)
// ======================================================
console.log('\n=== Test 5c: CDN classifier — false-positive: legitimate page with Cloudflare footer mention ===');

// Legitimate public business homepage that merely names Cloudflare as a CDN/security vendor.
// Such pages must NOT be classified as cdn_bot_protection.
const legitimateHomepageHtml = '<!DOCTYPE html><html><head><title>Acme Corp — Industrial Supplies</title>' +
  '<meta name="description" content="Acme Corp manufactures and supplies industrial equipment worldwide."/>' +
  '</head><body>' +
  '<header><nav><a href="/">Home</a><a href="/products">Products</a><a href="/about">About</a>' +
  '<a href="/contact">Contact</a></nav></header>' +
  '<main>' +
  '<h1>Welcome to Acme Corp</h1>' +
  '<p>We have been a trusted partner for industrial businesses since 1985. Our product catalogue ' +
  'includes over 10,000 items shipped to 60 countries. Contact our sales team for bulk pricing.</p>' +
  '<section><h2>Our Products</h2>' +
  '<p>Valves, pipes, fittings, and custom fabrication services for the energy and manufacturing sectors.</p>' +
  '</section>' +
  '</main>' +
  '<footer>' +
  '<p>© 2024 Acme Corp. All rights reserved.</p>' +
  '<p>This site is protected by Cloudflare. <a href="/privacy">Privacy Policy</a></p>' +
  '</footer>' +
  '</body></html>';

assert(isCdnBotProtection(legitimateHomepageHtml, 200) === false,
  'False-positive prevention: legitimate business homepage with incidental Cloudflare footer mention does NOT classify as cdn_bot_protection');

const fpResult = validateEvidence(
  { domain: 'acme-corp.com', details: { status_code: 200, ssl_present: true, load_time_ms: 280, redirected: false, final_url: 'https://acme-corp.com' } },
  legitimateHomepageHtml
);
assert(fpResult.valid === true,
  'False-positive prevention: legitimate homepage with Cloudflare mention passes evidence validation');
assert(fpResult.evidenceFailure === null,
  'False-positive prevention: no evidenceFailure for legitimate homepage with Cloudflare mention');

// ======================================================
// Test 5d: Public SaaS homepage PASS (incidental sign-in navigation)
// ======================================================
console.log('\n=== Test 5d: Public SaaS homepage PASS ===');

const saasHomepageHtml = '<!DOCTYPE html><html><head><title>Nimbus CRM | Grow Your Pipeline</title></head><body>' +
  '<header><nav><a href="/">Home</a><a href="/pricing">Pricing</a><a href="/login">Sign In</a></nav></header>' +
  '<main><h1>Close more deals with Nimbus CRM</h1><p>Track leads, automate follow-ups, and forecast revenue with one collaborative platform.</p>' +
  '<section><h2>Trusted by growth teams</h2><p>Book a demo to see account automation, pipeline stages, and reporting dashboards.</p></section></main>' +
  '<footer><a href="/terms">Terms</a></footer></body></html>';

const saasResult = validateEvidence(
  { domain: 'nimbuscrm.com', details: { status_code: 200, ssl_present: true, load_time_ms: 240, redirected: false, final_url: 'https://nimbuscrm.com' } },
  saasHomepageHtml
);
assert(saasResult.valid === true, 'Public SaaS homepage with incidental Sign In nav should pass');
assert(saasResult.evidenceFailure === null, 'Public SaaS homepage should not be labeled login_page');

// ======================================================
// Test 5e: Ecommerce homepage PASS (incidental cart/checkout navigation)
// ======================================================
console.log('\n=== Test 5e: Ecommerce homepage PASS ===');

const ecommerceHomepageHtml = '<!DOCTYPE html><html><head><title>Northline Outfitters</title></head><body>' +
  '<header><nav><a href="/">Home</a><a href="/collections/all">Shop</a><a href="/cart">Cart</a><a href="/checkout">Checkout</a></nav></header>' +
  '<main><h1>Adventure Gear Built for the Trail</h1><p>Shop boots, packs, and weatherproof outerwear engineered for demanding expeditions.</p>' +
  '<section><h2>Featured Collections</h2><p>Explore technical apparel, climbing accessories, and ultralight essentials.</p></section></main>' +
  '<footer><p>Free shipping on orders over $75.</p></footer></body></html>';

const ecommerceResult = validateEvidence(
  { domain: 'northline-outfitters.com', details: { status_code: 200, ssl_present: true, load_time_ms: 260, redirected: false, final_url: 'https://northline-outfitters.com' } },
  ecommerceHomepageHtml
);
assert(ecommerceResult.valid === true, 'Ecommerce homepage with nav cart/checkout should pass');
assert(ecommerceResult.evidenceFailure === null, 'Ecommerce homepage should not be labeled checkout_page');

// ======================================================
// Test 5f: Local business homepage PASS
// ======================================================
console.log('\n=== Test 5f: Local business homepage PASS ===');

const localBusinessHomepageHtml = '<!DOCTYPE html><html><head><title>Riverstone Plumbing | Austin TX</title></head><body>' +
  '<header><nav><a href="/">Home</a><a href="/services">Services</a><a href="/contact">Contact</a></nav></header>' +
  '<main><h1>Trusted Residential Plumbing in Austin</h1><p>Riverstone Plumbing provides leak repair, drain cleaning, and water-heater installation.</p>' +
  '<p>Call our licensed team for same-day service and transparent pricing.</p></main>' +
  '<footer><p>123 Barton Springs Rd, Austin, TX</p><p>(512) 555-0100</p></footer></body></html>';

const localBusinessResult = validateEvidence(
  { domain: 'riverstoneplumbing.com', details: { status_code: 200, ssl_present: true, load_time_ms: 210, redirected: false, final_url: 'https://riverstoneplumbing.com' } },
  localBusinessHomepageHtml
);
assert(localBusinessResult.valid === true, 'Local business homepage should pass');
assert(localBusinessResult.evidenceFailure === null, 'Local business homepage should not be misclassified');

// ======================================================
// Test 6: Complete retrieval failure → no Commercial Intelligence
// ======================================================
console.log('\n=== Test 6: Complete retrieval failure → no synthetic report ===');

const retrievalFailEvidence = {
  domain: 'unreachable-site.com',
  _evidence: {
    retrievalFailure: true,
    failureReason: 'Could not reach website: connect ECONNREFUSED',
    statusCode: 0,
    domain: 'unreachable-site.com',
    validationChecks: ['retrieval_failure']
  }
};

// Check that enrichment skips CI
const enrichedFail = enrichLeadData(retrievalFailEvidence);
assert(enrichedFail._evidenceFailure === 'retrieval_failure', 'Retrieval failure flagged in enrichment');
assert(enrichedFail.strategy_report === null, 'No strategy report for retrieval failure');
assert(enrichedFail.revenue_leak === null, 'No revenue leak for retrieval failure');
assert(enrichedFail.discovery_tags.length === 0, 'No discovery tags for retrieval failure');
assert(enrichedFail.visibility_health === null, 'No health score for retrieval failure');

// Also test the evidence validation path
const retrievalResult = validateEvidence(retrievalFailEvidence);
assert(retrievalResult.valid === false, 'Retrieval failure should not validate');

// ======================================================
// Test 7: Existing lead refresh with failed retrieval → preserve data
// ======================================================
console.log('\n=== Test 7: Existing lead refresh → preserve previous data ===');

const existingLead = {
  id: 'lead-123',
  domain: 'existing-business.com',
  business_name: 'Existing Business',
  speed_score: 65,
  responsive_status: 'responsive',
  seo_gaps: JSON.stringify(['Missing Title Tag']),
  conversion_gaps: JSON.stringify([]),
  verified_emails: JSON.stringify(['contact@existing-business.com']),
  details: { title: 'Existing Business', ssl_present: true },
  visibility_health: 75,
  strategy_report: { some: 'data' },
  revenue_leak: { some: 'leak' }
};

// Should preserve if we have existing data
const shouldPreserve = shouldPreservePreviousData(retrievalFailEvidence._evidence, existingLead);
assert(shouldPreserve === true, 'shouldPreservePreviousData should return true for existing lead');

// Should NOT preserve if no existing lead
const shouldNotPreserve = shouldPreservePreviousData(retrievalFailEvidence._evidence, null);
assert(shouldNotPreserve === false, 'shouldPreservePreviousData should return false for no existing lead');

// Test that the mock audit detection works (legacy synthetic data)
const syntheticAudit = {
  domain: 'fake-domain.com',
  business_name: 'Fake Services',
  speed_score: 65,
  details: {
    title: null,
    description: null,
    h1_count: 0,
    total_images: 12,
    missing_alt_count: 3,
    ssl_present: true,
    load_time_ms: 450,
    status_code: 200,
    redirected: false,
    final_url: 'https://fake-domain.com',
    fallback_active: true,
    fallback_reason: 'Could not reach website: test'
  }
};

const isSynthetic = isSyntheticAudit(syntheticAudit);
assert(isSynthetic === true, 'isSyntheticAudit should detect mock audit data');
const synResult = validateEvidence(syntheticAudit);
assert(synResult.valid === false, 'Synthetic audit should fail evidence validation');
assert(synResult.evidenceFailure === 'synthetic_audit_data', 'Evidence failure should be synthetic_audit_data');

// ======================================================
// Summary
// ======================================================
console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
console.log('========================================\n');

process.exit(failed > 0 ? 1 : 0);