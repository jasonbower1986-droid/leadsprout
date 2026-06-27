/**
 * narrativeService.js
 * 
 * Provides logic to generate persona-specific sales narratives (Executive Summary, 
 * Sales Hooks, and CTAs) based on Lead audit data.
 * 
 * Aligned with the LeadSprout Audience & Intelligence Constitution (Commercial-First).
 * Hierarchy: Business -> Behaviour -> Problem -> Opportunity -> Evidence.
 */

const PERSONA_TEMPLATES = {
  web_agency: {
    executiveSummary: "**Strategic Analysis: The Performance Barrier.** {LeadBusinessName} is a high-intent business whose growth is likely capped by technical friction. {NicheStory} Their loading friction score ({LeadSpeedScore}/100) suggests a major commercial leak, likely costing them {CalculatedLossPercent}% of potential revenue. This represents a high-value entry point for {AgencyName} to deploy a 'Performance-First' restoration that stops the leak and modernizes their local presence.",
    hooks: [
      "Revenue Recovery Play: {LeadBusinessName} is handing {CalculatedLossPercent}% of their mobile traffic to competitors. Pitch the 'Friction-Free' fix.",
      "High-Value Entry: {LeadBusinessName} has a broken conversion path on mobile. Lead with a 'Mobile Rescue' play to secure the project.",
      "Commercial Proof: {LeadBusinessName} fails {FailureCount} core trust checks. Use this evidence to close an immediate technical overhaul."
    ],
    cta: "Secure this Performance Project",
    pitch_urgency_label: "Service Opportunity Index"
  },
  freelancer: {
    executiveSummary: "**Commercial Insight: The Professional Gap.** {LeadBusinessName} has a solid brand reputation but a digital presence that doesn't match their expertise. {NicheStory} Their site is currently {ResponsiveStatus}, creating a 'professional friction' wall that is a low-hanging fruit for a skilled freelancer. Fixing their {SEO_Gap_1} will prove immediate ROI and establish the trust needed to upsell them into a long-term 'Growth Support' partnership.",
    hooks: [
      "Quick-Win Shortcut: {LeadBusinessName} has a {ResponsiveStatus} mobile layout. This is an ideal 'First Project' to establish trust.",
      "Aha Moment: {LeadBusinessName} looks professional but their mobile UX is broken. Lead with the 'Professionalism Facelift' pitch.",
      "Cash-Flow Lead: {LeadBusinessName} has {SEO_Gap_Count} major gaps in their digital lobby. Send an 'Authority Boost' pitch today."
    ],
    cta: "Claim this 'Quick-Win' Project",
    pitch_urgency_label: "Portfolio Opportunity Score"
  },
  seo_consultant: {
    executiveSummary: "**Strategic Analysis: The Visibility Ceiling.** {LeadBusinessName} is likely being out-competed in {City} despite having the foundation to win. {NicheStory} Their technical SEO failures ({SEO_Gap_List}) are commercial barriers preventing them from capturing the search volume they deserve. This is a high-conviction retainer opportunity to fix their 'Search Hooks', demonstrate a ranking jump, and secure a multi-month partnership.",
    hooks: [
      "Visibility Payday: {LeadBusinessName} is effectively invisible for {TargetKeyword}. Fix the technical foundation to reclaim their share.",
      "Authority Recovery: {LeadBusinessName} has no Schema/Social authority markers. Pitch the 'Authority Restoration' play for a fast win.",
      "Retention Lead: {LeadBusinessName} fails {SEO_Gap_Count} visibility metrics. High-confidence opportunity for a monthly SEO retainer."
    ],
    cta: "Start this SEO Retainer Play",
    pitch_urgency_label: "Ranking Potential Index"
  },
  cold_email_agency: {
    executiveSummary: "**High-Authority Pattern Interrupt.** {LeadBusinessName} is a prime target for high-conviction outreach because their technical performance is in the bottom {BottomPercentile}% of their niche. {NicheStory} Their {FailureCount} commercial failures provide the perfect 'Pattern Interrupt' to cut through the noise of generic pitches. Leading with this business-first evidence ensures your clients are seen as high-authority growth advisors, not just solicitors.",
    hooks: [
      "Outreach Edge: {LeadBusinessName} is technically inferior to {BottomPercentile}% of local rivals. Lead with this 'Comparison' data.",
      "Pattern Interrupt: Use {LeadBusinessName}'s {FailureCount} commercial barriers as a high-authority outreach hook.",
      "High-Conviction Target: {LeadBusinessName} is technically failing in a high-intent niche. The perfect lead for an automated 'Recovery' campaign."
    ],
    cta: "Deploy High-Authority Outreach",
    pitch_urgency_label: "Outreach Success Probability"
  }
};

