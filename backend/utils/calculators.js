/**
 * Utility to calculate estimated business metrics for reports.
 * Following LeadSprout Advisor Narrative Engine Implementation Guide.
 */

const NICHE_BENCHMARKS = {
  'Dentist': { ltv: 2500, convRate: 0.15, avgMonthlyLeads: 30 },
  'Plumbing': { ltv: 800, convRate: 0.25, avgMonthlyLeads: 50 },
  'HVAC': { ltv: 1200, convRate: 0.20, avgMonthlyLeads: 40 },
  'Legal': { ltv: 5000, convRate: 0.10, avgMonthlyLeads: 25 },
  'Roofing': { ltv: 8000, convRate: 0.08, avgMonthlyLeads: 20 },
  'Healthcare': { ltv: 1500, convRate: 0.12, avgMonthlyLeads: 35 },
  'Marketing Agency': { ltv: 10000, convRate: 0.05, avgMonthlyLeads: 15 },
  'Tech Startup': { ltv: 12000, convRate: 0.03, avgMonthlyLeads: 10 },
  'General': { ltv: 1000, convRate: 0.10, avgMonthlyLeads: 20 }
};

/**
 * v5.3 Confidence-Gated Revenue Leak Estimator
 *
 * Determines traffic volumes from Scale and Maturity, conversion losses
 * from Primary Bottleneck severity, and applies a strict 40% confidence gate.
 */

// Monthly traffic estimates based on Scale + Maturity
const TRAFFIC_ESTIMATES = {
  'Solo_Neglected': { avgMonthlyLeads: 10, confidenceBoost: 0.6 },
  'Solo_Active Marketer': { avgMonthlyLeads: 20, confidenceBoost: 0.7 },
  'Solo_Digital Leader': { avgMonthlyLeads: 30, confidenceBoost: 0.8 },
  'Mid-Market_Neglected': { avgMonthlyLeads: 25, confidenceBoost: 0.7 },
  'Mid-Market_Active Marketer': { avgMonthlyLeads: 50, confidenceBoost: 0.8 },
  'Mid-Market_Digital Leader': { avgMonthlyLeads: 80, confidenceBoost: 0.9 },
  'Enterprise_Neglected': { avgMonthlyLeads: 60, confidenceBoost: 0.8 },
  'Enterprise_Active Marketer': { avgMonthlyLeads: 120, confidenceBoost: 0.9 },
  'Enterprise_Digital Leader': { avgMonthlyLeads: 200, confidenceBoost: 1.0 }
};

/**
 * Calculate Evidence Confidence Score (0-100%) based on data completeness.
 */
function calculateEvidenceConfidence(lead, investigationReport) {
  let score = 0;
  const signals = [];

  // Speed data — high confidence signal
  if (lead.speed_score !== undefined && lead.speed_score !== null) {
    score += 25;
    signals.push('speed_measured');
  }

  // Responsive status
  if (lead.responsive_status) {
    score += 15;
    signals.push('responsive_tested');
  }

  // Trackers found — indicates real scraping
  const trackers = Array.isArray(lead.trackers_found) ? lead.trackers_found : [];
  if (trackers.length > 0) {
    score += 15;
    signals.push('trackers_detected');
  }

  // SEO gaps — indicates thorough scan
  const seoGaps = Array.isArray(lead.seo_gaps) ? lead.seo_gaps : [];
  if (seoGaps.length > 0) {
    score += 15;
    signals.push('seo_scanned');
  }

  // Conversion gaps
  const convGaps = Array.isArray(lead.conversion_gaps) ? lead.conversion_gaps : [];
  if (convGaps.length > 0) {
    score += 10;
    signals.push('conversion_scanned');
  }

  // Investigation report validated
  if (investigationReport && investigationReport.dimensions) {
    score += 10;
    signals.push('investigation_complete');
  }

  // Verified emails — highest confidence
  const emails = Array.isArray(lead.verified_emails) ? lead.verified_emails : [];
  if (emails.length > 0) {
    score += 10;
    signals.push('emails_verified');
  }

  return {
    score: Math.min(100, score),
    signals,
    isReliable: score >= 40
  };
}

/**
 * v5.3 Confidence-Gated Revenue Leak Estimator.
 *
 * @param {Object} lead - Lead object with speed_score, niche, etc.
 * @param {Object} context - Classified context (scale, maturity)
 * @param {Object} investigationReport - Result from investigate()
 * @param {Object} inductiveResult - Result from inductiveConclusion()
 * @returns {Object|null} Revenue leak with confidence gate
 */
