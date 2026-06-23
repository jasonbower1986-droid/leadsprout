const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { dbQuery } = require('../database');
const auth = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'leadsprout-super-secret-key-2026';

// Helper to generate UUIDs
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * POST /api/auth/register
 * 
 * Create a new user subscriber account. Default is free/inactive plan.
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, company_name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user already exists
    const existingUser = await dbQuery.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existingUser) {
      return res.status(400).json({ error: 'Account with that email address already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const userId = generateUUID();

    // Insert user
    await dbQuery.run(
      `INSERT INTO users (id, email, password_hash, company_name, plan, subscription_status)
       VALUES (?, ?, ?, ?, 'free', 'inactive')`,
      [userId, email.toLowerCase().trim(), passwordHash, company_name || null]
    );

    // Sign JWT
    const payload = { id: userId, email: email.toLowerCase().trim(), plan: 'free' };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      success: true,
      token,
      user: {
        id: userId,
        email: email.toLowerCase().trim(),
        company_name: company_name || null,
        plan: 'free',
        subscription_status: 'inactive'
      }
    });
  } catch (error) {
    console.error('Registration failed:', error.message);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

/**
 * POST /api/auth/login
 * 
 * Authenticate credentials and return JWT token.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await dbQuery.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password credentials' });
    }

    // Compare password hash
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password credentials' });
    }

    // Sign JWT
    const payload = { id: user.id, email: user.email, plan: user.plan };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        company_name: user.company_name,
        plan: user.plan,
        subscription_status: user.subscription_status
      }
    });
  } catch (error) {
    console.error('Login failed:', error.message);
    res.status(500).json({ error: 'Server error during authentication' });
  }
});

/**
 * GET /api/auth/me
 * 
 * Retrieve authenticated user profile and calculate remaining credits dynamically.
 */
router.get('/me', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Load active user model
    const user = await dbQuery.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Retrieve monthly unlock count
    const unlockCountRow = await dbQuery.get(
      'SELECT COUNT(*) as count FROM unlocked_leads WHERE user_id = ?',
      [userId]
    );
    const unlocksCount = unlockCountRow ? unlockCountRow.count : 0;

    // Determine credit limits based on plan
    let maxCredits = 0;
    if (user.plan === 'basic') maxCredits = 50;
    else if (user.plan === 'pro') maxCredits = 250;
    else if (user.plan === 'agency') maxCredits = 99999; // Unlimited represent

    const remainingCredits = Math.max(0, maxCredits - unlocksCount);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        company_name: user.company_name,
        plan: user.plan,
        subscription_status: user.subscription_status,
        unlocks_count: unlocksCount,
        max_credits: maxCredits,
        remaining_credits: user.plan === 'agency' ? 'unlimited' : remainingCredits
      }
    });
  } catch (error) {
    console.error('Fetch profile failed:', error.message);
    res.status(500).json({ error: 'Server error retrieving active session' });
  }
});

module.exports = router;
