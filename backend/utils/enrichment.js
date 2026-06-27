const { SEO_GAPS, CONVERSION_GAPS } = require('../constants/gap-metadata');
const { 
  calculateRevenueLeak, 
  calculateMarketStanding, 
  getAdvisorQuote,
  getConsultantOpportunity
} = require('./calculators');
const { generateNarrative } = require('../services/narrativeService');

/**
 * Enriches raw lead data with metadata (priority, impact, category).
 * Pivot: Opportunity Briefs for Consultants.
 */
function enrichLeadData(lead, nicheBenchmark = null, persona = 'web_agency', userCompany = 'LeadSprout') {
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

  // 1. Calculate Visibility Health (Technical Score)
  const healthScore = calculateHealthScore(lead, enrichedSeoGaps, enrichedConversionGaps);
  
  // 2. Calculate Pitch Urgency (Pivot)
  // Higher urgency when health is lower.
  const pitchUrgency = 100 - healthScore;
  
  // 3. Calculate Revenue Leak
  const revenueLeak = calculateRevenueLeak(lead.speed_score, lead.niche);
  
  // 4. Calculate Market Standing
  const marketStanding = calculateMarketStanding(healthScore, lead.niche, lead.location ? lead.location.split(',')[0] : 'Austin');

  // 5. Get Consultant Opportunity Logic
  // Prepare a copy with enriched gaps
  const leadForLogic = {
    ...lead,
    seo_gaps: enrichedSeoGaps,
    conversion_gaps: enrichedConversionGaps
  };
  const opportunity = getConsultantOpportunity(leadForLogic, healthScore);

  // 6. Generate Persona Narrative (Consultant Voice)
  const userContext = { company_name: userCompany, persona: persona };
  const narrative = generateNarrative(leadForLogic, persona, userContext);

  // 7. Get Legacy Advisor Quote (for owner-facing demos)
  const advisorQuote = getAdvisorQuote(leadForLogic, healthScore);

  return {
    ...lead,
    // Enriched objects
    seo_gaps: enrichedSeoGaps,
    conversion_gaps: enrichedConversionGaps,
    
    // Core Intelligence Metrics
    visibility_health: healthScore,
    health_grade: calculateGrade(healthScore),
    pitch_urgency: pitchUrgency,
    pitch_urgency_label: narrative.pitch_urgency_label || 'Pitch Urgency Score',
    revenue_leak: revenueLeak,
    market_standing: marketStanding,
    
    // Consultant Opportunity Brief
    opportunity_brief: {
      service_to_pitch: opportunity.serviceToPitch,
      pitch_reason: opportunity.pitchReason,
      commercial_impact: opportunity.commercialImpact,
      confidence: opportunity.confidence,
      confidence_reason: opportunity.confidenceReason,
      hook: narrative.hook
    },
    
    // Narrative Narratives
    persona_summary: narrative.executive_summary,
    sales_hooks: narrative.sales_hooks,
    proposal_cta: narrative.cta,
    
    // Legacy support
    advisor_quote: advisorQuote,
    
    // Advisor Labels (Jargon-to-Opportunity Translation)
    advisor_labels: {
      visibility_health: 'Visibility Health',
      pitch_urgency: 'Pitch Urgency',
      loading_friction: 'Revenue Leak Friction',
      mobile_accessibility: 'Mobile Conversion Gap',
      search_hooks: 'Search Capture Potential'
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
