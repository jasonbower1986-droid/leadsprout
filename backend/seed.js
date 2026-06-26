/**
 * LeadSprout Database Seed Script
 * 
 * Sets up the database schema and populates it with realistic seed data:
 * - 3 test users with different subscription tiers (Free, Pro, Agency)
 * - 25 highly realistic local business leads with SEO, performance, and mobile gaps
 */

const { dbQuery, initializeSchema } = require('./database');
const bcrypt = require('bcryptjs');

// Helper to generate UUIDs
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 25 Realistic local business leads with various niches, locations, and website optimization gaps
const SEED_LEADS = [
  {
    domain: 'austindentalsolutions.com',
    business_name: 'Austin Dental Solutions',
    niche: 'Dentist',
    location: 'Austin, TX',
    speed_score: 42,
    responsive_status: 'not_responsive',
    seo_gaps: [
      'Missing Meta Description',
      '34 images missing descriptive alt tags',
      'No H1 Header Found',
      'Missing mobile-responsive viewport meta tags'
    ],
    conversion_gaps: [
      'No clear Call-To-Action (CTA) buttons found',
      'No Schema.org structured data detected (Local SEO risk)'
    ],
    verified_emails: ['office@austindentalsolutions.com', 'dr.smith@austindentalsolutions.com'],
    outreach_status: 'new'
  },
  {
    domain: 'seattleplumbco.com',
    business_name: 'Seattle Plumbing Co.',
    niche: 'Plumbing',
    location: 'Seattle, WA',
    speed_score: 58,
    responsive_status: 'responsive',
    seo_gaps: [
      'Multiple H1 Headers (3)',
      '12 images missing descriptive alt tags',
      'Slow server response time (TTFB > 1.4s)'
    ],
    conversion_gaps: [
      'No phone number detected for direct contact',
      'Missing social media links (Trust gap)'
    ],
    verified_emails: ['service@seattleplumbco.com'],
    outreach_status: 'new'
  },
  {
    domain: 'bostoninjuryattorney.net',
    business_name: 'Boston Injury Attorneys',
    niche: 'Legal Services',
    location: 'Boston, MA',
    speed_score: 31,
    responsive_status: 'not_responsive',
    seo_gaps: [
      'Missing Title Tag',
      'Missing Meta Description',
      'SSL certificate is missing or invalid (Site loaded over HTTP)',
      '45 images missing descriptive alt tags'
    ],
    conversion_gaps: [
      'No clear Call-To-Action (CTA) buttons found',
      'No phone number detected for direct contact',
      'No Schema.org structured data detected (Local SEO risk)'
    ],
    verified_emails: ['contact@bostoninjuryattorney.net', 'intake@bostoninjuryattorney.net'],
    outreach_status: 'new'
  },
  {
    domain: 'denverroofingpros.com',
    business_name: 'Denver Roofing Pros',
    niche: 'Roofing',
    location: 'Denver, CO',
    speed_score: 65,
    responsive_status: 'responsive',
    seo_gaps: [
      'Missing Meta Description',
      'No H1 Header Found',
      'SSL certificate is missing or invalid (Site loaded over HTTP)'
    ],
    conversion_gaps: [
      'Missing social media links (Trust gap)'
    ],
    verified_emails: ['info@denverroofingpros.com'],
    outreach_status: 'new'
  },
  {
    domain: 'miamihvacspecialists.com',
    business_name: 'Miami HVAC Specialists',
    niche: 'HVAC',
    location: 'Miami, FL',
    speed_score: 48,
    responsive_status: 'not_responsive',
    seo_gaps: [
      'Missing Title Tag',
      'Multiple H1 Headers (2)',
      'Missing mobile-responsive viewport meta tags',
      '8 images missing descriptive alt tags'
    ],
    conversion_gaps: [
      'No clear Call-To-Action (CTA) buttons found',
      'No phone number detected for direct contact'
    ],
    verified_emails: ['support@miamihvacspecialists.com', 'admin@miamihvacspecialists.com'],
    outreach_status: 'new'
  },
  {
    domain: 'chicagofamilylawyer.com',
    business_name: 'Chicago Family Law Group',
    niche: 'Legal Services',
    location: 'Chicago, IL',
    speed_score: 52,
    responsive_status: 'responsive',
    seo_gaps: [
      'Missing Meta Description',
      '18 images missing descriptive alt tags',
      'Slow server response time (TTFB > 1.1s)'
    ],
    conversion_gaps: [
      'No Schema.org structured data detected (Local SEO risk)'
    ],
    verified_emails: ['hello@chicagofamilylawyer.com'],
    outreach_status: 'new'
  },
  {
    domain: 'portlandphysio.com',
    business_name: 'Portland Physical Therapy',
    niche: 'Healthcare',
    location: 'Portland, OR',
    speed_score: 39,
    responsive_status: 'not_responsive',
    seo_gaps: [
      'No H1 Header Found',
      'Missing Meta Description',
      'Missing mobile-responsive viewport meta tags',
      '22 images missing descriptive alt tags'
    ],
    conversion_gaps: [
      'No clear Call-To-Action (CTA) buttons found',
      'Missing social media links (Trust gap)'
    ],
    verified_emails: ['frontdesk@portlandphysio.com', 'billing@portlandphysio.com'],
    outreach_status: 'new'
  },
  {
    domain: 'phoenixautopainting.com',
    business_name: 'Phoenix Auto Painting & Collision',
    niche: 'Auto Repair',
    location: 'Phoenix, AZ',
    speed_score: 71,
    responsive_status: 'responsive',
    seo_gaps: [
      'No H1 Header Found',
      'Missing Meta Description',
      '5 images missing descriptive alt tags'
    ],
    conversion_gaps: [
      'No Schema.org structured data detected (Local SEO risk)'
    ],
    verified_emails: ['estimates@phoenixautopainting.com'],
    outreach_status: 'new'
  },
  {
    domain: 'atlantacateringco.com',
    business_name: 'Atlanta Catering Company',
    niche: 'Catering & Events',
    location: 'Atlanta, GA',
    speed_score: 44,
    responsive_status: 'not_responsive',
    seo_gaps: [
      'Missing Meta Description',
      'Missing Title Tag',
      '19 images missing descriptive alt tags',
      'Missing mobile-responsive viewport meta tags'
    ],
    conversion_gaps: [
      'No clear Call-To-Action (CTA) buttons found',
      'No phone number detected for direct contact'
    ],
    verified_emails: ['bookings@atlantacateringco.com', 'chef@atlantacateringco.com'],
    outreach_status: 'new'
  },
  {
    domain: 'austinlandscapingexperts.com',
    business_name: 'Austin Landscaping Experts',
    niche: 'Landscaping',
    location: 'Austin, TX',
    speed_score: 61,
    responsive_status: 'responsive',
    seo_gaps: [
      'Multiple H1 Headers (4)',
      'SSL certificate is missing or invalid (Site loaded over HTTP)'
    ],
    conversion_gaps: [
      'Missing social media links (Trust gap)'
    ],
    verified_emails: ['info@austinlandscapingexperts.com'],
    outreach_status: 'new'
  },
  {
    domain: 'sfchiropracticcenter.com',
    business_name: 'San Francisco Chiropractic Center',
    niche: 'Healthcare',
    location: 'San Francisco, CA',
    speed_score: 35,
    responsive_status: 'not_responsive',
    seo_gaps: [
      'Missing Meta Description',
      'No H1 Header Found',
      '31 images missing descriptive alt tags',
      'Missing mobile-responsive viewport meta tags'
    ],
    conversion_gaps: [
      'No clear Call-To-Action (CTA) buttons found',
      'No phone number detected for direct contact'
    ],
    verified_emails: ['dr.lee@sfchiropracticcenter.com', 'contact@sfchiropracticcenter.com'],
    outreach_status: 'new'
  },
  {
    domain: 'lasvegaspoolcleaners.com',
    business_name: 'Las Vegas Pool Cleaners',
    niche: 'Pool Maintenance',
    location: 'Las Vegas, NV',
    speed_score: 68,
    responsive_status: 'responsive',
    seo_gaps: [
      'Missing Meta Description',
      'No H1 Header Found',
      '9 images missing descriptive alt tags'
    ],
    conversion_gaps: [
      'No Schema.org structured data detected (Local SEO risk)'
    ],
    verified_emails: ['clean@lasvegaspoolcleaners.com'],
    outreach_status: 'new'
  },
  {
    domain: 'houstonpestpatrol.com',
    business_name: 'Houston Pest Patrol',
    niche: 'Pest Control',
    location: 'Houston, TX',
    speed_score: 55,
    responsive_status: 'responsive',
    seo_gaps: [
      'Missing Meta Description',
      'SSL certificate is missing or invalid (Site loaded over HTTP)',
      '14 images missing descriptive alt tags'
    ],
    conversion_gaps: [
      'Missing social media links (Trust gap)'
    ],
    verified_emails: ['help@houstonpestpatrol.com'],
    outreach_status: 'new'
  },
  {
    domain: 'nashvilleboutiquehotel.com',
    business_name: 'Nashville Boutique Lodging',
    niche: 'Hospitality',
    location: 'Nashville, TN',
    speed_score: 33,
    responsive_status: 'not_responsive',
    seo_gaps: [
      'Missing Title Tag',
      'Missing Meta Description',
      'No H1 Header Found',
      '53 images missing descriptive alt tags',
      'Missing mobile-responsive viewport meta tags'
    ],
    conversion_gaps: [
      'No clear Call-To-Action (CTA) buttons found',
      'No phone number detected for direct contact',
      'Missing social media links (Trust gap)'
    ],
    verified_emails: ['stay@nashvilleboutiquehotel.com', 'events@nashvilleboutiquehotel.com'],
    outreach_status: 'new'
  },
  {
    domain: 'sandiegopetsalon.com',
    business_name: 'San Diego Pet Salon',
    niche: 'Pet Services',
    location: 'San Diego, CA',
    speed_score: 72,
    responsive_status: 'responsive',
    seo_gaps: [
      'Missing Meta Description',
      'No H1 Header Found'
    ],
    conversion_gaps: [
      'No Schema.org structured data detected (Local SEO risk)'
    ],
    verified_emails: ['grooming@sandiegopetsalon.com'],
    outreach_status: 'new'
  },
  {
    domain: 'phillybuildersgroup.com',
    business_name: 'Philadelphia Builders Group',
    niche: 'Construction',
    location: 'Philadelphia, PA',
    speed_score: 41,
    responsive_status: 'not_responsive',
    seo_gaps: [
      'No H1 Header Found',
      'Missing Meta Description',
      '27 images missing descriptive alt tags',
      'Missing mobile-responsive viewport meta tags'
    ],
    conversion_gaps: [
      'No clear Call-To-Action (CTA) buttons found',
      'No phone number detected for direct contact'
    ],
    verified_emails: ['projects@phillybuildersgroup.com', 'admin@phillybuildersgroup.com'],
    outreach_status: 'new'
  },
  {
    domain: 'seattleaccountingpros.com',
    business_name: 'Seattle Accounting Associates',
    niche: 'Financial Services',
    location: 'Seattle, WA',
    speed_score: 63,
    responsive_status: 'responsive',
    seo_gaps: [
      'Multiple H1 Headers (2)',
      'Missing Meta Description',
      'SSL certificate is missing or invalid (Site loaded over HTTP)'
    ],
    conversion_gaps: [
      'Missing social media links (Trust gap)'
    ],
    verified_emails: ['tax@seattleaccountingpros.com', 'cpa@seattleaccountingpros.com'],
    outreach_status: 'new'
  },
  {
    domain: 'tampafitnesstraining.com',
    business_name: 'Tampa Bay Fitness & Personal Training',
    niche: 'Fitness',
    location: 'Tampa, FL',
    speed_score: 46,
    responsive_status: 'not_responsive',
    seo_gaps: [
      'Missing Meta Description',
      'No H1 Header Found',
      '15 images missing descriptive alt tags',
      'Missing mobile-responsive viewport meta tags'
    ],
    conversion_gaps: [
      'No clear Call-To-Action (CTA) buttons found',
      'No phone number detected for direct contact'
    ],
    verified_emails: ['train@tampafitnesstraining.com'],
    outreach_status: 'new'
  },
  {
    domain: 'austinflowercart.com',
    business_name: 'Austin Flower Cart & Florist',
    niche: 'Retail / Florist',
    location: 'Austin, TX',
    speed_score: 50,
    responsive_status: 'responsive',
    seo_gaps: [
      'Missing Meta Description',
      '23 images missing descriptive alt tags',
      'Slow server response time (TTFB > 1.3s)'
    ],
    conversion_gaps: [
      'No Schema.org structured data detected (Local SEO risk)'
    ],
    verified_emails: ['orders@austinflowercart.com', 'hello@austinflowercart.com'],
    outreach_status: 'new'
  },
  {
    domain: 'bouldermedspa.com',
    business_name: 'Boulder Laser & Med Spa',
    niche: 'Beauty / Wellness',
    location: 'Boulder, CO',
    speed_score: 37,
    responsive_status: 'not_responsive',
    seo_gaps: [
      'No H1 Header Found',
      'Missing Meta Description',
      '41 images missing descriptive alt tags',
      'Missing mobile-responsive viewport meta tags'
    ],
    conversion_gaps: [
      'No clear Call-To-Action (CTA) buttons found',
      'Missing social media links (Trust gap)'
    ],
    verified_emails: ['info@bouldermedspa.com', 'manager@bouldermedspa.com'],
    outreach_status: 'new'
  },
  {
    domain: 'detroitlockandkey.com',
    business_name: 'Detroit Lock & Key Services',
    niche: 'Locksmith',
    location: 'Detroit, MI',
    speed_score: 74,
    responsive_status: 'responsive',
    seo_gaps: [
      'Missing Meta Description',
      'SSL certificate is missing or invalid (Site loaded over HTTP)'
    ],
    conversion_gaps: [
      'No phone number detected for direct contact'
    ],
    verified_emails: ['emergency@detroitlockandkey.com'],
    outreach_status: 'new'
  },
  {
    domain: 'charlottecleaningpros.com',
    business_name: 'Charlotte Cleaning Professionals',
    niche: 'Cleaning Services',
    location: 'Charlotte, NC',
    speed_score: 57,
    responsive_status: 'responsive',
    seo_gaps: [
      'Multiple H1 Headers (2)',
      '11 images missing descriptive alt tags',
      'Missing Meta Description'
    ],
    conversion_gaps: [
      'No Schema.org structured data detected (Local SEO risk)'
    ],
    verified_emails: ['quote@charlottecleaningpros.com'],
    outreach_status: 'new'
  },
  {
    domain: 'dallaselectricians.net',
    business_name: 'Dallas Electric & Lighting',
    niche: 'Electrical Services',
    location: 'Dallas, TX',
    speed_score: 49,
    responsive_status: 'not_responsive',
    seo_gaps: [
      'No H1 Header Found',
      'Missing Meta Description',
      '16 images missing descriptive alt tags',
      'Missing mobile-responsive viewport meta tags'
    ],
    conversion_gaps: [
      'No clear Call-To-Action (CTA) buttons found',
      'No phone number detected for direct contact'
    ],
    verified_emails: ['service@dallaselectricians.net', 'billing@dallaselectricians.net'],
    outreach_status: 'new'
  },
  {
    domain: 'minneapolisphysique.com',
    business_name: 'Minneapolis Physique Gym',
    niche: 'Fitness',
    location: 'Minneapolis, MN',
    speed_score: 43,
    responsive_status: 'not_responsive',
    seo_gaps: [
      'Missing Meta Description',
      'No H1 Header Found',
      '38 images missing descriptive alt tags',
      'Missing mobile-responsive viewport meta tags'
    ],
    conversion_gaps: [
      'No clear Call-To-Action (CTA) buttons found',
      'Missing social media links (Trust gap)'
    ],
    verified_emails: ['memberships@minneapolisphysique.com'],
    outreach_status: 'new'
  },
  {
    domain: 'sacramentotreesurgery.com',
    business_name: 'Sacramento Tree Surgery',
    niche: 'Tree Care',
    location: 'Sacramento, CA',
    speed_score: 60,
    responsive_status: 'responsive',
    seo_gaps: [
      'Missing Meta Description',
      'No H1 Header Found',
      'SSL certificate is missing or invalid (Site loaded over HTTP)'
    ],
    conversion_gaps: [
      'No phone number detected for direct contact',
      'No Schema.org structured data detected (Local SEO risk)'
    ],
    verified_emails: ['arborist@sacramentotreesurgery.com', 'office@sacramentotreesurgery.com'],
    outreach_status: 'new'
  }
];

