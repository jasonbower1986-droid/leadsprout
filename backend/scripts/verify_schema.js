const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { IndependentEvidenceIntegrityGate } = require('../utils/evidence-integrity-authority');

const MIGRATIONS = Object.freeze([
  '001_evidence_identity_foundation.sql',
  '002_opportunity_workspace.sql',
  '003_commercial_opportunity_design_states.sql',
  '004_evidence_integrity_operational.sql'
]);

class MigrationControlError extends Error {
  constructor(code) {
    super(code);
    this.name = 'MigrationControlError';
    this.code = code;
  }
}

function fail(code) {
  throw new MigrationControlError(code);
}

function featureDisabled(value = process.env.OPPORTUNITY_WORKSPACE_ENABLED) {
  if (value !== undefined && value !== 'false') fail('FEATURE_STATE_INVALID');
  return true;
}

function migrationInventory(migrationsDir = path.join(__dirname, '../migrations')) {
  return MIGRATIONS.map((filename, index) => {
    const content = fs.readFileSync(path.join(migrationsDir, filename));
    return Object.freeze({
      migration_id: filename.slice(0, 3),
      filename,
      sequence: index + 1,
      checksum: crypto.createHash('sha256').update(content).digest('hex'),
      content: content.toString('utf8')
    });
  });
}

function loadDependency(reference, namedExport) {
  if (!reference) return undefined;
  try {
    const loaded = require(reference);
    const dependency = loaded[namedExport] || loaded.default || loaded;
    if (!dependency || typeof dependency !== 'object') return undefined;
    return dependency;
  } catch (_) {
    return undefined;
  }
}

function expectedObjects(inventory) {
  const names = new Set(['schema_migrations']);
  const expression = /CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([a-zA-Z0-9_]+)/gi;
  for (const migration of inventory) {
    let match;
    while ((match = expression.exec(migration.content))) names.add(match[1]);
  }
  return [...names].sort();
}

async function verifySchema(options = {}) {
  featureDisabled(options.featureState);
  let gate = options.integrityGate;
  if (!gate) {
    const authority = options.authority || loadDependency(
      process.env.EVIDENCE_INTEGRITY_AUTHORITY_MODULE, 'authority'
    );
    const provenanceResolver = options.provenanceResolver || loadDependency(
      process.env.EVIDENCE_PROVENANCE_RESOLVER_MODULE, 'provenanceResolver'
    );
    gate = new IndependentEvidenceIntegrityGate({
      authority,
      provenanceResolver,
      maxAttestationAgeMs: options.maxAttestationAgeMs,
      now: options.now
    });
  }
  const query = options.dbQuery || require('../database').dbQuery;
  const inventory = options.inventory || migrationInventory(options.migrationsDir);
  const rows = await query.all(
    "SELECT migration_id, filename, sequence, checksum, outcome FROM schema_migrations ORDER BY sequence"
  ).catch(() => fail('LEDGER_MISSING'));
  if (rows.length !== inventory.length) fail('LEDGER_MISSING');
  rows.forEach((row, index) => {
    const expected = inventory[index];
    if (row.outcome !== 'COMPLETED' && row.outcome !== 'ADOPTED') fail('LEDGER_DIRTY');
    if (Number(row.sequence) !== expected.sequence || row.migration_id !== expected.migration_id) fail('LEDGER_ORDER');
    if (row.filename !== expected.filename) fail('LEDGER_UNKNOWN');
    if (row.checksum !== expected.checksum) fail('LEDGER_CHECKSUM');
  });

  const objects = await query.all(
    "SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name"
  ).catch(() => fail('SCHEMA_MISMATCH'));
  const observed = new Set(objects.map(row => row.name));
  if (expectedObjects(inventory).some(name => !observed.has(name))) fail('SCHEMA_MISMATCH');

  await gate.verify(query).catch(() => fail('ATTESTATION_INVALID'));
  featureDisabled(options.finalFeatureState);
  return Object.freeze({
    status: 'VERIFIED',
    feature_enabled: false,
    migrations: inventory.map(({ content, ...entry }) => entry)
  });
}

async function main() {
  try {
    const result = await verifySchema();
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.code || 'SCHEMA_VERIFICATION_FAILED');
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  MIGRATIONS,
  MigrationControlError,
  expectedObjects,
  featureDisabled,
  migrationInventory,
  verifySchema
};
