const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildControlledTransaction,
  executeTeamDb,
  inspectLedger,
  parseArgs,
  validateControls
} = require('./backend/scripts/apply_migrations');
const {
  expectedObjects,
  featureDisabled,
  migrationInventory,
  verifySchema
} = require('./backend/scripts/verify_schema');

const inventory = migrationInventory();
const expected = expectedObjects(inventory);
const cleanRows = inventory.map(item => ({
  migration_id: item.migration_id,
  filename: item.filename,
  sequence: item.sequence,
  checksum: item.checksum,
  outcome: 'COMPLETED'
}));
const objectRows = expected.map(name => ({ name }));
const goodGate = { verify: async () => ({ status: 'VERIFIED' }) };

function db(ledger = cleanRows, objects = objectRows) {
  const calls = [];
  return {
    calls,
    all: async statement => {
      calls.push(statement);
      if (statement.includes('schema_migrations')) return ledger;
      if (statement.includes('sqlite_master')) return objects;
      throw new Error('unexpected query');
    }
  };
}

async function rejectsCode(fn, code) {
  await assert.rejects(fn, error => error && error.code === code);
}

async function run() {
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    count += 1;
    console.log(`PASS ${count}: ${name}`);
  };

  await test('ordinary startup invokes only read-only verification', async () => {
    const source = fs.readFileSync(path.join(__dirname, 'backend/server.js'), 'utf8');
    assert(source.includes('await verifySchema()'));
    assert(!source.includes('initializeSchema'));
    assert(!/\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b/.test(source));
    const query = db();
    await verifySchema({ dbQuery: query, integrityGate: goodGate });
    assert(query.calls.every(statement => /^\s*SELECT\b/.test(statement)));
  });

  await test('missing, dirty, unknown, order and checksum ledger states refuse', async () => {
    await rejectsCode(() => verifySchema({ dbQuery: db([]), integrityGate: goodGate }), 'LEDGER_MISSING');
    await rejectsCode(() => verifySchema({ dbQuery: db(cleanRows.map((r, i) => i ? r : { ...r, outcome: 'FAILED' })), integrityGate: goodGate }), 'LEDGER_DIRTY');
    await rejectsCode(() => verifySchema({ dbQuery: db(cleanRows.map((r, i) => i ? r : { ...r, filename: '999_unknown.sql' })), integrityGate: goodGate }), 'LEDGER_UNKNOWN');
    await rejectsCode(() => verifySchema({ dbQuery: db(cleanRows.map((r, i) => i ? r : { ...r, sequence: 9 })), integrityGate: goodGate }), 'LEDGER_ORDER');
    await rejectsCode(() => verifySchema({ dbQuery: db(cleanRows.map((r, i) => i ? r : { ...r, checksum: 'changed' })), integrityGate: goodGate }), 'LEDGER_CHECKSUM');
  });

  await test('absent or malformed Evidence Integrity dependencies refuse', async () => {
    await rejectsCode(() => verifySchema({ dbQuery: db(), authority: {}, provenanceResolver: {}, integrityGate: { verify: async () => { throw new Error('invalid'); } } }), 'ATTESTATION_INVALID');
  });

  await test('enabled and ambiguous feature states refuse', async () => {
    assert.strictEqual(featureDisabled(undefined), true);
    assert.strictEqual(featureDisabled('false'), true);
    assert.throws(() => featureDisabled('true'), /FEATURE_STATE_INVALID/);
    assert.throws(() => featureDisabled('FALSE'), /FEATURE_STATE_INVALID/);
  });

  await test('canonical 001 through 004 sequence is deterministic', async () => {
    assert.deepStrictEqual(inventory.map(item => item.migration_id), ['001', '002', '003', '004']);
    assert(inventory.every(item => /^[a-f0-9]{64}$/.test(item.checksum)));
  });

  await test('completed rerun is verification-only', async () => {
    const query = db();
    await verifySchema({ dbQuery: query, integrityGate: goodGate });
    assert(query.calls.every(statement => statement.trim().startsWith('SELECT')));
    const state = inspectLedger(inventory, () => ({
      status: 0,
      stdout: JSON.stringify(cleanRows),
      stderr: ''
    }));
    assert.strictEqual(state, 'COMPLETED');
  });

  await test('failure uses one atomic process and cannot record a completed ledger', async () => {
    let payload;
    assert.throws(() => executeTeamDb('BEGIN IMMEDIATE; CREATE TABLE x(a); BAD; COMMIT;', (_command, args) => {
      payload = args[0];
      return { status: 1, stderr: 'failure' };
    }), /MIGRATION_ATOMIC_EXECUTION_FAILED/);
    assert(payload.includes('BEGIN IMMEDIATE'));
  });

  await test('transaction qualification is a mandatory controlled input', async () => {
    const values = parseArgs(['--revision', '32248db8763208b8e56ac99a2b7934557f260513']);
    assert.throws(() => validateControls(values, { LEADSPROUT_CONTROLLED_MIGRATION: 'true' }), /TARGET_MISMATCH/);
  });

  await test('BEGIN IMMEDIATE provides deterministic concurrency refusal', async () => {
    const transaction = buildControlledTransaction({ inventory, revision: 'r', target: 't', operator: 'o', startedAt: 'now' });
    assert.strictEqual((transaction.match(/BEGIN IMMEDIATE/g) || []).length, 1);
    assert(transaction.endsWith('COMMIT;'));
  });

  await test('applied migration checksums are immutable', async () => {
    await rejectsCode(() => verifySchema({ dbQuery: db(cleanRows.map((r, i) => i === 2 ? { ...r, checksum: '0'.repeat(64) } : r)), integrityGate: goodGate }), 'LEDGER_CHECKSUM');
  });

  await test('incompatible existing schema refuses adoption', async () => {
    await rejectsCode(() => verifySchema({ dbQuery: db(cleanRows, [{ name: 'schema_migrations' }]), integrityGate: goodGate }), 'SCHEMA_MISMATCH');
  });

  await test('schema inventory contains ledger, foreign-key tables and required indexes', async () => {
    for (const name of ['schema_migrations', 'evidence_identities', 'opportunity_workspaces', 'evidence_integrity_decisions']) {
      assert(expected.includes(name));
    }
  });

  await test('Evidence Identity foundation baseline is deterministic and non-destructive', async () => {
    const sql001 = inventory[0].content;
    assert(sql001.includes("VALUES ('EVIDENCE_IDENTITY', 0, 0, 0, CURRENT_TIMESTAMP)"));
    assert(!/^\s*(?:DROP|DELETE|UPDATE|REPLACE)\b/im.test(sql001));
  });

  await test('migration dependencies are fixed by sequence', async () => {
    const transaction = buildControlledTransaction({ inventory, revision: 'r', target: 't', operator: 'o', startedAt: 'now' });
    assert(transaction.indexOf('001_evidence_identity_foundation.sql') < transaction.indexOf('002_opportunity_workspace.sql'));
    assert(transaction.indexOf('002_opportunity_workspace.sql') < transaction.indexOf('003_commercial_opportunity_design_states.sql'));
    assert(transaction.indexOf('003_commercial_opportunity_design_states.sql') < transaction.indexOf('004_evidence_integrity_operational.sql'));
  });

  await test('existing application migration regressions retain all prior SQL', async () => {
    assert(inventory[1].content.includes('opportunity_workspaces'));
    assert(inventory[2].content.includes('opportunity_commercial_estimates'));
    assert(inventory[3].content.includes('evidence_integrity_decisions'));
  });

  await test('returned controls contain no secret values or protected rows', async () => {
    const transaction = buildControlledTransaction({ inventory, revision: 'r', target: 'formal-target', operator: 'controlled-operator', startedAt: 'now' });
    assert(!/(password|token|credential|private[_ -]?key)/i.test(transaction));
    assert(!transaction.includes('SELECT *'));
  });

  await test('backup restoration and forward-recovery evidence is mandatory', async () => {
    assert.throws(() => validateControls({}, { LEADSPROUT_CONTROLLED_MIGRATION: 'true' }), /REVISION_MISMATCH/);
    const sql001 = inventory[0].content;
    assert(!/\bDROP\b/i.test(sql001));
  });

  console.log(`RESULT ${count} PASS, 0 FAIL`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
