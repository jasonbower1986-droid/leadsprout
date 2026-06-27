const axios = require('axios');

async function testWebhook() {
  const event = {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_session',
        customer: 'cus_test_customer',
        subscription: 'sub_test_subscription',
        customer_email: 'test@example.com',
        metadata: {
          plan: 'pro',
          userId: 'test-id'
        }
      }
    }
  };

  try {
    console.log('Sending mock webhook event...');
    const response = await axios.post('http://127.0.0.1:3000/api/checkout/webhook', event);
    console.log('Response Status:', response.status);
    console.log('Response Data:', response.data);
  } catch (error) {
    if (error.response) {
      console.error('Error Response Status:', error.response.status);
      console.error('Error Response Data:', error.response.data);
    } else {
      console.error('Error Message:', error.message);
    }
  }
}

testWebhook();
