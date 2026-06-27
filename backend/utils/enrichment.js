const { SEO_GAPS, CONVERSION_GAPS } = require('../constants/gap-metadata');
const { calculateRevenueLeak, calculateMarketStanding, getAdvisorQuote } = require('./calculators');

/**
 * Enriches raw lead data with metadata (priority, impact, category).
 * Following LeadSprout Advisor Narrative Engine Implementation Guide.
 */
function enrichLeadData(lead) {
  // Parse JSON strings if they are not already objects
  let seoGaps = lead.seo_gaps;
  if (typeof seoGaps === 'string') {
    try {
      seoGaps = JSON.parse(seoGaps);
    } catch (e) {
      seoGaps = [];
    }
  }

  let conversionGaps = lead.conversion_gaps;
  if (typeof conversionGaps === 'string') {
    try {
      conversionGaps = JSON.parse(conversionGaps);
    } catch (e) {
      conversionGaps = [];
    }
  }

  const enrichedSeoGaps = (seoGaps || []).map(gap => ({
    name: gap,
    ...(SEO_GAPS[gap] || { impact: 'Medium', difficulty: 'Medium', category: 'General SEO' })
  }));

  const enrichedConversionGaps = (conversionGaps || []).map(gap => ({
    name: gap,
    ...(CONVERSION_GAPS[gap] || { impact: 'Medium', difficulty: 'Medium', category: 'Conversion' })
  }));

  // 1. Calculate Visibility Health (Health Score)
  const healthScore = calculateHealthScore(lead, enrichedSeoGaps, enrichedConversionGaps);
  
  // 2. Calculate Revenue Leak
  const revenueLeak = calculateRevenueLeak(lead.speed_score);
  
  // 3. Calculate Market Standing
  const marketStanding = calculateMarketStanding(healthScore, lead.niche, lead.location ? lead.location.split(',')[0] : 'Austin');

  // 4. Get Advisor Quote
  // Prepare a copy with enriched gaps for the quote logic
  const leadForQuote = {
    ...lead,
    seo_gaps: enrichedSeoGaps,
    conversion_gaps: enrichedConversionGaps
  };
  const advisorQuote = getAdvisorQuote(leadForQuote, healthScore);

  return {
    ...lead,
    // Original fields with enriched objects
    seo_gaps: enrichedSeoGaps,
    conversion_gaps: enrichedConversionGaps,
    
    // Phase 1.2 Metrics
    visibility_health: healthScore,
    health_grade: calculateGrade(healthScore),
    revenue_leak: revenueLeak,
    market_standing: marketStanding,
    advisor_quote: advisorQuote,
    
    // Advisor Labels (Jargon Translation)
    advisor_labels: {
      visibility_health: 'Visibility Health',
      loading_friction: 'Loading Friction',
      mobile_accessibility: 'Mobile Accessibility',
      search_hooks: 'Search Hooks',
      trust_security: 'Trust & Security',
      value_prop_clarity: 'Value Proposition Clarity'
    }
  };
}

function calculateHealthScore(lead, seoGaps, conversionGaps) {
  let finalScore = 100;
  
  // Performance deduction (max 35)
  const speed = lead.speed_score || 0;
  const performanceLoss = (100 - speed) * 0.35;
  finalScore -= performanceLoss;
  
  // Mobile UX deduction (25)
  if (lead.responsive_status === 'not_responsive' || lead.responsive_status === 'non-responsive') {
    finalScore -= 25;
  }
  
  // SEO Foundations (20)
  const highImpactSeoGaps = seoGaps.filter(g => g.impact === 'High').length;
  finalScore -= Math.min(20, (highImpactSeoGaps * 10)); // Deduced 10 per high impact gap, max 20
  
  // Conversion (20)
  const highImpactConvGaps = conversionGaps.filter(g => g.impact === 'High').length;
  finalScore -= Math.min(20, (highImpactConvGaps * 10)); // Deduced 10 per high impact gap, max 20

  return Math.max(0, Math.round(finalScore));
}

function calculateGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'F';
}

module.exports = {
  enrichLeadData,
  calculateHealthScore,
  calculateGrade
};
