/**
 * LeadSprout Database Connection via team-db CLI (Turso Synced)
 * 
 * Instead of local SQLite, this version uses the shared team-db CLI
 * to ensure all team members see the same data across all sessions.
 */

const { spawnSync } = require('child_process');
const { verifyEvidenceIdentityIntegrity } = require('./utils/evidence-identity-repository');

/**
 * Helper to interpolate SQL parameters for team-db CLI.
 */
function interpolate(sql, params = []) {
  let interpolatedSql = sql;
  for (const param of params) {
    const val = typeof param === 'string' 
      ? `'${param.replace(/'/g, "''")}'` 
      : (param === null || param === undefined ? 'NULL' : param);
    interpolatedSql = interpolatedSql.replace('?', val);
  }
  return interpolatedSql;
}

/**
 * Promisified database query functions using team-db CLI.
 */
const dbQuery = {
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      try {
        const interpolatedSql = interpolate(sql, params);

        const res = spawnSync('team-db', [interpolatedSql], { encoding: 'utf-8' });
        if (res.error) throw res.error;
        if (res.status !== 0) throw new Error(res.stderr || `team-db failed with status ${res.status}`);
        
        resolve({ lastID: null, changes: 1 });
      } catch (err) {
        console.error('team-db run error:', err.message, 'SQL:', sql);
        reject(err);
      }
    });
  },

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      try {
        const interpolatedSql = interpolate(sql, params);

        const res = spawnSync('team-db', [interpolatedSql], { encoding: 'utf-8' });
        if (res.error) throw res.error;
        if (res.status !== 0) throw new Error(res.stderr || `team-db failed with status ${res.status}`);
        
        const rows = JSON.parse(res.stdout || '[]');
        resolve(rows[0] || null);
      } catch (err) {
        console.error('team-db get error:', err.message, 'SQL:', sql);
        reject(err);
      }
    });
  },

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      try {
        const interpolatedSql = interpolate(sql, params);

        const res = spawnSync('team-db', [interpolatedSql], { encoding: 'utf-8' });
        if (res.error) throw res.error;
        if (res.status !== 0) throw new Error(res.stderr || `team-db failed with status ${res.status}`);
        
        const rows = JSON.parse(res.stdout || '[]');
        resolve(rows);
      } catch (err) {
        console.error('team-db all error:', err.message, 'SQL:', sql);
        reject(err);
      }
    });
  },

  exec(sql) {
    return this.run(sql);
  }
};

/**
 * Initializes database schemas. Creates tables if they don't exist.
 * This is now mostly handled by the migration script, but kept for consistency.
 */
async function initializeSchema() {
  console.log('Verifying Turso database tables...');

  // Gate 001: Add evidence_state column for Evidence Integrity metadata persistence
  try {
    await dbQuery.run("ALTER TABLE leads ADD COLUMN evidence_state TEXT DEFAULT NULL;");
    console.log('✅ Added evidence_state column to leads table');
  } catch (err) {
    if (err.message && err.message.includes('duplicate column')) {
      console.log('ℹ️ evidence_state column already exists');
    } else {
      console.error('❌ Failed to add evidence_state column:', err.message);
      throw err;
    }
  }

  try {
    await dbQuery.run(`CREATE TABLE IF NOT EXISTS evidence_authorisations (
      contract_id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      contract_json TEXT NOT NULL,
      supersedes_contract_id TEXT DEFAULT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`);
    console.log('✅ Evidence Authorisation history storage verified');
  } catch (err) {
    console.error('❌ Failed to verify Evidence Authorisation history storage:', err.message);
    throw err;
  }

  try {
    const existingIdentityTable = await dbQuery.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'evidence_identities';");
    if (existingIdentityTable) {
      await verifyEvidenceIdentityIntegrity(dbQuery);
      console.log('✅ Evidence Identity pre-migration integrity verified');
    }
    await dbQuery.run(`CREATE TABLE IF NOT EXISTS evidence_identities (
      evidence_id TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      standard_version INTEGER NOT NULL,
      item_kind TEXT NOT NULL CHECK (item_kind IN ('SOURCE', 'FRAGMENT', 'DERIVED')),
      subject_business_id TEXT NOT NULL,
      source_namespace TEXT NOT NULL,
      source_locator TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      fragment_locator TEXT NOT NULL DEFAULT '',
      parent_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
      derivation_profile TEXT NOT NULL DEFAULT '',
      canonical_payload_digest TEXT NOT NULL UNIQUE,
      provenance_record_id TEXT NOT NULL,
      source_profile_version TEXT NOT NULL,
      derivation_profile_version TEXT DEFAULT NULL,
      lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('ACTIVE', 'SUPERSEDED', 'INVALIDATED')),
      supersedes_evidence_id TEXT DEFAULT NULL,
      superseded_by_evidence_id TEXT DEFAULT NULL,
      created_at TEXT NOT NULL
    );`);
    await dbQuery.run(`CREATE INDEX IF NOT EXISTS idx_evidence_identities_subject
      ON evidence_identities (subject_business_id, lifecycle_state);`);
    await dbQuery.run(`CREATE TABLE IF NOT EXISTS evidence_identity_lifecycle_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_id TEXT NOT NULL,
      from_state TEXT DEFAULT NULL,
      to_state TEXT NOT NULL CHECK (to_state IN ('ACTIVE', 'SUPERSEDED', 'INVALIDATED')),
      reason TEXT NOT NULL,
      responsible_authority TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      FOREIGN KEY (evidence_id) REFERENCES evidence_identities(evidence_id)
    );`);
    await dbQuery.run(`CREATE INDEX IF NOT EXISTS idx_evidence_identity_events
      ON evidence_identity_lifecycle_events (evidence_id, event_id);`);
    await dbQuery.run(`CREATE TABLE IF NOT EXISTS evidence_authorisation_evidence_identities (
      contract_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      lifecycle_state_at_decision TEXT NOT NULL CHECK (lifecycle_state_at_decision IN ('ACTIVE', 'SUPERSEDED', 'INVALIDATED')),
      PRIMARY KEY (contract_id, evidence_id),
      FOREIGN KEY (contract_id) REFERENCES evidence_authorisations(contract_id) ON DELETE RESTRICT,
      FOREIGN KEY (evidence_id) REFERENCES evidence_identities(evidence_id) ON DELETE RESTRICT
    );`);
    await verifyEvidenceIdentityIntegrity(dbQuery);
    console.log('✅ Evidence Identity post-migration integrity verified');
    console.log('✅ Evidence Identity storage verified');
  } catch (err) {
    console.error('❌ Failed to verify Evidence Identity storage:', err.message);
    throw err;
  }

  console.log('Database tables verified.');
}

module.exports = {
  db: null, // Legacy support
  dbQuery,
  initializeSchema
};
