const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('./backend/node_modules/sqlite3');
const { loadRuleBundle, ruleBundleDigest, BUNDLE_DIGEST } = require('./backend/utils/evidence-integrity-rule-bundle');
const { assessEvidenceIntegrity } = require('./backend/utils/evidence-integrity-assessor');
const {
  EvidenceIntegrityEnforcementError, validateEnvelope, enforceEvidenceIntegrity
} = require('./backend/utils/evidence-integrity-enforcement');
const {
  classifyMaterialChange, preserveDecision, recordDependentReasoning, replayDecision
} = require('./backend/utils/evidence-integrity-lifecycle');
const { buildEvidenceState, reconstructEvidence } = require('./backend/utils/evidence-state');

const bundle = loadRuleBundle();
const now = Date.parse('2026-07-26T12:00:00.000Z');
const identity = character => `EVI-1-${character.repeat(52)}`;
const evidence = (overrides = {}) => ({
  evidenceId: identity('A'),
  lifecycleState: 'ACTIVE',
  observedAt: '2026-07-26T11:00:00.000Z',
  contentDigest: crypto.createHash('sha256').update('controlled evidence A').digest('hex'),
  evidenceClass: 'GENERAL_BUSINESS_IDENTITY_DOMAIN_OR_PUBLIC_DESCRIPTION',
  reliability: 'RELIABLE',
  material: true,
  sourceAuthority: 'PRIMARY',
  independentSourceId: 'SOURCE-A',
  claimClasses: ['BUSINESS_IDENTITY', 'SERVICE_OBSERVATION'],
  parentEvidenceIds: [],
  provenance: { source: 'https://example.test/', acquisitionId: 'ACQ-001' },
  contradictions: [],
  limitations: [],
  ...overrides
});
const scope = {
  subject: 'BUS-001',
  operations: ['REPORT'],
  requiredClaimClasses: ['BUSINESS_IDENTITY', 'SERVICE_OBSERVATION'],
  usefulBoundedScopes: [{ claimClasses: ['BUSINESS_IDENTITY'], limitations: ['Service observation is excluded.'] }],
  breadth: 'business identity and service observation',
  depth: 'claim level'
};
const assess = (input, options = {}) => assessEvidenceIntegrity(input, { bundle, now, ...options });
const eligible = () => assess({ requestedScope: scope, evidence: [evidence()] });

assert.strictEqual(ruleBundleDigest(bundle), BUNDLE_DIGEST);
assert.deepStrictEqual([bundle.rules.length, bundle.reasonCodes.length, bundle.acceptanceCases.length], [53, 43, 14]);

const results = new Map();
function acceptance(id, assertion) {
  assertion();
  results.set(id, 'PASS');
  console.log(`✓ ${id}`);
}

acceptance('EI-ACCEPT-001', () => {
  for (const pageClassification of ['LOGIN', 'CHECKOUT', 'ERROR', 'LOW_CONTENT']) {
    assert.strictEqual(assess({ requestedScope: scope, evidence: [evidence({ pageClassification })] }).outcome, 'ELIGIBLE');
  }
});

acceptance('EI-ACCEPT-002', () => {
  assert.strictEqual(assess(null).outcome, 'REASSESSMENT_REQUIRED');
  assert.strictEqual(assess({ requestedScope: scope, evidence: [evidence()] }, {
    bundle: { ...bundle, digest: '0'.repeat(64) }
  }).outcome, 'REASSESSMENT_REQUIRED');
  assert.throws(() => enforceEvidenceIntegrity(null, {}), EvidenceIntegrityEnforcementError);
});

acceptance('EI-ACCEPT-003', () => {
  const refused = assess({ requestedScope: scope, evidence: [evidence({
    synthetic: true, cleanSeparationPossible: false
  })] });
  assert.strictEqual(refused.outcome, 'REFUSED');
  assert(refused.orderedReasonCodes.includes('EI-REASON-SY-001'));
});

acceptance('EI-ACCEPT-004', () => {
  assert.strictEqual(eligible().completeness, 'COMPLETE');
  const limited = assess({ requestedScope: scope, evidence: [evidence({ claimClasses: ['BUSINESS_IDENTITY'] })] });
  assert.strictEqual(limited.completeness, 'BOUNDED');
  assert.strictEqual(limited.outcome, 'LIMITED');
  assert.strictEqual(assess({ requestedScope: scope, evidence: [] }).completeness, 'INSUFFICIENT');
  assert.strictEqual(assess({ requestedScope: { ...scope, requiredClaimClasses: [] }, evidence: [] }).completeness, 'UNDETERMINED');
});

acceptance('EI-ACCEPT-005', () => {
  assert.strictEqual(assess({ requestedScope: scope, evidence: [evidence({ reliability: 'RELIABLE_WITH_LIMITATION', limitations: ['Access limitation.'] })] }).confidenceCeiling, 'MEDIUM');
  assert.strictEqual(assess({ requestedScope: scope, evidence: [evidence({ reliability: 'UNRELIABLE' })] }).outcome, 'REFUSED');
  assert.strictEqual(assess({ requestedScope: scope, evidence: [evidence({ reliability: 'UNVERIFIABLE' })] }).outcome, 'REASSESSMENT_REQUIRED');
});

