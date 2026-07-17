/**
 * LeadSprout Database Connection via team-db CLI (Turso Synced)
 * 
 * Instead of local SQLite, this version uses the shared team-db CLI
 * to ensure all team members see the same data across all sessions.
 */

const { spawnSync } = require('child_process');

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

  console.log('Database tables verified.');
}

module.exports = {
  db: null, // Legacy support
  dbQuery,
  initializeSchema
};
