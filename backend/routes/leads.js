const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { dbQuery } = require('../database');
const auth = require('../middleware/auth');
const { exportToCRM } = require('../services/crm');
const { analyzeWebsite, normalizeUrl } = require('../scraper');
const { v4: uuidv4 } = require('uuid');
const { enrichLeadData } = require('../utils/enrichment');
const { captureMobileScreenshot } = require('../utils/screenshot');

// Path to marketer's pitch templates
const PITCH_TEMPLATES_PATH = '/home/team/shared/marketing/pitch_templates.md';

/**
 * Mask email for Basic/Free users
 */
function maskEmail(email) {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

/**
 * Helper to dynamically extract a template block from markdown
 */
function extractTemplate(markdown, titleKeyword) {
  const lines = markdown.split('\n');
  let startIdx = -1;
  let endIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('## Template') && lines[i].toLowerCase().includes(titleKeyword.toLowerCase())) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) return null;

  // Search for the next template start or end of file
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## Template') || lines[i].startsWith('---') && i > startIdx + 5) {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) endIdx = lines.length;

  return lines.slice(startIdx, endIdx).join('\n').trim();
}

/**
 * GET /api/leads
 * 
 * Retrieve leads with search, pagination, and filter parameters.
 * Entitlement masking is applied to Free/Basic accounts for locked leads.
 */
router.get('/', auth, async (req, res) => {
  try {
    const { niche, location, gap, tag } = req.query;
    const userPlan = req.user.plan;
    const userId = req.user.id;

    // 1. Build dynamic query
    let sql = 'SELECT * FROM leads WHERE 1=1';
    let params = [];

    if (niche) {
      sql += ' AND niche LIKE ?';
      params.push(`%${niche}%`);
    }
    if (location) {
      sql += ' AND location LIKE ?';
      params.push(`%${location}%`);
    }
    if (gap) {
      sql += ' AND (seo_gaps LIKE ? OR conversion_gaps LIKE ?)';
      params.push(`%${gap}%`);
      params.push(`%${gap}%`);
    }
    if (tag) {
      sql += ' AND discovery_tags LIKE ?';
      params.push(`%${tag}%`);
    }

    sql += ' ORDER BY created_at DESC';

    const leads = await dbQuery.all(sql, params);

    // 1.5 Fetch user profile for persona-driven enrichment
    const userProfile = await dbQuery.get('SELECT persona, company_name FROM users WHERE id = ?', [userId]);
    const userPersona = userProfile ? userProfile.persona : 'web_agency';
    const userCompany = userProfile ? userProfile.company_name : 'LeadSprout';

    // 2. Fetch user's unlocked leads list
    const unlockedRows = await dbQuery.all('SELECT lead_id FROM unlocked_leads WHERE user_id = ?', [userId]);
    const unlockedLeadIds = new Set(unlockedRows.map(row => row.lead_id));
    
    // 2.5 Fetch Niche Benchmarks for enrichment
    const benchmarks = await dbQuery.all('SELECT * FROM niche_benchmarks');
    const benchmarkMap = benchmarks.reduce((acc, b) => {
      acc[b.niche] = b;
      return acc;
    }, {});

    // 3. Process and apply entitlement masking rules
    const processedLeads = leads.map(lead => {
      const isUnlocked = unlockedLeadIds.has(lead.id) || userPlan === 'pro' || userPlan === 'agency';
      
      // Enrich lead with metadata and scores
      const enriched = enrichLeadData(lead, benchmarkMap[lead.niche], userPersona, userCompany);

      // Parse emails if string
      let parsedEmails = [];
      try {
        parsedEmails = typeof lead.verified_emails === 'string' ? JSON.parse(lead.verified_emails) : lead.verified_emails;
      } catch (e) {
        parsedEmails = lead.verified_emails ? [lead.verified_emails] : [];
      }

      // Apply masking if NOT unlocked and user is on Free/Basic tier
      const finalEmails = isUnlocked ? parsedEmails : parsedEmails.map(maskEmail);

      return {
        ...enriched,
        verified_emails: finalEmails,
        is_unlocked: isUnlocked
      };
    });

    res.json(processedLeads);
  } catch (error) {
    console.error('Failed to query leads:', error.message);
    res.status(500).json({ error: 'Server error retrieving leads' });
  }
});