acceptance('EI-ACCEPT-006', () => {
  const nonPrimary = evidence({ sourceAuthority: 'SECONDARY', independentSourceId: 'SOURCE-A' });
  assert.strictEqual(assess({ requestedScope: scope, evidence: [nonPrimary] }).outcome, 'REFUSED');
  const corroborated = assess({ requestedScope: scope, evidence: [
    nonPrimary,
    evidence({ evidenceId: identity('B'), contentDigest: crypto.createHash('sha256').update('controlled evidence B').digest('hex'), sourceAuthority: 'SECONDARY', independentSourceId: 'SOURCE-B' })
  ] });
  assert.strictEqual(corroborated.outcome, 'ELIGIBLE');
});

acceptance('EI-ACCEPT-007', () => {
  assert.strictEqual(assess({ requestedScope: scope, evidence: [evidence({
    contradictions: [{ material: true, isolatable: false, description: 'Material conflict.' }]
  })] }).outcome, 'REASSESSMENT_REQUIRED');
  assert.strictEqual(assess({ requestedScope: scope, evidence: [evidence({
    contradictions: [{ material: true, isolatable: true, claimClasses: ['SERVICE_OBSERVATION'], limitation: 'Service claim excluded.' }]
  })] }).outcome, 'LIMITED');
});

acceptance('EI-ACCEPT-008', () => {
  const envelope = eligible();
  assert.throws(() => enforceEvidenceIntegrity(envelope, {
    operation: 'OUTREACH', subject: 'BUS-001', claims: []
  }), error => error.code === 'operation_scope_expansion');
  assert.throws(() => enforceEvidenceIntegrity(envelope, {
    operation: 'REPORT', subject: 'BUS-001',
    claims: [{ claimClass: 'UNAUTHORISED', confidence: 'LOW', parentEvidenceIds: [identity('A')] }]
  }), error => error.code === 'claim_scope_expansion');
});

acceptance('EI-ACCEPT-009', () => {
  const observationScope = {
    ...scope, requiredClaimClasses: ['SERVICE_OBSERVATION'], usefulBoundedScopes: []
  };
  const envelope = assess({ requestedScope: observationScope, evidence: [evidence({
    sourceAuthority: 'SECONDARY', claimClasses: ['SERVICE_OBSERVATION']
  })] });
  assert.strictEqual(envelope.confidenceCeiling, 'LOW');
  assert.throws(() => enforceEvidenceIntegrity(envelope, {
    operation: 'REPORT', subject: 'BUS-001',
    claims: [{ claimClass: 'SERVICE_OBSERVATION', confidence: 'HIGH', parentEvidenceIds: [identity('A')] }]
  }), error => error.code === 'confidence_escalation');
});

acceptance('EI-ACCEPT-010', () => {
  const input = { requestedScope: scope, evidence: [
    evidence(),
    evidence({ evidenceId: identity('B'), contentDigest: crypto.createHash('sha256').update('controlled evidence B').digest('hex') })
  ] };
  const first = assess(input);
  const shuffled = assess({ requestedScope: { ...scope }, evidence: [...input.evidence].reverse() });
  const wordingChanged = assess({ ...input, diagnosticWording: 'Incidental wording changed.' });
  assert.strictEqual(first.decisionDigest, shuffled.decisionDigest);
  assert.strictEqual(first.decisionDigest, wordingChanged.decisionDigest);
});

acceptance('EI-ACCEPT-011', () => {
  const expired = assess({ requestedScope: scope, evidence: [evidence({ observedAt: '2025-01-01T00:00:00.000Z' })] });
  assert.strictEqual(expired.outcome, 'REASSESSMENT_REQUIRED');
  assert.strictEqual(classifyMaterialChange(['DIAGNOSTIC_TIMESTAMP_CHANGE']).material, false);
  assert.strictEqual(classifyMaterialChange(['EVIDENCE_EXPIRY']).material, true);
});

acceptance('EI-ACCEPT-012', () => {
  const envelope = assess({ requestedScope: scope, evidence: [evidence({
    reliability: 'RELIABLE_WITH_LIMITATION', limitations: ['Access limitation.']
  })] });
  assert.throws(() => enforceEvidenceIntegrity(envelope, {
    operation: 'REPORT', subject: 'BUS-001', limitations: [],
    claims: [{ claimClass: 'BUSINESS_IDENTITY', confidence: 'MEDIUM', parentEvidenceIds: [identity('A')] }]
  }), error => error.code === 'required_limitation_removed');
  const output = enforceEvidenceIntegrity(envelope, {
    operation: 'REPORT', subject: 'BUS-001', limitations: ['Access limitation.'],
    claims: [{ claimClass: 'BUSINESS_IDENTITY', confidence: 'MEDIUM', parentEvidenceIds: [identity('A')], value: 'Observed business' }]
  });
  assert.strictEqual(validateEnvelope(output.evidenceIntegrityEnvelope).valid, true);
  assert.deepStrictEqual(output.claims[0].evidenceIntegrity.limitations, envelope.limitations);
});

