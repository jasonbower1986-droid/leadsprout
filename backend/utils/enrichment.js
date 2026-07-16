const { SEO_GAPS, CONVERSION_GAPS } = require('../constants/gap-metadata');
const { 
  calculateRevenueLeak, 
  calculateSimpleRevenueLeak,
  calculateMarketStanding, 
  getAdvisorQuote,
  getConsultantOpportunity,
  getStrategicHypothesis
} = require('./calculators');
const { generateNarrative } = require('../services/narrativeService');
const { identifyPatterns } = require('./discovery-patterns');
const { classifyContext, getContextSummary } = require('./classifier');
const { discernPatterns, inductiveConclusion } = require('./reasoning-matrix');
const { investigate } = require('./v5/investigation');
const { generateGrowthRoadmap } = require('./constraint-chain');
const { validateEvidence } = require('./evidence-validator');
const { reconstructEvidence } = require('./evidence-state');
const { canPerformCommercialAssessment } = require('./evidence-authorisation');

/**
 * Evidence Integrity Guard
 * Prevents Commercial Intelligence from running on unvalidated evidence.
 * This is the pre-Commercial Intelligence validation boundary.
 */
function assertValidEvidence(lead) {
  // Gate 002: Reconstruct evidence state from persisted evidence_state before checking
  if (lead.evidence_state && !lead._evidence) {
    const reconstructed = reconstructEvidence(lead.evidence_state);
    if (reconstructed) {
      lead._evidence = reconstructed;
    }
  }

  // Check for explicit evidence failure markers
  if (lead._evidence) {
    if (lead._evidence.retrievalFailure || lead._evidence.failureType) {
      return {
        valid: false,
        reason: lead._evidence.failureReason || 'Evidence validation failed',
        failureType: lead._evidence.failureType || 'retrieval_failure'
      };
    }
    // Also respect _evidence.validation.valid === false if present
    if (lead._evidence.validation && lead._evidence.validation.valid === false) {
      return {
        valid: false,
        reason: lead._evidence.validation.failureReason || 'Evidence validation failed during scraping',
        failureType: lead._evidence.validation.evidenceFailure || 'validation_failure'
      };
    }
    if (lead.evidence_state && lead._evidence.authorisationValidation && !lead._evidence.authorisationValidation.valid) {
      return {
        valid: false,
        reason: `Persisted Evidence Authorisation is incomplete or incompatible: ${lead._evidence.authorisationValidation.errors.join(', ')}`,
        failureType: 'invalid_evidence_authorisation'
      };
    }
    if (lead._evidence.authorisation && !canPerformCommercialAssessment(lead._evidence.authorisation)) {
      return {
        valid: false,
        reason: 'Canonical Evidence Authorisation does not permit downstream commercial assessment.',
        failureType: 'evidence_authorisation_denied'
      };
    }
    return { valid: true };
  }

  // Persisted legacy records must be reassessed; a legacy validation state is
  // not silently promoted to canonical downstream authority.
  if (Object.prototype.hasOwnProperty.call(lead, 'evidence_state') && !lead.evidence_state) {
    return {
      valid: false,
      reason: 'Persisted lead has no canonical Evidence Authorisation contract and requires reassessment.',
      failureType: 'evidence_reassessment_required'
    };
  }
  
  // Check for synthetic audit indicators
  // generateMockAudit produced details with exact fields:
  // { total_images: 12, missing_alt_count: 3, h1_count: 0, title: null, description: null }
  const details = lead.details || {};
  if (details.fallback_active === true || details.fallback_reason) {
    return {
      valid: false,
      reason: 'Synthetic/mock audit data detected. Commercial Intelligence must not reason from fabricated evidence.',
      failureType: 'synthetic_audit_data'
    };
  }
  
  // Check for status-code-based failures (e.g., 403, 404 saved from previous runs)
  if (details.status_code !== undefined && details.status_code !== null) {
    const sc = Number(details.status_code);
    if (sc === 403 || sc === 401 || sc === 404 || sc === 451) {
      return {
        valid: false,
        reason: `HTTP ${sc}: Access denied or page not found. Commercial Intelligence must not reason from blocked content.`,
        failureType: 'access_denied'
      };
    }
    // Other error statuses (5xx)
    if (sc >= 500) {
      return {
        valid: false,
        reason: `HTTP ${sc}: Server error. No valid business content available for Commercial Intelligence.`,
        failureType: 'retrieval_failure'
      };
    }
  }
  
  return { valid: true };
}

