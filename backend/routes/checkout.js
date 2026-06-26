const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const auth = require('../middleware/auth');
const { dbQuery } = require('../database');

/**
 * POST /api/checkout/create-session
 * 
 * Create a Stripe Checkout Session for subscriptions.
 */
router.post('/create-session', auth, async (req, res) => {
  try {
    const { plan } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;

    if (!['basic', 'pro', 'agency'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }

    // In a real production environment with valid STRIPE_SECRET_KEY:
    /*
    const prices = {
      basic: 'price_basic_id',
      pro: 'price_pro_id',
      agency: 'price_agency_id'
    };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: prices[plan],
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${req.protocol}://${req.get('host')}/dashboard?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get('host')}/checkout`,
      customer_email: userEmail,
      metadata: { userId, plan }
    });

    return res.json({ url: session.url, sessionId: session.id });
    */

    // Fallback Mock for Development/Testing
    const mockSessionId = `mock_session_${Date.now()}`;
    const successUrl = `${req.protocol}://${req.get('host')}/dashboard?success=plan_upgraded&session_id=${mockSessionId}&plan=${plan}`;
    
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
 * Stripe Webhook receiver.
 * Manages subscription lifecycle events.
 */
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    // Verify webhook signature if secret is provided
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // Fallback for mock testing or if secret is missing
      // req.body might be a Buffer due to express.raw()
      const bodyString = Buffer.isBuffer(req.body) ? req.body.toString() : req.body;
      event = typeof bodyString === 'string' ? JSON.parse(bodyString) : bodyString;
    }

    console.log(`[STRIPE WEBHOOK] Received event: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerEmail = session.customer_details?.email || session.customer_email;
        const plan = session.metadata?.plan;
        const stripeCustomerId = session.customer;
        const stripeSubscriptionId = session.subscription;

        console.log(`Processing checkout.session.completed for ${customerEmail}`);

        await dbQuery.run(
          `UPDATE users 
           SET plan = ?, 
               subscription_status = 'active', 
               stripe_customer_id = ?,
               stripe_subscription_id = ?,
               updated_at = CURRENT_TIMESTAMP 
           WHERE email = ?`,
          [plan, stripeCustomerId, stripeSubscriptionId, customerEmail.toLowerCase().trim()]
        );
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await dbQuery.run(
            `UPDATE users 
             SET subscription_status = 'active', updated_at = CURRENT_TIMESTAMP 
             WHERE stripe_subscription_id = ?`,
            [invoice.subscription]
          );
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await dbQuery.run(
            `UPDATE users 
             SET subscription_status = 'past_due', updated_at = CURRENT_TIMESTAMP 
             WHERE stripe_subscription_id = ?`,
            [invoice.subscription]
          );
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await dbQuery.run(
          `UPDATE users 
           SET plan = 'free', 
               subscription_status = 'canceled', 
               updated_at = CURRENT_TIMESTAMP 
           WHERE stripe_subscription_id = ?`,
          [subscription.id]
        );
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        // Handle plan changes if applicable
        if (subscription.metadata?.plan) {
          await dbQuery.run(
            `UPDATE users 
             SET plan = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE stripe_subscription_id = ?`,
            [subscription.metadata.plan, subscription.id]
          );
        }
        break;
      }

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

module.exports = router;