const NICHE_STORIES = {
  HVAC: "In the high-intent HVAC world, customers search in 'emergency mode'—usually on mobile and under stress. Because {LeadBusinessName} is {ResponsiveStatus}, they are effectively invisible to the highest-margin customers exactly when the AC breaks. This isn't a technical error; it's an invisible wall blocking emergency service revenue.",
  Plumbing: "Plumbing leads are mobile-first and emergency-driven. By maintaining a {ResponsiveStatus} site, {LeadBusinessName} is handing their local 'burst pipe' revenue directly to the nearest competitor with a functional mobile presence. Their technical debt is a daily loss of high-margin jobs.",
  Legal: "Legal clients prioritize authority and trust before booking a consultation. A site with {FailureCount} technical barriers or a {ResponsiveStatus} mobile view signals 'unreliability' to potential clients. In a high-stakes niche, this 'Digital Credibility Gap' is likely costing them $10k+ cases every single month.",
  Dental: "Dentistry is a fierce local comparison game where patients choose the clinic that feels most modern and accessible. If {LeadBusinessName} has high 'Loading Friction' or missing 'Search Hooks', local patients in {City} will simply book with the practice that provides the smoothest first impression.",
  default: "This business is currently underperforming in its local market due to technical friction. Their identified gaps ({SEO_Gap_Count} total) are creating a 'hidden ceiling' that prevents them from scaling. Use this evidence as a high-authority 'Comparison' play to show them exactly how they are trailing behind their local competition."
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
    seoGaps = Array.isArray(lead.seo_gaps) ? lead.seo_gaps : JSON.parse(lead.seo_gaps || '[]');
  } catch (e) {
    seoGaps = lead.seo_gaps ? [lead.seo_gaps] : [];
  }
  
  // Handle objects in gaps
  const gapNames = seoGaps.map(g => typeof g === 'object' ? g.name : g);
  const seoGap1 = gapNames[0] || "technical SEO gaps";
  const seoGapCount = gapNames.length;
  const seoGapList = gapNames.join(", ") || "various technical SEO issues";
  
  const city = lead.location ? lead.location.split(',')[0].trim() : "your local area";
  const niche = lead.niche || 'Business';
  const targetKeyword = `${niche} in ${city}`;
  
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
    "{Industry}": niche,
    "{FailureCount}": failureCount,
    "{BottomPercentile}": bottomPercentile,
    "{City}": city
  };

  const replaceAll = (str) => {
    let result = str;
    for (const [key, value] of Object.entries(replacements)) {
      result = result.split(key).join(value);
    }
    return result;
  };

  // Inject Niche Story
  let nicheKey = niche;
  if (niche === 'Legal Services') nicheKey = 'Legal';
  if (niche === 'Dentist') nicheKey = 'Dental';
  
  const nicheStoryTemplate = NICHE_STORIES[nicheKey] || NICHE_STORIES.default;
  replacements["{NicheStory}"] = replaceAll(nicheStoryTemplate);

  const finalSummary = replaceAll(template.executiveSummary);
  const finalHooks = template.hooks.map(hook => replaceAll(hook));

  return {
    executive_summary: finalSummary,
    sales_hooks: finalHooks,
    hook: finalHooks[0],
    cta: replaceAll(template.cta),
    pitch_urgency_label: template.pitch_urgency_label
  };
}

module.exports = {
  generateNarrative
};
