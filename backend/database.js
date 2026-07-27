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
  let index = 0;
  const interpolatedSql = sql.replace(/\?/g, () => {
    if (index >= params.length) throw new Error('Missing SQL parameter');
    const param = params[index++];
    return typeof param === 'string'
      ? `'${param.replace(/'/g, "''")}'`
      : (param === null || param === undefined ? 'NULL' : String(param));
  });
  if (index !== params.length) throw new Error('Unused SQL parameter');
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
  },

  transaction(operations = []) {
    return new Promise((resolve, reject) => {
      try {
        if (!Array.isArray(operations) || operations.length === 0) return resolve({ changes: 0 });
        const statements = operations.map(operation => interpolate(operation.sql, operation.params || []));
        const transactionSql = `BEGIN IMMEDIATE;\n${statements.join(';\n')};\nCOMMIT;`;
        const res = spawnSync('team-db', [transactionSql], { encoding: 'utf-8' });
        if (res.error) throw res.error;
        if (res.status !== 0) throw new Error(res.stderr || `team-db transaction failed with status ${res.status}`);
        resolve({ changes: operations.length });
      } catch (err) {
        console.error('team-db transaction error:', err.message);
        reject(err);
      }
    });
  }
};

/**
 * Compatibility entry point retained for existing callers.
 * The operation is verification-only and never creates or mutates schema.
 */
async function initializeSchema(options = {}) {
  // Compatibility export for callers/tests. This operation is intentionally
  // read-only and delegates to the canonical pre-start verifier.
  const { verifySchema } = require('./scripts/verify_schema');
  return verifySchema({ ...options, dbQuery: options.dbQuery || dbQuery });
}

module.exports = {
  db: null, // Legacy support
  dbQuery,
  initializeSchema,
  interpolate
};
