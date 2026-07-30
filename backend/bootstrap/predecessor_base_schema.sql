-- LeadSprout predecessor base schema for an exact empty isolated datastore.
-- Historical provenance (informative, not normative):
-- commit 9da18cb6698bb72f27d9edc29e9e5819fb96187a
-- blob 51c7493d7830b79f099c866230af03af49650b98
-- raw file SHA-256 5e87967515219ddda76ca51bb62dcd7443ab2796f8a99f1a8da5409569da9f78
--
-- This reviewed artifact is normative only through the immutable digest bound
-- by the controlled migration runner. It contains no seed or customer data.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  company_name TEXT,
  logo_url TEXT,
  calendly_link TEXT,
  persona TEXT DEFAULT 'web_agency',
  plan TEXT NOT NULL DEFAULT 'free',
  subscription_status TEXT NOT NULL DEFAULT 'inactive',
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  domain TEXT UNIQUE NOT NULL,
  business_name TEXT,
  niche TEXT NOT NULL,
  location TEXT NOT NULL,
  speed_score INTEGER CHECK(speed_score BETWEEN 0 AND 100),
  responsive_status TEXT NOT NULL,
  seo_gaps TEXT NOT NULL,
  conversion_gaps TEXT,
  verified_emails TEXT,
  outreach_status TEXT NOT NULL DEFAULT 'new',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE unlocked_leads (
  user_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, lead_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);
