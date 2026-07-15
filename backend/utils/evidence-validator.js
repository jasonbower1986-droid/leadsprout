/**
 * Evidence Integrity Validator (v1.0)
 *
 * Pre-Commercial Intelligence validation boundary.
 * Ensures that only validated, real business website content reaches
 * the Commercial Intelligence / enrichment pipeline.
 *
 * Detection Scenarios:
 * - 403 Access Denied / CDN bot protection
 * - 404 Not Found
 * - Login / authentication pages
 * - Checkout / payment routing pages
 * - Parked domains
 * - CDN / bot protection gateways (Cloudflare, Akamai, etc.)
 * - Synthetic / mock audit data (generateMockAudit fallback)
 */

const cheerio = require('cheerio');

// Patterns indicative of non-business content in scraped HTML
const BLOCKED_PAGE_PATTERNS = [
  // Login/Auth pages
  { pattern: /sign[\s-]?in/i, weight: 0.7, label: 'login_page' },
  { pattern: /log[\s-]?in/i, weight: 0.7, label: 'login_page' },
  { pattern: /sign[\s-]?up/i, weight: 0.5, label: 'signup_page' },
  
  // CDN / Bot Protection
  { pattern: /checking your browser/i, weight: 0.9, label: 'cdn_bot_check' },
  { pattern: /attention required!?/i, weight: 0.8, label: 'cdn_bot_check' },
  { pattern: /cloudflare/i, weight: 0.4, label: 'cdn_detected' },
  { pattern: /just a moment/i, weight: 0.8, label: 'cdn_bot_check' },
  { pattern: /enable javascript/i, weight: 0.6, label: 'js_required' },
  { pattern: /browser check/i, weight: 0.7, label: 'cdn_bot_check' },
  { pattern: /access denied/i, weight: 0.9, label: 'access_denied' },
  { pattern: /permission denied/i, weight: 0.8, label: 'access_denied' },
  { pattern: /blocked/i, weight: 0.5, label: 'blocked' },
  
  // Checkout / Payment pages
  { pattern: /checkout/i, weight: 0.4, label: 'checkout_page' },
  { pattern: /cart/i, weight: 0.3, label: 'cart_page' },
  { pattern: /payment/i, weight: 0.3, label: 'payment_page' },
  
  // Parked domains / placeholder pages
  { pattern: /this domain is parked/i, weight: 0.9, label: 'parked_domain' },
  { pattern: /domain is for sale/i, weight: 0.9, label: 'parked_domain' },
  { pattern: /buy this domain/i, weight: 0.8, label: 'parked_domain' },
  { pattern: /coming soon/i, weight: 0.6, label: 'coming_soon' },
  { pattern: /under construction/i, weight: 0.6, label: 'under_construction' },
  { pattern: /website is under maintenance/i, weight: 0.5, label: 'under_maintenance' },
  
  // Placeholder frameworks
  { pattern: /welcome to nginx/i, weight: 0.7, label: 'default_server_page' },
  { pattern: /apache2 ubuntu default page/i, weight: 0.8, label: 'default_server_page' },
  { pattern: /iis windows/i, weight: 0.5, label: 'default_server_page' },
  { pattern: /caddy/i, weight: 0.4, label: 'default_server_page' },
  
  // Error pages (non-404 status but still invalid)
  { pattern: /internal server error/i, weight: 0.7, label: 'server_error' },
  { pattern: /service unavailable/i, weight: 0.7, label: 'server_error' },
  { pattern: /bad gateway/i, weight: 0.7, label: 'server_error' },
  { pattern: /gateway timeout/i, weight: 0.6, label: 'server_error' },
];

/**
 * Minimum HTML content length to be considered a real page.
 * Very short responses (e.g., just an error message) are suspicious.
 */
const MIN_MEANINGFUL_CONTENT_LENGTH = 200;

/**
 * Minimum number of unique content words to consider a page
 * as having real business content (not a splash/landing-only page).
 */
