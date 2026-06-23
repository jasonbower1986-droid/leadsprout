const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { dbQuery } = require('../database');
const auth = require('../middleware/auth');
const { exportToCRM } = require('../services/crm');

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
    const { niche, location, gap } = req.query;
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
      sql += ' AND seo_gaps LIKE ?';
      params.push(`%${gap}%`);
    }

    sql += ' ORDER BY created_at DESC';

    const leads = await dbQuery.all(sql, params);

    // 2. Fetch user's unlocked leads list
    const unlockedRows = await dbQuery.all('SELECT lead_id FROM unlocked_leads WHERE user_id = ?', [userId]);
    const unlockedLeadIds = new Set(unlockedRows.map(row => row.lead_id));

    // 3. Process and apply entitlement masking rules
    const processedLeads = leads.map(lead => {
      // Parse JSON fields
      let parsedGaps = [];
      try {
        parsedGaps = JSON.parse(lead.seo_gaps);
      } catch (e) {
        parsedGaps = lead.seo_gaps ? [lead.seo_gaps] : [];
      }

      let parsedEmails = [];
      try {
        parsedEmails = JSON.parse(lead.verified_emails);
      } catch (e) {
        parsedEmails = lead.verified_emails ? [lead.verified_emails] : [];
      }

      const isUnlocked = unlockedLeadIds.has(lead.id) || userPlan === 'pro' || userPlan === 'agency';

      // Apply masking if NOT unlocked and user is on Free/Basic tier
      const finalEmails = isUnlocked ? parsedEmails : parsedEmails.map(maskEmail);

      return {
        id: lead.id,
        domain: lead.domain,
        business_name: lead.business_name,
        niche: lead.niche,
        location: lead.location,
        speed_score: lead.speed_score,
        responsive_status: lead.responsive_status,
        seo_gaps: parsedGaps,
        verified_emails: finalEmails,
        outreach_status: lead.outreach_status,
        is_unlocked: isUnlocked,
        created_at: lead.created_at
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

    // 3. Select appropriate template based on website gaps
    let templateKeyword = 'SEO'; // Default: Template 1
    let selectionReason = 'SEO technical improvements';

    let parsedGaps = [];
    try {
      parsedGaps = JSON.parse(lead.seo_gaps);
    } catch (e) {
      parsedGaps = lead.seo_gaps ? [lead.seo_gaps] : [];
    }

    const isSlow = lead.speed_score < 60;
    const isNotResponsive = lead.responsive_status === 'not_responsive';

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

    // 4. Load Markdown file and parse template
    if (!fs.existsSync(PITCH_TEMPLATES_PATH)) {
      return res.status(500).json({ error: 'Pitch templates file is missing on server.' });
    }

    const templatesMarkdown = fs.readFileSync(PITCH_TEMPLATES_PATH, 'utf-8');
    const rawTemplate = extractTemplate(templatesMarkdown, templateKeyword);

    if (!rawTemplate) {
      return res.status(500).json({ error: `Failed to load template matching: ${templateKeyword}` });
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

    res.json({
      success: true,
      lead_id: leadId,
      template_used: templateKeyword,
      selection_reason: selectionReason,
      subject: subjectLine,
      body: personalizedCopy
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
 * Simulates exporting an unlocked lead's profile to CRM (HubSpot or Pipedrive) pipelines.
 */
router.post('/:id/export', auth, async (req, res) => {
  try {
    const leadId = req.params.id;
    const userId = req.user.id;
    const userPlan = req.user.plan;
    const { platform } = req.body;

    if (!platform) {
      return res.status(400).json({ error: 'Platform parameter (hubspot or pipedrive) is required' });
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

module.exports = router;