/**
 * Enriches raw lead data with metadata (priority, impact, category).
 * Pivot: Commercial-First reasoning hierarchy.
 * v5.2: Adds Context Classification, Weighted Reasoning, Devil's Advocate,
 * Constraint Chain Simulation, and Growth Roadmap.
 */
function enrichLeadData(lead, nicheBenchmark = null, persona = 'web_agency', userCompany = 'LeadSprout') {
  // Preserve the established API response contract on every execution path,
  // including an authorised fail-closed return before commercial enrichment.
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

  lead = {
    ...lead,
    seo_gaps: Array.isArray(seoGaps) ? seoGaps : [],
    conversion_gaps: Array.isArray(conversionGaps) ? conversionGaps : []
  };

  // Evidence Integrity Guard: Prevent Commercial Intelligence from reasoning on invalid evidence
  const evidenceCheck = assertValidEvidence(lead);
  if (!evidenceCheck.valid) {
    console.warn(`[EvidenceGuard] Skipping Commercial Intelligence: ${evidenceCheck.reason}`);
    return {
      ...lead,
      evidence_authorisation: lead._evidence?.authorisation || null,
      _evidenceFailure: evidenceCheck.failureType,
      _evidenceFailureReason: evidenceCheck.reason,
      discovery_tags: [],
      discovery_patterns: [],
      commercial_context: null,
      strategy_report: null,
      revenue_leak: null,
      growth_roadmap: [],
      opportunity_brief: null,
      visibility_health: null,
      health_grade: null,
      pitch_urgency: 0
    };
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
  
  // 2. Context Classification (v5.2)
  const leadForClassification = {
    ...lead,
    seo_gaps: enrichedSeoGaps,
    conversion_gaps: enrichedConversionGaps
  };
  const context = classifyContext(leadForClassification);
  const contextSummary = getContextSummary(context);

  // 3. Identify Discovery Patterns (v4.0) + Weighted Reasoning (v5.2)
  const nicheAvgHealth = (nicheBenchmark && nicheBenchmark.avg_seo_score) ? nicheBenchmark.avg_seo_score : 70;
  
  // v5.2 Discernment Pipeline
  const discernment = discernPatterns(
    leadForClassification, 
    healthScore, 
    nicheAvgHealth,
    context
  );
  
  const matchedPatterns = discernment.matchedPatterns;
  const discoveryTags = matchedPatterns.map(p => p.tag);
  const primaryBreakthrough = discernment.primaryBreakthrough;

  // v5.3 Investigation: independent severity evaluation
  const investigationReport = investigate(
    leadForClassification,
    context?.transactionModel || 'Hybrid'
  );

  // v5.3 Inductive Conclusion: severity-driven bottleneck selection
  const inductiveResult = inductiveConclusion(investigationReport, context);

  // 4. Strategy Hierarchy: TOP-DOWN REASONING
  const leadForLogic = {
    ...lead,
    seo_gaps: enrichedSeoGaps,
    conversion_gaps: enrichedConversionGaps
  };
  
  // 4.1 Get Strategic Hypothesis (The Story)
  let strategy = getStrategicHypothesis(leadForLogic, healthScore);
  
  // If we have a primary breakthrough, override strategy with v5.2 reasoning
  let primaryPattern = null;
  if (primaryBreakthrough) {
    primaryPattern = primaryBreakthrough.pattern;
    strategy = {
      ...strategy,
      opportunity: {
        pattern_id: primaryPattern.id,
        name: primaryPattern.name,
        service_to_pitch: primaryPattern.service,
        impact_summary: primaryPattern.hook,
        commercial_weight: primaryBreakthrough.score,
        multiplier: primaryBreakthrough.multiplier
      }
    };
  } else if (matchedPatterns.length > 0) {
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

  // 4.2 Calculate Revenue Leak (v5.3 Confidence-Gated) & Market Standing (Proof Points)
  const revenueLeak = calculateRevenueLeak(lead, context, investigationReport, inductiveResult);
  const marketStanding = calculateMarketStanding(healthScore, lead.niche, lead.location ? lead.location.split(',')[0] : 'Austin');

  // 5. Generate Growth Roadmap (v5.2 Constraint Chain)
  const growthRoadmap = generateGrowthRoadmap(leadForClassification, context);

  // 6. Generate Persona Narrative (Consultant Voice)
  // v5.3: Attach pre-calculated context and report data to leadForLogic to prevent duplicate calculations
  leadForLogic.commercial_context = {
    scale: contextSummary.scale,
    maturity: contextSummary.maturity,
    transactionModel: contextSummary.transactionModel,
    raw: context
  };
  leadForLogic.discernment = discernment;
  leadForLogic.growth_roadmap = growthRoadmap;
  leadForLogic.investigation = investigationReport;
  leadForLogic.revenue_leak = revenueLeak;
  leadForLogic.market_standing = marketStanding;
  leadForLogic.visibility_health = healthScore;
  leadForLogic.primary_breakthrough = primaryBreakthrough;

  const userContext = { company_name: userCompany, persona: persona };
  const narrative = generateNarrative(leadForLogic, persona, userContext);

  // 7. Get Legacy Advisor Quote (for owner-facing demos)
  const advisorQuote = getAdvisorQuote(leadForLogic, healthScore);

  return {
    ...lead,
    evidence_authorisation: lead._evidence?.authorisation || null,
    discovery_tags: discoveryTags,
    discovery_patterns: matchedPatterns,
    
    // v5.2 Context Classification
    commercial_context: {
      scale: contextSummary.scale,
      maturity: contextSummary.maturity,
      transactionModel: contextSummary.transactionModel,
      raw: context
    },
    
    // v5.2 Discernment Details
    discernment: {
      primaryBreakthrough: primaryBreakthrough ? {
        tag: primaryBreakthrough.pattern.tag,
        score: primaryBreakthrough.score,
        multiplier: primaryBreakthrough.multiplier,
        hook: primaryBreakthrough.pattern.hook,
        service: primaryBreakthrough.pattern.service
      } : null,
      devilsAdvocate: discernment.devilsAdvocate,
      scoredPatterns: discernment.scoredPatterns ? discernment.scoredPatterns.slice(0, 5) : []
    },

    // Enriched objects
    seo_gaps: enrichedSeoGaps,
    conversion_gaps: enrichedConversionGaps,

    // v5.3 Investigation (independent diagnostic severity)
    investigation: {
      dimensions: investigationReport.dimensions,
      overall: investigationReport.overall,
      scoredForModel: investigationReport.scoredForModel
    },

    // v5.3 Inductive Conclusion (severity-driven bottleneck)
    inductive_conclusion: {
      primaryBottleneck: inductiveResult.primaryBottleneck,
      conclusion: inductiveResult.conclusion,
      patternLabel: inductiveResult.patternLabel,
      dimensionScores: inductiveResult.dimensionScores
    },

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
    
    // v5.2 Growth Roadmap (Constraint Chain Output)
    growth_roadmap: growthRoadmap,
    
    // v5.3 Investigation Report (4-dimension weighted severity)
    investigation: investigationReport,
    
    // Consultant Opportunity Brief
    opportunity_brief: {
      service_to_pitch: strategy.opportunity.service_to_pitch,
      pitch_reason: strategy.opportunity.impact_summary,
      commercial_impact: strategy.commercial_hypothesis.commercial_impact,
      hook: narrative.hook,
      pattern_id: strategy.opportunity.pattern_id,
      discovery_tag: discoveryTags.length > 0 ? discoveryTags[0] : null,
      commercial_weight: strategy.opportunity.commercial_weight || null
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
  finalScore -= Math.min(20, (highImpactSeoGaps * 10));
  
  // Conversion (20)
  const highImpactConvGaps = conversionGaps.filter(g => g.impact === 'High').length;
  finalScore -= Math.min(20, (highImpactConvGaps * 10));

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
  calculateGrade,
  assertValidEvidence
};