acceptance('EI-ACCEPT-013', () => {
  assert.strictEqual(eligible().outcome, 'ELIGIBLE');
  assert.strictEqual(assess({ requestedScope: scope, evidence: [evidence({ claimClasses: ['BUSINESS_IDENTITY'] })] }).outcome, 'LIMITED');
  assert.strictEqual(assess({ requestedScope: scope, evidence: [] }).outcome, 'REFUSED');
  assert.strictEqual(assess(null).outcome, 'REASSESSMENT_REQUIRED');
});

acceptance('EI-ACCEPT-014', () => {
  const base = eligible();
  const customerChanged = assess({ requestedScope: scope, evidence: [evidence()], customerId: 'OTHER' });
  const siteChanged = assess({ requestedScope: scope, evidence: [evidence()], siteId: 'OTHER' });
  assert.strictEqual(base.decisionDigest, customerChanged.decisionDigest);
  assert.strictEqual(base.decisionDigest, siteChanged.decisionDigest);
});

const persistedAcquisition = buildEvidenceState({
  valid: true,
  checked: ['controlled'],
  canonicalAssessment: { requestedScope: scope, evidence: [evidence()] }
}, { assessmentTime: '2026-07-26T12:00:00.000Z' });
assert.strictEqual(persistedAcquisition.integrityEnvelope.outcome, 'ELIGIBLE');
assert.strictEqual(
  reconstructEvidence(JSON.stringify(persistedAcquisition)).integrityEnvelope.decisionId,
  persistedAcquisition.integrityEnvelope.decisionId
);

function database() {
  const raw = new sqlite3.Database(':memory:');
  const run = (sql, params = []) => new Promise((resolve, reject) => raw.run(sql, params, function(error) {
    if (error) reject(error); else resolve({ changes: this.changes });
  }));
  const get = (sql, params = []) => new Promise((resolve, reject) => raw.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
  const exec = sql => new Promise((resolve, reject) => raw.exec(sql, error => error ? reject(error) : resolve()));
  return {
    run, get, exec,
    all: (sql, params = []) => new Promise((resolve, reject) => raw.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows))),
    async transaction(operations) {
      await exec('BEGIN IMMEDIATE');
      try {
        for (const operation of operations) await run(operation.sql, operation.params || []);
        await exec('COMMIT');
      } catch (error) {
        await exec('ROLLBACK');
        throw error;
      }
    },
    close: () => new Promise(resolve => raw.close(resolve))
  };
}

(async () => {
  const db = database();
  await db.exec(fs.readFileSync(path.join(__dirname, 'backend/migrations/004_evidence_integrity_operational.sql'), 'utf8'));
  const first = eligible();
  await preserveDecision(db, 'BUS-001', first, { occurredAt: '2026-07-26T12:00:00.000Z' });
  await recordDependentReasoning(db, 'REASONING-001', first.decisionId, crypto.createHash('sha256').update('output').digest('hex'), '2026-07-26T12:01:00.000Z');
  const second = assess({ requestedScope: scope, evidence: [evidence({ claimClasses: ['BUSINESS_IDENTITY'] })] });
  await preserveDecision(db, 'BUS-001', second, {
    supersedesDecisionId: first.decisionId,
    triggerCodes: ['REQUIRED_CLAIM_CLASS_SUPPORT_GAINED_OR_LOST'],
    occurredAt: '2026-07-26T12:02:00.000Z'
  });
  assert.strictEqual((await db.get('SELECT lifecycle_state FROM evidence_integrity_decisions WHERE decision_id = ?', [first.decisionId])).lifecycle_state, 'SUPERSEDED');
  assert.strictEqual((await db.get('SELECT valid FROM evidence_integrity_dependent_reasoning WHERE reasoning_id = ?', ['REASONING-001'])).valid, 0);
  await assert.rejects(recordDependentReasoning(db, 'REASONING-STALE', first.decisionId, crypto.createHash('sha256').update('stale').digest('hex'), '2026-07-26T12:03:00.000Z'), error => error.code === 'EVIDENCE_INTEGRITY_STALE_DECISION');
  assert.strictEqual((await replayDecision(db, first.decisionId)).lifecycleState, 'SUPERSEDED');
  assert.strictEqual((await replayDecision(db, second.decisionId)).lifecycleState, 'CURRENT');
  await assert.rejects(preserveDecision(db, 'BUS-001', second, {
    supersedesDecisionId: second.decisionId,
    triggerCodes: ['NORMALISED_DECISION_INPUT_CHANGE'],
    occurredAt: '2026-07-26T12:04:00.000Z'
  }), error => error.code === 'EVIDENCE_INTEGRITY_PERSISTENCE_FAILED');
  assert.strictEqual((await db.get(
    'SELECT lifecycle_state FROM evidence_integrity_decisions WHERE decision_id = ?',
    [second.decisionId]
  )).lifecycle_state, 'CURRENT');
  assert.strictEqual(results.size, bundle.acceptanceCases.length);
  await db.close();
  console.log('Operational Evidence Integrity Stages 1–4 conformance: PASS');
})().catch(error => { console.error(error); process.exit(1); });
