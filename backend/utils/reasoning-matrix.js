/**
 * v5.2 Weighted Reasoning Matrix & Devil's Advocate
 *
 * Wraps the 13 discovery patterns with commercial weight scores,
 * selects the Primary Breakthrough, and runs an internal self-critique
 * that assesses alternative explanations and corrects if necessary.
 */
const { identifyPatterns: baseIdentify, PATTERNS } = require('./discovery-patterns');

// Commercial weights for each pattern (urgency × revenue impact × closeability)
const PATTERN_WEIGHTS = {
  'Neglected Digital Storefront': { weight: 85, urgency: 7, revenueImpact: 9, closeability: 8 },
  'Premium Business, Budget Website': { weight: 90, urgency: 8, revenueImpact: 10, closeability: 7 },
  'High-Traffic, Low-Conversion Opportunity': { weight: 88, urgency: 6, revenueImpact: 9, closeability: 9 },
  'Mobile Confidence Breakdown': { weight: 82, urgency: 8, revenueImpact: 7, closeability: 8 },
  'Competitive Neglect': { weight: 75, urgency: 5, revenueImpact: 8, closeability: 6 },
  'Local Visibility Gap': { weight: 70, urgency: 4, revenueImpact: 6, closeability: 7 },
  'Trust Deficit': { weight: 95, urgency: 9, revenueImpact: 9, closeability: 10 },
  'Booking Friction': { weight: 88, urgency: 10, revenueImpact: 8, closeability: 9 },
  'Reputation Leakage': { weight: 65, urgency: 3, revenueImpact: 5, closeability: 6 },
  'Outdated Customer Experience': { weight: 80, urgency: 7, revenueImpact: 8, closeability: 7 },
  'Authority Without Credibility': { weight: 78, urgency: 6, revenueImpact: 7, closeability: 8 },
  'Revenue Bottleneck': { weight: 92, urgency: 8, revenueImpact: 10, closeability: 9 },
  'Digital First Impression Failure': { weight: 85, urgency: 9, revenueImpact: 8, closeability: 8 }
};

/**
 * Context-aware multiplier based on lead maturity & transaction model.
 * Urgent + Neglected = high multiplier for Booking Friction type patterns.
 */
function getMultiplier(patternTag, context) {
  let multiplier = 1.0;
  const { maturity, transactionModel, scale } = context;

  // Urgent businesses amplify friction patterns
  if (transactionModel === 'Urgent') {
    if (patternTag === 'Booking Friction') multiplier += 0.3;
    if (patternTag === 'Mobile Confidence Breakdown') multiplier += 0.2;
    if (patternTag === 'Revenue Bottleneck') multiplier += 0.15;
  }

  // Neglected sites = higher value for foundational fixes
  if (maturity === 'Neglected') {
    if (patternTag === 'Neglected Digital Storefront') multiplier += 0.25;
    if (patternTag === 'Digital First Impression Failure') multiplier += 0.2;
    if (patternTag === 'Trust Deficit') multiplier += 0.15;
  }

  // Enterprise scale = higher revenue potential
  if (scale === 'Enterprise') {
    if (patternTag === 'Revenue Bottleneck') multiplier += 0.3;
    if (patternTag === 'Premium Business, Budget Website') multiplier += 0.25;
    if (patternTag === 'High-Traffic, Low-Conversion Opportunity') multiplier += 0.2;
  }

  return Math.min(multiplier, 1.5); // Cap at 1.5x
}

/**
 * Select the Primary Breakthrough from matched patterns using weighted scoring.
 */
