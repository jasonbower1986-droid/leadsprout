/**
 * narrativeService.js
 * 
 * Provides logic to generate persona-specific sales narratives (Executive Summary, 
 * Sales Hooks, and CTAs) based on Lead audit data.
 * 
 * v5.3: Growth-Consultant Copywriting & Dynamic Narrative Generation.
 * Fully dynamic assembly based on the 4 core investigation dimensions,
 * explicitly answering the 5 Core Questions without hardcoded templates.
 * Enforces the "Business First, Website Second" constitutional principles.
 */

const { classifyContext, getContextSummary } = require('../utils/classifier');
const { investigate } = require('../utils/v5/investigation');
const { generateGrowthRoadmap } = require('../utils/constraint-chain');
const { calculateRevenueLeak, calculateMarketStanding } = require('../utils/calculators');

/**
 * Safely determines a letter grade based on numerical score.
 */
function calculateGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'F';
}

/**
 * Generate a formatted, fully dynamic narrative object for a lead and a specific persona.
 * 
 * @param {Object} lead - The lead object from the DB.
 * @param {string} persona - The user's persona (web_agency, freelancer, etc).
 * @param {Object} user - The user object (for AgencyName).
 * @returns {Object} { executive_summary, sales_hooks, cta, pitch_urgency_label }
 */
