const assert = require('assert');
const { participants } = require('./uat/commercial-opportunity-intelligence/fixtures');
const { validateStudyDesign, calculateResults, assertActivationControls, UatStore } = require('./uat/commercial-opportunity-intelligence/harness');
assert.strictEqual(validateStudyDesign(), true);
const attempts = participants.flatMap(participant => participant.scenarios.map((scenario_id, index) => ({
  attempt_id: `${participant.participant_id}-${scenario_id}`, participant_id: participant.participant_id,
  scenario_id, server_timestamp: new Date(2026, 6, 19, 12, index).toISOString(),
  assessors: [{ assessor_id: 'A', pass: true }, { assessor_id: 'B', pass: true }],
  uat_09: true, product_caused_critical_truthfulness_failure: false
})));
const result = calculateResults(attempts);
assert.strictEqual(result.valid_attempts, 54);
assert(Object.values(result.scenario_counts).every(count => count === 9));
assert.strictEqual(result.critical_failures, 0);
assert.strictEqual(result.uat_09_participants, 18);
assert.throws(() => assertActivationControls({ NODE_ENV: 'test' }), /retention/);
assert.throws(() => assertActivationControls({ NODE_ENV: 'production', COI_UAT_RETENTION_DAYS: '30' }), /production/);
assert.doesNotThrow(() => assertActivationControls({ NODE_ENV: 'test', COI_UAT_RETENTION_DAYS: '30' }));
let current = new Date('2026-07-19T00:00:00.000Z');
const store = new UatStore({ retentionDays: 30, now: () => current });
store.add(attempts[0]);
assert.strictEqual(store.export().attempts.length, 1);
assert.throws(() => store.add({ ...attempts[1], email: 'not-permitted@example.test' }), /pseudonymous/);
current = new Date('2026-08-20T00:00:00.000Z');
assert.strictEqual(store.deleteExpired(), 1);
assert(store.audit.some(item => item.action === 'RETENTION_DELETE'));
console.log('Commercial Opportunity Intelligence controlled UAT harness: PASS');
