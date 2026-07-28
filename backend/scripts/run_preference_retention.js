const { dbQuery } = require('../database');
const { dueCases } = require('../services/preferenceRetentionService');
const { processCase } = require('../services/preferenceRetentionWorker');

async function run(options = {}) {
  if (options.controlledInternalIdentity !== true || !options.workerIdentity) {
    throw new Error('RETENTION_WORKER_AUTHORITY_REQUIRED');
  }
  const now = options.now || new Date().toISOString();
  const cases = await dueCases(options.dbQuery || dbQuery, now);
  const results = [];
  for (const row of cases) {
    results.push(await processCase(options.dbQuery || dbQuery, {
      retentionCaseId: row.retention_case_id,
      workerIdentity: options.workerIdentity,
      controlledInternalIdentity: true,
      now
    }));
  }
  return results;
}

if (require.main === module) {
  console.error('CONTROLLED_INVOCATION_REQUIRED');
  process.exitCode = 1;
}

module.exports = { run };