/**
 * POST /api/leads/:id/unlock
 * 
 * Unlocks a lead for Basic/Free subscribers, decrementing available credits.
 */
router.post('/:id/unlock', auth, async (req, res) => {
  try {
    const leadId = req.params.id;
    const userId = req.user.id;
    const userPlan = req.user.plan;

    // Verify lead exists
    const lead = await dbQuery.get('SELECT * FROM leads WHERE id = ?', [leadId]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Check if already unlocked
    const alreadyUnlocked = await dbQuery.get(
      'SELECT 1 FROM unlocked_leads WHERE user_id = ? AND lead_id = ?',
      [userId, leadId]
    );

    if (alreadyUnlocked) {
      return res.json({ success: true, message: 'Lead already unlocked' });
    }

    // Pro / Agency have unlimited unlocks, but we can still record it so it appears on their list
    if (userPlan !== 'pro' && userPlan !== 'agency') {
      // Free users cannot unlock unless they upgrade
      if (userPlan === 'free') {
        return res.status(403).json({
          error: 'Free tier limits reached. Please upgrade to Basic, Pro, or Agency plan to unlock direct contact details.'
        });
      }

      // Check current unlocks count for Basic (limit 50)
      const unlockCountRow = await dbQuery.get(
        'SELECT COUNT(*) as count FROM unlocked_leads WHERE user_id = ?',
        [userId]
      );
      const currentCount = unlockCountRow ? unlockCountRow.count : 0;

      if (userPlan === 'basic' && currentCount >= 50) {
        return res.status(403).json({
          error: 'Basic plan limit reached (50 unlocks/month). Please upgrade to Pro or Agency for more credits.'
        });
      }
    }

    // Record the unlock
    await dbQuery.run(
      'INSERT INTO unlocked_leads (user_id, lead_id) VALUES (?, ?)',
      [userId, leadId]
    );

    res.json({ success: true, message: 'Lead unlocked successfully!' });
  } catch (error) {
    console.error('Unlock lead failed:', error.message);
    res.status(500).json({ error: 'Server error unlocking lead' });
  }
});

/**
 * GET /api/leads/:id/pitch
 * 
 * Generates personalized email copy by loading marketing templates
 * and injecting custom technical gap audit details dynamically.
 */
router.get('/:id/pitch', auth, async (req, res) => {
  try {
    const leadId = req.params.id;
    const userId = req.user.id;
    const userPlan = req.user.plan;

    // 1. Load lead and user contexts
    const lead = await dbQuery.get('SELECT * FROM leads WHERE id = ?', [leadId]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const user = await dbQuery.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User context not found' });
    }

    // 2. Enforce entitlement access (must be unlocked or Pro/Agency)
    const isUnlocked = await dbQuery.get(
      'SELECT 1 FROM unlocked_leads WHERE user_id = ? AND lead_id = ?',
      [userId, leadId]
    );

    const hasAccess = isUnlocked || userPlan === 'pro' || userPlan === 'agency';
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Access denied. You must unlock this lead to generate personalized outreach pitch templates.'
      });
    }

    // 4. Load Persona Config and Pitch Templates
    let rawTemplate = '';
    let templateKeyword = 'SEO';
    let selectionReason = 'SEO technical improvements';

    const configPath = '/home/team/shared/persona_config.json';
    let personaConfig = null;
    try {
      if (fs.existsSync(configPath)) {
        personaConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch (e) {
      console.error('Error loading persona config in pitch:', e);
    }

    const userPersonaConfig = (personaConfig && user.persona) ? personaConfig[user.persona] : null;

    let parsedGaps = [];
    try {
      parsedGaps = JSON.parse(lead.seo_gaps);
    } catch (e) {
      parsedGaps = lead.seo_gaps ? [lead.seo_gaps] : [];
    }
    const isSlow = lead.speed_score < 60;
    const isNotResponsive = lead.responsive_status === 'not_responsive';

    if (userPersonaConfig && userPersonaConfig.lead_pitch_template) {
      rawTemplate = userPersonaConfig.lead_pitch_template;
      selectionReason = `Custom ${userPersonaConfig.display_name} Persona Template`;
    } else {
      // Fallback to Marketer's templates
      if (isNotResponsive) {
        templateKeyword = 'Mobile-First'; // Template 3
        selectionReason = 'Mobile Responsiveness / Viewport Configuration';
      } else if (isSlow) {
        templateKeyword = 'Need for Speed'; // Template 2
        selectionReason = 'Page Load Speeds & Optimization';
      } else if (parsedGaps.length >= 3) {
        templateKeyword = 'All-in-One'; // Template 4
        selectionReason = 'Comprehensive Website Audit & Optimization Gaps';
      }

      if (fs.existsSync(PITCH_TEMPLATES_PATH)) {
        const templatesMarkdown = fs.readFileSync(PITCH_TEMPLATES_PATH, 'utf-8');
        rawTemplate = extractTemplate(templatesMarkdown, templateKeyword);
      }
    }

    if (!rawTemplate) {
      return res.status(500).json({ error: `Failed to load a suitable pitch template.` });
    }

    // 5. Personalize template by replacing placeholders
    const businessName = lead.business_name || lead.domain;
    const industry = lead.niche || 'Business';
    const city = lead.location.split(',')[0].trim();
    const loadTimeSeconds = ((100 - lead.speed_score) / 10).toFixed(1);
    const primaryGapsList = parsedGaps.slice(0, 3).join(', ');
    const agencyName = user.company_name || 'Our Agency';
    const senderEmail = user.email;

    let personalizedCopy = rawTemplate
      .replace(/\[Business Name\]/g, businessName)
      .replace(/\[Contact Name\]/g, 'Business Owner')
      .replace(/\[Industry\]/g, industry)
      .replace(/\[City\/Region\]/g, city)
      .replace(/\[City\]/g, city)
      .replace(/\[Target Keyword\]/g, `${industry} Services in ${city}`)
      .replace(/\[Competitor Name\]/g, `${industry} competitors in ${city}`)
      .replace(/\[X\.X\]/g, loadTimeSeconds)
      .replace(/\[X\]/g, Math.round((100 - lead.speed_score) * 0.6)) // Loss estimation percentage
      .replace(/\[Your Name\]/g, agencyName)
      .replace(/\[Your Agency\]/g, agencyName)
      .replace(/\[Role\]/g, 'Web Consultant')
      .replace(/\[Link to your Portfolio\/Agency\]/g, `https://${agencyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`)
      .replace(/\[Past Client\]/g, `local ${industry} firms`);

    // Extract subject line from personalized copy
    let subjectLine = `Quick note regarding ${businessName}`;
    const subjectMatch = personalizedCopy.match(/\*\*Subject:\*\*\s*(.*)/i);
    if (subjectMatch && subjectMatch[1]) {
      subjectLine = subjectMatch[1].trim();
      // Remove Subject line meta header from core copy body
      personalizedCopy = personalizedCopy.replace(/\*\*Subject:\*\*\s*.*/i, '').trim();
    }

    // Remove the markdown heading from body
    personalizedCopy = personalizedCopy.replace(/## Template.*/i, '').trim();

    // 6. Generate Persona-Specific Sales Narrative (Structured)
    const { generateNarrative } = require('../services/narrativeService');
    const salesNarrative = generateNarrative(lead, user.persona || 'web_agency', user);

    res.json({
      success: true,
      lead_id: leadId,
      template_used: templateKeyword,
      selection_reason: selectionReason,
      subject: subjectLine,
      body: personalizedCopy,
      sales_narrative: salesNarrative
    });
  } catch (error) {
    console.error('Failed to generate pitch:', error.message);
    res.status(500).json({ error: 'Server error generating pitch template' });
  }
});

/**
 * POST /api/leads/:id/outreach-sequence
 * 
 * Generates an automated 3-step outreach sequence (Initial Pitch, Day 3 Follow-up, Day 7 Breakup).
 * Exclusive feature of the 'agency' subscription tier.
 */
router.post('/:id/outreach-sequence', auth, async (req, res) => {
  try {
    const leadId = req.params.id;
    const userId = req.user.id;
    const userPlan = req.user.plan;

    // 1. Check if user is on the agency tier
    if (userPlan !== 'agency') {
      return res.status(403).json({
        error: "Access denied. The 3-Step Automated Outreach Sequence Generator is an exclusive feature of our premium Agency Plan ($149/month). Please upgrade your subscription to unlock this sales tool."
      });
    }

    // 2. Fetch lead and user details
    const lead = await dbQuery.get('SELECT * FROM leads WHERE id = ?', [leadId]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const user = await dbQuery.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User context not found' });
    }

    // 3. Select primary gap to tailor sequence
    let typeKeyword = 'SEO';
    let auditType = 'technical SEO audit';
    let focusFixes = 'H1 and meta tag fixes';
    let projectKeyword = 'SEO search visibility';

    let parsedGaps = [];
    try {
      parsedGaps = JSON.parse(lead.seo_gaps);
    } catch (e) {
      parsedGaps = lead.seo_gaps ? [lead.seo_gaps] : [];
    }

    const isSlow = lead.speed_score < 60;
    const isNotResponsive = lead.responsive_status === 'not_responsive';

    if (isNotResponsive) {
      typeKeyword = 'Mobile-First';
      auditType = 'mobile responsiveness audit';
      focusFixes = 'viewport & mobile navigation fixes';
      projectKeyword = 'mobile responsiveness';
    } else if (isSlow) {
      typeKeyword = 'Need for Speed';
      auditType = 'performance speed audit';
      focusFixes = 'image & asset compression fixes';
      projectKeyword = 'site speed performance';
    } else if (parsedGaps.length >= 3) {
      typeKeyword = 'All-in-One';
      auditType = 'technical site audit';
      focusFixes = 'technical checklist fixes';
      projectKeyword = 'website technical optimization';
    }

    // 4. Load Markdown file for Step 1 template
    let step1Body = '';
    let step1Subject = `Quick note regarding ${lead.business_name || lead.domain}`;

    if (fs.existsSync(PITCH_TEMPLATES_PATH)) {
      const templatesMarkdown = fs.readFileSync(PITCH_TEMPLATES_PATH, 'utf-8');
      const rawTemplate = extractTemplate(templatesMarkdown, typeKeyword);
      
      if (rawTemplate) {
        const businessName = lead.business_name || lead.domain;
        const industry = lead.niche || 'Business';
        const city = lead.location.split(',')[0].trim();
        const loadTimeSeconds = ((100 - lead.speed_score) / 10).toFixed(1);
        const agencyName = user.company_name || 'Our Agency';

        step1Body = rawTemplate
          .replace(/\[Business Name\]/g, businessName)
          .replace(/\[Contact Name\]/g, 'Business Owner')
          .replace(/\[Industry\]/g, industry)
          .replace(/\[City\/Region\]/g, city)
          .replace(/\[City\]/g, city)
          .replace(/\[Target Keyword\]/g, `${industry} Services in ${city}`)
          .replace(/\[Competitor Name\]/g, `${industry} competitors in ${city}`)
          .replace(/\[X\.X\]/g, loadTimeSeconds)
          .replace(/\[X\]/g, Math.round((100 - lead.speed_score) * 0.6))
          .replace(/\[Your Name\]/g, agencyName)
          .replace(/\[Your Agency\]/g, agencyName)
          .replace(/\[Role\]/g, 'Web Consultant')
          .replace(/\[Link to your Portfolio\/Agency\]/g, `https://${agencyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`)
          .replace(/\[Past Client\]/g, `local ${industry} firms`);

        // Extract subject
        const subjectMatch = step1Body.match(/\*\*Subject:\*\*\s*(.*)/i);
        if (subjectMatch && subjectMatch[1]) {
          step1Subject = subjectMatch[1].trim();
          step1Body = step1Body.replace(/\*\*Subject:\*\*\s*.*/i, '').trim();
        }
        step1Body = step1Body.replace(/## Template.*/i, '').trim();
      }
    }

    // If fallback is needed
    if (!step1Body) {
      step1Body = `Hi Business Owner,\n\nI ran an audit on your site ${lead.domain} and noticed some technical performance areas that could be improved.\n\nBest,\n${user.company_name || 'Our Agency'}`;
    }

    // 5. Construct Day 3 Follow-up (Step 2) and Day 7 Breakup (Step 3)
    const businessName = lead.business_name || lead.domain;
    const agencyName = user.company_name || 'Our Agency';

    const step2Subject = `Re: ${step1Subject}`;
    const step2Body = `Hi Business Owner,\n\nJust wanted to make sure you saw that ${auditType} I sent over for ${businessName}. Did those ${focusFixes} make sense?\n\nIf you want to plug those conversion leaks and start capturing more clients, let me know if you're open to a quick 5-minute chat.\n\nBest,\n\n${agencyName}`;

    const step3Subject = `Re: ${step1Subject}`;
    const step3Body = `Hi Business Owner,\n\nI haven't heard back, so I’ll assume ${projectKeyword} and website optimization aren't priorities for ${businessName} right now.\n\nI'll take you off my list for now, but feel free to reach out if things change down the road.\n\nBest,\n\n${agencyName}`;

    res.json({
      success: true,
      lead_id: leadId,
      sequence_type: typeKeyword,
      sequence: [
        {
          step: 1,
          day: 1,
          type: "Initial Personalized Pitch",
          subject: step1Subject,
          body: step1Body
        },
        {
          step: 2,
          day: 3,
          type: "First Value Follow-up",
          subject: step2Subject,
          body: step2Body
        },
        {
          step: 3,
          day: 7,
          type: "Breakup Follow-up",
          subject: step3Subject,
          body: step3Body
        }
      ]
    });

  } catch (error) {
    console.error('Failed to generate outreach sequence:', error.message);
    res.status(500).json({ error: 'Server error generating outreach sequence' });
  }
});

/**
 * POST /api/leads/:id/export
 * 
 * Simulates exporting an unlocked lead's profile to CRM (HubSpot) pipelines.
 */
router.post('/:id/export', auth, async (req, res) => {
  try {
    const leadId = req.params.id;
    const userId = req.user.id;
    const userPlan = req.user.plan;
    const { platform } = req.body;

    if (!platform) {
      return res.status(400).json({ error: 'Platform parameter (hubspot) is required' });
    }

    // 1. Fetch lead & user
    const lead = await dbQuery.get('SELECT * FROM leads WHERE id = ?', [leadId]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const user = await dbQuery.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User context not found' });
    }

    // Parse gaps & emails for processing
    let parsedGaps = [];
    try {
      parsedGaps = JSON.parse(lead.seo_gaps);
    } catch (e) {
      parsedGaps = lead.seo_gaps ? [lead.seo_gaps] : [];
    }

    let parsedConvGaps = [];
    try {
      parsedConvGaps = JSON.parse(lead.conversion_gaps);
    } catch (e) {
      parsedConvGaps = lead.conversion_gaps ? [lead.conversion_gaps] : [];
    }

    let parsedEmails = [];
    try {
      parsedEmails = JSON.parse(lead.verified_emails);
    } catch (e) {
      parsedEmails = lead.verified_emails ? [lead.verified_emails] : [];
    }

    // 2. Validate entitlement access
    const isUnlocked = await dbQuery.get(
      'SELECT 1 FROM unlocked_leads WHERE user_id = ? AND lead_id = ?',
      [userId, leadId]
    );

    const hasAccess = isUnlocked || userPlan === 'pro' || userPlan === 'agency';
    if (!hasAccess) {
      return res.status(403).json({
        error: 'Access denied. You must unlock this lead before exporting direct contact details to your CRM pipeline.'
      });
    }

    // 3. Prepare lead data with emails unlocked
    const leadDetail = {
      ...lead,
      seo_gaps: parsedGaps,
      conversion_gaps: parsedConvGaps,
      verified_emails: parsedEmails
    };

    // 4. Trigger CRM service export
    const result = await exportToCRM(platform, leadDetail, user);
    res.json(result);

  } catch (error) {
    console.error('CRM export failed:', error.message);
    res.status(500).json({ error: error.message || 'Server error exporting to CRM' });
  }
});

/**
 * GET /api/leads/demo/:id
 * 
 * Public route for agencies to view a sample audit "gifted" during outreach.
 * Does not require authentication.
 */
router.get('/demo/:id', async (req, res) => {
  try {
    const leadId = req.params.id;
    const viaUserId = req.query.via;

    // 1. Fetch lead
    const lead = await dbQuery.get('SELECT * FROM leads WHERE id = ?', [leadId]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // 2. Fetch Branding Info
    let branding = {
      company_name: 'LeadSprout',
      logo_url: null,
      calendly_link: 'https://calendly.com/leadsprout-demo',
      persona: 'web_agency'
    };

    let user;
    if (viaUserId) {
      user = await dbQuery.get('SELECT company_name, logo_url, calendly_link, persona FROM users WHERE id = ?', [viaUserId]);
    } else {
      // Fallback: find the first user who unlocked this lead
      user = await dbQuery.get(`
        SELECT u.company_name, u.logo_url, u.calendly_link, u.persona 
        FROM users u
        JOIN unlocked_leads ul ON u.id = ul.user_id
        WHERE ul.lead_id = ?
        ORDER BY ul.unlocked_at ASC
        LIMIT 1
      `, [leadId]);
    }

    if (user) {
      branding = {
        company_name: user.company_name || branding.company_name,
        logo_url: user.logo_url || branding.logo_url,
        calendly_link: user.calendly_link || branding.calendly_link,
        persona: user.persona || branding.persona
      };
    }

    // 2.5 Attach Persona Configuration
    let personaDetails = null;
    try {
      const configPath = '/home/team/shared/persona_config.json';
      if (fs.existsSync(configPath)) {
        const fullConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        personaDetails = fullConfig[branding.persona] || null;
      }
    } catch (e) {
      console.error('Error attaching persona details to demo:', e);
    }

    // 3. Enrich lead
    const benchmark = await dbQuery.get('SELECT * FROM niche_benchmarks WHERE niche = ?', [lead.niche]);
    const enrichedLead = enrichLeadData(lead, benchmark, branding.persona, branding.company_name);

    res.json({
      success: true,
      branding,
      personaDetails,
      lead: enrichedLead
    });

  } catch (error) {
    console.error('Failed to retrieve demo lead:', error.message);
    res.status(500).json({ error: 'Server error retrieving demo audit' });
  }
});

/**
 * POST /api/leads/analyze
 * 
 * On-demand scraping and analysis of a target website.
 */
router.post('/analyze', auth, async (req, res) => {
  try {
    const { url, refresh } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    let normalized;
    let domain;
    try {
      normalized = normalizeUrl(url);
      domain = new URL(normalized).hostname;
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    // Check if lead already exists
    let lead = await dbQuery.get('SELECT * FROM leads WHERE domain = ?', [domain]);

    if (!lead || refresh) {
      console.log(`Starting on-demand analysis for: ${domain}`);
      const auditReport = await analyzeWebsite(normalized);
      
      const leadId = lead ? lead.id : uuidv4();
      
      // Capture screenshot if non-responsive
      let screenshotPath = lead ? lead.screenshot_path : null;
      if (auditReport.responsive_status === 'not_responsive') {
        screenshotPath = await captureMobileScreenshot(normalized, leadId);
      }

      const leadData = {
        id: leadId,
        domain: auditReport.domain,
        business_name: auditReport.business_name,
        niche: req.body.niche || 'General',
        location: req.body.location || 'Unknown',
        speed_score: auditReport.speed_score,
        responsive_status: auditReport.responsive_status,
        seo_gaps: JSON.stringify(auditReport.seo_gaps),
        conversion_gaps: JSON.stringify(auditReport.conversion_gaps),
        verified_emails: JSON.stringify(auditReport.verified_emails),
        screenshot_path: screenshotPath,
        trackers_found: JSON.stringify(auditReport.trackers_found || []),
        address_detected: auditReport.address_detected ? 1 : 0,
        outreach_status: lead ? lead.outreach_status : 'new',
        updated_at: new Date().toISOString()
      };

      const { identifyPatterns } = require('../utils/discovery-patterns');
      const { calculateHealthScore } = require('../utils/enrichment');
      
      // Calculate real health score for tagging
      const healthScore = calculateHealthScore(auditReport, auditReport.seo_gaps, auditReport.conversion_gaps);
      
      const matchedPatterns = identifyPatterns({
        ...auditReport,
        niche: leadData.niche
      }, healthScore);
      const discoveryTags = matchedPatterns.map(p => p.tag);
      leadData.discovery_tags = JSON.stringify(discoveryTags);

      if (lead) {
        // Update
        await dbQuery.run(`
          UPDATE leads SET 
            business_name = ?, niche = ?, location = ?, speed_score = ?, 
            responsive_status = ?, seo_gaps = ?, conversion_gaps = ?, 
            verified_emails = ?, screenshot_path = ?, trackers_found = ?,
            address_detected = ?, discovery_tags = ?, updated_at = ?
          WHERE id = ?
        `, [
          leadData.business_name, leadData.niche, leadData.location, leadData.speed_score,
          leadData.responsive_status, leadData.seo_gaps, leadData.conversion_gaps, 
          leadData.verified_emails, leadData.screenshot_path, leadData.trackers_found,
          leadData.address_detected, leadData.discovery_tags, leadData.updated_at, lead.id
        ]);
      } else {
        // Insert
        await dbQuery.run(`
          INSERT INTO leads (id, domain, business_name, niche, location, speed_score, responsive_status, seo_gaps, conversion_gaps, verified_emails, screenshot_path, trackers_found, address_detected, discovery_tags, outreach_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          leadData.id, leadData.domain, leadData.business_name, leadData.niche, leadData.location,
          leadData.speed_score, leadData.responsive_status, leadData.seo_gaps, leadData.conversion_gaps, 
          leadData.verified_emails, leadData.screenshot_path, leadData.trackers_found, 
          leadData.address_detected, leadData.discovery_tags, leadData.outreach_status
        ]);
      }
      
      // Fetch the full lead object back
      lead = await dbQuery.get('SELECT * FROM leads WHERE id = ?', [leadData.id]);
    }

    // Automatically unlock for the user
    const alreadyUnlocked = await dbQuery.get(
      'SELECT 1 FROM unlocked_leads WHERE user_id = ? AND lead_id = ?',
      [req.user.id, lead.id]
    );

    if (!alreadyUnlocked) {
      await dbQuery.run(
        'INSERT INTO unlocked_leads (user_id, lead_id) VALUES (?, ?)',
        [req.user.id, lead.id]
      );
    }

    // Enrich for response
    const benchmark = await dbQuery.get('SELECT * FROM niche_benchmarks WHERE niche = ?', [lead.niche]);
    
    // Fetch user profile for enrichment
    const userProfileForAnalyze = await dbQuery.get('SELECT persona, company_name FROM users WHERE id = ?', [req.user.id]);
    const userPersonaForAnalyze = userProfileForAnalyze ? userProfileForAnalyze.persona : 'web_agency';
    const userCompanyForAnalyze = userProfileForAnalyze ? userProfileForAnalyze.company_name : 'LeadSprout';
    
    lead = enrichLeadData(lead, benchmark, userPersonaForAnalyze, userCompanyForAnalyze);

    res.json({
      success: true,
      lead
    });
  } catch (error) {
    console.error('On-demand analysis failed:', error.message);
    res.status(500).json({ error: 'Server error performing on-demand website analysis' });
  }
});

/**
 * GET /api/leads/benchmarks/:niche
 * 
 * Fetches industry benchmarks for a specific niche.
 */
router.get('/benchmarks/:niche', auth, async (req, res) => {
  try {
    const niche = req.params.niche;
    const benchmark = await dbQuery.get('SELECT * FROM niche_benchmarks WHERE niche = ?', [niche]);
    
    if (!benchmark) {
      // Return default benchmark
      return res.json({
        niche: 'General',
        avg_speed_score: 70,
        avg_seo_score: 75,
        conversion_benchmark: 'Medium'
      });
    }
    
    res.json(benchmark);
  } catch (error) {
    console.error('Failed to fetch benchmarks:', error.message);
    res.status(500).json({ error: 'Server error retrieving industry benchmarks' });
  }
});

module.exports = router;
