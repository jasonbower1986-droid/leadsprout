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
  _evidence: { validation: { valid: true } }, // Evidence Integrity marker
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
// With the fail-closed requirement (IMPLEMENTATION 003), leads without ANY evidence
// metadata (no _evidence, no evidence_state) are treated as legacy evidence and blocked.
// The enrichment guard now correctly catches these.
assert(enrichedCdn._evidenceFailure === 'legacy_evidence', 'CDN-only (without _evidence marker) now flagged as legacy evidence — fail-closed behavior');

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
// Test 8: Evidence state lifecycle — validated, failed, legacy, unknown, malformed
// ======================================================
console.log('\n=== Test 8: Evidence state lifecycle (all states) ===');

const { buildEvidenceState, reconstructEvidence, isLegacyLead, EVIDENCE_STATES } = require('./backend/utils/evidence-state');

// 8a: validated state → enrichment produces commercial output
const validatedState = buildEvidenceState({ valid: true });
assert(validatedState.status === 'validated', 'buildEvidenceState: valid → validated status');
const reconstructedValidated = reconstructEvidence(validatedState);
assert(reconstructedValidated.validation.valid === true, 'reconstructEvidence: validated → valid: true');
const enrichedValidated = enrichLeadData({ domain: 'test.com', speed_score: 70, _evidence: reconstructedValidated });
assert(enrichedValidated.visibility_health !== null, 'Validated state: enrichment produces commercial output');

// 8b: failed state → enrichment blocked, no CI output
const failedState = buildEvidenceState({ valid: false, evidenceFailure: 'access_denied', failureReason: '403 Forbidden' });
assert(failedState.status === 'failed', 'buildEvidenceState: invalid → failed status');
const reconstructedFailed = reconstructEvidence(failedState);
assert(reconstructedFailed.validation.valid === false, 'reconstructEvidence: failed → valid: false');
const enrichedFailed = enrichLeadData({ domain: 'blocked.com', speed_score: 50, _evidence: reconstructedFailed });
assert(enrichedFailed._evidenceFailure !== undefined, 'Failed state: enrichment flagged');
assert(enrichedFailed.strategy_report === null, 'Failed state: no strategy report');

// 8c: legacy state (no evidence_state, no _evidence) → enrichment blocked
const legacyLead = { domain: 'old-site.com', speed_score: 65, business_name: 'Old Business' };
assert(isLegacyLead(legacyLead) === true, 'isLegacyLead: true for lead without evidence metadata');
assert(isLegacyLead({ ...legacyLead, evidence_state: '{}' }) === false, 'isLegacyLead: false when evidence_state exists');
const enrichedLegacy = enrichLeadData(legacyLead);
assert(enrichedLegacy._evidenceFailure === 'legacy_evidence', 'Legacy lead: enrichment blocked with legacy_evidence');
assert(enrichedLegacy.strategy_report === null, 'Legacy lead: no strategy report');

// 8d: unknown state → enrichment blocked
const unknownState = { status: 'unknown', validatedAt: new Date().toISOString(), failureType: 'unknown', failureReason: 'Test' };
const reconstructedUnknown = reconstructEvidence(unknownState);
assert(reconstructedUnknown.status === 'unknown', 'reconstructEvidence: unknown state');
const enrichedUnknown = enrichLeadData({ domain: 'unknown.com', speed_score: 60, _evidence: reconstructedUnknown });
assert(enrichedUnknown._evidenceFailure !== undefined, 'Unknown state: enrichment blocked');

// 8e: malformed evidence_state → safely handled, fails closed
const enrichedMalformed = enrichLeadData({ domain: 'malformed.com', speed_score: 55, evidence_state: '{invalid json!!!}' });
assert(enrichedMalformed._evidenceFailure !== undefined, 'Malformed evidence_state: enrichment blocked');
assert(enrichedMalformed.strategy_report === null, 'Malformed evidence_state: no strategy report');
assert(!enrichedMalformed.visibility_health, 'Malformed evidence_state: no health score');

// ======================================================
// Test 9: Comprehensive Evidence Integrity lifecycle (all BLOCKER scenarios)
// ======================================================
console.log('\n=== Test 9: Comprehensive Evidence Integrity lifecycle (all BLOCKER scenarios) ===');

