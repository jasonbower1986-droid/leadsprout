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

const LEDGER_SCHEMA_SQL = `CREATE TABLE schema_migrations (
  migration_id TEXT PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  sequence INTEGER NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  application_revision TEXT NOT NULL,
  target_identifier TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  operator_identity TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('STARTED','COMPLETED','FAILED','INTERRUPTED','ADOPTED'))
);`;

function createdTables(inventory) {
  const names = new Set(['schema_migrations']);
  const expression = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([a-zA-Z0-9_]+)/gi;
  for (const migration of inventory) {
    let match;
    while ((match = expression.exec(migration.content))) names.add(match[1]);
  }
  return [...names].sort();
}

function quoteIdentifier(name) {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) fail('SCHEMA_MISMATCH');
  return `"${name}"`;
}

function normalizeSql(sql) {
  return String(sql || '')
    .replace(/--[^\n]*/g, '')
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, '')
    .replace(/["`\[\]]/g, '')
    .replace(/\s+/g, '')
    .replace(/;$/g, '')
    .toLowerCase();
}

function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/\s+/g, '').replace(/^\((.*)\)$/s, '$1').toLowerCase();
}

function sqliteAdapter(raw) {
  const all = (statement) => new Promise((resolve, reject) =>
    raw.all(statement, (error, rows) => error ? reject(error) : resolve(rows)));
  const exec = (statement) => new Promise((resolve, reject) =>
    raw.exec(statement, error => error ? reject(error) : resolve()));
  return { all, exec };
}

async function inspectTable(query, name) {
  const identifier = quoteIdentifier(name);
  const master = await query.all(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${name}'`
  );
  if (master.length !== 1 || !master[0].sql) fail('SCHEMA_MISMATCH');
  const columns = (await query.all(`PRAGMA table_info(${identifier})`)).map(row => ({
    cid: Number(row.cid),
    name: row.name,
    type: String(row.type || '').toUpperCase(),
    notnull: Number(row.notnull),
    default: normalizeDefault(row.dflt_value),
    pk: Number(row.pk)
  }));
  const foreignKeys = (await query.all(`PRAGMA foreign_key_list(${identifier})`)).map(row => ({
    id: Number(row.id),
    seq: Number(row.seq),
    table: row.table,
    from: row.from,
    to: row.to,
    on_update: String(row.on_update || '').toUpperCase(),
    on_delete: String(row.on_delete || '').toUpperCase(),
    match: String(row.match || '').toUpperCase()
  })).sort((left, right) => left.id - right.id || left.seq - right.seq);
  const indexes = [];
  for (const index of await query.all(`PRAGMA index_list(${identifier})`)) {
    const indexName = quoteIdentifier(index.name);
    const info = (await query.all(`PRAGMA index_info(${indexName})`)).map(row => ({
      seqno: Number(row.seqno),
      cid: Number(row.cid),
      name: row.name
    })).sort((left, right) => left.seqno - right.seqno);
    const sqlRows = await query.all(
      `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = '${index.name}'`
    );
    indexes.push({
      name: index.origin === 'c' ? index.name : null,
      unique: Number(index.unique),
      origin: index.origin,
      partial: Number(index.partial),
      columns: info,
      sql: normalizeSql(sqlRows[0]?.sql)
    });
  }
  indexes.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {
    name,
    sql: normalizeSql(master[0].sql),
    columns,
    foreignKeys,
    indexes
  };
}

async function buildExpectedSchemaContract(inventory = migrationInventory()) {
  const sqlite3 = require('sqlite3');
  const raw = new sqlite3.Database(':memory:');
  const query = sqliteAdapter(raw);
  try {
    await query.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE leads (id TEXT PRIMARY KEY);
      ${LEDGER_SCHEMA_SQL}
      ${inventory.map(item => item.content).join('\n')}`);
    const tables = {};
    for (const name of createdTables(inventory)) tables[name] = await inspectTable(query, name);
    const leadColumns = await query.all('PRAGMA table_info("leads")');
    const evidenceState = leadColumns.find(row => row.name === 'evidence_state');
    if (!evidenceState) fail('SCHEMA_MISMATCH');
    return Object.freeze({
      tables,
      leadsEvidenceState: {
        name: evidenceState.name,
        type: String(evidenceState.type || '').toUpperCase(),
        notnull: Number(evidenceState.notnull),
        default: normalizeDefault(evidenceState.dflt_value),
        pk: Number(evidenceState.pk)
      }
    });
  } finally {
    await new Promise(resolve => raw.close(resolve));
  }
}

async function verifyStructuralSchema(query, contract) {
  for (const [name, expected] of Object.entries(contract.tables)) {
    let actual;
    try {
      actual = await inspectTable(query, name);
    } catch (_) {
      fail('SCHEMA_MISMATCH');
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('SCHEMA_MISMATCH');
  }
  let leads;
  try {
    leads = await query.all('PRAGMA table_info("leads")');
  } catch (_) {
    fail('SCHEMA_MISMATCH');
  }
  const evidenceState = leads.find(row => row.name === 'evidence_state');
  if (!evidenceState) fail('SCHEMA_MISMATCH');
  const actualEvidenceState = {
    name: evidenceState.name,
    type: String(evidenceState.type || '').toUpperCase(),
    notnull: Number(evidenceState.notnull),
    default: normalizeDefault(evidenceState.dflt_value),
    pk: Number(evidenceState.pk)
  };
  if (JSON.stringify(actualEvidenceState) !== JSON.stringify(contract.leadsEvidenceState)) {
    fail('SCHEMA_MISMATCH');
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

  const contract = options.expectedContract || await buildExpectedSchemaContract(inventory)
    .catch(() => fail('SCHEMA_MISMATCH'));
  await verifyStructuralSchema(query, contract);

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
  buildExpectedSchemaContract,
  createdTables,
  featureDisabled,
  inspectTable,
  migrationInventory,
  normalizeSql,
  verifyStructuralSchema,
  verifySchema
};
