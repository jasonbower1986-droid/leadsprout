const { IndependentEvidenceIntegrityGate } = require('../utils/evidence-integrity-authority');
const readonlySchema = require('./verify_schema_readonly');

const {
  EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST,
  EXPECTED_SCHEMA_MANIFEST,
  FINAL_SCHEMA_INVENTORY_DIGEST_DOMAIN,
  FINAL_SCHEMA_INVENTORY_SHA256,
  MigrationControlError,
  featureDisabled,
  migrationInventory,
  verifyFinalSchemaInventory,
  verifyPredecessorBaseSchema,
  verifyStructuralSchema
} = readonlySchema;

function fail(code) {
  throw new MigrationControlError(code);
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
    'SELECT migration_id, filename, sequence, checksum, outcome FROM schema_migrations ORDER BY sequence'
  ).catch(() => fail('LEDGER_MISSING'));
  if (rows.length !== inventory.length) fail('LEDGER_MISSING');
  rows.forEach((row, index) => {
    const expected = inventory[index];
    if (row.outcome !== 'COMPLETED' && row.outcome !== 'ADOPTED') fail('LEDGER_DIRTY');
    if (Number(row.sequence) !== expected.sequence || row.migration_id !== expected.migration_id) {
      fail('LEDGER_ORDER');
    }
    if (row.filename !== expected.filename) fail('LEDGER_UNKNOWN');
    if (row.checksum !== expected.checksum) fail('LEDGER_CHECKSUM');
  });

  await verifyStructuralSchema(query, EXPECTED_SCHEMA_MANIFEST, {
    migrationsDir: options.migrationsDir
  });
  await verifyPredecessorBaseSchema(query, {
    afterMigration001: true,
    errorCode: 'SCHEMA_MISMATCH'
  });

  await gate.verify(query).catch(() => fail('ATTESTATION_INVALID'));
  await verifyFinalSchemaInventory(query);
  featureDisabled(options.finalFeatureState);
  return Object.freeze({
    status: 'VERIFIED',
    feature_enabled: false,
    final_schema_inventory_sha256: FINAL_SCHEMA_INVENTORY_SHA256,
    final_schema_inventory_digest_domain: FINAL_SCHEMA_INVENTORY_DIGEST_DOMAIN,
    final_schema_inventory_serialization:
      EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST.serialization,
    final_schema_inventory_preimage_byte_length:
      EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST.byte_length,
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
  ...readonlySchema,
  verifySchema
};