function calculateRevenueLeak(lead, context = null, investigationReport = null, inductiveResult = null) {
  const confidence = calculateEvidenceConfidence(lead, investigationReport);

  // Strict 40% confidence gate
  if (!confidence.isReliable) {
    const nicheKnown = lead.niche && lead.niche !== 'General';
    return {
      revenue_leak: null,
      confidence: confidence.score,
      explanation: nicheKnown
        ? `Insufficient scan data (${confidence.score}% confidence) for a reliable revenue estimate. A complete site audit is needed.`
        : `Limited data available (${confidence.score}% confidence). Niche and technical signals are both required for a meaningful revenue projection.`,
      isGated: true
    };
  }

  // Determine traffic volume from Scale + Maturity
  const scale = context?.scale || 'Solo';
  const maturity = context?.maturity || 'Neglected';
  const trafficKey = `${scale}_${maturity}`;
  const traffic = TRAFFIC_ESTIMATES[trafficKey] || TRAFFIC_ESTIMATES['Solo_Neglected'];

  // Determine loss percentage from primary bottleneck severity
  const severity = inductiveResult?.primaryBottleneck?.severity || 0;
  let lossPercentage = 0.05;
  if (severity >= 8) {
    lossPercentage = 0.40;
  } else if (severity >= 5) {
    lossPercentage = 0.25;
  } else if (severity >= 3) {
    lossPercentage = 0.10;
  }

  // Get niche benchmark for LTV
  const benchmark = NICHE_BENCHMARKS[lead.niche] || NICHE_BENCHMARKS['General'];
  // Use traffic estimate × niche confidence factor
  const effectiveLeads = Math.round(traffic.avgMonthlyLeads * benchmark.convRate);
  const lossCount = Math.max(1, Math.round(effectiveLeads * lossPercentage));
  const monthlyRevenueLeak = Math.round(lossCount * benchmark.ltv);

  return {
    revenue_leak: {
      loss_count: lossCount,
      loss_percentage: Math.round(lossPercentage * 100),
      monthly_revenue_leak: monthlyRevenueLeak,
      formatted_leak: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(monthlyRevenueLeak),
      sentence: `Based on ${lead.niche || 'industry'} benchmarks and your site's current technical condition, this friction is likely costing ~${lossCount} conversions and ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(monthlyRevenueLeak)} in revenue every month.`
    },
    confidence: confidence.score,
    confidenceDetails: {
      signals: confidence.signals,
      trafficSource: `${scale} / ${maturity}`,
      estimatedMonthlyLeads: traffic.avgMonthlyLeads,
      primarySeverity: severity,
      lossPercentage
    },
    isGated: false
  };
}

/**
 * Legacy simple revenue leak calculator (for backward compatibility).
 * Only used when the full confidence-gated pipeline is not available.
 */
function calculateSimpleRevenueLeak(speedScore, niche = 'General') {
  const benchmark = NICHE_BENCHMARKS[niche] || NICHE_BENCHMARKS['General'];
  let lossPercentage = 0.05;
  if (speedScore < 40) {
    lossPercentage = 0.40;
  } else if (speedScore < 70) {
    lossPercentage = 0.20;
  }
  const lossCount = Math.round(benchmark.avgMonthlyLeads * lossPercentage);
  const monthlyRevenueLeak = Math.round(lossCount * benchmark.ltv);
  return {
    loss_count: lossCount,
    loss_percentage: Math.round(lossPercentage * 100),
    monthly_revenue_leak: monthlyRevenueLeak,
    formatted_leak: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(monthlyRevenueLeak),
    sentence: `Based on ${niche} industry benchmarks, this technical friction is likely costing the business ~${lossCount} customers and ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(monthlyRevenueLeak)} in revenue every month.`
  };
}

/**
 * Calculates market standing percentile.
 * Section 4 of Advisor Narrative Engine guide.
 */
function calculateMarketStanding(leadScore, niche, location = 'Austin') {
  const averages = {
    'Dentist': { visibility: 72, speed: 65 },
    'Plumbing': { visibility: 68, speed: 60 },
    'HVAC': { visibility: 70, speed: 62 },
    'Legal': { visibility: 85, speed: 75 },
    'Healthcare': { visibility: 80, speed: 70 },
    'Marketing Agency': { visibility: 85, speed: 78 },
    'Tech Startup': { visibility: 82, speed: 80 },
    'General': { visibility: 70, speed: 65 }
  };

  const avg = averages[niche] || averages['General'];
  const avgVisibility = avg.visibility;
  
  let percentile;
  let standingType;

  if (leadScore < avgVisibility) {
    percentile = Math.min(49, Math.round((leadScore / avgVisibility) * 100));
    standingType = 'bottom';
  } else {
    // If better than average, calculate "Top X%"
    percentile = Math.max(1, Math.round(100 - ((leadScore - avgVisibility) / (100 - avgVisibility) * 50)));
    standingType = 'top';
  }

  return {
    percentile,
    standing_type: standingType,
    sentence: `Your Visibility Health is in the ${standingType} ${percentile}% of local ${niche} sites.`
  };
}