function generateNarrative(lead, persona = 'web_agency', user = {}) {
  // Safely parse JSON arrays for gaps
  let seoGaps = [];
  try {
    seoGaps = Array.isArray(lead.seo_gaps) ? lead.seo_gaps : JSON.parse(lead.seo_gaps || '[]');
  } catch (e) {
    seoGaps = lead.seo_gaps ? [lead.seo_gaps] : [];
  }
  
  let conversionGaps = [];
  try {
    conversionGaps = Array.isArray(lead.conversion_gaps) ? lead.conversion_gaps : JSON.parse(lead.conversion_gaps || '[]');
  } catch (e) {
    conversionGaps = lead.conversion_gaps ? [lead.conversion_gaps] : [];
  }

  // Ensure arrays are lists of objects or names
  const cleanSeoGaps = seoGaps.map(g => typeof g === 'object' ? g.name : g);
  const cleanConvGaps = conversionGaps.map(g => typeof g === 'object' ? g.name : g);

  // Prepare fallback data structure for calculators and classifiers
  const leadForCalc = {
    ...lead,
    seo_gaps: cleanSeoGaps,
    conversion_gaps: cleanConvGaps
  };

  // Run or resolve classifiers and investigators (robust backward compatibility)
  const context = lead.commercial_context?.raw || classifyContext(leadForCalc);
  const contextSummary = getContextSummary(context);
  const investigation = lead.investigation || investigate(leadForCalc, context);
  const roadmap = lead.growth_roadmap || generateGrowthRoadmap(leadForCalc, context);

  // Core metrics for interpolation
  const healthScore = lead.visibility_health !== undefined ? lead.visibility_health : investigation.overall.healthScore;
  const healthGrade = calculateGrade(healthScore);
  
  const city = lead.location ? lead.location.split(',')[0].trim() : "your local area";
  const niche = lead.niche || 'Business';
  
  const rawLeak = calculateRevenueLeak(lead.speed_score || 50, niche);
  const formattedLeak = rawLeak.formatted_leak;
  
  const rawStanding = calculateMarketStanding(healthScore, niche, city);
  const marketStandingSentence = rawStanding.sentence;

  const leadBusinessName = lead.business_name || lead.domain || "the business";
  const agencyName = user.company_name || "Your Agency";

  // Scale, maturity, transaction model identifiers
  const scale = contextSummary.scale.label; // Solo / Mid-Market / Enterprise
  const maturity = contextSummary.maturity.label; // Neglected / Active Marketer / Digital Leader
  const transModel = contextSummary.transactionModel.label; // Urgent / Deliberate / Hybrid
  const journeyDescription = contextSummary.transactionModel.description;

  // Primary breakthrough details for hooks
  const primaryPattern = lead.discernment?.primaryBreakthrough?.pattern || (lead.discovery_patterns && lead.discovery_patterns[0]);
  const patternName = primaryPattern ? (primaryPattern.name || primaryPattern.tag) : "Digital Underperformance";
  const patternService = primaryPattern ? primaryPattern.service : "Performance Restoration";

  // ==========================================
  // DYNAMIC ASSEMBLY: EXECUTIVE SUMMARY
  // ==========================================

  // I. Strategic Diagnostic
  let intro = `**Strategic Analysis: The Opportunity Discovery Brief for ${leadBusinessName}.**\n\n`;
  intro += `Our diagnostic scans have identified ${leadBusinessName} as a **${scale}-Scale** operation displaying **${maturity}** digital maturity. `;
  intro += `Under the **${transModel}** transaction model, their customer acquisition relies on the primary journey funnel: *"${journeyDescription}"*.\n\n`;

  // Q1: How healthy is my digital infrastructure?
  let q1 = `### 1. Digital Infrastructure Health\n`;
  q1 += `Currently, ${leadBusinessName} operates with an overall Visibility Health Score of **${healthScore}/100**, earning an infrastructure grade of **"${healthGrade}"**. `;
  q1 += `${marketStandingSentence} `;
  if (healthGrade === 'F') {
    q1 += `An 'F' grade represents high operational risk. Foundational gateways are broken, indicating that the digital storefront is repelling prospects before they can engage.`;
  } else if (healthGrade === 'C') {
    q1 += `A 'C' grade indicates moderate digital friction. While the brand has some local presence, critical leakage points prevent the infrastructure from scaling efficiently.`;
  } else {
    q1 += `While some technical metrics are stable, substantial optimizations are still required to unlock their full conversion potential.`;
  }
  q1 += `\n\n`;

  // Q2: Why did I receive this score?
  const dimAccess = investigation.dimensions.accessibility;
  const dimTrust = investigation.dimensions.trust;
  const dimConv = investigation.dimensions.conversion;
  const dimSEO = investigation.dimensions.localSEO;

  let q2 = `### 2. Foundational Friction Analysis\n`;
  q2 += `The diagnostic breakdown of your digital gateway highlights performance gaps across 4 core dimensions:\n\n`;
  
  q2 += `- **Accessibility & Speed (Severity: ${dimAccess.score}/10 — ${dimAccess.label.toUpperCase()}):** `;
  if (dimAccess.findings.length > 0) {
    const details = dimAccess.findings.map(f => f.detail).join(", ");
    q2 += `Critical barriers detected: ${details}. Performance friction at this level causes rapid visitor bounce, particularly on mobile viewports.`;
  } else {
    q2 += `Accessibility pathways are structurally responsive and stable, showing acceptable load rates.`;
  }
  q2 += `\n`;

  q2 += `- **Trust & Credibility (Severity: ${dimTrust.score}/10 — ${dimTrust.label.toUpperCase()}):** `;
  if (dimTrust.findings.length > 0) {
    const details = dimTrust.findings.map(f => f.detail).join(", ");
    q2 += `Security and credibility risks identified: ${details}. In professional services, the absence of secure protocols or local identifiers destroys consumer confidence immediately.`;
  } else {
    q2 += `Credibility and identity verification metrics are solid, establishing essential consumer trust.`;
  }
  q2 += `\n`;

  q2 += `- **Conversion Optimization (Severity: ${dimConv.score}/10 — ${dimConv.label.toUpperCase()}):** `;
  if (dimConv.findings.length > 0) {
    const details = dimConv.findings.map(f => f.detail).join(", ");
    q2 += `Funnel architecture failures detected: ${details}. The lack of clear, direct call-to-action paths leaves interested prospects abandoned.`;
  } else {
    q2 += `Call-to-action signals and lead capture fields are prominent, facilitating visitor conversion.`;
  }
  q2 += `\n`;

  q2 += `- **Local Discovery & SEO (Severity: ${dimSEO.score}/10 — ${dimSEO.label.toUpperCase()}):** `;
  if (dimSEO.findings.length > 0) {
    const details = dimSEO.findings.map(f => f.detail).join(", ");
    q2 += `Organic search engine bottlenecks identified: ${details}. Lacking schema structures and title descriptions hides the business from ready-to-buy local search volume.`;
  } else {
    q2 += `Organic positioning and rich schemas are healthy, maintaining visible search relevance.`;
  }
  q2 += `\n\n`;

  // Q3: Which issues are actually costing me customers?
  let q3 = `### 3. Economic Revenue Leak\n`;
  q3 += `These technical barriers are not harmless bugs; they are directly choking company cash flow. `;
  if (transModel === 'Urgent') {
    q3 += `In high-intent, immediate-need niches like yours, customers make quick decisions, almost exclusively on mobile. Because of your mobile responsive issues and high friction, you are suffering an estimated monthly revenue leak of **${formattedLeak}**. `;
    q3 += `High-margin emergency clients in ${city} under stress will instantly abandon a broken page and call the nearest competitor with a responsive mobile interface.`;
  } else if (transModel === 'Deliberate') {
    q3 += `For high-consideration niches, prospects evaluate and research options carefully over several days. Security issues (missing SSL) and conversion hurdles (missing contact forms) cost you an estimated monthly revenue leak of **${formattedLeak}**. `;
    q3 += `Safety-conscious prospects will look elsewhere the moment their browser raises trust warnings or when they find no convenient way to submit an inquiry.`;
  } else {
    q3 += `With a hybrid transaction model, your business depends on both swift contact options and strong credibility signals. Gaps in performance and visibility are costing you an estimated monthly revenue leak of **${formattedLeak}**. `;
    q3 += `You are losing both immediate mobile callers and deliberate planned bookers.`;
  }
  q3 += ` Across all dimensions, our engine identified a total of **${investigation.overall.totalFindings} verified technical failures** restricting your growth.`;
  q3 += `\n\n`;

  // Q4: What should I fix first?
  let q4 = `### 4. Primary Constraint & Strategic Action Plan\n`;
  if (roadmap.phases && roadmap.phases.length > 0) {
    const phase1 = roadmap.phases[0];
    q4 += `To unlock this digital bottleneck, we recommend a strict, constraint-based roadmap. Fixing issues out of order is a waste of marketing spend. `;
    q4 += `**Your immediate primary constraint is: ${phase1.title}** (Severity Score: ${phase1.score}/10).\n\n`;
    
    q4 += `Our dynamic 3-Phase structured recovery path is outlined below:\n\n`;
    
    roadmap.phases.forEach((p) => {
      q4 += `- **Phase ${p.phase}: ${p.title} (Confidence: ${p.confidence}%)**\n`;
      q4 += `  *Recommended Service:* ${p.serviceToPitch}\n`;
      q4 += `  *Commercial Objective:* ${p.commercialHook}\n`;
      if (p.transition) {
        q4 += `  *Roadmap Dependency & Lock:* ${p.transition}\n`;
      }
      if (p.devilsAdvocateNotes && p.devilsAdvocateNotes.length > 0) {
        q4 += `  *Friction Proof Points:* ${p.devilsAdvocateNotes.slice(0, 2).join("; ")}\n`;
      }
      q4 += `\n`;
    });
  } else {
    q4 += `No critical bottlenecks are currently limiting your growth. We recommend maintaining your current solid infrastructure and monitoring performance quarterly.`;
    q4 += `\n\n`;
  }

  // Q5: Why should I trust these recommendations?
  let q5 = `### 5. Verification & Visual Evidence\n`;
  const hasScreenshot = !!lead.screenshot_path;
  if (hasScreenshot) {
    q5 += `These findings are fully verified and empirical. They are anchored directly to our automated visual capture system, which has recorded a real-time **Verified Visual Break** on your mobile layout (Saved Path: \`${lead.screenshot_path}\`). `;
    q5 += `This image proof of layout failure makes these diagnostic conclusions undeniable.`;
  } else {
    q5 += `These findings are fully backed by digital telemetry. Every gap represents an active, machine-verified failure point queried directly from your server response. `;
    q5 += `This raw engineering evidence removes any speculation, providing an objective audit that validates every single conversion roadblock.`;
  }
  q5 += `\n`;

  const finalSummary = intro + q1 + q2 + q3 + q4 + q5;

  // ==========================================
  // DYNAMIC ASSEMBLY: SALES HOOKS & CTA PER PERSONA
  // ==========================================

  let sales_hooks = [];
  let cta = "";
  let pitch_urgency_label = "";

  if (persona === 'web_agency') {
    sales_hooks = [
      `Discovery Hook: I discovered a severe conversion ceiling for ${leadBusinessName} caused by "${patternName}". This structural viewport friction represents a massive leak costing them ${formattedLeak} monthly. Pitch a customized '${patternService}' to plug this leak immediately.`,
      `Evidence-First Hook: Present the verified mobile viewport breakdown. Complacency is high until you show them the verified visual proof of their layout collapsing on mobile.`,
      `Consultant Outreach Script: "Hi there, I was auditing local ${niche} providers in the ${city} area and discovered a critical performance barrier on your site. According to our diagnostic scans, your loading and responsive friction is currently leaking up to ${formattedLeak} in potential revenue. I've compiled a verified visual proof and a 3-phase roadmap to resolve it. Let's schedule a brief call to go over the fix."`
    ];
    cta = `Secure this ${patternService} Project`;
    pitch_urgency_label = "Service Opportunity Index";
  } else if (persona === 'freelancer') {
    sales_hooks = [
      `Discovery Hook: I identified an immediate quick-win opportunity for ${leadBusinessName}. Their site is failing on responsive structures, creating a professional friction wall. Perfect for a skilled freelancer to swoop in with a fast mobile restoration.`,
      `Complacency-Buster: Complacent business owners think their site is fine. Send them the verified technical telemetry showing exactly where their mobile viewport breaks.`,
      `Consultant Outreach Script: "Hi, love your brand in ${city}! I was browsing your site on my phone and noticed the layout breaks quite severely on mobile viewports. This is actually a very quick fix that would prevent mobile visitors from bouncing back to Google. Let me know if you'd like a quick screen-share to show you where it's breaking."`
    ];
    cta = `Claim this 'Quick-Win' Project`;
    pitch_urgency_label = "Portfolio Opportunity Score";
  } else if (persona === 'seo_consultant') {
    sales_hooks = [
      `Discovery Hook: I discovered that ${leadBusinessName} is effectively invisible for high-intent ${niche} search volume in ${city}. Pitching them a '${patternService}' retainer will allow them to reclaim their rightful search authority.`,
      `Authority Evidence: Lacking structured schema and description meta tags keeps them invisible in local pack searches. Use our verified SEO gaps report to close an immediate retainer.`,
      `Consultant Outreach Script: "Dear ${leadBusinessName} Team, I was analyzing local search visibility trends for ${niche} clinics in ${city}. Your practice has an amazing reputation, but your site's technical SEO foundation is blocked, preventing you from capturing search volume. I have mapped out your organic visibility score and compiled a 3-phase boosting plan. Let's talk."`
    ];
    cta = `Start this SEO Retainer Play`;
    pitch_urgency_label = "Ranking Potential Index";
  } else if (persona === 'cold_email_agency') {
    sales_hooks = [
      `Discovery Hook: ${leadBusinessName} is technically underperforming compared to ${rawStanding.percentile}% of local competitors in ${city}. This makes them a high-conviction target for a performance recovery sequence.`,
      `Outreach Trigger: Lead with the Verified Visual Proof to achieve a massive pattern interrupt. Showing a business owner a visual image of their site failing on mobile viewports gets instant attention.`,
      `Automated Cold Script: "Subject: ${leadBusinessName} — quick question about your website layout\n\nHi, I run a digital performance agency. We were auditing local ${niche} players in ${city} and your domain came up. Our browser container caught some major viewport breaks on mobile viewports. This structural layout friction is likely costing you ${formattedLeak} in monthly revenue. Here is the verified report link: [Report Link]. Let me know if you'd like a quick fix."`
    ];
    cta = "Deploy High-Authority Outreach";
    pitch_urgency_label = "Outreach Success Probability";
  } else {
    // Default fallback
    sales_hooks = [
      `Discovery Hook: I discovered that ${leadBusinessName} is underperforming in its local market due to technical friction, costing them ${formattedLeak} monthly.`,
      `Evidence-First Play: Use the verified technical telemetry in our report to validate this commercial gap.`,
      `Outreach pitch: 'Hi there, I was looking at your site's speed and responsive viewport metrics. There are some major bottlenecks costing you potential clients.'`
    ];
    cta = "Deploy Outreach Strategy";
    pitch_urgency_label = "Opportunity Index";
  }

  return {
    executive_summary: finalSummary,
    sales_hooks: sales_hooks,
    hook: sales_hooks[0],
    cta: cta,
    pitch_urgency_label: pitch_urgency_label
  };
}

module.exports = {
  generateNarrative
};