async function seedDatabase() {
  try {
    // 1. Initialize Tables
    await initializeSchema();

    // 2. Clear Existing Data (enables fresh seeding)
    console.log('Clearing old seed data...');
    await dbQuery.run('DELETE FROM unlocked_leads;');
    await dbQuery.run('DELETE FROM leads;');
    await dbQuery.run('DELETE FROM users;');

    // 3. Seed Users (with hashed passwords using bcryptjs)
    console.log('Seeding subscriber accounts...');
    
    // Hash password 'password123'
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('password123', salt);

    const users = [
      {
        id: generateUUID(),
        email: 'free@leadsprout.com',
        password_hash: passwordHash,
        company_name: 'Freelancer Joe',
        plan: 'free',
        subscription_status: 'inactive'
      },
      {
        id: generateUUID(),
        email: 'basic@leadsprout.com',
        password_hash: passwordHash,
        company_name: 'Basic Agency Ltd',
        plan: 'basic',
        subscription_status: 'active'
      },
      {
        id: generateUUID(),
        email: 'pro@leadsprout.com',
        password_hash: passwordHash,
        company_name: 'Apex SEO Partners',
        plan: 'pro',
        subscription_status: 'active'
      },
      {
        id: generateUUID(),
        email: 'agency@leadsprout.com',
        password_hash: passwordHash,
        company_name: 'GrowthSpurt Marketing',
        plan: 'agency',
        subscription_status: 'active'
      }
    ];

    for (const u of users) {
      await dbQuery.run(`
        INSERT INTO users (id, email, password_hash, company_name, plan, subscription_status)
        VALUES (?, ?, ?, ?, ?, ?);
      `, [u.id, u.email, u.password_hash, u.company_name, u.plan, u.subscription_status]);
    }
    console.log(`Seeded ${users.length} subscriber accounts successfully (Password is 'password123').`);

    // 4. Seed Leads
    console.log('Seeding qualified business leads...');
    let leadsSeededCount = 0;
    
    for (const l of SEED_LEADS) {
      const leadId = generateUUID();
      const seoGapsJson = JSON.stringify(l.seo_gaps);
      const conversionGapsJson = JSON.stringify(l.conversion_gaps || []);
      const emailsJson = JSON.stringify(l.verified_emails);

      await dbQuery.run(`
        INSERT INTO leads (id, domain, business_name, niche, location, speed_score, responsive_status, seo_gaps, conversion_gaps, verified_emails, outreach_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `, [
        leadId,
        l.domain,
        l.business_name,
        l.niche,
        l.location,
        l.speed_score,
        l.responsive_status,
        seoGapsJson,
        conversionGapsJson,
        emailsJson,
        l.outreach_status
      ]);
      leadsSeededCount++;
    }
    console.log(`Seeded ${leadsSeededCount} business leads successfully.`);

    // 5. Setup initial unlocks for demo purposes
    console.log('Pre-unlocking some leads for the Pro & Agency accounts...');
    
    const proUser = await dbQuery.get("SELECT id FROM users WHERE email = 'pro@leadsprout.com';");
    const agencyUser = await dbQuery.get("SELECT id FROM users WHERE email = 'agency@leadsprout.com';");
    
    const randomLeads = await dbQuery.all("SELECT id FROM leads LIMIT 5;");

    if (proUser && randomLeads.length > 0) {
      await dbQuery.run(`
        INSERT INTO unlocked_leads (user_id, lead_id)
        VALUES (?, ?);
      `, [proUser.id, randomLeads[0].id]);
      
      await dbQuery.run(`
        INSERT INTO unlocked_leads (user_id, lead_id)
        VALUES (?, ?);
      `, [proUser.id, randomLeads[1].id]);
    }

    if (agencyUser && randomLeads.length > 2) {
      await dbQuery.run(`
        INSERT INTO unlocked_leads (user_id, lead_id)
        VALUES (?, ?);
      `, [agencyUser.id, randomLeads[2].id]);
      
      await dbQuery.run(`
        INSERT INTO unlocked_leads (user_id, lead_id)
        VALUES (?, ?);
      `, [agencyUser.id, randomLeads[3].id]);
      
      await dbQuery.run(`
        INSERT INTO unlocked_leads (user_id, lead_id)
        VALUES (?, ?);
      `, [agencyUser.id, randomLeads[4].id]);
    }
    
    console.log('Database seeding completely finished.');
    process.exit(0);
  } catch (error) {
    console.error('Database seeding failed:', error);
    process.exit(1);
  }
}

seedDatabase();
