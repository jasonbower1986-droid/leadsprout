const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { dbQuery } = require('../database');

/**
 * POST /api/checkout/create-session
 * 
 * Mock Stripe Checkout Session creation.
 * In a real app, this would use the stripe npm package.
 */
router.post('/create-session', auth, async (req, res) => {
  try {
    const { plan } = req.body;
    const userId = req.user.id;

    if (!['basic', 'pro', 'agency'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }

    // Mock session URL - in production this would be a Stripe URL
    // We'll redirect to a local success route for simulation
    const mockSessionId = `mock_session_${Date.now()}`;
    const successUrl = `${req.protocol}://${req.get('host')}/checkout/success?session_id=${mockSessionId}&plan=${plan}`;
    
    res.json({
      url: successUrl,
      sessionId: mockSessionId
    });
  } catch (error) {
    console.error('Failed to create checkout session:', error.message);
    res.status(500).json({ error: 'Server error creating checkout session' });
  }
});

/**
 * POST /api/checkout/webhook
 * 
 * Mock Stripe Webhook receiver.
 * Updates user plan based on payment success.
 */
router.post('/webhook', async (req, res) => {
  try {
    // In a real app, we would verify the Stripe signature
    const { type, data } = req.body;

    if (type === 'checkout.session.completed') {
      const sessionId = data.object.id;
      const customerEmail = data.object.customer_details.email;
      const plan = data.object.metadata.plan;

      console.log(`[MOCK WEBHOOK] Payment success for ${customerEmail}, plan: ${plan}`);

      await dbQuery.run(
        `UPDATE users 
         SET plan = ?, subscription_status = 'active', updated_at = CURRENT_TIMESTAMP 
         WHERE email = ?`,
        [plan, customerEmail.toLowerCase().trim()]
      );
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook processing failed:', error.message);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

module.exports = router;
