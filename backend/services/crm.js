/**
 * CRM Integration Service
 * Mock-exports unlocked leads to HubSpot or Pipedrive pipelines.
 * Logs export events to /home/team/shared/crm_exports.log
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE_PATH = '/home/team/shared/crm_exports.log';

/**
 * Mock export an unlocked lead's data to a CRM pipeline
 * @param {string} platform - 'hubspot' or 'pipedrive'
 * @param {object} lead - Lead object with audit diagnostics
 * @param {object} user - User context performing the export
 * @returns {Promise<object>} Export success payload
 */
async function exportToCRM(platform, lead, user) {
  if (!['hubspot', 'pipedrive'].includes(platform.toLowerCase())) {
    throw new Error('Unsupported CRM platform. We only support HubSpot and Pipedrive integration.');
  }

  const timestamp = new Date().toISOString();
  const crmPlatform = platform.toLowerCase();
  
  // Create a structured mock payload matching professional CRM REST APIs
  const payload = {
    deal_title: `Web Design & SEO Audit - ${lead.business_name || lead.domain}`,
    pipeline_stage: crmPlatform === 'hubspot' ? 'appointmentscheduled' : 'contact_made',
    contact: {
      email: lead.verified_emails && lead.verified_emails.length > 0 ? lead.verified_emails[0] : 'contact@' + lead.domain,
      company: lead.business_name || lead.domain,
      domain: lead.domain,
      location: lead.location,
    },
    custom_fields: {
      leadsprout_id: lead.id,
      niche: lead.niche,
      speed_score: lead.speed_score,
      responsive_status: lead.responsive_status,
      identified_gaps: lead.seo_gaps,
      audit_source: 'LeadSprout Automated Intelligence'
    }
  };

  const logEntry = {
    timestamp,
    user_id: user.id,
    user_email: user.email,
    lead_id: lead.id,
    business_name: lead.business_name || lead.domain,
    platform: crmPlatform,
    payload,
    status: 'SUCCESS',
    external_deal_id: `${crmPlatform}_deal_${Math.floor(100000 + Math.random() * 900000)}`
  };

  // Append formatted log entry securely to the shared log file
  try {
    const dir = path.dirname(LOG_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(LOG_FILE_PATH, JSON.stringify(logEntry) + '\n', 'utf-8');
  } catch (err) {
    console.error('CRM logging failed:', err.message);
    throw new Error('Internal CRM integration logger error');
  }

  return {
    success: true,
    platform: crmPlatform,
    dealId: logEntry.external_deal_id,
    timestamp: logEntry.timestamp,
    message: `Lead data for ${lead.business_name || lead.domain} successfully synchronized to your ${platform === 'hubspot' ? 'HubSpot Contacts and Deals' : 'Pipedrive Pipeline'}!`
  };
}

module.exports = {
  exportToCRM
};