function selectPrimaryBreakthrough(matchedPatterns, context) {
  if (!matchedPatterns || matchedPatterns.length === 0) return null;

  const scored = matchedPatterns.map(p => {
    const meta = PATTERN_WEIGHTS[p.tag] || { weight: 50, urgency: 5, revenueImpact: 5, closeability: 5 };
    const multiplier = getMultiplier(p.tag, context);
    const compositeScore = Math.round(meta.weight * multiplier);
    return { pattern: p, score: compositeScore, meta, multiplier };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

/**
 * Devil's Advocate self-critique loop.
 *
 * Challenges the selected primary breakthrough by checking for
 * alternative explanations. If a strong alternative exists with
 * a score within 10% of the primary, critiques and may swap.
 */
function devilsAdvocateReview(primary, scoredPatterns, context) {
  if (!primary || scoredPatterns.length <= 1) {
    return {
      selected: primary,
      critiques: [],
      finalSelection: primary
    };
  }

  const critiques = [];
  const primaryTag = primary.pattern.tag;
  const runnerUp = scoredPatterns[1];
  const scoreDiff = primary.score - runnerUp.score;
  const diffPercent = Math.round((scoreDiff / primary.score) * 100);

  // Case 1: Trust Deficit often masks deeper issues
  if (primaryTag === 'Trust Deficit' && runnerUp.score >= primary.score * 0.85) {
    critiques.push({
      challenge: 'Trust Deficit is surface-level — the real constraint may be a Broken Digital Storefront underneath.',
      confidence: diffPercent < 5 ? 'High' : 'Medium',
      alternativeTag: runnerUp.pattern.tag,
      alternativeScore: runnerUp.score
    });
  }

  // Case 2: Mobile Confidence Breakdown may be symptom of broader neglect
  if (primaryTag === 'Mobile Confidence Breakdown' && runnerUp.score >= primary.score * 0.8) {
    critiques.push({
      challenge: 'Mobile issues may be a symptom of broader digital neglect rather than an isolated problem.',
      confidence: 'Medium',
      alternativeTag: runnerUp.pattern.tag,
      alternativeScore: runnerUp.score
    });
  }

  // Case 3: Very close scores — consider swapping if runner-up is a stronger commercial hook
  if (diffPercent < 10 && runnerUp.meta.closeability > primary.meta.closeability) {
    critiques.push({
      challenge: `The runner-up (${runnerUp.pattern.tag}) has higher closeability despite similar scores. Recommend prioritizing closeability.`,
      confidence: 'High',
      alternativeTag: runnerUp.pattern.tag,
      alternativeScore: runnerUp.score,
      recommended: true
    });
  }

  // Determine final selection
  let finalSelection = primary;
  const hasStrongRecommendation = critiques.some(c => c.recommended && c.confidence === 'High');
  if (hasStrongRecommendation) {
    finalSelection = runnerUp;
  }

  return { selected: primary, critiques, finalSelection };
}

/**
 * Full discernment pipeline: identify → weight → critique → select.
 */
function discernPatterns(lead, healthScore, nicheAvgHealth = null, context = { scale: 'Local', maturity: 'Neglected', transactionModel: 'Deliberate' }) {
  const matchedPatterns = baseIdentify(lead, healthScore, nicheAvgHealth);

  if (matchedPatterns.length === 0) {
    return {
      matchedPatterns: [],
      primaryBreakthrough: null,
      devilsAdvocate: null,
      context
    };
  }

  const scoredPatterns = matchedPatterns.map(p => {
    const meta = PATTERN_WEIGHTS[p.tag] || { weight: 50, urgency: 5, revenueImpact: 5, closeability: 5 };
    const multiplier = getMultiplier(p.tag, context);
    const compositeScore = Math.round(meta.weight * multiplier);
    return { pattern: p, score: compositeScore, meta, multiplier };
  });

  scoredPatterns.sort((a, b) => b.score - a.score);
  const primary = scoredPatterns[0];
  const daReview = devilsAdvocateReview(primary, scoredPatterns, context);

  return {
    matchedPatterns,
    scoredPatterns,
    primaryBreakthrough: daReview.finalSelection,
    devilsAdvocate: {
      selected: daReview.selected,
      critiques: daReview.critiques,
      finalSelection: daReview.finalSelection
    },
    context
  };
}

module.exports = {
  discernPatterns,
  selectPrimaryBreakthrough,
  devilsAdvocateReview,
  PATTERN_WEIGHTS,
  getMultiplier
};
