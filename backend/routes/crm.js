const express = require('express');
const router = express.Router();
const { dbQuery } = require('../database');
const auth = require('../middleware/auth');
const axios = require('axios');

// HubSpot OAuth Config (Scaffolded with placeholders)
const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID || 'PLACEHOLDER_CLIENT_ID';
const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET || 'PLACEHOLDER_CLIENT_SECRET';
const HUBSPOT_REDIRECT_URI = process.env.HUBSPOT_REDIRECT_URI || 'http://localhost:3000/api/crm/hubspot/callback';
const HUBSPOT_SCOPES = 'crm.objects.contacts.write crm.objects.contacts.read crm.objects.deals.read crm.objects.deals.write';

/**
 * GET /api/crm/hubspot/connect
 * Redirects the user to HubSpot's OAuth consent screen.
 */
router.get('/hubspot/connect', auth, (req, res) => {
  const authUrl = `https://app.hubspot.com/oauth/authorize?` +
    `client_id=${HUBSPOT_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(HUBSPOT_REDIRECT_URI)}&` +
    `scope=${encodeURIComponent(HUBSPOT_SCOPES)}&` +
    `state=${req.user.id}`;
  
  res.json({ url: authUrl });
});

/**
 * GET /api/crm/hubspot/callback
 * Handles the redirect from HubSpot after user approval.
 */
router.get('/hubspot/callback', async (req, res) => {
  const { code, state: userId } = req.query;

  if (!code) {
    return res.status(400).send('HubSpot OAuth code is missing.');
  }

  try {
    // Exchange the authorization code for an access token
    const tokenRes = await axios.post('https://api.hubapi.com/oauth/v1/token', 
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: HUBSPOT_CLIENT_ID,
        client_secret: HUBSPOT_CLIENT_SECRET,
        redirect_uri: HUBSPOT_REDIRECT_URI,
        code
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    // Get Portal ID / Account Info
    const accountRes = await axios.get('https://api.hubapi.com/integrations/v1/me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const portalId = accountRes.data.portalId;

    // Save tokens to DB for the user
    await dbQuery.run(`
      UPDATE users SET 
        hubspot_access_token = ?, 
        hubspot_refresh_token = ?, 
        hubspot_expires_at = ?, 
        hubspot_portal_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [access_token, refresh_token, expiresAt, portalId.toString(), userId]);

    // Redirect back to dashboard settings with success flag
    res.redirect('/settings?crm_connected=hubspot');
  } catch (error) {
    console.error('HubSpot OAuth Callback Error:', error.response?.data || error.message);
    res.redirect('/settings?crm_error=hubspot_auth_failed');
  }
});

/**
 * POST /api/crm/hubspot/disconnect
 * Removes HubSpot credentials for the current user.
 */
router.post('/hubspot/disconnect', auth, async (req, res) => {
  try {
    await dbQuery.run(`
      UPDATE users SET 
        hubspot_access_token = NULL, 
        hubspot_refresh_token = NULL, 
        hubspot_expires_at = NULL, 
        hubspot_portal_id = NULL
      WHERE id = ?
    `, [req.user.id]);

    res.json({ success: true, message: 'HubSpot disconnected successfully.' });
  } catch (error) {
    console.error('Failed to disconnect HubSpot:', error.message);
    res.status(500).json({ error: 'Internal server error disconnecting HubSpot.' });
  }
});

/**
 * GET /api/crm/status
 * Returns the integration status for the current user.
 */
router.get('/status', auth, async (req, res) => {
  try {
    const user = await dbQuery.get('SELECT hubspot_portal_id, hubspot_expires_at FROM users WHERE id = ?', [req.user.id]);
    
    res.json({
      hubspot: {
        connected: !!user.hubspot_portal_id,
        portalId: user.hubspot_portal_id,
        expiresAt: user.hubspot_expires_at
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve CRM status.' });
  }
});

module.exports = router;
