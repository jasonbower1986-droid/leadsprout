const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repository = __dirname;
const entry = path.join(repository, 'backend/scripts/qualify_v1_contract_alignment.js');
const expectedLocalFiles = Object.freeze([
  'backend/scripts/qualify_v1_contract_alignment.js',
  'backend/scripts/verify_schema_readonly.js'
]);
const allowedBuiltins = Object.freeze(['crypto', 'fs', 'path']);
const forbiddenPatterns = Object.freeze([
  ['database binding', /require\(['"]\.\.\/database['"]\)/],
  ['startup verifier wrapper', /require\(['"]\.\/verify_schema['"]\)/],
  ['migration runner', /require\(['"]\.\/apply_migrations['"]\)/],
  ['integrity authority', /evidence-integrity-authority/],
  ['integrity module binding', /EVIDENCE_INTEGRITY_AUTHORITY_MODULE/],
  ['provenance module binding', /EVIDENCE_PROVENANCE_RESOLVER_MODULE/],
  ['dynamic dependency loader', /\bloadDependency\b/],
  ['complete verifier', /\bverifySchema\b/]
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

function inspectImportGraph(root) {
  const pending = [root];
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
  return { files, builtins };
}

const graph = inspectImportGraph(entry);
const localFiles = [...graph.files.keys()]
  .map(filename => path.relative(repository, filename))
  .sort();
assert.deepStrictEqual(localFiles, [...expectedLocalFiles].sort());
assert.deepStrictEqual([...graph.builtins].sort(), [...allowedBuiltins].sort());

for (const [filename, source] of graph.files) {
  for (const [label, pattern] of forbiddenPatterns) {
    assert(!pattern.test(source), `${label}:${path.relative(repository, filename)}`);
  }
  const queryMethods = [...source.matchAll(/\bquery\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)]
    .map(match => match[1]);
  assert(queryMethods.length > 0, `missing query evidence:${path.relative(repository, filename)}`);
  assert(queryMethods.every(method => method === 'all'),
    `non-read query method:${path.relative(repository, filename)}`);
}

console.log('PASS V1 contract-alignment read-only transitive import containment');
