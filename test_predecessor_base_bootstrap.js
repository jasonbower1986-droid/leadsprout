const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.OPPORTUNITY_WORKSPACE_ENABLED = 'false';

const sqlite3 = require('./backend/node_modules/sqlite3');
const {
  buildBootstrapTransaction,
  predecessorBaseSchema,
  PREDECESSOR_BASE_PROVENANCE,
  PREDECESSOR_BASE_SCHEMA_SHA256
} = require('./backend/scripts/apply_migrations');
const {
  EXPECTED_SCHEMA_MANIFEST,
  EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST,
  expectedFinalSchemaInventory,
  finalSchemaInventoryDigest,
  migrationInventory,
  verifyEmptyDatastore,
  verifyFinalSchemaInventory,
  verifyPredecessorBaseSchema,
  verifySchema,
  verifyStructuralSchema
} = require('./backend/scripts/verify_schema');

function database(filename = ':memory:') {
  const raw = new sqlite3.Database(filename);
  const invoke = (method, sql, params = []) => new Promise((resolve, reject) => {
    raw[method](sql, params, function callback(error, rows) {
      if (error) reject(error);
      else resolve(method === 'run' ? this : rows);
    });
  });
  return {
    all: (sql, params) => invoke('all', sql, params),
    get: (sql, params) => invoke('get', sql, params),
    run: (sql, params) => invoke('run', sql, params),
    exec: sql => new Promise((resolve, reject) =>
      raw.exec(sql, error => error ? reject(error) : resolve())),
    close: () => new Promise((resolve, reject) =>
      raw.close(error => error ? reject(error) : resolve()))
  };
}

async function rejectsCode(action, code) {
  await assert.rejects(action, error => error?.code === code);
}

