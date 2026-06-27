const { SEO_GAPS, CONVERSION_GAPS } = require('../constants/gap-metadata');

/**
 * Enriches raw lead data with metadata (priority, impact, category).
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

  // Calculate Health Score
  const healthScore = calculateHealthScore(lead, enrichedSeoGaps, enrichedConversionGaps);

  return {
    ...lead,
    seo_gaps: enrichedSeoGaps,
    conversion_gaps: enrichedConversionGaps,
    health_score: healthScore,
    health_grade: calculateGrade(healthScore)
  };
}

function calculateHealthScore(lead, seoGaps, conversionGaps) {
  let score = 100;

  // Performance (Speed Score) - 35% weight
  const speed = lead.speed_score || 0;
  const speedContribution = (speed / 100) * 35;
  
  // Base score from speed
  score = 65 + speedContribution; // Starts at 65 and goes up to 100 based on speed? No, let's use the mapping.
  
  // Re-evaluating: start at 100 and deduct.
  let finalScore = 100;
  
  // Performance deduction (max 35)
  const performanceLoss = (100 - speed) * 0.35;
  finalScore -= performanceLoss;
  
  // Mobile UX deduction (25)
  if (lead.responsive_status === 'not_responsive') {
    finalScore -= 25;
  }
  
  // SEO Foundations (20)
  const highImpactSeoGaps = seoGaps.filter(g => g.impact === 'High').length;
  finalScore -= (highImpactSeoGaps * 5); // Max 20
  
  // Conversion (20)
  const highImpactConvGaps = conversionGaps.filter(g => g.impact === 'High').length;
  finalScore -= (highImpactConvGaps * 10); // Max 20

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
