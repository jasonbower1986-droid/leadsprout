/**
 * v5.2 Constraint Chain Simulator
 *
 * Recursive state mutation engine that simulates the resolution of
 * Bottleneck 1 → re-evaluates the lead → finds Bottleneck 2 →
 * resolves → finds Bottleneck 3. Generates logical transition
 * explanations for each step.
 */
const { discernPatterns } = require('./reasoning-matrix');

/**
 * Simulate what the lead's state would look like after resolving
 * a given pattern. Returns a mutated lead object.
 */
function resolvePattern(lead, patternTag) {
  const mutated = { ...lead };
  const seoGaps = Array.isArray(lead.seo_gaps) ? [...lead.seo_gaps] : [];
  const convGaps = Array.isArray(lead.conversion_gaps) ? [...lead.conversion_gaps] : [];

  switch (patternTag) {
    case 'Neglected Digital Storefront':
      mutated.speed_score = Math.min(100, (lead.speed_score || 0) + 30);
      mutated.responsive_status = 'responsive';
      break;
    case 'Premium Business, Budget Website':
      mutated.speed_score = Math.min(100, (lead.speed_score || 0) + 25);
      break;
    case 'High-Traffic, Low-Conversion Opportunity':
      // Add CTA, lead capture — remove conversion gaps
      mutated.conversion_gaps = convGaps.filter(g =>
        typeof g === 'string' &&
        !g.includes('No clear Call-To-Action') &&
        !g.includes('No lead capture')
      );
      break;
    case 'Mobile Confidence Breakdown':
      mutated.responsive_status = 'responsive';
      mutated.speed_score = Math.min(100, (lead.speed_score || 0) + 15);
      break;
    case 'Competitive Neglect':
      mutated.speed_score = Math.min(100, (lead.speed_score || 0) + 20);
      if (seoGaps.length > 0) {
        mutated.seo_gaps = seoGaps.slice(1); // Remove one gap
      }
      break;
    case 'Local Visibility Gap':
      mutated.seo_gaps = seoGaps.filter(g =>
        typeof g === 'string' && !g.includes('Missing Title') && !g.includes('Missing Meta')
      );
      break;
    case 'Trust Deficit':
      mutated.seo_gaps = seoGaps.filter(g =>
        typeof g === 'string' && !g.includes('SSL') && !g.includes('HTTPS')
      );
      break;
    case 'Booking Friction':
      mutated.conversion_gaps = convGaps.filter(g =>
        typeof g === 'string' &&
        !g.includes('No phone') &&
        !g.includes('No clear Call-To-Action')
      );
      break;
    case 'Reputation Leakage':
      mutated.conversion_gaps = convGaps.filter(g =>
        typeof g === 'string' && !g.includes('Missing social')
      );
      break;
    case 'Outdated Customer Experience':
      mutated.speed_score = Math.min(100, (lead.speed_score || 0) + 35);
      mutated.responsive_status = 'responsive';
      break;
    case 'Authority Without Credibility':
      if (seoGaps.length > 0) {
        mutated.seo_gaps = seoGaps.slice(1);
      }
      break;
    case 'Revenue Bottleneck':
      mutated.speed_score = Math.min(100, (lead.speed_score || 0) + 20);
      break;
    case 'Digital First Impression Failure':
      mutated.seo_gaps = seoGaps.filter(g =>
        typeof g === 'string' && !g.includes('Missing Title')
      );
      mutated.speed_score = Math.min(100, (lead.speed_score || 0) + 10);
      break;
    default:
      break;
  }

  return mutated;
}

/**
 * Generate a human-readable transition explanation for moving from
 * one bottleneck to the next.
 */
