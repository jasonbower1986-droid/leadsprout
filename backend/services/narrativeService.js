/**
 * narrativeService.js
 * 
 * Provides logic to generate persona-specific sales narratives (Executive Summary, 
 * Sales Hooks, and CTAs) based on Lead audit data.
 * 
 * Aligned with 'LeadSprout Audience & Intelligence Constitution' - Phase 1.2 Pivot.
 */

const PERSONA_TEMPLATES = {
  web_agency: {
    executiveSummary: "Strategic Opportunity: **{LeadBusinessName}** is losing an estimated **{CalculatedLossPercent}%** of their mobile traffic due to high loading friction and responsive design failures. For an agency like **{AgencyName}**, this represents a high-conviction entry point to pitch a full-scale 'Mobile Revenue Recovery' project. The business is technically healthy enough to survive, but currently inefficient enough to justify a professional design intervention.",
    hooks: [
      "I noticed {LeadBusinessName} is currently losing about {CalculatedLossPercent}% of its mobile traffic due to loading friction—have you considered a recovery project?",
      "Found a local business with a high search volume but zero mobile CTA buttons. Ready for a quick-win project?",
      "Opportunity Alert: {LeadBusinessName} has a speed score of {LeadSpeedScore}, causing a major revenue leak in their mobile funnel."
    ],
    cta: "Review the Revenue Recovery Roadmap",
    pitch_urgency_label: "Service Opportunity Index"
  },
  freelancer: {
    executiveSummary: "Quick-Win Project: **{LeadBusinessName}** has {SEO_Gap_Count} visible technical gaps, including **{SEO_Gap_1}**, that are currently undermining their brand credibility. This is the perfect 'foot-in-the-door' opportunity. By fixing these specific UX friction points, you can establish an immediate ROI and position yourself for a long-term retainer as their lead technical partner.",
    hooks: [
      "I found a high-value client in the {Industry} niche with a broken mobile layout—perfect quick-win project.",
      "{LeadBusinessName} has clear technical gaps in their {SEO_Gap_1}—great opportunity to pitch a cleanup.",
      "Want to lead with ROI? {LeadBusinessName} is failing 3/5 conversion checks on their current site."
    ],
    cta: "Claim this Project Roadmap",
    pitch_urgency_label: "Portfolio Opportunity Score"
  },
  seo_consultant: {
    executiveSummary: "Visibility Gap: Despite having a strong local reputation, **{LeadBusinessName}** is currently 'invisible' to search engines for high-intent keywords like **{TargetKeyword}** due to missing technical foundations. The opportunity here is to lead with a 'Technical Visibility Cleanup.' Addressing their **{SEO_Gap_List}** will provide the fastest jump in rankings and secure your authority as their growth advisor.",
    hooks: [
      "Strategic Gap: {LeadBusinessName} is invisible on Google for '{TargetKeyword}' due to basic meta-data errors.",
      "Found a {Industry} business with great reviews but zero Schema markup—prime target for a visibility boost.",
      "Lead with technical data: {LeadBusinessName} is currently failing {FailureCount} critical search hooks."
    ],
    cta: "Analyze Visibility Gaps",
    pitch_urgency_label: "Ranking Potential Index"
  },
  cold_email_agency: {
    executiveSummary: "Pattern-Interrupt Data: **{LeadBusinessName}** is performing in the bottom **{BottomPercentile}%** of local {Industry} businesses for site performance. This data point is a powerful hook for your outbound campaigns. Leading with the specific 'Revenue Leak' statistic will cut through generic noise and instantly validate your agency's technical depth to the prospect.",
    hooks: [
      "Outreach Hook: {LeadBusinessName}'s site is slower than {BottomPercentile}% of their local competitors.",
      "Lead with ROI: Use this data to show {LeadBusinessName} exactly how many customers they're losing per month.",
      "Perfect prospect: {LeadBusinessName} has high niche authority but a failing technical foundation."
    ],
    cta: "Download Pitch Data Pack",
    pitch_urgency_label: "Outreach Success Probability"
  }
};

/**
 * Generate a formatted narrative object for a lead and a specific persona.
 * 
 * @param {Object} lead - The lead object from the DB.
 * @param {string} persona - The user's persona (web_agency, freelancer, etc).
 * @param {Object} user - The user object (for AgencyName).
 * @returns {Object} { executive_summary, sales_hooks, cta, pitch_urgency_label }
 */
function generateNarrative(lead, persona, user = {}) {
  const template = PERSONA_TEMPLATES[persona] || PERSONA_TEMPLATES.web_agency;
  
  // Prepare variables
  const leadBusinessName = lead.business_name || lead.domain;
  const leadSpeedScore = lead.speed_score || 0;
  const calculatedLossPercent = Math.round((100 - leadSpeedScore) * 0.6);
  const agencyName = user.company_name || "Your Agency";
  const responsiveStatus = lead.responsive_status === 'responsive' ? 'responsive' : 'not responsive';
  
  let seoGaps = [];
  try {
    seoGaps = Array.isArray(lead.seo_gaps) ? lead.seo_gaps : JSON.parse(lead.seo_gaps);
  } catch (e) {
    seoGaps = lead.seo_gaps ? [lead.seo_gaps] : [];
  }
  
  // Handle objects in gaps
  const gapNames = seoGaps.map(g => typeof g === 'object' ? g.name : g);
  const seoGap1 = gapNames[0] || "technical SEO gaps";
  const seoGapCount = gapNames.length;
  const seoGapList = gapNames.join(", ") || "various technical SEO issues";
  
  const city = lead.location ? lead.location.split(',')[0].trim() : "your local area";
  const targetKeyword = `${lead.niche || 'Business'} in ${city}`;
  
  // Calculate failure count (rough estimation for now)
  let failureCount = 0;
  if (leadSpeedScore < 60) failureCount++;
  if (lead.responsive_status !== 'responsive') failureCount++;
  if (seoGaps.length > 0) failureCount++;
  // Add other checks if available
  if (failureCount === 0 && (leadSpeedScore < 90 || seoGaps.length > 0)) failureCount = 1;
  
  const bottomPercentile = Math.max(10, Math.round(100 - leadSpeedScore));

  const replacements = {
    "{LeadBusinessName}": leadBusinessName,
    "{LeadSpeedScore}": leadSpeedScore,
    "{CalculatedLossPercent}": calculatedLossPercent,
    "{AgencyName}": agencyName,
    "{ResponsiveStatus}": responsiveStatus,
    "{SEO_Gap_1}": seoGap1,
    "{SEO_Gap_Count}": seoGapCount,
    "{SEO_Gap_List}": seoGapList,
    "{TargetKeyword}": targetKeyword,
    "{Industry}": lead.niche || 'Business',
    "{FailureCount}": failureCount,
    "{BottomPercentile}": bottomPercentile
  };

  const replaceAll = (str) => {
    let result = str;
    for (const [key, value] of Object.entries(replacements)) {
      result = result.split(key).join(value);
    }
    return result;
  };

  const executiveSummary = replaceAll(template.executiveSummary);
  const hooks = template.hooks.map(hook => replaceAll(hook));
  const hook = hooks[0]; // Primary hook

  return {
    executive_summary: executiveSummary,
    sales_hooks: hooks,
    hook: hook,
    cta: replaceAll(template.cta),
    pitch_urgency_label: template.pitch_urgency_label
  };
}

module.exports = {
  generateNarrative
};
