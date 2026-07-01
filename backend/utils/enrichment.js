const { SEO_GAPS, CONVERSION_GAPS } = require('../constants/gap-metadata');
const { 
  calculateRevenueLeak, 
  calculateMarketStanding, 
  getAdvisorQuote,
  getConsultantOpportunity,
  getStrategicHypothesis
} = require('./calculators');
const { generateNarrative } = require('../services/narrativeService');

const { identifyPatterns } = require('./discovery-patterns');

/**
 * Enriches raw lead data with metadata (priority, impact, category).
 * Pivot: Commercial-First reasoning hierarchy.
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
  
  // 2. Identify Discovery Patterns (v4.0)
  const nicheAvgHealth = (nicheBenchmark && nicheBenchmark.avg_seo_score) ? nicheBenchmark.avg_seo_score : 70;
  const matchedPatterns = identifyPatterns(lead, healthScore, nicheAvgHealth);
  const discoveryTags = matchedPatterns.map(p => p.tag);

  // 3. Strategy Hierarchy: TOP-DOWN REASONING
  const leadForLogic = {
    ...lead,
    seo_gaps: enrichedSeoGaps,
    conversion_gaps: enrichedConversionGaps
  };
  
  // 3.1 Get Strategic Hypothesis (The Story)
  let strategy = getStrategicHypothesis(leadForLogic, healthScore);
  
  // If we have discovery patterns, override or augment strategy
  let primaryPattern = null;
  if (matchedPatterns.length > 0) {
    primaryPattern = matchedPatterns[0];
    strategy = {
      ...strategy,
      opportunity: {
        pattern_id: primaryPattern.id,
        name: primaryPattern.name,
        service_to_pitch: primaryPattern.service,
        impact_summary: primaryPattern.hook
      }
    };
  }

  // 3.2 Calculate Revenue Leak & Market Standing (Proof Points)
  const revenueLeak = calculateRevenueLeak(lead.speed_score, lead.niche);
  const marketStanding = calculateMarketStanding(healthScore, lead.niche, lead.location ? lead.location.split(',')[0] : 'Austin');

  // 4. Generate Persona Narrative (Consultant Voice)
  const userContext = { company_name: userCompany, persona: persona };
  const narrative = generateNarrative(leadForLogic, persona, userContext);

  // 5. Get Legacy Advisor Quote (for owner-facing demos)
  const advisorQuote = getAdvisorQuote(leadForLogic, healthScore);

  return {
    ...lead,
    discovery_tags: discoveryTags,
    discovery_patterns: matchedPatterns,
    
    // Enriched objects
    seo_gaps: enrichedSeoGaps,
    conversion_gaps: enrichedConversionGaps,
    
    // TOP-DOWN REASONING OBJECT (Hierarchy reflected here)
    strategy_report: {
      discovery_hierarchy: {
        business_type: lead.niche || 'General',
        commercial_behaviour: primaryPattern ? primaryPattern.behaviour : strategy.business_profile.growth_model,
        opportunity_pattern: primaryPattern ? primaryPattern.name : strategy.opportunity.service_to_pitch,
        evidence: strategy.supporting_evidence
      },
      business_profile: strategy.business_profile,
      business_behaviour: strategy.business_profile.growth_model,
      hidden_ceiling: strategy.commercial_hypothesis.hidden_ceiling,
      commercial_impact: strategy.commercial_hypothesis.commercial_impact,
      opportunity: strategy.opportunity,
      supporting_proof: strategy.supporting_evidence
    },

    // Supporting Proof Details
    visibility_health: healthScore,
    health_grade: calculateGrade(healthScore),
    pitch_urgency: 100 - healthScore,
    revenue_leak: revenueLeak,
    market_standing: marketStanding,
    
    // Consultant Opportunity Brief
    opportunity_brief: {
      service_to_pitch: strategy.opportunity.service_to_pitch,
      pitch_reason: strategy.opportunity.impact_summary,
      commercial_impact: strategy.commercial_hypothesis.commercial_impact,
      hook: narrative.hook,
      pattern_id: strategy.opportunity.pattern_id,
      discovery_tag: discoveryTags.length > 0 ? discoveryTags[0] : null
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