function generateTransition(bottleneckIndex, fromPattern, toPattern, context) {
  const transitions = {
    'Trust Deficit_to_Neglected Digital Storefront': 'Fixing the SSL crisis reveals a deeper digital neglect — the site is fundamentally outdated beyond just security.',
    'Trust Deficit_to_Mobile Confidence Breakdown': 'Once security is restored, the mobile experience becomes the next critical barrier to customer trust.',
    'Mobile Confidence Breakdown_to_Revenue Bottleneck': 'With mobile working, the real revenue leak becomes visible — traffic arrives but performance kills conversions.',
    'Neglected Digital Storefront_to_High-Traffic, Low-Conversion Opportunity': 'After the site rebuild, traffic recovers — now the missing CTA and funnel architecture become the primary constraint.',
    'Revenue Bottleneck_to_Booking Friction': 'Speed is fixed — now the lack of clear contact paths and booking CTAs prevents the final conversion step.',
    'High-Traffic, Low-Conversion Opportunity_to_Reputation Leakage': 'Conversion flow is fixed — now missing social proof prevents the final trust step needed to close.',
    'Premium Business, Budget Website_to_Revenue Bottleneck': 'The premium redesign exposes underlying performance bottlenecks that were hidden by the dated design.',
    'Competitive Neglect_to_Mobile Confidence Breakdown': 'Catching up to competitors reveals that mobile experience is the specific dimension where they still lag.',
    'Local Visibility Gap_to_High-Traffic, Low-Conversion Opportunity': 'Once search visibility is restored, traffic increases reveal the conversion funnel as the next bottleneck.'
  };

  const key = `${fromPattern}_to_${toPattern}`;
  if (transitions[key]) {
    return transitions[key];
  }

  // Default transition
  return `Resolving ${fromPattern} naturally exposes ${toPattern} as the next priority constraint.`;
}

/**
 * Run the constraint chain simulation recursively.
 *
 * @param {Object} lead - Original lead data
 * @param {Object} context - Classified context (scale, maturity, transactionModel)
 * @param {number} depth - Current recursion depth (0=first bottleneck)
 * @returns {Array} Array of bottleneck objects, each with pattern, state, and reasoning
 */
function simulateConstraintChain(lead, context, depth = 0) {
  const MAX_DEPTH = 3;
  if (depth >= MAX_DEPTH) return [];

  // Discern patterns on current lead state
  const healthScore = lead.speed_score || 50;
  const result = discernPatterns(lead, healthScore, null, context);
  const bottlenecks = [];

  if (!result.primaryBreakthrough) {
    return bottlenecks;
  }

  const currentPattern = result.primaryBreakthrough.pattern;
  const currentScore = result.primaryBreakthrough.score;

  // Build the bottleneck record
  const bottleneck = {
    phase: depth + 1,
    pattern: currentPattern,
    score: currentScore,
    commercialHook: currentPattern.hook,
    serviceToPitch: currentPattern.service,
    commercialBehaviour: currentPattern.behaviour,
    evidence: result.devilsAdvocate?.critiques || []
  };

  // Add transition explanation if this is not the first bottleneck
  if (depth > 0) {
    bottlenecks.push(null); // placeholder — will be replaced
  }

  bottlenecks.push(bottleneck);

  // Resolve the current bottleneck and recurse
  const resolvedLead = resolvePattern(lead, currentPattern.tag);

  // Add transition text to the bottleneck
  const nextBottlenecks = simulateConstraintChain(resolvedLead, context, depth + 1);

  if (nextBottlenecks.length > 0 && depth < MAX_DEPTH - 1) {
    const nextPattern = nextBottlenecks[0].pattern;
    bottleneck.transition = generateTransition(depth, currentPattern.tag, nextPattern.tag, context);
  } else {
    bottleneck.transition = depth === MAX_DEPTH - 1
      ? 'Final bottleneck resolved — lead achieves optimized digital presence.'
      : 'No further critical bottlenecks detected.';
  }

  return [bottleneck, ...nextBottlenecks];
}

/**
 * Full Growth Roadmap generator.
 * Wraps the constraint chain with structured metadata.
 */
function generateGrowthRoadmap(lead, context) {
  const chain = simulateConstraintChain(lead, context);

  if (chain.length === 0) {
    return {
      phases: [],
      totalConfidence: 0,
      summary: 'No critical bottlenecks detected — this lead is already well-optimized.'
    };
  }

  const totalConfidence = Math.round(
    chain.reduce((sum, b) => sum + (b.score || 0), 0) / chain.length
  );

  return {
    phases: chain.map((b, i) => ({
      phase: i + 1,
      title: b.pattern.name || b.pattern.tag,
      commercialHook: b.commercialHook,
      serviceToPitch: b.serviceToPitch,
      commercialBehaviour: b.commercialBehaviour,
      score: b.score,
      transition: b.transition,
      // Confidence drops slightly with each successive phase
      confidence: Math.max(60, Math.round(b.score * (1 - i * 0.08))),
      devilsAdvocateNotes: b.evidence
    })),
    totalConfidence,
    totalPhases: chain.length,
    summary: chain.length === 1
      ? `Single-priority roadmap: ${chain[0].pattern.tag}`
      : `${chain.length}-phase growth roadmap: ${chain.map(b => b.pattern.tag).join(' → ')}`
  };
}

module.exports = {
  simulateConstraintChain,
  generateGrowthRoadmap,
  resolvePattern,
  generateTransition
};
