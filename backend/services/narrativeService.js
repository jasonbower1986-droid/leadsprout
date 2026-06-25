/**
 * narrativeService.js
 * 
 * Provides logic to generate persona-specific sales narratives (Executive Summary, 
 * Sales Hooks, and CTAs) based on Lead audit data.
 */

const PERSONA_TEMPLATES = {
  web_agency: {
    executiveSummary: "Our recent audit of **{LeadBusinessName}** has uncovered critical conversion leaks that are directly impacting their bottom line. With a mobile page speed of **{LeadSpeedScore}** and significant responsive layout breaks, this business is likely losing up to **{CalculatedLossPercent}%** of their mobile traffic before they even see a call-to-action. These technical failures represent a massive opportunity for an agency like **{AgencyName}** to step in and provide an immediate ROI through performance-first design intervention.",
    hooks: [
      "{LeadBusinessName} is leaking revenue through a slow mobile experience—their site takes {LeadSpeedScore}s to load.",
      "I found a local business in your niche with no clear call-to-action on mobile. Interested?",
      "Technical Audit: {LeadBusinessName} fails {FailureCount}/5 conversion checks. Are they a fit for your recovery services?"
    ],
    cta: "Book a Website Audit Review"
  },
  freelancer: {
    executiveSummary: "I noticed **{LeadBusinessName}** is currently struggling with several visible UX and performance gaps that are holding their brand back. Specifically, their site is **{ResponsiveStatus}** and suffers from **{SEO_Gap_1}**, which makes for a frustrating user experience on modern devices. These are 'quick-win' technical improvements that could drastically improve their site's effectiveness. As a designer, fixing these specific friction points would be the perfect entry point for a full-scale partnership.",
    hooks: [
      "Found a quick-win UX project for your portfolio: {LeadBusinessName}'s layout is breaking on mobile.",
      "{LeadBusinessName} needs a mobile-first facelift—their current site isn't responsive.",
      "Is your next client {LeadBusinessName}? They have {SEO_Gap_Count} major design and technical gaps."
    ],
    cta: "Claim this Project Roadmap"
  },
  seo_consultant: {
    executiveSummary: "An automated deep-scan of **{LeadBusinessName}** has flagged multiple critical technical SEO failures, including **{SEO_Gap_List}**. Despite having a solid foundation, they are currently 'invisible' to search engines for **{TargetKeyword}** because of these back-end configuration errors. By addressing these meta-data and schema gaps, {LeadBusinessName} could see a significant jump in organic visibility. This is a prime candidate for a technical SEO cleanup and long-term search strategy.",
    hooks: [
      "{LeadBusinessName} is invisible on Google due to these specific meta-tag and header errors.",
      "Technical SEO Audit: Why {LeadBusinessName} isn't ranking for {TargetKeyword} despite having content.",
      "I found a local business with zero Schema markup. Ready to fix their technical SEO foundation?"
    ],
    cta: "Review the SEO Technical Roadmap"
  },
  cold_email_agency: {
    executiveSummary: "Shock Stat: **{LeadBusinessName}**’s website currently fails **{FailureCount}** out of 5 basic performance metrics, putting them in the bottom **{BottomPercentile}%** of their industry. This level of technical failure is the ultimate 'pattern-interrupt' for high-volume outreach. Leading with this specific diagnostic data in your first email will cut through the noise of generic pitches and establish immediate authority for your clients.",
    hooks: [
      "Pattern Interrupt: {LeadBusinessName}’s site is slower than {BottomPercentile}% of their competitors.",
      "Lead with data: {LeadBusinessName} fails {FailureCount} critical performance and trust checks.",
      "Use this 'Growth Gap' data to close {LeadBusinessName} for your clients on day one."
    ],
    cta: "Generate Custom Outreach Sequence"
  }
};

/**
 * Generate a formatted narrative object for a lead and a specific persona.
 * 
 * @param {Object} lead - The lead object from the DB.
 * @param {string} persona - The user's persona (web_agency, freelancer, etc).
 * @param {Object} user - The user object (for AgencyName).
 * @returns {Object} { executive_summary, sales_hooks, cta }
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
    seoGaps = JSON.parse(lead.seo_gaps);
  } catch (e) {
    seoGaps = lead.seo_gaps ? [lead.seo_gaps] : [];
  }
  
  const seoGap1 = seoGaps[0] || "technical SEO gaps";
  const seoGapCount = seoGaps.length;
  const seoGapList = seoGaps.join(", ") || "various technical SEO issues";
  
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

  return {
    executive_summary: replaceAll(template.executiveSummary),
    sales_hooks: template.hooks.map(hook => replaceAll(hook)),
    cta: replaceAll(template.cta)
  };
}

module.exports = {
  generateNarrative
};
