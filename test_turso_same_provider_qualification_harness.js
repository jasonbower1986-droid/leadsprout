const assert = require('assert');
const fs = require('fs');
const path = require('path');

const filename = path.join(__dirname,
  'backend/scripts/qualify_turso_atomic_migration_executor.mjs');
const source = fs.readFileSync(filename, 'utf8');

assert(source.startsWith('#!/usr/bin/env node\n'));
assert(source.includes("const APPROVAL = 'AUTHORIZED_DISPOSABLE_ONLY'"));
assert(source.includes("const PROTECTED_HOST = 'agent-team-2d88b7d5-cto.aws-us-west-2.turso.io'"));
assert(source.includes('PROTECTED_V1_TARGET_ID'));
assert(source.includes('QUALIFICATION_TARGET_NOT_EMPTY'));
assert(source.includes('__leadsprout_forced_rollback__'));
assert(source.includes('QUALIFICATION_ROLLBACK_MISMATCH'));
assert(source.includes('executeTeamDb(migrationPayload(inventory[6], target))'));
assert(source.includes('executeTeamDb(migrationPayload(inventory[7], target))'));
assert(source.includes('verifyStructuralSchema(query, EXPECTED_SCHEMA_MANIFEST)'));
assert(source.includes('requireForeignKeyIntegrity(query, EXPECTED_SCHEMA_MANIFEST)'));
assert(source.includes("classification: 'PASS_SAME_PROVIDER_EXECUTOR_QUALIFIED'"));
assert(source.includes("classification: 'STOP'"));
assert(!source.includes('@tursodatabase/sync'));
assert(!source.includes('team-db'));

console.log('PASS bounded same-provider Turso qualification harness contract');