/**
 * Identifies the best service to pitch based on technical gaps.
 * Aligns with LeadSprout Audience & Intelligence Constitution.
 */
function getConsultantOpportunity(leadData, healthScore) {
  const seoGaps = Array.isArray(leadData.seo_gaps) ? leadData.seo_gaps : [];
  const convGaps = Array.isArray(leadData.conversion_gaps) ? leadData.conversion_gaps : [];
  const speed = leadData.speed_score || 0;
  const isNotResponsive = leadData.responsive_status === 'not_responsive' || leadData.responsive_status === 'non-responsive';
  const niche = leadData.niche || 'General';

  // 1. Security/SSL (Highest Urgency)
  if (leadData.details && (leadData.details.ssl_present === false || leadData.details.ssl_status === 'missing')) {
    return {
      serviceToPitch: "Security & Trust Recovery",
      pitchReason: "Lead with Trust: Missing SSL is a major red flag that kills conversions before they happen.",
      commercialImpact: "Restoring visitor trust and preventing 'Not Secure' browser warnings from driving away 90% of traffic.",
      confidence: "High",
      confidenceReason: "Verified: Critical security failure detected."
    };
  }

  // 2. Mobile Conversion (High Urgency)
  if (isNotResponsive) {
    return {
      serviceToPitch: "Mobile Conversion Design",
      pitchReason: "Lead with Accessibility: Over 60% of local searchers cannot navigate this site effectively.",
      commercialImpact: "Capturing the majority of local mobile search traffic that is currently being lost to competitors.",
      confidence: "High",
      confidenceReason: "Verified: Mobile rendering failure confirmed."
    };
  }

  // 3. Speed/Performance (Revenue Leak)
  if (speed < 50) {
    const leak = calculateSimpleRevenueLeak(speed, niche);
    return {
      serviceToPitch: "Performance Optimization",
      pitchReason: `Lead with ROI: High loading friction is causing a ${leak.loss_percentage}% revenue leak.`,
      commercialImpact: `Stopping the monthly drain of ~${leak.loss_count} customers (est. ${leak.formatted_leak}/mo) caused by friction.`,
      confidence: "High",
      confidenceReason: `Measured: Performance score is in the bottom quartile.`
    };
  }

  // 4. CRO (Lead Capture)
  const hasNoCTA = convGaps.some(g => {
    const name = typeof g === 'object' ? g.name : g;
    return name.includes('CTA') || name.includes('Call-To-Action') || name.includes('Phone') || name.includes('Contact');
  });
  if (hasNoCTA) {
    return {
      serviceToPitch: "CRO & Lead Capture",
      pitchReason: "Lead with Efficiency: The site has traffic but no clear mechanism to turn visitors into callers.",
      commercialImpact: "Doubling the effective ROI of current traffic by removing the friction to contact the business.",
      confidence: "Medium",
      confidenceReason: "Projected: Heuristic analysis suggests capture friction."
    };
  }

  // 5. Technical SEO (Visibility)
  if (seoGaps.length > 0 || healthScore < 70) {
    return {
      serviceToPitch: "Search Visibility Audit",
      pitchReason: "Lead with Discovery: Technical SEO gaps are making the business invisible to local searchers.",
      commercialImpact: "Ensuring the business appears in the 'Map Pack' and organic results for high-intent local keywords.",
      confidence: "Medium",
      confidenceReason: "Projected: Technical gaps detected in search hooks."
    };
  }

  // 6. Maintenance/Growth (Low Urgency)
  return {
    serviceToPitch: "Competitive Edge & Content Strategy",
    pitchReason: "Lead with Dominance: The foundation is strong; now is the time to outpace the local competition.",
    commercialImpact: "Scaling market share by leveraging a superior technical foundation to dominate search and UX.",
    confidence: "Medium",
    confidenceReason: "Strategic: Identified as high-growth potential."
  };
}

/**
 * Picks the single most critical failure to highlight for the BUSINESS OWNER.
 * (Legacy/Demo support)
 */
function getAdvisorQuote(leadData, overallScore) {
  // Existing logic remains for owner-facing reports
  const details = leadData.details || {};
  if (details.ssl_present === false || details.ssl_status === 'missing') {
    return "If this were my business, I would resolve the security warnings today. Especially in professional services, trust is your most valuable asset.";
  }
  if (leadData.responsive_status === 'not_responsive' || leadData.responsive_status === 'non-responsive') {
    return "If this were my business, I would prioritize mobile accessibility immediately. Over 60% of local searches happen on phones.";
  }
  if (leadData.speed_score < 50) {
    return "If this were my business, I would fix the loading friction immediately. Most customers are searching in a 'need it now' mindset.";
  }
  const hasNoCTA = Array.isArray(leadData.conversion_gaps) && leadData.conversion_gaps.some(g => {
    const name = typeof g === 'object' ? g.name : g;
    return name.includes('CTA') || name.includes('Call-To-Action') || name.includes('Phone') || name.includes('Contact');
  });
  if (hasNoCTA) {
    return "If this were my business, I would make your contact information impossible to miss. You're making it too hard for customers to hire you.";
  }
  if (overallScore < 70) {
    return "If this were my business, I would update your 'Search Hooks' (Meta-tags). Right now, your site is invisible to local customers.";
  }
  return "If this were my business, I would focus on 'Competitive Dominance.' Your foundation is excellent—now is the time to invest in aggressive growth.";
}

