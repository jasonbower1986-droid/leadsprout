const crypto = require('crypto');
const path = require('path');

const BUNDLE_ID = 'EI-RULE-BUNDLE-001';
const BUNDLE_VERSION = '1.0.0';
const BUNDLE_DIGEST = '9fdf4ea9ea6a0f5e23c4783608d29cb2b6bd1db77b693009d4cab09a4aff0eb2';
const BUNDLE_PATH = path.join(__dirname, '..', 'config', 'evidence-integrity', 'EI-RULE-BUNDLE-001-1.0.0.json');

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function ruleBundleDigest(bundle) {
  const payload = { ...bundle };
  delete payload.digest;
  return crypto.createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function bundleError(code) {
  const error = new Error('Evidence Integrity rule bundle verification failed.');
  error.code = code;
  return error;
}

function verifyRuleBundle(bundle) {
  if (!bundle || bundle.bundleId !== BUNDLE_ID || bundle.semanticVersion !== BUNDLE_VERSION) {
    throw bundleError('EVIDENCE_RULE_BUNDLE_UNSUPPORTED');
  }
  if (bundle.digest !== BUNDLE_DIGEST || ruleBundleDigest(bundle) !== BUNDLE_DIGEST) {
    throw bundleError('EVIDENCE_RULE_BUNDLE_DIGEST_MISMATCH');
  }
  if (bundle.canonicalization !== 'RFC 8785' || bundle.digestAlgorithm !== 'SHA-256') {
    throw bundleError('EVIDENCE_RULE_BUNDLE_UNSUPPORTED');
  }
  const rules = Array.isArray(bundle.rules) ? bundle.rules : [];
  const reasons = Array.isArray(bundle.reasonCodes) ? bundle.reasonCodes : [];
  const cases = Array.isArray(bundle.acceptanceCases) ? bundle.acceptanceCases : [];
  if (rules.length !== 53 || reasons.length !== 43 || cases.length !== 14) {
    throw bundleError('EVIDENCE_RULE_BUNDLE_INCOMPLETE');
  }
  const ruleIds = new Set(rules.map(item => item.id));
  const reasonIds = new Set(reasons.map(item => item.id));
  const caseIds = new Set(cases.map(item => item.id));
  if (ruleIds.size !== rules.length || reasonIds.size !== reasons.length || caseIds.size !== cases.length) {
    throw bundleError('EVIDENCE_RULE_BUNDLE_IDENTIFIER_COLLISION');
  }
  if (rules.some(rule => (rule.reasons || []).some(reason => !reasonIds.has(reason))) ||
      cases.some(entry => (entry.rules || []).some(rule => !ruleIds.has(rule)))) {
    throw bundleError('EVIDENCE_RULE_BUNDLE_REFERENCE_INVALID');
  }
  return Object.freeze({
    id: bundle.bundleId,
    version: bundle.semanticVersion,
    digest: bundle.digest,
    tuple: `${bundle.bundleId} | ${bundle.semanticVersion} | sha256:${bundle.digest}`,
    rules: rules.length,
    reasons: reasons.length,
    acceptanceCases: cases.length
  });
}

function loadRuleBundle() {
  delete require.cache[require.resolve(BUNDLE_PATH)];
  const bundle = require(BUNDLE_PATH);
  verifyRuleBundle(bundle);
  return Object.freeze(bundle);
}

module.exports = {
  BUNDLE_ID, BUNDLE_VERSION, BUNDLE_DIGEST, BUNDLE_PATH,
  canonicalJson, ruleBundleDigest, verifyRuleBundle, loadRuleBundle
};
