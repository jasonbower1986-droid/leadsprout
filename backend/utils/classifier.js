/**
 * v5.3 Context Classifier
 *
 * Refined classifiers with:
 * - Scale: Solo / Mid-Market / Enterprise (renamed from Local → Solo)
 * - Maturity: Neglected / Active Marketer / Digital Leader
 * - Transaction Model: Urgent / Deliberate / Hybrid (with journey funnel mapping)
 * - Explicit primary customer journey funnel per transaction model
 * - High-conviction classification rules
 */

const URGENT_NICHES = ['HVAC', 'Plumbing', 'Roofing', 'Auto Repair', 'Locksmith', 'Emergency', 'Electrical Services'];
const DELIBERATE_NICHES = ['Legal Services', 'Financial Services', 'Consulting', 'Medical', 'Real Estate', 'Software'];

/**
 * Journey funnel mapping per transaction model.
 */
const JOURNEY_FUNNEL = {
  Urgent: {
    funnel: 'Maps to Mobile Call',
    description: 'Customer searches for immediate service → sees phone number → calls to book/order',
    criticalConversionPath: ['visible_phone', 'click_to_call', 'fast_load'],
    decisionTimeframe: 'Minutes to hours',
    primaryDevice: 'Mobile'
  },
  Deliberate: {
    funnel: 'Organic to Credentials Form',
    description: 'Customer researches multiple options → evaluates credentials → fills contact form or books consult',
    criticalConversionPath: ['ssl_trust', 'schema_rich_results', 'credentials_content', 'contact_form'],
    decisionTimeframe: 'Days to weeks',
    primaryDevice: 'Desktop & Mobile'
  },
  Hybrid: {
    funnel: 'Search → Verify → Call or Book',
    description: 'Customer searches, verifies credibility via reviews/schema, then calls if urgent or books if planned',
    criticalConversionPath: ['schema_rich_results', 'social_proof', 'visible_phone', 'contact_form'],
    decisionTimeframe: 'Hours to days',
    primaryDevice: 'Mobile-first'
  }
};

/**
 * Classify business scale: Solo / Mid-Market / Enterprise.
 * Uses tracker depth, responsive quality, and speed as signals.
 */
function classifyScale(lead) {
  const trackers = Array.isArray(lead.trackers_found) ? lead.trackers_found : [];
  const speed = lead.speed_score || 50;
  const isResponsive = lead.responsive_status === 'responsive';
  const hasGA = trackers.includes('Google Analytics');
  const hasAds = trackers.includes('Google Ads') || trackers.includes('Facebook Pixel');
  const hasAdvancedTrackers = trackers.length >= 2;

  if (hasAdvancedTrackers && hasGA && speed >= 60 && isResponsive) {
    return { scale: 'Enterprise', confidence: 'High' };
  }
  if (hasGA || hasAds) {
    return { scale: 'Mid-Market', confidence: hasGA && hasAds ? 'High' : 'Medium' };
  }
  return { scale: 'Solo', confidence: 'High' };
}

/**
 * Classify business maturity: Neglected / Active Marketer / Digital Leader.
 * Signals: tracker usage, responsive quality, CTA presence, speed.
 */
function classifyMaturity(lead) {
  const trackers = Array.isArray(lead.trackers_found) ? lead.trackers_found : [];
  const convGaps = Array.isArray(lead.conversion_gaps) ? lead.conversion_gaps : [];
  const speed = lead.speed_score || 50;
  const isResponsive = lead.responsive_status === 'responsive';
  const hasGA = trackers.includes('Google Analytics');
  const hasAds = trackers.includes('Google Ads') || trackers.includes('Facebook Pixel');
  const hasCTA = !convGaps.some(g => typeof g === 'string' && g.includes('No clear Call-To-Action'));

  let activeSignals = 0;
  if (hasGA) activeSignals++;
  if (hasAds) activeSignals++;
  if (isResponsive && speed >= 60) activeSignals++;
  if (hasCTA) activeSignals++;

  if (activeSignals >= 3) return { maturity: 'Digital Leader', confidence: 'High' };
  if (activeSignals >= 1) return { maturity: 'Active Marketer', confidence: activeSignals >= 2 ? 'High' : 'Medium' };
  return { maturity: 'Neglected', confidence: 'High' };
}

