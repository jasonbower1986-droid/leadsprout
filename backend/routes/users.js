const express = require('express');
const router = express.Router();
const { dbQuery } = require('../database');
const auth = require('../middleware/auth');

/**
 * GET /api/users/profile
 * 
 * Retrieve the current user's profile details.
 */
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await dbQuery.get('SELECT id, email, company_name, logo_url, calendly_link, persona, plan, subscription_status FROM users WHERE id = ?', [req.user.id]);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, user });
  } catch (error) {
    console.error('Failed to fetch profile:', error.message);
    res.status(500).json({ error: 'Server error retrieving profile' });
  }
});

/**
 * PUT /api/users/profile
 * 
 * Update user profile details (branding and persona).
 */
router.put('/profile', auth, async (req, res) => {
  try {
    const { company_name, logo_url, calendly_link, persona } = req.body;
    const userId = req.user.id;

    // Validate persona if provided
    const validPersonas = ['web_agency', 'freelancer', 'seo_consultant', 'cold_email_agency'];
    if (persona && !validPersonas.includes(persona)) {
      return res.status(400).json({ error: 'Invalid persona type provided.' });
    }

    await dbQuery.run(`
      UPDATE users 
      SET 
        company_name = COALESCE(?, company_name),
        logo_url = COALESCE(?, logo_url),
        calendly_link = COALESCE(?, calendly_link),
        persona = COALESCE(?, persona),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [company_name, logo_url, calendly_link, persona, userId]);

    const updatedUser = await dbQuery.get('SELECT id, email, company_name, logo_url, calendly_link, persona, plan, subscription_status FROM users WHERE id = ?', [userId]);

    res.json({
      success: true,
      message: 'Profile updated successfully!',
      user: updatedUser
    });
  } catch (error) {
    console.error('Failed to update profile:', error.message);
    res.status(500).json({ error: 'Server error updating profile' });
  }
});

module.exports = router;