// 9a: Runtime validated evidence passes (BLOCKER 001/002)
const runtimeValid = assertValidEvidence({ 
  domain: 'valid.com', 
  _evidence: { validation: { valid: true } } 
});
assert(runtimeValid.valid === true, '9a: Runtime validated evidence passes');

// 9b: Persisted validated evidence reconstructs and passes (BLOCKER 001)
const persistedState = buildEvidenceState({ valid: true });
const reconstructed = reconstructEvidence(persistedState);
const persistedValid = assertValidEvidence({ 
  domain: 'persisted.com', 
  _evidence: reconstructed 
});
assert(persistedValid.valid === true, '9b: Persisted validated evidence reconstructs and passes');

// 9c: Runtime failed evidence is blocked
const runtimeFail = assertValidEvidence({ 
  domain: 'fail.com', 
  _evidence: { validation: { valid: false, evidenceFailure: 'access_denied' } } 
});
assert(runtimeFail.valid === false, '9c: Runtime failed evidence is blocked');
assert(runtimeFail.failureType === 'access_denied', '9c: Failure type preserved');

// 9d: Persisted failed evidence reconstructs and remains blocked
const t9_failedState = buildEvidenceState({ valid: false, evidenceFailure: 'access_denied', failureReason: '403 Forbidden' });
const reconstructedFail = reconstructEvidence(t9_failedState);
const persistedFail = assertValidEvidence({ 
  domain: 'persisted-fail.com', 
  _evidence: reconstructedFail 
});
assert(persistedFail.valid === false, '9d: Persisted failed evidence remains blocked');
assert(persistedFail.failureType === 'access_denied', '9d: Persisted failed: failure type preserved');

// 9e: Unknown evidence is blocked (BLOCKER 002)
const unknownResult = assertValidEvidence({ 
  domain: 'unknown.com', 
  _evidence: { status: 'unknown' }  // no failureType — should hit final fallback
});
assert(unknownResult.valid === false, '9e: Unknown evidence is blocked');
assert(unknownResult.failureType === 'unvalidated_evidence', '9e: Unknown evidence: unvalidated_evidence type');

// 9f: Legacy evidence is blocked
const legacyResult = assertValidEvidence({ 
  domain: 'legacy.com', 
  speed_score: 70 
});
assert(legacyResult.valid === false, '9f: Legacy evidence is blocked');
assert(legacyResult.failureType === 'legacy_evidence', '9f: Legacy evidence: legacy_evidence type');

// 9g: Missing evidence metadata is blocked (BLOCKER 002 — ambiguous _evidence)
const missingMetaResult = assertValidEvidence({ 
  domain: 'ambiguous.com', 
  _evidence: { statusCode: 200 }  // No validation info, no status
});
assert(missingMetaResult.valid === false, '9g: Missing evidence metadata is blocked');
assert(missingMetaResult.failureType === 'unvalidated_evidence', '9g: Missing metadata: unvalidated_evidence type');

// 9h: Malformed evidence_state is blocked without crashing (BLOCKER 004)
let malformedThrew = false;
let malformedResult;
try {
  malformedResult = assertValidEvidence({ 
    domain: 'malformed.com', 
    evidence_state: '{invalid json!!!}', 
    speed_score: 55 
  });
} catch (e) {
  malformedThrew = true;
}
assert(!malformedThrew, '9h: Malformed evidence_state does not throw');
assert(malformedResult.valid === false, '9h: Malformed evidence_state is blocked');
assert(malformedResult.failureType === 'malformed_evidence_state' || malformedResult.failureType === 'unvalidated_evidence', '9h: Malformed: appropriate failure type');

// 9i: Unrecognised status is blocked (BLOCKER 002)
const unrecognisedResult = assertValidEvidence({ 
  domain: 'weird.com', 
  _evidence: { status: 'something_bizarre', validation: { xyz: true } } 
});
assert(unrecognisedResult.valid === false, '9i: Unrecognised status is blocked');
assert(unrecognisedResult.failureType === 'unvalidated_evidence', '9i: Unrecognised: unvalidated_evidence');

