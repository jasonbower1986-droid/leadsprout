/**
 * v5.2 Context Classifier
 *
 * Derives three commercial context dimensions from lead technical signals:
 * 1. Scale: Local / Mid-Market / Enterprise
 * 2. Maturity: Neglected / Active Marketer / Digital Leader
 * 3. Transaction Model: Urgent / Deliberate / Hybrid
 */
function classifyContext(lead) {
  const trackers = Array.isArray(lead.trackers_found) ? lead.trackers_found : [];
  const seoGaps = Array.isArray(lead.seo_gaps) ? lead.seo_gaps : [];
  const convGaps = Array.isArray(lead.conversion_gaps) ? lead.conversion_gaps : [];
  const speed = lead.speed_score || 50;
  const hasAddress = Boolean(lead.address_detected);
  const hasPhone = !convGaps.some(g => typeof g === 'string' && g.includes('No phone'));
  const hasCTA = !convGaps.some(g => typeof g === 'string' && g.includes('No clear Call-To-Action'));
  const isResponsive = lead.responsive_status === 'responsive';

  // --- Scale ---
  let scale = 'Local';
  const hasGA = trackers.includes('Google Analytics');
  const hasAds = trackers.includes('Google Ads') || trackers.includes('Facebook Pixel');
  const hasAdvancedTrackers = trackers.length >= 2;
  if (hasAdvancedTrackers && hasGA && speed >= 60) {
    scale = 'Enterprise';
  } else if (hasGA || hasAds) {
    scale = 'Mid-Market';
  }

  // --- Maturity ---
  let maturity = 'Neglected';
  let activeSignals = 0;
  if (hasGA) activeSignals++;
  if (hasAds) activeSignals++;
  if (isResponsive && speed >= 60) activeSignals++;
  if (hasCTA) activeSignals++;
  if (activeSignals >= 3) maturity = 'Digital Leader';
  else if (activeSignals >= 1) maturity = 'Active Marketer';

  // --- Transaction Model ---
  let transactionModel = 'Deliberate';
  const urgentNiches = ['HVAC', 'Plumbing', 'Roofing', 'Auto Repair', 'Locksmith', 'Emergency', 'Electrical Services'];
  if (urgentNiches.includes(lead.niche) && hasPhone) {
    transactionModel = 'Urgent';
  } else if (hasPhone && hasCTA && isResponsive) {
    transactionModel = 'Hybrid';
  }

  return { scale, maturity, transactionModel };
}

/**
 * Generates a human-readable context summary for consultant dashboards.
 */
function getContextSummary(context) {
  return {
    scale: {
      label: context.scale,
      description: context.scale === 'Enterprise'
        ? 'Mature digital operation with analytics infrastructure'
        : context.scale === 'Mid-Market'
          ? 'Growing business with measurable digital investment'
          : 'Local business with minimal digital footprint'
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
      description: context.transactionModel === 'Urgent'
        ? 'Customers seek immediate service — phone and speed are critical'
        : context.transactionModel === 'Hybrid'
          ? 'Mix of immediate and researched buying — both phone and web matter'
          : 'Customers research before purchasing — content and credibility drive decisions'
    }
  };
}

module.exports = { classifyContext, getContextSummary };
