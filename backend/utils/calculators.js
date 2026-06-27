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
 * Picks the single most critical failure to highlight.
 * Section 1 of Advisor Narrative Engine guide (Updated priorities).
 */
function getAdvisorQuote(leadData, overallScore) {
  const details = leadData.details || {};
  
  // 1. Security (SSL)
  if (details.ssl_present === false || details.ssl_status === 'missing') {
    return "If this were my business, I would resolve the security warnings today. Especially in professional services, trust is your most valuable asset. A 'Not Secure' warning can drive away high-value leads before they even see your brand.";
  }

  // 2. Mobile Accessibility (Responsiveness)
  if (leadData.responsive_status === 'not_responsive' || leadData.responsive_status === 'non-responsive') {
    return "If this were my business, I would prioritize mobile accessibility immediately. Over 60% of local searches happen on phones. Right now, you are effectively invisible to the majority of your market.";
  }

  // 3. High Loading Friction (Speed < 50)
  if (leadData.speed_score < 50) {
    return "If this were my business, I would fix the 5+ second loading friction immediately. Most customers are searching in a 'need it now' mindset—if your site doesn't load instantly, they will click the next competitor on the list.";
  }

  // 4. Missing Contact Info
  // We assume these flags are passed in details or checked from gaps
  const hasContactGap = Array.isArray(leadData.conversion_gaps) && 
                       leadData.conversion_gaps.some(g => {
                         const name = typeof g === 'object' ? g.name : g;
                         return name.includes('Phone') || name.includes('Email') || name.includes('Contact');
                       });
  if (hasContactGap || details.no_phone || details.no_email) {
    return "If this were my business, I would make your contact information impossible to miss. You have a digital presence, but you're making it too hard for customers to actually hire you. A prominent 'Call Now' button is your fastest win.";
  }

  // 5. Conversion Leak (No CTA)
  const hasNoCTA = Array.isArray(leadData.conversion_gaps) && 
                   leadData.conversion_gaps.some(g => {
                     const name = typeof g === 'object' ? g.name : g;
                     return name.includes('CTA') || name.includes('Call-To-Action');
                   });
  if (hasNoCTA || details.no_cta_found) {
    return "If this were my business, I would add a clear 'Call Now' or 'Book Appointment' button. You are successfully getting traffic, but you're making it far too difficult for customers to actually give you money.";
  }

  // 6. Moderate Loading Friction (Speed 50-70)
  if (leadData.speed_score >= 50 && leadData.speed_score < 70) {
    return "If this were my business, I would optimize the 'Loading Friction.' Your site isn't in the 'danger zone' yet, but you are likely losing 1 out of every 5 visitors to a sluggish experience that your competitors have already solved.";
  }

  // 7. Visibility Gap (SEO Tags)
  const hasMetaGap = Array.isArray(leadData.seo_gaps) && 
                     leadData.seo_gaps.some(g => {
                       const name = typeof g === 'object' ? g.name : g;
                       return name.includes('Meta') || name.includes('Title') || name.includes('Description');
                     });
  if (hasMetaGap || details.meta_tags_missing) {
    return "If this were my business, I would update your 'Search Hooks' (Meta-tags). Right now, your site is invisible to local customers searching for your services because Google doesn't know exactly what you offer.";
  }

  // 8. Authority Gap (Schema / Social Proof)
  const hasAuthorityGap = Array.isArray(leadData.seo_gaps) && 
                          leadData.seo_gaps.some(g => {
                            const name = typeof g === 'object' ? g.name : g;
                            return name.includes('Schema') || name.includes('Social') || name.includes('Proof');
                          });
  if (hasAuthorityGap || details.schema_missing || details.no_social_links) {
    return "If this were my business, I would focus on 'Authority Indicators.' Your foundation is strong, but you're missing the final 10% (like Schema or Social Proof) that signals to Google and customers that you are the #1 choice in your area.";
  }

  // 9. Healthy Site
  if (overallScore > 90) {
    return "If this were my business, I would focus on 'Competitive Dominance.' Your foundation is excellent—now is the time to invest in aggressive content to steal market share from your slower competitors.";
  }

  return "If this were my business, I would keep optimizing the conversion path. You have a solid foundation, and small tweaks now will lead to compounding growth.";
}

/**
 * Generates a persona-specific summary narrative.
 * Section 1 of persona_narratives.md.
 */
function getPersonaSummary(leadData, persona, userCompany = 'LeadSprout', healthScore, revenueLeak, marketStanding) {
  const businessName = leadData.business_name || leadData.domain;
  const agencyName = userCompany;
  const speedScore = leadData.speed_score || 0;
  const lossPercent = revenueLeak.loss_percentage;
  const bottomPercentile = marketStanding.percentile;
  
  // Extract specific gaps for templates
  let seoGaps = [];
  try {
    seoGaps = Array.isArray(leadData.seo_gaps) ? leadData.seo_gaps : JSON.parse(leadData.seo_gaps);
  } catch (e) {
    seoGaps = [];
  }
  const firstSeoGap = seoGaps.length > 0 ? (typeof seoGaps[0] === 'object' ? seoGaps[0].name : seoGaps[0]) : "visibility issues";
  const failureCount = (leadData.speed_score < 60 ? 1 : 0) + 
                       (leadData.responsive_status !== 'responsive' ? 1 : 0) + 
                       (seoGaps.length > 0 ? 1 : 0);

  const templates = {
    'web_agency': `Our growth audit of **${businessName}** has identified critical conversion friction that is directly impacting their bottom line. With **Loading Friction** at **${speedScore}ms** and significant **Mobile Accessibility** failures, this business is likely losing up to **${lossPercent}%** of their mobile traffic before they even see a call-to-action. These gaps represent a massive opportunity for an agency like **${agencyName}** to step in as a strategic partner and provide an immediate ROI through performance-first design intervention.`,
    
    'freelancer': `I noticed **${businessName}** is currently struggling with several visible **Mobile Accessibility** and **Visibility Health** gaps that are holding their brand back. Specifically, their site suffers from **${firstSeoGap}**, creating unnecessary friction for modern customers. These are high-impact 'quick-win' improvements that would drastically increase their digital effectiveness. As a specialist, resolving these specific friction points is the perfect entry point for a long-term partnership.`,
    
    'seo_consultant': `A deep visibility scan of **${businessName}** has flagged multiple critical **Visibility Health** failures, including missing **Search Hooks** and **Authority Indicators**. Despite their strong reputation, they are currently 'invisible' to local customers for their target keywords because of these back-end configuration errors. By addressing these meta-data and schema gaps, ${businessName} can reclaim their market share. This is a prime candidate for a visibility cleanup and long-term search dominance strategy.`,
    
    'cold_email_agency': `Revenue Shock Stat: **${businessName}**’s website currently fails **${failureCount}** out of 5 basic performance metrics, putting their **Visibility Health** in the bottom **${bottomPercentile}%** of their industry. This level of failure is the ultimate 'pattern-interrupt' for high-volume outreach. Leading with this specific **Loading Friction** data in your first email will cut through the noise and establish immediate authority for your clients.`
  };

  return templates[persona] || templates['web_agency'];
}

module.exports = {
  calculateRevenueLeak,
  calculateMarketStanding,
  getAdvisorQuote,
  getPersonaSummary
};