const MIN_CONTENT_WORDS = 20;

/**
 * Build a primary-purpose page view from HTML by prioritizing primary content
 * regions and excluding common secondary containers (nav/footer/header/boilerplate).
 */
function extractPrimaryPageContext(html) {
  if (!html) {
    return { title: '', h1: '', primaryHtml: '', primaryText: '' };
  }

  const $ = cheerio.load(html);
  const title = $('title').text().trim();
  const h1 = $('h1').first().text().trim();

  const primaryRoots = $('main, [role="main"], article').toArray();
  let primaryHtml = '';

  if (primaryRoots.length > 0) {
    primaryHtml = primaryRoots.map(node => $.html(node) || '').join('\n');
  } else {
    const bodyHtml = $('body').html() || html;
    const $bodyOnly = cheerio.load(bodyHtml);
    $bodyOnly('nav, footer, header, aside, script, style, noscript, template').remove();
    primaryHtml = $bodyOnly.root().html() || bodyHtml;
  }

  const primaryText = (primaryHtml || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { title, h1, primaryHtml, primaryText };
}

/**
 * Checks if the HTTP status code indicates a retrieval failure.
 */
function isRetrievalFailure(statusCode) {
  if (!statusCode) return true;
  // 2xx = success, 3xx = redirect (handled separately)
  if (statusCode >= 200 && statusCode < 400) return false;
  // 4xx client errors (except 401/403 which are explicit failures)
  // 5xx server errors
  return true;
}

/**
 * Checks if the status code indicates an explicit access-denied scenario.
 */
function isExplicitAccessDenied(statusCode, html, domain) {
  if (statusCode === 403) return true;
  if (statusCode === 401) return true;
  if (statusCode === 404) {
    // 404 alone is enough — page not found is a clear failure sign
    return true;
  }
  if (statusCode === 451) return true; // Legal block
  
  // Check HTML for access denied patterns even if status is 200
  // (CDNs often return 200 with a challenge page)
  if (html) {
    const accessDeniedPatterns = [
      /access denied/i,
      /permission denied/i,
      /403 forbidden/i,
      /404 not found/i,
      /the page you are looking for/i,
      /this page could not be found/i,
      /we could not find/i,
    ];
    for (const pat of accessDeniedPatterns) {
      if (pat.test(html)) return true;
    }
  }
  
  return false;
}

/**
 * Scans HTML content for patterns indicating non-business content.
 * Returns an array of matched pattern labels with confidence scores.
 */
function scanHtmlPatterns(html) {
  if (!html || html.length < MIN_MEANINGFUL_CONTENT_LENGTH) {
    // Very short responses may indicate error pages or redirect bodies
    return [{ label: 'insufficient_content', confidence: 0.8, detail: `Content too short (${html ? html.length : 0} chars)` }];
  }
  
  const matches = [];
  const matchedLabels = new Set();
  
  for (const entry of BLOCKED_PAGE_PATTERNS) {
    if (entry.pattern.test(html)) {
      const key = entry.label;
      if (!matchedLabels.has(key)) {
        matchedLabels.add(key);
        matches.push({ label: key, confidence: entry.weight, detail: `Matched: ${entry.pattern.toString().slice(1, 30)}...` });
      }
    }
  }
  
  return matches;
}

/**
 * Count meaningful content words in HTML (stripped tags).
 */
function countMeaningfulWords(html) {
  if (!html) return 0;
  const text = html.replace(/<[^>]*>/g, ' ') // strip tags
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = text.split(/\s+/).filter(w => w.length > 2 && !/^[0-9\W]+$/.test(w));
  return words.length;
}

/**
 * Check if the audit result contains synthetic/mock data from generateMockAudit.
 */
function isSyntheticAudit(auditResult) {
  if (!auditResult) return true;
  
  // Explicit fallback flag
  if (auditResult.details && auditResult.details.fallback_active === true) {
    return true;
  }
  
  // Check for synthetic indicators
  if (auditResult.details && auditResult.details.fallback_reason) {
    return true;
  }
  
  // If there's no real HTTP response data (no details.status_code or it's a synthetic one)
  if (auditResult.details) {
    // Mock audits often have a round load_time_ms and no real status
    const details = auditResult.details;
    // Real scrapes always have the redirected/ssl fields from actual HTTP interaction
    // Synthetic audits have suspiciously clean numbers
    if (details.total_images === 12 && details.missing_alt_count === 3 && details.h1_count === 0 && details.title === null && details.description === null) {
      return true; // Matches generateMockAudit structure
    }
  }
  
  return false;
}

/**
 * Check if HTML contains login/authentication page content.
 * Must produce explicit evidence failure regardless of content length.
 */
const LOGIN_PATTERNS = [
  /\b(sign[\s-]?in|log[\s-]?in)\b/i,
  /\b(username|password|remember me)\b/i,
  /\b(forgot.*password|reset.*password)\b/i,
  /<input[^>]*type=["']password["']/i,
  /<form[^>]*action=["'][^"']*(login|signin|auth)[^"']*["']/i,
];

function isLoginPage(html) {
  if (!html) return false;

  const { title, h1, primaryHtml, primaryText } = extractPrimaryPageContext(html);
  const authSurface = `${title} ${h1} ${primaryText}`;

  const hasPasswordInput = /<input[^>]*type=["']password["']/i.test(primaryHtml);
  const hasAuthFormAction = /<form[^>]*action=["'][^"']*(login|signin|auth|account)[^"']*["']/i.test(primaryHtml);
  const hasCredentialFields =
    /<input[^>]*(name|id)=["'][^"']*(user(name)?|email|login|password)[^"']*["']/i.test(primaryHtml) ||
    /\b(username|email address|password|remember me)\b/i.test(primaryText);
  const hasLoginSubmit =
    /<button[^>]*type=["']submit["'][^>]*>[\s\S]{0,100}(sign[\s-]?in|log[\s-]?in|continue)/i.test(primaryHtml) ||
    /<input[^>]*type=["']submit["'][^>]*value=["'][^"']*(sign[\s-]?in|log[\s-]?in|continue)[^"']*["']/i.test(primaryHtml);
  const explicitAuthHeading = /\b(sign[\s-]?in|log[\s-]?in|account login|customer login|member login)\b/i.test(authSurface);

  // Primary-purpose authentication gate:
  // Require structural authentication evidence, not incidental nav/footer vocabulary.
  if (hasPasswordInput && (hasAuthFormAction || hasCredentialFields || hasLoginSubmit || explicitAuthHeading)) {
    return true;
  }
  if (hasAuthFormAction && hasCredentialFields && (hasLoginSubmit || explicitAuthHeading)) {
    return true;
  }

  // Backstop for explicit full-page auth copy in primary content only.
  let primaryPatternCount = 0;
  for (const pat of LOGIN_PATTERNS) {
    if (pat.test(primaryHtml)) primaryPatternCount++;
  }
  return primaryPatternCount >= 3;
}

/**
 * Check if HTML contains checkout/payment routing page content.
 * Must produce explicit evidence failure regardless of content length.
 */
const CHECKOUT_PATTERNS = [
  /\b(checkout)\b/i,
  /\b(shopping cart|cart)\b/i,
  /\b(payment|pay now|place order|order now)\b/i,
  /\b(billing|shipping address)\b/i,
  /<input[^>]*name=["'](card_number|cc_number|credit_card|cvv|expiry)["']/i,
];

function isCheckoutOrPaymentPage(html) {
  if (!html) return false;

  const { title, h1, primaryHtml, primaryText } = extractPrimaryPageContext(html);
  const checkoutSurface = `${title} ${h1} ${primaryText}`;

  const hasForm = /<form\b/i.test(primaryHtml);
  const hasPaymentInputs = /<input[^>]*(name|id)=["'](card_number|cc_number|credit_card|cvv|expiry|exp|cardnumber|cvc)[^"']*["']/i.test(primaryHtml);
  const hasBillingShippingInputs = /<(input|select|textarea)[^>]*(name|id)=["'][^"']*(billing|shipping|address|postal|zip)[^"']*["']/i.test(primaryHtml);
  const hasCheckoutSubmit =
    /<button[^>]*>[\s\S]{0,120}(pay now|place order|complete purchase|proceed to payment|checkout now)\b/i.test(primaryHtml) ||
    /<input[^>]*type=["']submit["'][^>]*value=["'][^"']*(pay now|place order|complete purchase|checkout)[^"']*["']/i.test(primaryHtml);
  const primaryIntent = /\b(checkout|shopping cart|order summary|order total|billing|shipping address|payment)\b/i.test(checkoutSurface);

  // Primary-purpose checkout gate:
  // Require structural transaction evidence in primary content.
  if (hasPaymentInputs && (hasCheckoutSubmit || hasBillingShippingInputs || hasForm)) {
    return true;
  }
  if (hasForm && hasBillingShippingInputs && hasCheckoutSubmit && primaryIntent) {
    return true;
  }

  // Backstop for explicit checkout behavior in primary region.
  let primaryPatternCount = 0;
  for (const pat of CHECKOUT_PATTERNS) {
    if (pat.test(primaryHtml)) primaryPatternCount++;
  }
  return hasForm && primaryIntent && primaryPatternCount >= 3;
}

/**
 * Determine if the scraped page likely belongs to a CDN/bot protection service.
 */
function isCdnBotProtection(html, statusCode) {
  if (!html) return false;
  
  // Cloudflare challenge-specific indicators — these only appear on actual Cloudflare
  // challenge/interstitial pages, not on legitimate sites that merely use Cloudflare as a CDN.
  // NOTE: /cloudflare/i alone is intentionally excluded here; incidental mentions of the
  // Cloudflare vendor name on legitimate business pages must not trigger this classifier.
  const cloudflareChallengePats = [
    /checking your browser before accessing/i,
    /cf-request-id/i,
    /__cf_chl_f_tk/i,
    /cf_chl_opt/i,
    /attention.*required.*cloudflare/i,
  ];
  
  for (const pat of cloudflareChallengePats) {
    if (pat.test(html)) return true;
  }
  
  // Generic bot protection
  const botProtectionPatterns = [
    /browser integrity check/i,
    /security check/i,
    /ddos protection/i,
    /you have been blocked/i,
    /blocked by/i,
    /please enable cookies/i,
    /referer.*denied/i,
    /request.*blocked/i,
  ];
  
  let botMatchCount = 0;
  for (const pat of botProtectionPatterns) {
    if (pat.test(html)) {
      botMatchCount++;
    }
  }
  
  return botMatchCount >= 2;
}

function isEngineeringDiagnosticsEnabled(options = {}) {
  if (options.enableDiagnostics === true) return true;

  const envFlag = process.env.EVIDENCE_INTEGRITY_DIAGNOSTICS;
  if (typeof envFlag !== 'string') return false;

  const normalized = envFlag.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function createDiagnosticsContext(auditResult, html, details, domain, options = {}) {
  const analysedUrl = options.analysedUrl || details.final_url || auditResult?.url || auditResult?.domain || null;
  const canonicalSelectedUrl = details.final_url || analysedUrl || (domain ? `https://${domain}` : null);
  const primaryPage = html ? extractPrimaryPageContext(html) : { title: '', h1: '', primaryHtml: '', primaryText: '' };
  const primarySummary = {
    title: primaryPage.title || '',
    h1: primaryPage.h1 || '',
    excerpt: (primaryPage.primaryText || '').slice(0, 220),
    meaningfulWordCount: countMeaningfulWords(primaryPage.primaryHtml || ''),
  };

  const hasAcquisitionSignals = Boolean(
    details.status_code !== undefined ||
    (auditResult && auditResult._evidence && (
      auditResult._evidence.statusCode !== undefined ||
      auditResult._evidence.rawHtmlLength !== undefined
    ))
  );

  return {
    investigationIdentifier: options.investigationIdentifier ||
      `eng-ei-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    analysedUrl,
    acquisition: {
      completed: hasAcquisitionSignals
    },
    canonicalPage: {
      selected: canonicalSelectedUrl
    },
    primaryPageSummary: primarySummary,
    classifierExecutionSequence: [],
    classifierResults: [],
    firstTerminatingClassifier: null,
    finalEvidenceIntegrityDecision: null,
    investigationCompletionStatus: {
      completed: false,
      status: 'running'
    }
  };
}

function recordClassifierDiagnostic(diagnostics, classifierName, classifierResult) {
  if (!diagnostics) return;
  diagnostics.classifierExecutionSequence.push(classifierName);
  diagnostics.classifierResults.push({
    classifier: classifierName,
    result: Boolean(classifierResult)
  });
  if (classifierResult && !diagnostics.firstTerminatingClassifier) {
    diagnostics.firstTerminatingClassifier = classifierName;
  }
}

function finalizeDiagnostics(result, diagnostics) {
  if (!diagnostics) return result;
  diagnostics.finalEvidenceIntegrityDecision = {
    valid: result.valid,
    evidenceFailure: result.evidenceFailure
  };
  diagnostics.investigationCompletionStatus = {
    completed: true,
    status: 'completed'
  };
  result.diagnostics = diagnostics;
  return result;
}

/**
 * Main validation function.
 *
 * @param {Object} auditResult - The result from analyzeWebsite()
 * @param {string} rawHtml - The raw HTML content (optional, will use auditResult if not provided)
 * @param {Object} options - Runtime options (engineering diagnostics only)
 * @returns {Object} { valid, evidenceFailure, failureReason, detail }
 */
function validateEvidence(auditResult, rawHtml = null, options = {}) {
  const result = {
    valid: true,
    evidenceFailure: null,
    failureReason: null,
    detail: null,
    checked: []
  };

  const diagnosticsEnabled = isEngineeringDiagnosticsEnabled(options);
  const diagnostics = diagnosticsEnabled
    ? createDiagnosticsContext(auditResult, rawHtml || '', (auditResult && auditResult.details) || {}, auditResult && auditResult.domain, options)
    : null;

  if (!auditResult) {
    result.valid = false;
    result.evidenceFailure = 'no_audit_result';
    result.failureReason = 'No audit result provided';
    result.checked = ['null_result'];
    recordClassifierDiagnostic(diagnostics, 'null_result', true);
    return finalizeDiagnostics(result, diagnostics);
  }

  const html = rawHtml || '';
  const details = auditResult.details || {};
  const statusCode = details.status_code;
  const domain = auditResult.domain;

  // Check 0: _evidence-based failure (from scraper retrieval/validation)
  if (auditResult._evidence) {
    const evidenceMarkerFailure = auditResult._evidence.retrievalFailure === true || auditResult._evidence.failureType;
    recordClassifierDiagnostic(diagnostics, 'evidence_marker_failure', evidenceMarkerFailure);
    if (evidenceMarkerFailure) {
      result.valid = false;
      result.evidenceFailure = auditResult._evidence.failureType || 'retrieval_failure';
      result.failureReason = auditResult._evidence.failureReason || 'Evidence validation failed';
      result.detail = { evidence: auditResult._evidence, domain };
      result.checked = ['evidence_marker_failure'];
      return finalizeDiagnostics(result, diagnostics);
    }
    // Also respect _evidence.validation.valid === false if present
    const evidenceValidationMarker = auditResult._evidence.validation && auditResult._evidence.validation.valid === false;
    recordClassifierDiagnostic(diagnostics, 'evidence_validation_marker', evidenceValidationMarker);
    if (evidenceValidationMarker) {
      result.valid = false;
      result.evidenceFailure = auditResult._evidence.validation.evidenceFailure || 'validation_failure';
      result.failureReason = auditResult._evidence.validation.failureReason || 'Evidence validation failed';
      result.detail = { evidence: auditResult._evidence, domain };
      result.checked = ['evidence_validation_marker'];
      return finalizeDiagnostics(result, diagnostics);
    }
  }

  // Check 1: Access Denied (403, 401, 404, 451, or content patterns)
  const checked = [];

  // Check explicit access-denied statuses FIRST before general retrieval failure
  const accessDenied = statusCode !== undefined && isExplicitAccessDenied(statusCode, html, domain);
  recordClassifierDiagnostic(diagnostics, 'access_denied', accessDenied);
  if (accessDenied) {
    result.valid = false;
    result.evidenceFailure = 'access_denied';
    result.failureReason = `HTTP ${statusCode}: Access denied or page not found. Commercial Intelligence must not reason from blocked content.`;
    result.detail = { statusCode, domain };
    result.checked = ['access_denied'];
    return finalizeDiagnostics(result, diagnostics);
  }

  // Check 2: General retrieval failure (other non-2xx/3xx statuses like 500, 502, etc.)
  const retrievalFailure = statusCode !== undefined && isRetrievalFailure(statusCode);
  recordClassifierDiagnostic(diagnostics, 'retrieval_failure', retrievalFailure);
  if (retrievalFailure) {
    result.valid = false;
    result.evidenceFailure = 'retrieval_failure';
    result.failureReason = `HTTP ${statusCode}: Page could not be retrieved. No valid business content available for Commercial Intelligence.`;
    result.detail = { statusCode, domain };
    result.checked = ['status_code_failure'];
    return finalizeDiagnostics(result, diagnostics);
  }

  // Check 3a: Login/Authentication page (regardless of content length)
  const loginPage = html && isLoginPage(html);
  recordClassifierDiagnostic(diagnostics, 'login_page', loginPage);
  if (loginPage) {
    result.valid = false;
    result.evidenceFailure = 'login_page';
    result.failureReason = `Login/authentication page detected. Commercial Intelligence must not reason from login pages or authentication walls.`;
    result.detail = { statusCode, domain };
    result.checked = ['login_page_detected'];
    return finalizeDiagnostics(result, diagnostics);
  }

  // Check 3b: Checkout/Payment routing page (regardless of content length)
  const checkoutPage = html && isCheckoutOrPaymentPage(html);
  recordClassifierDiagnostic(diagnostics, 'checkout_page', checkoutPage);
  if (checkoutPage) {
    result.valid = false;
    result.evidenceFailure = 'checkout_page';
    result.failureReason = `Checkout/payment routing page detected. Commercial Intelligence must not reason from checkout or payment routing pages.`;
    result.detail = { statusCode, domain };
    result.checked = ['checkout_page_detected'];
    return finalizeDiagnostics(result, diagnostics);
  }

  // Check 4: CDN / Bot Protection
  const cdnBotProtection = html && isCdnBotProtection(html, statusCode);
  recordClassifierDiagnostic(diagnostics, 'cdn_bot_protection', cdnBotProtection);
  if (cdnBotProtection) {
    result.valid = false;
    result.evidenceFailure = 'cdn_bot_protection';
    result.failureReason = `CDN/bot protection page detected. Commercial Intelligence must not reason from bot challenge pages.`;
    result.detail = { statusCode, domain };
    result.checked = ['cdn_bot_protection'];
    return finalizeDiagnostics(result, diagnostics);
  }

  // Check 5: HTML content scan for non-business patterns
  if (html) {
    const patternMatches = scanHtmlPatterns(html);
    const highConfidenceBlocks = patternMatches.filter(m => m.confidence >= 0.8);
    const mediumConfidenceBlocks = patternMatches.filter(m => m.confidence >= 0.6 && m.confidence < 0.8);
    const hasHighConfidenceBlock = highConfidenceBlocks.length > 0;
    recordClassifierDiagnostic(diagnostics, 'html_pattern_high_confidence', hasHighConfidenceBlock);

    if (highConfidenceBlocks.length > 0) {
      const top = highConfidenceBlocks[0];
      result.valid = false;
      result.evidenceFailure = top.label;
      result.failureReason = `Non-business content detected: ${top.label} (confidence: ${Math.round(top.confidence * 100)}%). Commercial Intelligence must not reason from unvalidated content.`;
      result.detail = { matches: patternMatches, statusCode, domain };
      result.checked = ['html_pattern_high_confidence', ...patternMatches.map(m => m.label)];
      return finalizeDiagnostics(result, diagnostics);
    }

    // Check content depth — a real business website should have meaningful content
    const meaningfulWords = countMeaningfulWords(html);
    const insufficientContent = meaningfulWords < MIN_CONTENT_WORDS && patternMatches.length > 0;
    recordClassifierDiagnostic(diagnostics, 'insufficient_content', insufficientContent);
    if (insufficientContent) {
      result.valid = false;
      result.evidenceFailure = 'insufficient_content';
      result.failureReason = `Insufficient business content detected (${meaningfulWords} meaningful words, ${patternMatches.length} non-business pattern matches). Commercial Intelligence must not reason from placeholder or incomplete pages.`;
      result.detail = { meaningfulWords, patternMatches, statusCode, domain };
      result.checked = ['insufficient_content', ...patternMatches.map(m => m.label)];
      return finalizeDiagnostics(result, diagnostics);
    }

    checked.push('html_scan_passed', `content_words:${meaningfulWords}`);
  }

  // Check 6: Synthetic/Mock audit data
  const syntheticAudit = isSyntheticAudit(auditResult);
  recordClassifierDiagnostic(diagnostics, 'synthetic_audit_data', syntheticAudit);
  if (syntheticAudit) {
    result.valid = false;
    result.evidenceFailure = 'synthetic_audit_data';
    result.failureReason = `Synthetic/mock audit data detected. The audit result was generated from a fallback path, not from actual retrieved website content. Commercial Intelligence must not reason from fabricated evidence.`;
    result.detail = { domain };
    result.checked = ['synthetic_data_check'];
    return finalizeDiagnostics(result, diagnostics);
  }

  checked.push('synthetic_data_check_passed');

  // All checks passed — evidence is valid
  result.valid = true;
  result.checked = checked;
  return finalizeDiagnostics(result, diagnostics);
}

/**
 * Determines if an evidence validation failure should preserve previously
 * valid data when refreshing an existing lead.
 * 
 * @param {Object} validationResult - Result from validateEvidence()
 * @param {Object} existingLead - The existing lead data from the database
 * @returns {boolean} - true if previous data should be preserved
 */
function shouldPreservePreviousData(validationResult, existingLead) {
  if (!existingLead) return false; // No previous data to preserve
  if (validationResult.valid) return false; // New data is valid, use it
  
  // Only preserve if we have an existing lead with real (non-synthetic) data
  const hasRealData = existingLead.speed_score !== undefined && existingLead.speed_score !== null;
  return hasRealData;
}

module.exports = {
  validateEvidence,
  isSyntheticAudit,
  isExplicitAccessDenied,
  isCdnBotProtection,
  isLoginPage,
  isCheckoutOrPaymentPage,
  scanHtmlPatterns,
  countMeaningfulWords,
  shouldPreservePreviousData,
  BLOCKED_PAGE_PATTERNS,
  MIN_MEANINGFUL_CONTENT_LENGTH
};