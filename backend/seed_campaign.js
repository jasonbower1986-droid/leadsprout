const { dbQuery } = require('./database');

const CAMPAIGN_LEADS = [
  {
    id: 'campaign-bakery-001',
    domain: 'thelocalbakery-bk.com',
    business_name: 'The Local Bakery',
    niche: 'Retail / Bakery',
    location: 'Brooklyn, NY',
    speed_score: 20,
    responsive_status: 'responsive',
    seo_gaps: JSON.stringify(['Extremely slow mobile load time (8.2s)', 'Large unoptimized images (4.5MB)', 'Missing browser caching']),
    conversion_gaps: JSON.stringify(['No clear Call-To-Action (CTA) buttons found', 'No Schema.org structured data detected']),
    verified_emails: JSON.stringify(['hello@thelocalbakery-bk.com', 'owner@thelocalbakery-bk.com']),
    outreach_status: 'new'
  },
  {
    id: 'campaign-law-002',
    domain: 'texaslawgroup-dallas.com',
    business_name: 'Texas Law Firm',
    niche: 'Legal Services',
    location: 'Dallas, TX',
    speed_score: 55,
    responsive_status: 'responsive',
    seo_gaps: JSON.stringify(['Missing H1 Header', 'Missing Meta Descriptions on 12 pages', 'Duplicate Title Tags']),
    conversion_gaps: JSON.stringify(['No phone number detected for direct contact']),
    verified_emails: JSON.stringify(['contact@texaslawgroup-dallas.com']),
    outreach_status: 'new'
  },
  {
    id: 'campaign-gear-003',
    domain: 'mountaingear-shop.com',
    business_name: 'Mountain Gear Shop',
    niche: 'Retail / Outdoor',
    location: 'Denver, CO',
    speed_score: 45,
    responsive_status: 'not_responsive',
    seo_gaps: JSON.stringify(['Mobile Viewport not set', 'Touch elements too close together', 'Checkout button hidden on small screens']),
    conversion_gaps: JSON.stringify(['Missing social media links (Trust gap)']),
    verified_emails: JSON.stringify(['sales@mountaingear-shop.com', 'manager@mountaingear-shop.com']),
    outreach_status: 'new'
  },
  {
    id: 'campaign-sdtech-004',
    domain: 'sdtechsolutions.net',
    business_name: 'SD Tech Solutions',
    niche: 'Technology',
    location: 'San Diego, CA',
    speed_score: 15,
    responsive_status: 'responsive',
    seo_gaps: JSON.stringify(['Critical performance lag (7.4s load)', 'Unused JavaScript (2.1MB)', 'Slow TTFB (1.8s)']),
    conversion_gaps: JSON.stringify(['No clear Call-To-Action (CTA) buttons found', 'No Schema.org structured data detected']),
    verified_emails: JSON.stringify(['info@sdtechsolutions.net']),
    outreach_status: 'new'
  },
  {
    id: 'campaign-ohioind-005',
    domain: 'ohioindustrial-parts.com',
    business_name: 'Ohio Industrial',
    niche: 'Manufacturing',
    location: 'Cleveland, OH',
    speed_score: 40,
    responsive_status: 'not_responsive',
    seo_gaps: JSON.stringify(['Non-responsive layout', 'Missing Alt tags on 150+ images', 'Old Table-based HTML structure']),
    conversion_gaps: JSON.stringify(['No phone number detected for direct contact', 'Missing social media links']),
    verified_emails: JSON.stringify(['support@ohioindustrial-parts.com']),
    outreach_status: 'new'
  }
];

async function seedCampaignLeads() {
  console.log('Adding specific campaign leads...');
  for (const l of CAMPAIGN_LEADS) {
    try {
      await dbQuery.run(`
        INSERT INTO leads (id, domain, business_name, niche, location, speed_score, responsive_status, seo_gaps, conversion_gaps, verified_emails, outreach_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(domain) DO UPDATE SET business_name=excluded.business_name, conversion_gaps=excluded.conversion_gaps;
      `, [l.id, l.domain, l.business_name, l.niche, l.location, l.speed_score, l.responsive_status, l.seo_gaps, l.conversion_gaps, l.verified_emails, l.outreach_status]);
    } catch (e) {
      console.error(`Failed to seed ${l.business_name}:`, e.message);
    }
  }
  console.log('Campaign leads seeded.');
  process.exit(0);
}

seedCampaignLeads();
