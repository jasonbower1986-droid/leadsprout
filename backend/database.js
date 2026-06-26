/**
 * LeadSprout Database Connection and Initializer
 * 
 * Sets up SQLite database, tables, and provides helper functions.
 * The database file resides in the shared directory to be accessible across team modules.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Path to the shared database file
const DB_DIR = '/home/team/shared';
const DB_PATH = path.join(DB_DIR, 'leadsprout.db');

// Ensure the directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to connect to LeadSprout SQLite Database:', err.message);
  } else {
    console.log('Connected to LeadSprout SQLite Database at:', DB_PATH);
  }
});

/**
 * Promisified database query functions for clean async/await syntax.
 */
const dbQuery = {
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  },

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  exec(sql) {
    return new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
};

/**
 * Initializes database schemas. Creates tables if they don't exist.
 */
async function initializeSchema() {
  console.log('Initializing database tables...');
  
  // Enable foreign keys
  await dbQuery.run('PRAGMA foreign_keys = ON;');

  // 1. Create Users (Subscribers) table
  await dbQuery.run(`
    CREATE TABLE IF NOT EXISTS users (
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
  `);

  // 2. Create Leads table
  await dbQuery.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      domain TEXT UNIQUE NOT NULL,
      business_name TEXT,
      niche TEXT NOT NULL,
      location TEXT NOT NULL,
      speed_score INTEGER CHECK(speed_score BETWEEN 0 AND 100),
      responsive_status TEXT NOT NULL,
      seo_gaps TEXT NOT NULL, -- Stored as a JSON string
      conversion_gaps TEXT,   -- Stored as a JSON string
      verified_emails TEXT,   -- Stored as a JSON string
      outreach_status TEXT NOT NULL DEFAULT 'new',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Create Unlocked Leads junction table (to track user's unlocked leads and enforce subscription limits)
  await dbQuery.run(`
    CREATE TABLE IF NOT EXISTS unlocked_leads (
      user_id TEXT NOT NULL,
      lead_id TEXT NOT NULL,
      unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, lead_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );
  `);

  console.log('Database tables verified / initialized successfully.');
}

module.exports = {
  db,
  dbQuery,
  initializeSchema,
  DB_PATH
};