/**
 * Classify transaction model: Urgent / Deliberate / Hybrid.
 * High-conviction rules based on niche + available conversion signals.
 */
function classifyTransactionModel(lead) {
  const convGaps = Array.isArray(lead.conversion_gaps) ? lead.conversion_gaps : [];
  const hasPhone = !convGaps.some(g => typeof g === 'string' && g.includes('No phone'));
  const hasCTA = !convGaps.some(g => typeof g === 'string' && g.includes('No clear Call-To-Action'));
  const isResponsive = lead.responsive_status === 'responsive';
  const niche = lead.niche || '';

  // Urgent: emergency-service niche + phone available (the primary conversion path)
  if (URGENT_NICHES.includes(niche) && hasPhone) {
    return { transactionModel: 'Urgent', confidence: 'High' };
  }

  // Deliberate: high-consideration niches, or not urgent + not set up for immediate conversion
  if (DELIBERATE_NICHES.includes(niche) || (!hasPhone && !hasCTA)) {
    return { transactionModel: 'Deliberate', confidence: 'High' };
  }

  // Hybrid: has both phone and CTA (can convert either way)
  if (hasPhone && hasCTA && isResponsive) {
    return { transactionModel: 'Hybrid', confidence: 'Medium' };
  }

  // Fallback based on what signals exist
  if (hasPhone) return { transactionModel: 'Hybrid', confidence: 'Low' };
  return { transactionModel: 'Deliberate', confidence: 'Medium' };
}

/**
 * Full context classification.
 * Returns scale, maturity, transactionModel + journeyFunnel metadata.
 */
function classifyContext(lead) {
  const { scale, confidence: scaleConf } = classifyScale(lead);
  const { maturity, confidence: maturityConf } = classifyMaturity(lead);
  const { transactionModel, confidence: modelConf } = classifyTransactionModel(lead);
  const journeyFunnel = JOURNEY_FUNNEL[transactionModel] || JOURNEY_FUNNEL.Deliberate;

  return {
    scale,
    maturity,
    transactionModel,
    journeyFunnel,
    confidence: {
      scale: scaleConf,
      maturity: maturityConf,
      transactionModel: modelConf
    }
  };
}

/**
 * Human-readable context summary with journey funnel explanation.
 */
function getContextSummary(context) {
  return {
    scale: {
      label: context.scale,
      description: context.scale === 'Enterprise'
        ? 'Mature digital operation with analytics infrastructure and investment'
        : context.scale === 'Mid-Market'
          ? 'Growing business with measurable digital investment'
          : 'Solo or very small business with minimal digital footprint'
    },
    maturity: {
      label: context.maturity,
      description: context.maturity === 'Digital Leader'
        ? 'Actively investing in digital presence and conversion optimization'
        : context.maturity === 'Active Marketer'
          ? 'Some digital activity present but significant gaps remain'
          : 'Digitally neglected — high upside for foundational improvements'
    },
    transactionModel: {
      label: context.transactionModel,
      description: context.journeyFunnel?.description || 'Standard purchase journey'
    },
    journeyFunnel: context.journeyFunnel ? {
      funnel: context.journeyFunnel.funnel,
      criticalConversionPath: context.journeyFunnel.criticalConversionPath,
      decisionTimeframe: context.journeyFunnel.decisionTimeframe,
      primaryDevice: context.journeyFunnel.primaryDevice
    } : null
  };
}

module.exports = {
  classifyContext,
  getContextSummary,
  classifyScale,
  classifyMaturity,
  classifyTransactionModel,
  JOURNEY_FUNNEL,
  URGENT_NICHES,
  DELIBERATE_NICHES
};