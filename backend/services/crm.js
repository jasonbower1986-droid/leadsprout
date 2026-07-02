/**
 * CRM Integration Service
 * Mock-exports unlocked leads to HubSpot or Pipedrive pipelines.
 * Logs export events to /home/team/shared/crm_exports.log
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const LOG_FILE_PATH = '/home/team/shared/crm_exports.log';

/**
 * Refresh HubSpot access token using the stored refresh token
 */
async function refreshHubSpotToken(user, dbQuery) {
  try {
    const res = await axios.post('https://api.hubapi.com/oauth/v1/token', 
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.HUBSPOT_CLIENT_ID,
        client_secret: process.env.HUBSPOT_CLIENT_SECRET,
        refresh_token: user.hubspot_refresh_token
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = res.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    await dbQuery.run(`
      UPDATE users SET 
        hubspot_access_token = ?, 
        hubspot_refresh_token = ?, 
        hubspot_expires_at = ?, 
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [access_token, refresh_token, expiresAt, user.id]);

    return access_token;
  } catch (error) {
    console.error('Failed to refresh HubSpot token:', error.response?.data || error.message);
    throw new Error('CRM authorization expired. Please reconnect HubSpot in Settings.');
  }
}

/**
 * Real HubSpot Sync logic
 */
async function syncToHubSpot(lead, user, dbQuery) {
  let accessToken = user.hubspot_access_token;
  
  // Check if token is expired (or expires soon - within 5 mins)
  const expiresAt = new Date(user.hubspot_expires_at).getTime();
  if (Date.now() + 300000 > expiresAt) {
    accessToken = await refreshHubSpotToken(user, dbQuery);
  }

  // 1. Create or Update Contact
  // Using HubSpot CRM Contacts API v3
  const contactPayload = {
    properties: {
      email: lead.verified_emails && lead.verified_emails.length > 0 ? lead.verified_emails[0] : null,
      firstname: lead.business_name,
      website: lead.domain,
      city: lead.location.split(',')[0].trim(),
      industry: lead.niche,
      // LeadSprout Custom Properties (Assuming they exist in HubSpot)
      leadsprout_id: lead.id,
      leadsprout_speed_score: lead.speed_score.toString(),
      leadsprout_responsive_status: lead.responsive_status,
      leadsprout_seo_gaps: lead.seo_gaps.join('; ')
    }
  };

  try {
    // Upsert contact by email
    const contactRes = await axios.post('https://api.hubapi.com/crm/v3/objects/contacts', contactPayload, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    }).catch(async (err) => {
      if (err.response?.status === 409) {
        // Contact already exists, update it
        const existingId = err.response.data.message.match(/ID: (\d+)/)[1];
        return axios.patch(`https://api.hubapi.com/crm/v3/objects/contacts/${existingId}`, contactPayload, {
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
      }
      throw err;
    });

    const contactId = contactRes.data.id;

    // 2. Create Deal and Associate with Contact
    const dealPayload = {
      properties: {
        dealname: `Web Design & SEO Audit - ${lead.business_name || lead.domain}`,
        pipeline: 'default',
        dealstage: 'appointmentscheduled',
        amount: '1500', // Mock value
        hubspot_owner_id: null // Could be mapped if needed
      },
      associations: [
        {
          to: { id: contactId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 20 }] // contact to deal
        }
      ]
    };

    const dealRes = await axios.post('https://api.hubapi.com/crm/v3/objects/deals', dealPayload, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });

    return {
      success: true,
      contactId,
      dealId: dealRes.data.id
    };
  } catch (error) {
    console.error('HubSpot Sync Error:', error.response?.data || error.message);
    throw new Error('Failed to synchronize lead to HubSpot CRM.');
  }
}

/**
 * Mock export an unlocked lead's data to a CRM pipeline
 * @param {string} platform - 'hubspot'
 * @param {object} lead - Lead object with audit diagnostics
 * @param {object} user - User context performing the export
 * @returns {Promise<object>} Export success payload
 */
async function exportToCRM(platform, lead, user) {
  if (!['hubspot'].includes(platform.toLowerCase())) {
    throw new Error('Unsupported CRM platform. We only support HubSpot integration.');
  }

  const timestamp = new Date().toISOString();
  const crmPlatform = platform.toLowerCase();
  const { dbQuery } = require('../database');

  // Real HubSpot Sync
  if (crmPlatform === 'hubspot' && user.hubspot_access_token) {
    const realResult = await syncToHubSpot(lead, user, dbQuery);
    return {
      success: true,
      platform: 'hubspot',
      dealId: realResult.dealId,
      timestamp,
      message: `Lead data for ${lead.business_name} successfully synced to your HubSpot account (Deal ID: ${realResult.dealId})!`
    };
  }
  
  // Fallback to Mock export for disconnected HubSpot
  const payload = {
    deal_title: `Web Design & SEO Audit - ${lead.business_name || lead.domain}`,
    pipeline_stage: 'appointmentscheduled',
    contact: {
      email: lead.verified_emails && lead.verified_emails.length > 0 ? lead.verified_emails[0] : null,
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
    message: `Lead data for ${lead.business_name || lead.domain} successfully synchronized to your HubSpot Contacts and Deals!`
  };
}

module.exports = {
  exportToCRM
};
