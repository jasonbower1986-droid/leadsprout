const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  TRIGGER_INVENTORY_SQL,
  diagnoseV1TriggerInventory
} = require('./backend/scripts/diagnose_v1_trigger_inventory');

const repository = __dirname;
const entry = path.join(repository, 'backend/scripts/diagnose_v1_trigger_inventory.js');
const expectedLocalFiles = Object.freeze([
  'backend/scripts/diagnose_v1_trigger_inventory.js',
  'backend/scripts/verify_schema_readonly.js'
]);
const allowedBuiltins = Object.freeze(['crypto', 'fs', 'path']);
const forbiddenPatterns = Object.freeze([
  /require\(['"]\.\.\/database['"]\)/,
  /require\(['"]\.\/verify_schema['"]\)/,
  /require\(['"]\.\/apply_migrations['"]\)/,
  /evidence-integrity-authority/,
  /EVIDENCE_INTEGRITY_AUTHORITY_MODULE/,
  /EVIDENCE_PROVENANCE_RESOLVER_MODULE/,
  /\bloadDependency\b/,
  /\bverifySchema\b/
]);

function staticRequires(source) {
  return [...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map(match => match[1]);
}

function resolveLocal(parent, reference) {
  const unresolved = path.resolve(path.dirname(parent), reference);
  for (const candidate of [unresolved, `${unresolved}.js`, path.join(unresolved, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`UNRESOLVED_LOCAL_IMPORT:${reference}`);
}

const pending = [entry];
const files = new Map();
const builtins = new Set();
while (pending.length > 0) {
  const filename = pending.shift();
  if (files.has(filename)) continue;
  const source = fs.readFileSync(filename, 'utf8');
  files.set(filename, source);
  for (const reference of staticRequires(source)) {
    if (reference.startsWith('.')) pending.push(resolveLocal(filename, reference));
    else builtins.add(reference);
  }
}

assert.deepStrictEqual([...files.keys()].map(filename => path.relative(repository, filename)).sort(),
  [...expectedLocalFiles].sort());
assert.deepStrictEqual([...builtins].sort(), [...allowedBuiltins].sort());
assert(/^SELECT\b/.test(TRIGGER_INVENTORY_SQL));
assert.strictEqual((TRIGGER_INVENTORY_SQL.match(/\bSELECT\b/g) || []).length, 1);
assert(!/;|--|\/\*/.test(TRIGGER_INVENTORY_SQL));
assert.strictEqual(
  (diagnoseV1TriggerInventory.toString().match(/\bquery\s*\.\s*all\s*\(/g) || []).length,
  1
);
for (const [filename, source] of files) {
  for (const pattern of forbiddenPatterns) {
    assert(!pattern.test(source), `${pattern}:${path.relative(repository, filename)}`);
  }
  const methods = [...source.matchAll(/\bquery\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)]
    .map(match => match[1]);
  assert(methods.length > 0, `missing query evidence:${path.relative(repository, filename)}`);
  assert(methods.every(method => method === 'all'),
    `non-read query method:${path.relative(repository, filename)}`);
}

console.log('PASS V1 trigger diagnostic transitive import containment');
