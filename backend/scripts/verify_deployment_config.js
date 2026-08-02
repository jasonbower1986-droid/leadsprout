const fs = require('fs');
const path = require('path');
const { loadSnapshot } = require('../integrations/evidence-authority-file');
const { loadRecords } = require('../integrations/evidence-provenance-file');
const { resolveTeamDbExecutable } = require('../database');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function requireSecret(env, name, minimumLength, forbidden = []) {
  const value = env[name];
  if (typeof value !== 'string' || value.length < minimumLength || forbidden.includes(value)) {
    fail(`DEPLOYMENT_${name}_INVALID`);
  }
}

function verifyDeploymentConfig(options = {}) {
  const env = options.env || process.env;
  if (env.NODE_ENV !== 'production') fail('DEPLOYMENT_NODE_ENV_INVALID');
  if (env.OPPORTUNITY_WORKSPACE_ENABLED !== 'false') fail('DEPLOYMENT_FEATURE_STATE_INVALID');
  requireSecret(env, 'JWT_SECRET', 32, ['leadsprout-super-secret-key-2026']);
  requireSecret(env, 'STRIPE_SECRET_KEY', 16);
  requireSecret(env, 'STRIPE_WEBHOOK_SECRET', 16);
  let baseUrl;
  try { baseUrl = new URL(env.BASE_URL); } catch (_) { fail('DEPLOYMENT_BASE_URL_INVALID'); }
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password) {
    fail('DEPLOYMENT_BASE_URL_INVALID');
  }
  if (env.PORT !== undefined && (!/^\d+$/.test(env.PORT) || Number(env.PORT) < 1 || Number(env.PORT) > 65535)) {
    fail('DEPLOYMENT_PORT_INVALID');
  }
  const authority = loadSnapshot({ env });
  const provenance = loadRecords({ env });
  const databaseExecutable = resolveTeamDbExecutable(env);
  if (!authority.latest) fail('DEPLOYMENT_ATTESTATION_MISSING');
  const frontendIndex = options.frontendIndex || path.join(__dirname, '../../frontend/dist/index.html');
  try {
    if (!fs.statSync(frontendIndex).isFile()) fail('DEPLOYMENT_FRONTEND_BUILD_MISSING');
  } catch (error) {
    if (error?.code === 'DEPLOYMENT_FRONTEND_BUILD_MISSING') throw error;
    fail('DEPLOYMENT_FRONTEND_BUILD_MISSING');
  }
  return Object.freeze({
    status: 'DEPLOYMENT_CONFIGURATION_VERIFIED',
    base_url_origin: baseUrl.origin,
    authority_checkpoint: authority.latest.checkpoint_id,
    authority_sequence: authority.latest.sequence,
    provenance_record_count: provenance.size,
    authority_store_sha256: env.EVIDENCE_INTEGRITY_AUTHORITY_STORE_SHA256,
    provenance_store_sha256: env.EVIDENCE_PROVENANCE_AUTHORITY_STORE_SHA256,
    database_executable: databaseExecutable,
    database_executable_sha256: env.LEADSPROUT_TEAM_DB_EXECUTABLE_SHA256,
    frontend_index: path.resolve(frontendIndex),
    feature_enabled: false
  });
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(verifyDeploymentConfig()));
  } catch (error) {
    console.error(error.code || 'DEPLOYMENT_CONFIGURATION_INVALID');
    process.exitCode = 1;
  }
}

module.exports = { verifyDeploymentConfig };