/**
 * Generates a top-down strategic hypothesis based on the LeadSprout Constitution.
 * 
 * Hierarchy: 
 * 1. Business Profile
 * 2. Business Behaviour
 * 3. The Hidden Ceiling
 * 4. The Opportunity
 * 5. Supporting Evidence
 */
function getStrategicHypothesis(leadData, healthScore) {
  const niche = leadData.niche || 'General';
  const speed = leadData.speed_score || 0;
  const isNotResponsive = leadData.responsive_status === 'not_responsive' || leadData.responsive_status === 'non-responsive';
  const seoGaps = Array.isArray(leadData.seo_gaps) ? leadData.seo_gaps : [];
  const convGaps = Array.isArray(leadData.conversion_gaps) ? leadData.conversion_gaps : [];

  // 1. Business Profile & Behaviour
  const transactional_niches = ['Retail / Florist', 'Beauty / Wellness', 'Catering & Events'];
  const profile = {
    category: niche,
    growth_model: transactional_niches.includes(niche) ? 'Transactional / Direct Sales' : 'Lead Generation / Appointment Based'
  };

  // 2. Hidden Ceiling & Opportunity Logic
  let ceiling = {
    pain: 'Generic Visibility Barrier',
    commercial_impact: 'The business is likely struggling to be found by high-intent local searchers.',
    opportunity: 'Search Visibility Audit'
  };

  // Prioritize Pain Hierarchy
  if (leadData.details && (leadData.details.ssl_present === false || leadData.details.ssl_status === 'missing')) {
    ceiling = {
      pain: 'Trust Deficit & Security Barrier',
      commercial_impact: 'Browser security warnings are likely killing 90% of lead trust before the page even loads.',
      opportunity: 'Security & Trust Recovery'
    };
  } else if (isNotResponsive) {
    ceiling = {
      pain: 'Mobile Accessibility Wall',
      commercial_impact: 'Over 60% of local search traffic is likely bouncing due to an unusable mobile experience.',
      opportunity: 'Mobile Conversion Design'
    };
  } else if (speed < 50) {
    ceiling = {
      pain: 'The Leaky Performance Bucket',
      commercial_impact: 'High loading friction is causing a significant revenue leak, causing prospects to abandon the site for faster competitors.',
      opportunity: 'Performance Optimization'
    };
  } else if (convGaps.length > 0) {
    ceiling = {
      pain: 'Friction-Heavy Funnel',
      commercial_impact: 'The business is successfully attracting visitors, but is failing to convert them into calls or appointments.',
      opportunity: 'CRO & Lead Capture'
    };
  }

  // 3. Supporting Evidence (Mapping technical findings to the hypothesis)
  const evidence = [];
  if (leadData.screenshot_path) {
    evidence.push('Verified Visual Breakdown (Screenshot Attached)');
  }
  if (leadData.details && (leadData.details.ssl_present === false || leadData.details.ssl_status === 'missing')) {
    evidence.push('Missing SSL Certificate (Verified)');
  }
  if (isNotResponsive) {
    evidence.push('Non-responsive Mobile Layout (Verified)');
  }
  if (speed < 50) {
    evidence.push(`Critical Performance Score: ${speed}/100 (Measured)`);
  }
  if (seoGaps.length > 0) {
    evidence.push(`${seoGaps.length} Technical SEO Gaps detected (e.g., ${typeof seoGaps[0] === 'object' ? seoGaps[0].name : seoGaps[0]})`);
  }

  return {
    business_profile: profile,
    commercial_hypothesis: {
      hidden_ceiling: ceiling.pain,
      commercial_impact: ceiling.commercial_impact,
      probability: healthScore < 50 ? 'High' : 'Medium'
    },
    opportunity: {
      service_to_pitch: ceiling.opportunity,
      impact_summary: ceiling.commercial_impact
    },
    supporting_evidence: evidence
  };
}

module.exports = {
  calculateRevenueLeak,
  calculateSimpleRevenueLeak,
  calculateEvidenceConfidence,
  calculateMarketStanding,
  getAdvisorQuote,
  getConsultantOpportunity,
  getStrategicHypothesis
};
