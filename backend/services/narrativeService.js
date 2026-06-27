/**
 * narrativeService.js
 * 
 * Provides logic to generate persona-specific sales narratives (Executive Summary, 
 * Sales Hooks, and CTAs) based on Lead audit data.
 * 
 * Aligned with the LeadSprout Audience & Intelligence Constitution (Commercial-First).
 * Hierarchy: Business -> Behaviour -> Problem -> Opportunity -> Evidence.
 * 
 * Phase 1.3: Integrated Visual Evidence references.
 */

const PERSONA_TEMPLATES = {
  web_agency: {
    executiveSummary: "**Strategic Analysis: The Performance Barrier.** I discovered a high-conviction opportunity in your market—{LeadBusinessName} has a specific commercial barrier that is currently costing them revenue. {NicheStory} Their loading friction score ({LeadSpeedScore}/100) suggests a major commercial leak, likely costing them {CalculatedLossPercent}% of potential revenue. {VisualEvidenceProof} This represents a high-value entry point for {AgencyName} to deploy a 'Performance-First' restoration that stops the leak and modernizes their local presence.",
    hooks: [
      "Discovery Hook: I discovered a revenue-recovery opportunity for {LeadBusinessName}. They are handing {CalculatedLossPercent}% of their mobile traffic to competitors. Pitch the 'Friction-Free' fix using the **Verified Visual Proof**.",
      "High-Conviction Lead: {LeadBusinessName} has a specific commercial barrier on mobile that I've verified with proof. Secure the project by leading with the **Verified Visual Breakdown**.",
      "Evidence-First Play: Use the **smoking gun** visual proof of {LeadBusinessName}'s {FailureCount} commercial failures to close an immediate technical overhaul."
    ],
    cta: "Secure this Performance Project",
    pitch_urgency_label: "Service Opportunity Index"
  },
  freelancer: {
    executiveSummary: "**Commercial Insight: The Professional Gap.** I discovered a high-conviction opportunity—{LeadBusinessName} has a professional brand but a digital barrier that is currently leaking revenue. {NicheStory} Their site is currently {ResponsiveStatus}, creating a 'professional friction' wall that is a low-hanging fruit for a skilled freelancer. {VisualEvidenceProof} Fixing their {SEO_Gap_1} will prove immediate ROI and establish the trust needed to upsell them into a long-term 'Growth Support' partnership.",
    hooks: [
      "Discovery Hook: {LeadBusinessName} has a {ResponsiveStatus} mobile layout—a verified commercial opportunity. Use the **Visual Breakdown** in our report as your 'smoking gun' hook.",
      "High-Conviction Lead: {LeadBusinessName} looks professional but their mobile UX is broken. Lead with the 'Professionalism Facelift' discovery and the **Verified Proof**.",
      "Evidence-First Play: {LeadBusinessName} has {SEO_Gap_Count} major gaps. Use our **Verified Visual Proof** to send an 'Authority Boost' pitch today."
    ],
    cta: "Claim this 'Quick-Win' Project",
    pitch_urgency_label: "Portfolio Opportunity Score"
  },
  seo_consultant: {
    executiveSummary: "**Strategic Analysis: The Visibility Ceiling.** I discovered a high-conviction opportunity for {LeadBusinessName} to reclaim their market share. {NicheStory} Their technical SEO failures ({SEO_Gap_List}) are commercial barriers preventing them from capturing the search volume they deserve. {VisualEvidenceProof} This is a high-conviction retainer opportunity to fix their 'Search Hooks', demonstrate a ranking jump, and secure a multi-month partnership.",
    hooks: [
      "Discovery Hook: I discovered that {LeadBusinessName} is effectively invisible for {TargetKeyword}. Fix the technical foundation (verified with proof) to reclaim their share.",
      "High-Conviction Lead: {LeadBusinessName} has no Schema/Social authority markers. Pitch the 'Authority Restoration' discovery with **Verified Visual Proof** for a fast win.",
      "Evidence-First Play: {LeadBusinessName} fails {SEO_Gap_Count} visibility metrics. Use the **smoking gun** proof in our report to secure a monthly SEO retainer."
    ],
    cta: "Start this SEO Retainer Play",
    pitch_urgency_label: "Ranking Potential Index"
  },
  cold_email_agency: {
    executiveSummary: "**High-Authority Pattern Interrupt.** I discovered a high-conviction target—{LeadBusinessName}'s technical performance is in the bottom {BottomPercentile}% of their niche, creating a specific commercial opportunity. {NicheStory} Their {FailureCount} commercial failures provide the perfect 'Pattern Interrupt' to cut through the noise. {VisualEvidenceProof} Leading with this business-first evidence ensures your clients are seen as high-authority growth advisors.",
    hooks: [
      "Discovery Hook: {LeadBusinessName} is technically inferior to {BottomPercentile}% of local rivals. Lead with this discovery and the **Visual Breakdown** proof.",
      "High-Conviction Lead: Use {LeadBusinessName}'s {FailureCount} commercial barriers and our **Verified Visual Proof** as a high-authority outreach hook.",
      "Evidence-First Play: {LeadBusinessName} is technically failing in a high-intent niche. The perfect lead for an automated 'Recovery' campaign with **Verified Proof**."
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

  // Visual Evidence Logic
  const hasScreenshot = !!lead.screenshot_path;
  const visualEvidenceProof = hasScreenshot 
    ? "You can lead with the **Verified Visual Breakdown** already attached to this lead's profile. This proof of the layout break makes the pitch undeniable."
    : "Use the verified technical evidence in our report to validate this commercial gap to the prospect.";

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
    "{City}": city,
    "{VisualEvidenceProof}": visualEvidenceProof
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
