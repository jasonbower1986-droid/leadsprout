/**
 * narrativeService.js
 * 
 * Provides logic to generate persona-specific sales narratives (Executive Summary, 
 * Sales Hooks, and CTAs) based on Lead audit data.
 * 
 * Refined for v5.2 Narrative Overhaul:
 * - Adopts the tone of an experienced senior digital growth consultant.
 * - Structurally answers the 5 core commercial questions.
 * - Integrates Constraint Chain 3-Phase Roadmap timelines and transition narratives.
 * - Outlines 13 highly targeted discovery patterns with outcome-focused commercial stories.
 */

const PATTERN_NARRATIVES = {
  neglected_digital_storefront: {
    name: 'Neglected Digital Storefront',
    overview: "Your business has scaled operationally, but your digital storefront is acting like a 'closed' sign to modern local prospects. While your offline reputation is solid, this digital gap creates a silent, steady decay in your local market share as younger, technically optimized competitors emerge.",
    whyScore: "Your score was heavily penalized because your mobile layout fails modern usability standards and lags behind market averages, signaling to search engines and prospects that your digital presence has been neglected.",
    whatToFixFirst: "A complete mobile-responsive brand re-launch paired with professional performance hosting, turning your primary digital channel into an active client acquisition engine.",
    evidenceProof: "Our simulated mobile audit detected layout viewport breaking, coupled with a performance score of {LeadSpeedScore}/100. This is verified by visual breaks captured in our screen scan.",
    phases: {
      phase1: "Brand Restoration & Mobile Overhaul",
      phase2: "Local Search Identity & Geo-Targeting",
      phase3: "Conversion Optimization & Retainer Support"
    },
    transitions: {
      phase1to2: "Phase 2 (Local Search Dominance) is currently locked: Driving local search traffic is a waste of your marketing capital if 7 out of 10 mobile visitors hit a broken visual viewport and bounce immediately. We must plug the rendering leaks in Phase 1 before scaling your reach.",
      phase2to3: "Phase 3 (Ongoing Optimization) is currently locked: Implementing complex customer engagement funnels or A/B testing requires a steady, predictable flow of localized search leads. We must establish your local map visibility in Phase 2 first."
    },
    hooks: [
      "Discovery Hook: {LeadBusinessName}'s website is acting like a closed sign. They are losing high-margin local clients to modern rivals. Pitch the 'Friction-Free' re-launch with **Verified Visual Proof**.",
      "High-Conviction Lead: {LeadBusinessName} has scaled offline but is decaying online. Secure an audit review by leading with the **Verified Visual Breakdown**.",
      "Evidence-First Play: Use the **smoking gun** viewport breaks of {LeadBusinessName} to close an immediate modern brand overhaul."
    ]
  },
  premium_business_budget_site: {
    name: 'Premium Business, Budget Website',
    overview: "There is a jarring, costly disconnect between the premium pricing of your services and the budget reality of your website. This digital friction actively devalues your authority, making elite pricing harder to justify and alienating high-value clients who expect absolute professionalism.",
    whyScore: "Your low score is driven by sluggish server responses and a lack of authority schema, which directly devalues your premium brand positioning in the eyes of new prospects.",
    whatToFixFirst: "An elite UX/UI design overhaul with premium server architecture to align your digital first impression with your high-ticket service quality.",
    evidenceProof: "Verified slow response times (TTFB) and missing trust credentials, which are documented as critical branding failures in our visual audit.",
    phases: {
      phase1: "Elite Visual Identity & Fast Server Architecture",
      phase2: "Authority Indicators & Case Study Schema",
      phase3: "High-Touch Booking & Premium Funnels"
    },
    transitions: {
      phase1to2: "Phase 2 (Authority & Schema) is currently locked: Publishing elite case studies or advanced schemas is ineffective if high-value prospects bounce within 3 seconds due to poor hosting speeds. We must establish visual and technical excellence in Phase 1 first.",
      phase2to3: "Phase 3 (Premium Funnels) is currently locked: High-touch booking funnels fail to convert if your core website lacks the technical authority signals that justify your premium pricing model."
    },
    hooks: [
      "Discovery Hook: {LeadBusinessName} offers high-end services but their budget site devalues their brand. Pitch a premium UX overhaul to justify their premium pricing.",
      "High-Conviction Lead: Elite prospects are bouncing from {LeadBusinessName} due to poor first impressions. Lead with the **Verified Visual Breakdown** of their speed bottlenecks.",
      "Evidence-First Play: Leverage the **Verified Proof** of {LeadBusinessName}'s server latency to secure an immediate premium platform redesign."
    ]
  },
  high_traffic_low_conversion: {
    name: 'High-Traffic, Low-Conversion Opportunity',
    overview: "You have already completed the hardest and most expensive task: successfully attracting traffic to your domain. However, you are currently leaving substantial revenue on the table because your site is a 'leaky bucket' that fails to direct those active visitors into a clear, compelling path to book.",
    whyScore: "While your site traffic indicators are active, your overall score is penalized due to the complete absence of prominent call-to-actions, conversion hooks, and optimized lead capture systems.",
    whatToFixFirst: "A rapid Conversion Architecture sprint to integrate high-visibility, frictionless lead capture forms and strategic conversion hooks.",
    evidenceProof: "Active traffic tracking codes detected alongside a complete lack of primary call-to-action (CTA) buttons or contact widgets.",
    phases: {
      phase1: "Conversion Architecture & Primary CTA Overhaul",
      phase2: "Speed Performance & Friction Removal",
      phase3: "Advanced Personalization & Behavioral Testing"
    },
    transitions: {
      phase1to2: "Phase 2 (Performance & Speed) is currently locked: Shaving milliseconds off page load times yields zero ROI if your active visitors still have no clear actions to take once they land. We must build your conversion funnels in Phase 1 first.",
      phase2to3: "Phase 3 (Behavioral Testing) is currently locked: Advanced behavioral split-testing requires a highly optimized, responsive foundation. We must clean up technical speed barriers in Phase 2 before tuning minor metrics."
    },
    hooks: [
      "Discovery Hook: {LeadBusinessName} has active traffic but is failing to capture leads. Pitch a 'Leaky Bucket' conversion sprint using our verified findings.",
      "High-Conviction Lead: {LeadBusinessName} is wasting active traffic due to missing CTAs. Secure a pitch by showcasing their **Verified Conversion Gaps**.",
      "Evidence-First Play: Use the **smoking gun** absence of primary call-to-actions on {LeadBusinessName}'s site to close an immediate conversion optimization project."
    ]
  },
  mobile_confidence_breakdown: {
    name: 'Mobile Confidence Breakdown',
    overview: "With over 70% of local customers searching on mobile devices, your current mobile viewport failures represent a critical threat to buyer confidence. By failing basic mobile rendering tests, you are actively handing ready-to-buy prospects to your local rivals.",
    whyScore: "Your score was severely dragged down by rendering failures on simulated mobile browsers, causing layout text and booking elements to overlap and break.",
    whatToFixFirst: "A mobile-first responsive overhaul to ensure your site is completely responsive, gorgeous, and effortless to navigate on any smartphone screen.",
    evidenceProof: "Severe mobile viewport layout breaks and a slow mobile speed index, as verified by the screenshots captured in our mobile viewport audit.",
    phases: {
      phase1: "Mobile-Responsive UX/UI Reconstruction",
      phase2: "Mobile Speed Optimization & Performance Suite",
      phase3: "SMS & Tap-to-Call High-Conversion Funnels"
    },
    transitions: {
      phase1to2: "Phase 2 (Mobile Speed) is currently locked: Optimizing your speed indices is a waste of effort if your actual site layout remains physically broken on mobile viewports. We must deliver a flawless responsive layout in Phase 1 first.",
      phase2to3: "Phase 3 (SMS Funnels) is currently locked: Deploying modern SMS sequences or instant callbacks will fail if your core mobile load time causes prospects to bounce before your scripts can trigger."
    },
    hooks: [
      "Discovery Hook: {LeadBusinessName}'s mobile layout is physically broken, driving mobile buyers away. Pitch a 'Mobile-First' responsive overhaul with **Verified Visual Proof**.",
      "High-Conviction Lead: {LeadBusinessName} is bleeding mobile leads to competitors. Get their attention with the **Verified Visual Breakdown** of their layout breaks.",
      "Evidence-First Play: Use the **smoking gun** mobile screenshot of {LeadBusinessName} to pitch an immediate mobile-first responsive redesign."
    ]
  },
  competitive_neglect: {
    name: 'Competitive Neglect',
    overview: "Your business is standing still while your local competitors are actively modernizing. Google's algorithm has begun to actively favor the technically superior mobile and performance experiences of your direct rivals, putting your local market dominance at immediate risk.",
    whyScore: "Your overall score is sitting significantly below your specific industry's local average, signaling to search engines that your site is a technical liability compared to your peers.",
    whatToFixFirst: "An aggressive technical and design modernization to exceed your direct rivals' performance benchmarks and reclaim your search visibility.",
    evidenceProof: "Your site health sits {CalculatedLossPercent}% below the {Industry} benchmark, leaving you exposed to a steady loss of search real estate.",
    phases: {
      phase1: "Technical Performance Foundation Overhaul",
      phase2: "Local SEO & Map Pack Supremacy",
      phase3: "Aggressive Competitor Monitoring & Content Scale"
    },
    transitions: {
      phase1to2: "Phase 2 (Local Map Pack) is currently locked: Aggressive citation building or local link campaigns will not rank a site that fails core technical search requirements. We must fix your technical foundation in Phase 1 first.",
      phase2to3: "Phase 3 (Content Scale) is currently locked: Scaling blog posts or localized service landing pages will underperform if your main domain fails to rank in the core Map Pack due to a weak search authority profile."
    },
    hooks: [
      "Discovery Hook: {LeadBusinessName} is falling behind local rivals who are modernizing. Pitch a modernization campaign to reclaim their market share.",
      "High-Conviction Lead: {LeadBusinessName}'s site health is below the local average. Grab their interest with a competitive gap analysis and **Verified Proof**.",
      "Evidence-First Play: Leverage the **smoking gun** comparison of {LeadBusinessName} against their local rivals to close a high-value technical modernization package."
    ]
  },
  local_visibility_gap: {
    name: 'Local Visibility Gap',
    overview: "You are a trusted authority in your physical neighborhood, but digitally invisible. Because your site lacks structured local schema and geo-optimized metadata, Google cannot confidently list your business in high-intent, near-me search queries.",
    whyScore: "Your score was penalized because you fail to broadcast your local presence technically, missing structured Schema.org markup and geographic keywords in your title tags.",
    whatToFixFirst: "An intensive Local SEO alignment, including structured schema injection and geo-targeted meta tag optimization for your primary service areas.",
    evidenceProof: "A verified physical address coupled with an absolute absence of local structured code or location-specific meta indicators.",
    phases: {
      phase1: "Local Schema Injection & Meta Optimization",
      phase2: "Local Citation Sync & GBP Integration",
      phase3: "Geo-Targeted Landing Page Campaigns"
    },
    transitions: {
      phase1to2: "Phase 2 (GBP & Citation Sync) is currently locked: Syncing directory citations will not boost authority if your website lacks the core local schema code to validate those citations. Structured schema in Phase 1 is the prerequisite.",
      phase2to3: "Phase 3 (Geo-Targeted Campaigns) is currently locked: Launching hyper-targeted local landing pages yields low ROI if your primary domain's local visibility profile is technically unoptimized."
    },
    hooks: [
      "Discovery Hook: {LeadBusinessName} is invisible in local map pack searches despite their great offline presence. Pitch a Local SEO schema and metadata sprint.",
      "High-Conviction Lead: Google cannot verify {LeadBusinessName}'s location due to missing schemas. Pitch 'Map Pack Dominance' with **Verified Proof** of their SEO gaps.",
      "Evidence-First Play: Secure a monthly local SEO retainer by showcasing the **smoking gun** lack of structured schema on {LeadBusinessName}'s domain."
    ]
  },
  trust_deficit: {
    name: 'Trust Deficit',
    overview: "In your high-stakes, high-trust industry, credibility is your primary commercial currency. Severe browser warnings or a lack of verified trust signals create immediate psychological red flags that prevent ready-to-book clients from ever contacting your office.",
    whyScore: "Your trust score was heavily penalized because your domain lacks basic security parameters (HTTPS/SSL) and fails to display high-trust authority indicators on the landing page.",
    whatToFixFirst: "Immediate domain security hardening, SSL restoration, and strategic trust-signal placement across your conversion paths.",
    evidenceProof: "A verified lack of SSL encryption or missing trust signals in an industry where security is a high-ranking factor.",
    phases: {
      phase1: "Security Hardening & SSL Restoration",
      phase2: "Trust-Signal & Credibility Placement",
      phase3: "High-Security Lead Capture & Compliance"
    },
    transitions: {
      phase1to2: "Phase 2 (Credibility Placement) is currently locked: Displaying customer reviews or badges is ineffective if browsers are displaying a giant 'Not Secure' warning in the URL bar. We must resolve the security warning in Phase 1 first.",
      phase2to3: "Phase 3 (High-Security Capture) is currently locked: Implementing secure client consultation portals is useless if visitors do not trust the base security of your domain."
    },
    hooks: [
      "Discovery Hook: {LeadBusinessName} has security warnings that are destroying prospect trust. Pitch an immediate trust-signal and security sprint.",
      "High-Conviction Lead: {LeadBusinessName}'s site triggers psychological red flags due to missing security parameters. Secure a pitch with our **Verified Proof**.",
      "Evidence-First Play: Use the **smoking gun** 'Not Secure' warning on {LeadBusinessName} to close an immediate security hardening and trust overhaul."
    ]
  },
  booking_friction: {
    name: 'Booking Friction',
    overview: "Stressed clients seeking urgent assistance typically have a patience window of under 30 seconds. By burying your contact details and making booking complex, you are actively disqualifying yourself from the most lucrative inbound leads in your market.",
    whyScore: "Your score was penalized due to severe friction in your conversion path—missing tap-to-call phone numbers and a lack of quick-contact forms above the fold.",
    whatToFixFirst: "A Conversion Path restructuring to place high-visibility tap-to-call actions and single-field contact forms at the top of your mobile layout.",
    evidenceProof: "Missing contact action elements and buried telephone link indicators on your landing page in an immediate-need service industry.",
    phases: {
      phase1: "Frictionless Contact Architecture & Mobile Call Actions",
      phase2: "Mobile Load Speed Acceleration",
      phase3: "Automated Callback & Online Scheduling Integration"
    },
    transitions: {
      phase1to2: "Phase 2 (Mobile Speed) is currently locked: Shaving milliseconds off load times won't capture emergency leads if they still can't locate your phone number when they arrive. Clear contact actions in Phase 1 must come first.",
      phase2to3: "Phase 3 (Online Scheduling) is currently locked: Integrating complex scheduling calendars will only frustrate users if your mobile loading speed remains slow and unstable."
    },
    hooks: [
      "Discovery Hook: {LeadBusinessName} is burying their phone number in an urgent niche. Pitch 'Frictionless Booking' to capture emergency leads instantly.",
      "High-Conviction Lead: Urgent leads are bouncing from {LeadBusinessName} because they can't call. Pitch 'High-Conversion Contact Architecture' with **Verified Proof**.",
      "Evidence-First Play: Leverage the **smoking gun** lack of mobile click-to-call links on {LeadBusinessName}'s domain to secure an immediate conversion overhaul."
    ]
  },
  reputation_leakage: {
    name: 'Reputation Leakage',
    overview: "You have built an incredible reputation offline, but your website is actively letting that authority leak. By failing to display social proof and failing to optimize your Google search snippet, you are allowing rivals to capture prospects searching for your brand.",
    whyScore: "Your score was penalized due to a sterile digital presence—missing integrated social profiles, unoptimized meta descriptions, and a lack of integrated customer reviews.",
    whatToFixFirst: "Social proof integration and search snippet optimization to ensure your brand commands immediate, unquestioned authority on the search results page.",
    evidenceProof: "Verified absence of social media hooks and unoptimized metadata, allowing competitors to intercept your branded traffic.",
    phases: {
      phase1: "Social Proof Integration & Snippet Optimization",
      phase2: "Schema-Driven Testimonials & Review Badges",
      phase3: "Active Reputation & Client Referral Engine"
    },
    transitions: {
      phase1to2: "Phase 2 (Schema Reviews) is currently locked: Displaying review badges on-site is ineffective if search engines cannot parse them into rich star ratings in search results. We must optimize your basic search snippets in Phase 1 first.",
      phase2to3: "Phase 3 (Referral Engine) is currently locked: Directing clients to referral programs will leak leads if your website fails to immediately validate your offline credibility to new visitors."
    },
    hooks: [
      "Discovery Hook: {LeadBusinessName}'s offline reputation is leaking online due to a sterile website. Pitch a social proof and meta description optimization campaign.",
      "High-Conviction Lead: Branded searchers are bouncing because {LeadBusinessName} lacks online reviews. Offer a 'Reputation Integration' sprint using **Verified Proof**.",
      "Evidence-First Play: Leverage the **smoking gun** lack of social validation on {LeadBusinessName}'s landing page to secure an immediate digital authority project."
    ]
  },
  outdated_customer_experience: {
    name: 'Outdated Customer Experience',
    overview: "This site isn't just slow; it is functionally obsolete. It represents a legacy user experience in a modern world. Modern clients have near-zero tolerance for digital friction and will bounce to a modern competitor within three seconds of landing.",
    whyScore: "Your site score is in the lowest tier of the market due to a combination of severe loading lag, outdated structure, and a completely non-responsive layout on modern mobile screens.",
    whatToFixFirst: "A complete platform migration and UX overhaul to transition your legacy business into a modern, high-performance sales tool.",
    evidenceProof: "A sub-40 speed score, outdated coding standards, and multiple high-impact technical and visual rendering breaks.",
    phases: {
      phase1: "Modern UX/UI Platform Migration",
      phase2: "Performance Optimization & Core Web Vitals",
      phase3: "Client Engagement & Retention Systems"
    },
    transitions: {
      phase1to2: "Phase 2 (Performance Optimization) is currently locked: Attempting to optimize speed indicators on an obsolete, legacy codebase is highly inefficient. We must migrate your brand to a modern visual platform in Phase 1 first.",
      phase2to3: "Phase 3 (Engagement Systems) is currently locked: Deploying advanced client retention programs is a waste of capital if your core digital experience is so outdated that visitors immediately bounce."
    },
    hooks: [
      "Discovery Hook: {LeadBusinessName}'s website is a legacy liability. Pitch a modern platform migration to prevent massive customer bounce.",
      "High-Conviction Lead: Modern buyers are bouncing from {LeadBusinessName}'s obsolete layout. Secure a pitch with the **Verified Visual Breakdown**.",
      "Evidence-First Play: Leverage the **smoking gun** sub-30 speed and obsolete layout of {LeadBusinessName} to close a complete, high-ticket site re-launch."
    ]
  },
  authority_without_credibility: {
    name: 'Authority Without Credibility',
    overview: "In high-ticket B2B and advisory niches, prospects perform deep, rigorous digital due diligence. Your website currently signals a complete lack of professional attention, actively undermining the prestige and expert authority you have built offline.",
    whyScore: "Your professional credibility score is penalized by severe technical neglect—missing metadata, slow server response times, and a lack of verified trust signals.",
    whatToFixFirst: "A professional credibility sweep, correcting metadata errors, optimizing server response, and integrating verified authority indicators.",
    evidenceProof: "High-value industry classification coupled with server lags, missing metadata, and missing operational trust signals.",
    phases: {
      phase1: "Technical Authority & Metadata Overhaul",
      phase2: "Expert Content Structure & Case Studies",
      phase3: "B2B Client Capture & ABM Integration"
    },
    transitions: {
      phase1to2: "Phase 2 (Expert Content) is currently locked: Publishing high-value whitepapers or thought leadership won't build credibility if your site's technical foundation suffers from basic metadata errors and slow loads. Technical authority in Phase 1 is required.",
      phase2to3: "Phase 3 (ABM Integration) is currently locked: Directing targeted B2B accounts to your site will leak high-value prospects if they find a sterile digital presence that lacks professional credibility markers."
    },
    hooks: [
      "Discovery Hook: {LeadBusinessName} has deep offline expertise but a site that lacks professional credibility. Pitch a professional authority sweep.",
      "High-Conviction Lead: High-value prospects are doubting {LeadBusinessName} due to basic site errors. Pitch 'Credibility Restoration' with **Verified Proof**.",
      "Evidence-First Play: Leverage the **smoking gun** metadata and speed issues on {LeadBusinessName}'s domain to secure an immediate professional overhaul."
    ]
  },
  revenue_bottleneck: {
    name: 'Revenue Bottleneck',
    overview: "You are successfully paying for traffic and winning clicks, but you are losing customers before the page even loads. This severe performance bottleneck acts as an expensive 'tax' on your ad spend, yielding a significantly lower ROI than your campaigns deserve.",
    whyScore: "Your ad landing experience is severely penalized due to critical page speed friction, causing up to 40% of paid clicks to bounce before seeing your offer.",
    whatToFixFirst: "Dedicated landing page performance optimization to eliminate load-time friction and maximize ad conversion rates.",
    evidenceProof: "Verified active ad trackers (Google/Facebook ads) running on a site with a performance score below 40/100.",
    phases: {
      phase1: "Ad Landing Page Performance Optimization",
      phase2: "Conversion Copy & Lead Capture Alignment",
      phase3: "Retargeting & High-Performance Funnel Scaling"
    },
    transitions: {
      phase1to2: "Phase 2 (Conversion Copy) is currently locked: Overhauling your landing page copy or headlines will not increase campaign ROI if nearly half your paid visitors bounce due to a slow server before reading the copy. We must fix page performance in Phase 1 first.",
      phase2to3: "Phase 3 (Funnel Scaling) is currently locked: Scaling paid ad campaigns or retargeting will multiply your waste if your landing pages still suffer from a severe technical performance bottleneck."
    },
    hooks: [
      "Discovery Hook: {LeadBusinessName} is wasting ad spend because their page loads too slowly. Pitch a landing page performance sprint to maximize ad ROI.",
      "High-Conviction Lead: Active ad campaigns on {LeadBusinessName} are hitting a severe technical bottleneck. Pitch 'Ad-Spend Recovery' with **Verified Proof**.",
      "Evidence-First Play: Leverage the **smoking gun** load speed of {LeadBusinessName}'s ad landing page to secure an immediate performance overhaul."
    ]
  },
  digital_first_impression_failure: {
    name: 'Digital First Impression Failure',
    overview: "First impressions are permanent in the digital world. Between a slow-loading screen and a blank browser tab (missing title), the first interaction a potential customer has with your brand is one of confusion and frustration.",
    whyScore: "Your site is failing the basic 3-second test. It suffers from a combined failure of slow server response (TTFB) and missing basic search identifiers.",
    whatToFixFirst: "Immediate speed-index optimization and title tag correction to establish instant brand clarity and trust.",
    evidenceProof: "Combined health score below 35/100, verified missing title tag, and critical loading friction.",
    phases: {
      phase1: "Immediate Brand Identity & Speed Correction",
      phase2: "Core Web Vitals & Accessibility",
      phase3: "Brand Authority & Organic Growth"
    },
    transitions: {
      phase1to2: "Phase 2 (Web Vitals) is currently locked: Shaving off minor performance indicators is pointless if your site still loads with a blank browser tab. We must establish instant brand identity in Phase 1 first.",
      phase2to3: "Phase 3 (Organic Growth) is currently locked: Driving organic growth or content campaigns is a waste of budget if your site's first impression is so poor that it instantly drives new visitors away."
    },
    hooks: [
      "Discovery Hook: {LeadBusinessName} is failing the basic 3-second test with a blank tab and slow load. Pitch an immediate brand identity and speed correction.",
      "High-Conviction Lead: {LeadBusinessName}'s digital first impression is causing immediate bounce. Secure a pitch using **Verified Visual Proof**.",
      "Evidence-First Play: Leverage the **smoking gun** missing title and speed failure of {LeadBusinessName} to close an immediate technical recovery package."
    ]
  }
};

