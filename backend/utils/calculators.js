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
 * Calculates estimated monthly customer loss based on speed.
 * Section 3 of Advisor Narrative Engine guide.
 */
function calculateRevenueLeak(speedScore, niche = 'General') {
  const benchmark = NICHE_BENCHMARKS[niche] || NICHE_BENCHMARKS['General'];
  let lossPercentage = 0.05; // Default 5%
  
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
    const leak = calculateRevenueLeak(speed, niche);
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

module.exports = {
  calculateRevenueLeak,
  calculateMarketStanding,
  getAdvisorQuote,
  getConsultantOpportunity
};
