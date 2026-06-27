/**
 * Utility to calculate estimated business metrics for reports.
 * Following LeadSprout Advisor Narrative Engine Implementation Guide.
 */

/**
 * Calculates estimated monthly customer loss based on speed.
 * Section 3 of Advisor Narrative Engine guide.
 */
function calculateRevenueLeak(speedScore, nicheAvgLeads = 20) {
  let lossPercentage = 0.05; // Default 5%
  
  if (speedScore < 40) {
    lossPercentage = 0.40;
  } else if (speedScore < 70) {
    lossPercentage = 0.20;
  }
  
  const lossCount = Math.round(nicheAvgLeads * lossPercentage);
  
  return {
    loss_count: lossCount,
    loss_percentage: Math.round(lossPercentage * 100),
    sentence: `Based on industry benchmarks, your loading friction is likely costing you ${lossCount} potential customers per month.`
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
    // Simple heuristic: Top (100 - (LeadScore/MaxPotential)*100)
    // But let's just do something simple for now
    percentile = Math.max(1, Math.round(100 - ((leadScore - avgVisibility) / (100 - avgVisibility) * 50)));
    standingType = 'top';
  }

  return {
    percentile,
    standing_type: standingType,
    sentence: `Your Visibility Health is in the ${standingType} ${percentile}% of ${location} ${niche}s.`
  };
}

/**
 * Picks the single most critical failure to highlight.
 * Section 1 of Advisor Narrative Engine guide.
 */
function getAdvisorQuote(leadData, overallScore) {
  // 1. Security (SSL)
  // Assuming leadData.details.ssl_present is boolean
  if (leadData.details && leadData.details.ssl_present === false) {
    return "If this were my business, I would resolve the security warnings today. Customers see a 'Not Secure' warning before they even see your brand, which is a massive trust-killer for new leads.";
  }

  // 2. Mobile Accessibility (Responsiveness)
  if (leadData.responsive_status === 'not_responsive' || leadData.responsive_status === 'non-responsive') {
    return "If this were my business, I would prioritize mobile accessibility immediately. Over 60% of your potential customers are searching on their phones, and right now, your site is effectively invisible to them.";
  }

  // 3. Loading Friction (Speed)
  if (leadData.speed_score < 50) {
    return "If this were my business, I would fix the 5+ second loading friction. You are likely paying for marketing that sends customers to a blank screen; most leave after just 3 seconds.";
  }

  // 4. Conversion (No CTA)
  // Checking conversion_gaps for 'No clear Call-To-Action (CTA) buttons found'
  const hasNoCTA = Array.isArray(leadData.conversion_gaps) && 
                   leadData.conversion_gaps.some(g => g.name === 'No clear Call-To-Action (CTA) buttons found' || g === 'No clear Call-To-Action (CTA) buttons found');
  
  if (hasNoCTA) {
    return "If this were my business, I would add a clear 'Call Now' or 'Book Appointment' button. You are getting traffic, but you are making it too hard for customers to actually give you money.";
  }

  // 5. Visibility (SEO Tags)
  const hasMetaGap = Array.isArray(leadData.seo_gaps) && 
                     leadData.seo_gaps.some(g => (g.name || g).includes('Meta') || (g.name || g).includes('Title'));
  
  if (hasMetaGap) {
    return "If this were my business, I would update your 'Search Hooks' (Meta-tags). Right now, your site is invisible to local customers searching for your services because Google doesn't know what you offer.";
  }

  // 6. Healthy Site
  if (overallScore > 90) {
    return "If this were my business, I would focus on 'Competitive Dominance.' Your foundation is excellent—now is the time to invest in content to steal market share from your slower competitors.";
  }

  return "If this were my business, I would keep optimizing the conversion path. You have a solid foundation, and small tweaks now will lead to compounding growth.";
}

module.exports = {
  calculateRevenueLeak,
  calculateMarketStanding,
  getAdvisorQuote
};