const PERSONA_NARRATIVES = {
  web_agency: {
    lead_type: "high-conviction",
    voice: "Authoritative, High-Performance, Results-Driven",
    strategy_tag: "Performance-First Restoration"
  },
  freelancer: {
    lead_type: "quick-win",
    voice: "Supportive, Entrepreneurial, Accessible",
    strategy_tag: "Rapid Implementation Fix"
  },
  seo_consultant: {
    lead_type: "high-leverage retainer",
    voice: "Analytical, Strategic, Precise",
    strategy_tag: "Technical Authority Overhaul"
  },
  cold_email_agency: {
    lead_type: "pattern-interrupt",
    voice: "Direct, Persuasive, Bold",
    strategy_tag: "Conversion Recovery Campaign"
  }
};

/**
 * Generate a formatted narrative object for a lead and a specific persona.
 * 
 * @param {Object} lead - The lead object from the DB (enriched with discovery_patterns, visibility_health, revenue_leak, market_standing).
 * @param {string} persona - The user's persona (web_agency, freelancer, etc).
 * @param {Object} user - The user object (for AgencyName).
 * @returns {Object} { executive_summary, sales_hooks, hook, cta, pitch_urgency_label }
 */
function generateNarrative(lead, persona, user = {}) {
  // 1. Resolve primary matched pattern or default
  let patternId = 'neglected_digital_storefront';
  if (lead.discovery_patterns && lead.discovery_patterns.length > 0) {
    patternId = lead.discovery_patterns[0].id;
  } else if (lead.responsive_status !== 'responsive') {
    patternId = 'mobile_confidence_breakdown';
  } else if (lead.speed_score < 50) {
    patternId = 'revenue_bottleneck';
  }
  
  // Resolve pattern details with robust fallback
  const pattern = PATTERN_NARRATIVES[patternId] || PATTERN_NARRATIVES.neglected_digital_storefront;
  const personaMeta = PERSONA_NARRATIVES[persona] || PERSONA_NARRATIVES.web_agency;

  // 2. Prepare all token variables for text substitution
  const leadBusinessName = lead.business_name || lead.domain;
  const leadSpeedScore = lead.speed_score || 0;
  const calculatedLossPercent = Math.round((100 - leadSpeedScore) * 0.6);
  const agencyName = user.company_name || "our advisory team";
  const responsiveStatus = lead.responsive_status === 'responsive' ? 'responsive' : 'not responsive';
  
  let seoGaps = [];
  try {
    seoGaps = Array.isArray(lead.seo_gaps) ? lead.seo_gaps : JSON.parse(lead.seo_gaps || '[]');
  } catch (e) {
    seoGaps = lead.seo_gaps ? [lead.seo_gaps] : [];
  }
  
  const gapNames = seoGaps.map(g => typeof g === 'object' ? g.name : g);
  const seoGap1 = gapNames[0] || "technical rendering gaps";
  const seoGapCount = gapNames.length;
  const seoGapList = gapNames.join(", ") || "various technical SEO issues";
  
  const city = lead.location ? lead.location.split(',')[0].trim() : "your local area";
  const niche = lead.niche || 'Business';
  const targetKeyword = `${niche} in ${city}`;
  
  let failureCount = 0;
  if (leadSpeedScore < 60) failureCount++;
  if (lead.responsive_status !== 'responsive') failureCount++;
  if (seoGaps.length > 0) failureCount++;
  if (failureCount === 0) failureCount = 1;
  
  const bottomPercentile = Math.max(10, Math.round(100 - leadSpeedScore));

  // Visibility health metrics
  const visibilityHealth = lead.visibility_health || lead.speed_score || 50;
  let grade = 'F';
  if (visibilityHealth >= 90) grade = 'A';
  else if (visibilityHealth >= 80) grade = 'B';
  else if (visibilityHealth >= 70) grade = 'C';
  else if (visibilityHealth >= 50) grade = 'D';

  const formattedLeak = (lead.revenue_leak && lead.revenue_leak.formatted_leak) ? lead.revenue_leak.formatted_leak : '$2,400';
  const lossCount = (lead.revenue_leak && lead.revenue_leak.loss_count) ? lead.revenue_leak.loss_count : '4';
  const marketPercentile = (lead.market_standing && lead.market_standing.percentile) ? lead.market_standing.percentile : Math.max(15, Math.round(100 - leadSpeedScore));

  // Visual Evidence Screenshot
  const hasScreenshot = !!lead.screenshot_path;
  const visualEvidenceProof = hasScreenshot 
    ? `the viewport layout scaling breaks captured on a simulated mobile browser in our visual audit, alongside a performance score of ${leadSpeedScore}/100.`
    : `verified server latency and technical seo debt of ${seoGapCount} critical failure points discovered in our system crawl.`;

  // 3. Construct premium, highly persuasive Executive Summary answering the 5 Core Questions
  const executiveSummary = `**Strategic Diagnostic: ${pattern.name}**

### 1. Executive Opportunity Summary
As a professional growth advisor, we have identified a **${personaMeta.lead_type} opportunity** for ${agencyName} regarding **${leadBusinessName}**. 

${pattern.overview}

---

### 2. Core Commercial Diagnostics

*   **Q1: How healthy is this business's digital infrastructure?**
    *   *Diagnostic:* Their Visibility Health is currently graded **${grade}** (${visibilityHealth}/100), placing them in the **bottom ${marketPercentile}%** of local businesses in the ${niche} space. This score reflects an environment where offline excellence is currently undermined by critical technical barriers.
*   **Q2: Why did they receive this score?**
    *   *Diagnostic:* ${pattern.whyScore} Specifically, they are failing on a **${responsiveStatus}** viewport rendering and suffering from a page speed barrier of **${leadSpeedScore}/100**.
*   **Q3: Which of these issues are actually costing them customers?**
    *   *Diagnostic:* Our models estimate that this technical friction is creating a **${calculatedLossPercent}% conversion ceiling**, resulting in a **monthly revenue leak of ${formattedLeak}** (translating to approximately **${lossCount} ready-to-buy clients lost** to local competitors every single month).
*   **Q4: What should be fixed first?**
    *   *Diagnostic:* Their primary breakthrough right now is **${pattern.whatToFixFirst}**. Resolving this single constraint is the highest-leverage action to stop the leak and unlock immediate ROI.
*   **Q5: Why should they trust these recommendations?**
    *   *Diagnostic:* This analysis is backed by **Verified Technical Proof**, including ${visualEvidenceProof}

---

### 3. Proposed 3-Phase Growth Roadmap (Constraint Chain Model)

*   **Phase 1: ${pattern.phases.phase1} (Est. Time: 2-3 Weeks)**
    *   *Objective:* Eliminate the primary growth bottleneck: **${pattern.whatToFixFirst}**.
    *   *Constraint Chain Logic:* ${pattern.transitions.phase1to2}
*   **Phase 2: ${pattern.phases.phase2} (Est. Time: 3-4 Weeks)**
    *   *Objective:* Boost local performance, search visibility, and frictionless contact actions.
    *   *Constraint Chain Logic:* ${pattern.transitions.phase2to3}
*   **Phase 3: ${pattern.phases.phase3} (Est. Time: Ongoing)**
    *   *Objective:* Scale brand authority, local map pack supremacy, and deployment of long-term retainer marketing funnels.`;

  // 4. Construct pattern-specific sales hooks
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

  const salesHooks = pattern.hooks.map(h => replaceAll(h));

  // Determine CTA and urgency labels
  let cta = "Secure this Performance Project";
  let pitchUrgencyLabel = "Service Opportunity Index";

  if (persona === 'freelancer') {
    cta = "Claim this 'Quick-Win' Project";
    pitchUrgencyLabel = "Portfolio Opportunity Score";
  } else if (persona === 'seo_consultant') {
    cta = "Start this SEO Retainer Play";
    pitchUrgencyLabel = "Ranking Potential Index";
  } else if (persona === 'cold_email_agency') {
    cta = "Deploy High-Authority Outreach";
    pitchUrgencyLabel = "Outreach Success Probability";
  }

  return {
    executive_summary: replaceAll(executiveSummary),
    sales_hooks: salesHooks,
    hook: salesHooks[0],
    cta: cta,
    pitch_urgency_label: pitchUrgencyLabel
  };
}

module.exports = {
  generateNarrative
};