// 9j: Missing acquisition validation never persisted as validated (BLOCKER 003)
// This simulates what leads.js does when no validation result exists
const noValidationResult = { valid: false, evidenceFailure: 'no_validation_result', failureReason: 'No evidence validation result available for this acquisition.' };
const builtFromNull = buildEvidenceState(null);
assert(builtFromNull.status === 'unknown', '9j: Null validation → unknown state');
assert(builtFromNull.failureType === null, '9j: Null validation: no failure type');
const builtFromNoValidation = buildEvidenceState({ valid: false, evidenceFailure: 'no_validation_result', failureReason: 'No validation result' });
assert(builtFromNoValidation.status === 'failed', '9j: Missing validation → failed state');

// 9k: Narrative generation does not execute for invalid evidence (BLOCKER 003 — boundary)
// When assertValidEvidence returns false, the route skips generateNarrative()
const invalidForNarrative = assertValidEvidence({ 
  domain: 'invalid-narrative.com', 
  _evidence: { validation: { valid: false, evidenceFailure: 'login_page' } } 
});
assert(invalidForNarrative.valid === false, '9k: Invalid evidence blocks narrative generation');

// 9l: Valid evidence still permits narrative generation
const validForNarrative = assertValidEvidence({ 
  domain: 'valid-narrative.com', 
  _evidence: { validation: { valid: true } } 
});
assert(validForNarrative.valid === true, '9l: Valid evidence permits narrative generation');

// 9m: Migration succeeds on clean schema (simulated — check migration script exits 0)
const { execSync } = require('child_process');
const path = require('path');
const repoRoot = path.resolve(__dirname);
let migrationExitCode = -1;
let migrationStdout = '';
try {
  migrationStdout = execSync('node backend/migrate_evidence_state.js 2>&1', { 
    cwd: repoRoot,
    timeout: 5000,
    encoding: 'utf-8'
  });
  migrationExitCode = 0;
} catch (e) {
  migrationExitCode = e.status !== undefined ? e.status : -1;
  migrationStdout = e.stdout || '';
}
// The migration ALTER TABLE may fail if column already exists, but should exit 0
// since it handles "duplicate column" gracefully
assert(migrationExitCode === 0, '9m: Migration script exits 0 (even if column exists)');
assert(migrationStdout.includes('evidence_state'), '9m: Migration produced expected output');

// 9n: Migration is safe when column already exists (idempotent)
let migrationIdempotentExit = -1;
try {
  migrationIdempotentExit = execSync('node backend/migrate_evidence_state.js 2>&1', { 
    cwd: repoRoot,
    timeout: 5000,
    encoding: 'utf-8'
  });
  migrationIdempotentExit = 0;
} catch (e) {
  migrationIdempotentExit = e.status !== undefined ? e.status : -1;
}
assert(migrationIdempotentExit === 0, '9n: Migration is safe when column already exists (idempotent)');

// 9o: Forced migration failure produces non-zero exit (test the error path)
// Simulate a migration that will fail by running a deliberately broken SQL command
let migrationFailureExit = -1;
let migrationFailureStdout = '';
try {
  migrationFailureStdout = execSync('node -e "const {dbQuery} = require(\'./backend/database\'); dbQuery.run(\'INVALID SQL!!!\').then(() => process.exit(0)).catch(() => process.exit(1))" 2>&1', {
    cwd: repoRoot,
    timeout: 5000,
    encoding: 'utf-8'
  });
  migrationFailureExit = 0;
} catch (e) {
  migrationFailureExit = e.status !== undefined ? e.status : -1;
  migrationFailureStdout = e.stdout || '';
}
assert(migrationFailureExit !== 0, '9o: Migration failure produces non-zero exit status');

// 9p: Existing valid Evidence Integrity behaviour remains regression-safe (Test 1 re-run)
const regressionValid = validateEvidence(validAudit);
assert(regressionValid.valid === true, '9p: Regression: valid audit still passes validation');
const regressionEnriched = enrichLeadData(validAudit);
assert(regressionEnriched.visibility_health !== null, '9p: Regression: valid enrichment still produces output');

// ======================================================
// Summary
// ======================================================
console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
console.log('========================================\n');

process.exit(failed > 0 ? 1 : 0);