async function run() {
  const inventory = migrationInventory();
  const base = predecessorBaseSchema();
  assert.strictEqual(base.sha256, PREDECESSOR_BASE_SCHEMA_SHA256);
  assert.deepStrictEqual(base.provenance, PREDECESSOR_BASE_PROVENANCE);

  const expectedInventory = expectedFinalSchemaInventory();
  const inventoryDigest = finalSchemaInventoryDigest(expectedInventory);
  const canonicalPreimage =
    'LEADSPROUT_FINAL_SQLITE_SCHEMA_INVENTORY_V1\n' +
    expectedInventory.map(row => JSON.stringify(row)).join('\n') + '\n';
  assert(Object.isFrozen(EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST));
  assert(Object.isFrozen(expectedInventory));
  assert(expectedInventory.every(Object.isFrozen));
  assert.strictEqual(inventoryDigest.canonical, canonicalPreimage);
  assert.strictEqual(inventoryDigest.byte_length, Buffer.byteLength(canonicalPreimage, 'utf8'));
  assert.strictEqual(
    crypto.createHash('sha256').update(canonicalPreimage, 'utf8').digest('hex'),
    EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST.sha256
  );
  const substitutedInventory = expectedInventory.map(row => [...row]);
  substitutedInventory[0][1] = 'substituted';
  assert.throws(
    () => finalSchemaInventoryDigest(substitutedInventory),
    /SCHEMA_INVENTORY_DIGEST_MISMATCH/
  );

  const empty = database();
  await verifyEmptyDatastore(empty);
  await empty.exec(base.content);
  await verifyPredecessorBaseSchema(empty, { exact: true });
  await empty.close();

  const nonempty = database();
  await nonempty.exec('CREATE TABLE unexpected(id TEXT PRIMARY KEY)');
  await rejectsCode(() => verifyEmptyDatastore(nonempty), 'EMPTY_DATASTORE_REQUIRED');
  await nonempty.close();

  const altered = database();
  await altered.exec(base.content.replace(
    'speed_score INTEGER CHECK(speed_score BETWEEN 0 AND 100)',
    'speed_score INTEGER'
  ));
  await rejectsCode(
    () => verifyPredecessorBaseSchema(altered, { exact: true }),
    'BASE_SCHEMA_MISMATCH'
  );
  await altered.close();

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leadsprout-base-artifact-'));
  fs.writeFileSync(
    path.join(temp, 'predecessor_base_schema.sql'),
    `${base.content}\n-- tampered\n`
  );
  assert.throws(() => predecessorBaseSchema(temp), /BASE_SCHEMA_ARTIFACT_INVALID/);
  fs.rmSync(temp, { recursive: true, force: true });

  const transaction = buildBootstrapTransaction({
    baseSchema: base,
    inventory,
    revision: 'a'.repeat(40),
    target: 'isolated-disposable',
    operator: 'synthetic-test',
    startedAt: '2026-07-30T00:00:00Z'
  });
  assert.strictEqual((transaction.match(/BEGIN IMMEDIATE/g) || []).length, 1);
  assert.strictEqual((transaction.match(/COMMIT;/g) || []).length, 1);
  assert(transaction.indexOf('CREATE TABLE users') < transaction.indexOf(inventory[0].content));

  const complete = database();
  await complete.exec(transaction);
  await verifyPredecessorBaseSchema(complete, { afterMigration001: true });
  await verifyStructuralSchema(complete, EXPECTED_SCHEMA_MANIFEST);
  await verifyFinalSchemaInventory(complete);
  assert.deepStrictEqual(await complete.all('PRAGMA foreign_key_check'), []);
  const ledger = await complete.all(
    'SELECT migration_id,filename,sequence,checksum,outcome FROM schema_migrations ORDER BY sequence'
  );
  assert.deepStrictEqual(ledger.map(row => row.migration_id), [
    '001', '002', '003', '004', '005', '006', '007', '008'
  ]);
  assert(ledger.every((row, index) =>
    row.filename === inventory[index].filename &&
    Number(row.sequence) === index + 1 &&
    row.checksum === inventory[index].checksum &&
    row.outcome === 'COMPLETED'
  ));
  const verification = await verifySchema({
    dbQuery: complete,
    integrityGate: { verify: async () => ({ status: 'VERIFIED' }) }
  });
  assert.strictEqual(
    verification.final_schema_inventory_sha256,
    EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST.sha256
  );
  assert.strictEqual(
    verification.final_schema_inventory_digest_domain,
    EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST.domain
  );
  assert.strictEqual(
    verification.final_schema_inventory_serialization,
    EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST.serialization
  );
  assert.strictEqual(
    verification.final_schema_inventory_preimage_byte_length,
    EXPECTED_FINAL_SCHEMA_INVENTORY_DIGEST.byte_length
  );

  const adversarialObjects = [
    ['table', 'CREATE TABLE unexpected_extra(id TEXT PRIMARY KEY)'],
    ['index', 'CREATE INDEX unexpected_extra_index ON leads(business_name)'],
    ['trigger', `CREATE TRIGGER unexpected_extra_trigger
      AFTER INSERT ON leads BEGIN SELECT 1; END`],
    ['view', 'CREATE VIEW unexpected_extra_view AS SELECT id FROM leads']
  ];
  for (const [type, statement] of adversarialObjects) {
    await complete.exec(statement);
    await rejectsCode(() => verifyFinalSchemaInventory(complete), 'SCHEMA_MISMATCH');
    await rejectsCode(
      () => verifySchema({
        dbQuery: complete,
        integrityGate: { verify: async () => ({ status: 'VERIFIED' }) }
      }),
      'SCHEMA_MISMATCH'
    );
    await complete.exec(`DROP ${type.toUpperCase()} unexpected_extra${type === 'table' ? '' : `_${type}`}`);
    await verifyFinalSchemaInventory(complete);
  }

  await rejectsCode(
    () => verifySchema({
      dbQuery: complete,
      integrityGate: {
        verify: async () => {
          await complete.exec(
            'CREATE VIEW unexpected_late_view AS SELECT id FROM leads'
          );
          return { status: 'VERIFIED' };
        }
      }
    }),
    'SCHEMA_MISMATCH'
  );
  await complete.exec('DROP VIEW unexpected_late_view');
  await verifyFinalSchemaInventory(complete);
  await complete.close();

  const rollbackFile = path.join(
    os.tmpdir(),
    `leadsprout-bootstrap-rollback-${process.pid}-${Date.now()}.db`
  );
  const interrupted = database(rollbackFile);
  await assert.rejects(interrupted.exec(transaction.replace(
    'COMMIT;',
    'SELECT * FROM deliberately_missing_table;\nCOMMIT;'
  )));
  await interrupted.close();
  const reopened = database(rollbackFile);
  await verifyEmptyDatastore(reopened);
  await reopened.close();
  fs.rmSync(rollbackFile, { force: true });

  console.log('PASS predecessor base-schema bootstrap positive and adversarial controls');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
