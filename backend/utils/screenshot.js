const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Captures a mobile screenshot of a target URL using agent-browser CLI.
 * @param {string} targetUrl 
 * @param {string} leadId 
 * @returns {Promise<string|null>} Path to the saved screenshot or null if failed
 */
async function captureMobileScreenshot(targetUrl, leadId) {
  const screenshotDir = '/home/team/shared/screenshots';
  const fileName = `lead_${leadId}_mobile.png`;
  const filePath = path.join(screenshotDir, fileName);

  try {
    // Ensure directory exists
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    console.log(`Capturing screenshot for ${targetUrl} (Lead: ${leadId})...`);

    // Use agent-browser CLI
    // 1. Set viewport to mobile
    // 2. Open URL
    // 3. Wait for load
    // 4. Take screenshot
    
    // We use a clean session for each screenshot to avoid cross-contamination
    const cmd = `agent-browser set viewport 375 812 && agent-browser open "${targetUrl}" && agent-browser wait 3 && agent-browser screenshot "${filePath}"`;
    
    execSync(cmd, { stdio: 'inherit' });

    if (fs.existsSync(filePath)) {
      console.log(`Screenshot saved to ${filePath}`);
      return `/screenshots/${fileName}`; // Return relative path for frontend
    } else {
      console.error(`Screenshot file not found after command execution: ${filePath}`);
      return null;
    }
  } catch (error) {
    console.error(`Failed to capture screenshot for ${targetUrl}:`, error.message);
    return null;
  }
}

module.exports = {
  captureMobileScreenshot
};
