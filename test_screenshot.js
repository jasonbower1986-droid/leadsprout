
const { captureMobileScreenshot } = require('./backend/utils/screenshot');
const path = require('path');
const fs = require('fs');

async function test() {
  const url = 'https://example.com';
  const leadId = 'test-lead-id';
  const result = await captureMobileScreenshot(url, leadId);
  console.log('Result:', result);
  
  if (result) {
    const fullPath = path.join('/home/team/shared', result);
    if (fs.existsSync(fullPath)) {
      console.log('File exists at:', fullPath);
    } else {
      console.error('File NOT found at:', fullPath);
    }
  }
}

test().catch(console.error);
