const { generateNarrative } = require('./narrativeService');

const mockLead = {
  business_name: 'Smith & Associates',
  domain: 'smith-legal.com',
  speed_score: 85,
  responsive_status: 'not_responsive',
  seo_gaps: JSON.stringify(['Missing Meta Descriptions']),
  niche: 'Legal Services',
  location: 'Chicago, IL',
  screenshot_path: '/screenshots/smith-legal-mobile.png'
};

const mockUser = {
  company_name: 'LeadSprout Agency',
  persona: 'seo_consultant'
};

const result = generateNarrative(mockLead, 'seo_consultant', mockUser);

console.log('--- Executive Summary ---');
console.log(result.executive_summary);
console.log('\n--- Sales Hooks ---');
result.sales_hooks.forEach((hook, i) => console.log(`${i+1}. ${hook}`));
console.log('\n--- CTA ---');
console.log(result.cta);
