const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('./backend/node_modules/sqlite3');
const {
  createProductionAcquisitionEvidence
} = require('./backend/scraper');
const {
  productionRequestedScope,
  canonicalAssessmentFromAcquisition,
  assessAndPreserveAcquisition,
  executeGovernedCommercialIntelligence
} = require('./backend/utils/evidence-integrity-production');
const { enforceEvidenceIntegrity } = require('./backend/utils/evidence-integrity-enforcement');
const { recordDependentReasoning, replayDecision } = require('./backend/utils/evidence-integrity-lifecycle');
const { buildEvidenceState } = require('./backend/utils/evidence-state');
const { enrichLeadData } = require('./backend/utils/enrichment');

function database() {
  const raw = new sqlite3.Database(':memory:');
  const run = (sql, params = []) => new Promise((resolve, reject) => raw.run(sql, params, function(error) {
    if (error) reject(error); else resolve({ changes: this.changes });
  }));
  const get = (sql, params = []) => new Promise((resolve, reject) =>
    raw.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
  const exec = sql => new Promise((resolve, reject) => raw.exec(sql, error => error ? reject(error) : resolve()));
  return {
    run, get, exec,
    all: (sql, params = []) => new Promise((resolve, reject) =>
      raw.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows))),
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

function acquisition(subject, overrides = {}) {
  const observedAt = overrides.observedAt || '2026-07-26T12:00:00.000Z';
  const produced = createProductionAcquisitionEvidence({
    subject,
    sourceUrl: `https://${subject}/`,
    observedAt,
    content: `controlled acquisition:${subject}:${observedAt}`,
    observations: {
      statusCode: 200,
      domain: subject,
      businessName: 'Controlled Business',
      speedScore: 72,
      responsiveStatus: 'responsive',
      seoGaps: ['Missing Meta Description'],
      conversionGaps: ['No clear Call-To-Action (CTA) buttons found'],
      redirected: false,
      finalUrl: `https://${subject}/`,
      quantitativeBasis: {
        monthlyTraffic: 1000,
        conversionRate: 0.02,
        averageTransactionValue: 500
      }
    }
  });
  return {
    ...produced,
    validation: {
      valid: true,
      evidenceFailure: null,
      failureReason: null,
      checked: ['html_scan_passed', 'content_words:100', 'synthetic_data_check_passed']
    },
    ...overrides
  };
}

async function decision(db, subject, acquisitionValue, options = {}) {
  return assessAndPreserveAcquisition({
    dbQuery: db,
    acquisition: acquisitionValue,
    requestedScope: productionRequestedScope(subject),
    priorDecisionId: options.priorDecisionId || null,
    occurredAt: options.occurredAt || '2026-07-26T12:01:00.000Z'
  });
}

(async () => {
  const db = database();
  await db.exec(fs.readFileSync(
    path.join(__dirname, 'backend/migrations/004_evidence_integrity_operational.sql'), 'utf8'
  ));

  const eligible = await decision(db, 'eligible.test', acquisition('eligible.test'));
  assert.strictEqual(eligible.envelope.outcome, 'ELIGIBLE');
  assert(canonicalAssessmentFromAcquisition(
    acquisition('eligible.test'), productionRequestedScope('eligible.test')
  ));
  const evidenceState = buildEvidenceState({
    valid: true,
    checked: ['controlled_source_validation'],
    canonicalAssessment: eligible.canonicalAssessment,
    canonicalDecision: eligible.canonicalDecision,
    integrityEnvelope: eligible.envelope
  }, {
    domain: 'eligible.test',
    analysedUrl: 'https://eligible.test/',
    assessmentTime: '2026-07-26T12:01:00.000Z'
  });
  const productionLead = {
    id: 'lead-eligible',
    domain: 'eligible.test',
    business_name: 'Eligible Test',
    niche: 'General',
    speed_score: 72,
    responsive_status: 'responsive',
    seo_gaps: JSON.stringify(['Missing Meta Description']),
    conversion_gaps: JSON.stringify(['No clear Call-To-Action (CTA) buttons found']),
    details: JSON.stringify({ status_code: 200 }),
    evidence_state: JSON.stringify(evidenceState)
  };

  const execution = await executeGovernedCommercialIntelligence({
    dbQuery: db,
    envelope: eligible.envelope,
    subject: 'eligible.test',
    occurredAt: '2026-07-26T12:02:00.000Z',
    execute: async () => enrichLeadData(productionLead)
  });
  assert.strictEqual(execution.enforced.operation, 'COMMERCIAL_INTELLIGENCE');
  assert(execution.result.strategy_report);
  assert.deepStrictEqual(
    execution.enforced.claims.map(claim => claim.claimClass).sort(),
    [
      'BUSINESS_IDENTITY',
      'COMMERCIAL_OPPORTUNITY',
      'REVENUE_ESTIMATE',
      'STRATEGIC_RECOMMENDATION',
      'WEBSITE_PERFORMANCE'
    ]
  );
  assert(execution.enforced.claims.every(claim => /^[a-f0-9]{64}$/.test(claim.valueDigest)));
  assert.strictEqual((await db.get(
    'SELECT valid FROM evidence_integrity_dependent_reasoning WHERE reasoning_id = ?',
    [execution.reasoningId]
  )).valid, 1);

  const limitedAcquisition = acquisition('limited.test');
  limitedAcquisition.observations.quantitativeBasis = null;
  const limited = await decision(db, 'limited.test', limitedAcquisition);
  assert.strictEqual(limited.envelope.outcome, 'LIMITED');
  const limitedState = buildEvidenceState({
    valid: true,
    checked: ['controlled_source_validation'],
    canonicalAssessment: limited.canonicalAssessment,
    canonicalDecision: limited.canonicalDecision,
    integrityEnvelope: limited.envelope
  }, {
    domain: 'limited.test',
    analysedUrl: 'https://limited.test/',
    assessmentTime: '2026-07-26T12:01:00.000Z'
  });
  const controlledRevenueMarker = 'EXEC-SD-018-UNAUTHORISED-REVENUE-$987654';
  const limitedExecution = await executeGovernedCommercialIntelligence({
    dbQuery: db,
    envelope: limited.envelope,
    subject: 'limited.test',
    occurredAt: '2026-07-26T12:02:30.000Z',
    execute: async () => {
      const output = enrichLeadData({
        ...productionLead,
        id: 'lead-limited',
        domain: 'limited.test',
        business_name: 'Limited Test',
        evidence_state: JSON.stringify(limitedState)
      });
      output.revenue_leak.revenue_leak.formatted_leak = controlledRevenueMarker;
      output.persona_summary += controlledRevenueMarker;
      output.sales_hooks = output.sales_hooks.map(hook => `${hook}${controlledRevenueMarker}`);
      output.opportunity_brief.hook += controlledRevenueMarker;
      output.strategy_report.commercial_impact += controlledRevenueMarker;
      output.strategy_report.opportunity.impact_summary += controlledRevenueMarker;
      output.opportunity_brief.pitch_reason += controlledRevenueMarker;
      output.opportunity_brief.commercial_impact += controlledRevenueMarker;
      output.growth_roadmap.summary += controlledRevenueMarker;
      output.discovery_patterns.push({ controlledRevenueMarker });
      output.discernment.controlledRevenueMarker = controlledRevenueMarker;
      output.advisor_labels.loading_friction += controlledRevenueMarker;
      return output;
    }
  });
  assert.strictEqual(JSON.stringify(limitedExecution.result).includes(controlledRevenueMarker), false);
  assert.strictEqual(limitedExecution.result.revenue_leak, null);
  assert.strictEqual(limitedExecution.result.persona_summary, null);
  assert.deepStrictEqual(limitedExecution.result.sales_hooks, []);
  assert.strictEqual(limitedExecution.result.opportunity_brief.hook, null);
  assert.deepStrictEqual(
    limitedExecution.enforced.claims.map(claim => claim.claimClass).sort(),
    [
      'BUSINESS_IDENTITY',
      'COMMERCIAL_OPPORTUNITY',
      'STRATEGIC_RECOMMENDATION',
      'WEBSITE_PERFORMANCE'
    ]
  );
  assert(limitedExecution.enforced.claims.every(claim =>
    claim.confidence === limited.envelope.confidenceCeiling &&
    claim.evidenceIntegrity.limitations.length === limited.envelope.limitations.length &&
    claim.parentEvidenceIds[0] === limited.envelope.evidenceLineage[0].evidenceId
  ));
  const limitedReasoning = await db.get(
    'SELECT output_digest,valid FROM evidence_integrity_dependent_reasoning WHERE reasoning_id = ?',
    [limitedExecution.reasoningId]
  );
  assert.strictEqual(limitedReasoning.valid, 1);
  assert.strictEqual(limitedReasoning.output_digest, limitedExecution.outputDigest);
  assert.strictEqual(JSON.stringify(limitedReasoning).includes(controlledRevenueMarker), false);
  const limitedReasoningBeforeInseparable = (await db.get(
    'SELECT COUNT(*) AS count FROM evidence_integrity_dependent_reasoning WHERE decision_id = ?',
    [limited.envelope.decisionId]
  )).count;
  await assert.rejects(executeGovernedCommercialIntelligence({
    dbQuery: db,
    envelope: limited.envelope,
    subject: 'limited.test',
    occurredAt: '2026-07-26T12:02:45.000Z',
    execute: async () => {
      const output = enrichLeadData({
        ...productionLead,
        id: 'lead-limited-inseparable',
        domain: 'limited.test',
        business_name: 'Limited Test',
        evidence_state: JSON.stringify(limitedState)
      });
      output.strategy_report.opportunity.impact_summary += controlledRevenueMarker;
      output.output_provenance.revenueEstimateDerivedPaths.push({
        path: 'strategy_report.opportunity.impact_summary',
        separable: false
      });
      return output;
    }
  }), error => error.code === 'EVIDENCE_INTEGRITY_OUTPUT_UNMAPPABLE');
  assert.strictEqual((await db.get(
    'SELECT COUNT(*) AS count FROM evidence_integrity_dependent_reasoning WHERE decision_id = ?',
    [limited.envelope.decisionId]
  )).count, limitedReasoningBeforeInseparable);

  const refused = await decision(db, 'refused.test', acquisition('refused.test', {
    validation: {
      valid: false,
      evidenceFailure: 'access_denied',
      failureReason: 'Controlled access denial.',
      checked: ['access_denied']
    }
  }));
  assert.strictEqual(refused.envelope.outcome, 'REFUSED');

  const reassessment = await decision(db, 'missing.test', null);
  assert.strictEqual(reassessment.envelope.outcome, 'REASSESSMENT_REQUIRED');
  assert.strictEqual(canonicalAssessmentFromAcquisition({
    ...acquisition('fabricated.test'), evidenceId: `EVI-1-${'A'.repeat(52)}`
  }, productionRequestedScope('fabricated.test')), null);
  const fabricated = await decision(db, 'fabricated-lineage.test', acquisition('fabricated-lineage.test', {
    validation: {
      valid: false,
      evidenceFailure: 'synthetic_audit_data',
      failureReason: 'Controlled synthetic evidence.',
      checked: ['synthetic_data_check']
    }
  }));
  assert.strictEqual(fabricated.envelope.outcome, 'REFUSED');

  let executed = false;
  await assert.rejects(executeGovernedCommercialIntelligence({
    dbQuery: db,
    envelope: eligible.envelope,
    subject: 'eligible.test',
    operation: 'OUTREACH',
    occurredAt: '2026-07-26T12:03:00.000Z',
    execute: async () => { executed = true; return {}; }
  }), error => error.code === 'operation_scope_expansion');
  assert.strictEqual(executed, false);

  assert.throws(() => enforceEvidenceIntegrity(eligible.envelope, {
    operation: 'COMMERCIAL_INTELLIGENCE',
    subject: 'eligible.test',
    limitations: [],
    claims: [{
      claimClass: 'UNAUTHORISED',
      confidence: 'LOW',
      parentEvidenceIds: eligible.envelope.evidenceLineage.map(item => item.evidenceId)
    }]
  }), error => error.code === 'claim_scope_expansion');
  assert.throws(() => enforceEvidenceIntegrity(eligible.envelope, {
    operation: 'COMMERCIAL_INTELLIGENCE',
    subject: 'eligible.test',
    limitations: [],
    claims: [{
      claimClass: 'BUSINESS_IDENTITY',
      confidence: 'HIGH',
      parentEvidenceIds: []
    }]
  }), error => error.code === 'claim_lineage_missing');
  assert.throws(() => enforceEvidenceIntegrity(eligible.envelope, {
    operation: 'COMMERCIAL_INTELLIGENCE',
    subject: 'eligible.test',
    limitations: [],
    claims: [{
      claimClass: 'BUSINESS_IDENTITY',
      confidence: 'HIGH',
      parentEvidenceIds: [`EVI-1-${'B'.repeat(52)}`]
    }]
  }), error => error.code === 'claim_lineage_unauthorised');

  assert.throws(() => enforceEvidenceIntegrity(limited.envelope, {
    operation: 'COMMERCIAL_INTELLIGENCE',
    subject: 'limited.test',
    limitations: [...limited.envelope.limitations],
    claims: [{
      claimClass: 'WEBSITE_PERFORMANCE',
      confidence: 'HIGH',
      parentEvidenceIds: limited.envelope.evidenceLineage.map(item => item.evidenceId)
    }]
  }), error => error.code === 'confidence_escalation');

  const limitationsAcquisition = acquisition('limitations.test');
  limitationsAcquisition.observations.quantitativeBasis = null;
  const limitedWithEvidenceLimitation = await decision(db, 'limitations.test', limitationsAcquisition);
  assert.throws(() => enforceEvidenceIntegrity(limitedWithEvidenceLimitation.envelope, {
    operation: 'COMMERCIAL_INTELLIGENCE',
    subject: 'limitations.test',
    limitations: [],
    claims: [{
      claimClass: 'BUSINESS_IDENTITY',
      confidence: 'MEDIUM',
      parentEvidenceIds: limitedWithEvidenceLimitation.envelope.evidenceLineage.map(item => item.evidenceId)
    }]
  }), error => error.code === 'required_limitation_removed');

  const superseding = await decision(db, 'eligible.test', acquisition('eligible.test', {
    observedAt: '2026-07-26T13:00:00.000Z'
  }), {
    priorDecisionId: eligible.envelope.decisionId,
    occurredAt: '2026-07-26T13:01:00.000Z'
  });
  assert.strictEqual((await replayDecision(db, eligible.envelope.decisionId)).lifecycleState, 'SUPERSEDED');
  assert.strictEqual((await replayDecision(db, superseding.envelope.decisionId)).lifecycleState, 'CURRENT');
  assert.strictEqual((await db.get(
    'SELECT valid FROM evidence_integrity_dependent_reasoning WHERE reasoning_id = ?',
    [execution.reasoningId]
  )).valid, 0);
  await assert.rejects(executeGovernedCommercialIntelligence({
    dbQuery: db,
    envelope: eligible.envelope,
    subject: 'eligible.test',
    occurredAt: '2026-07-26T13:02:00.000Z',
    execute: async () => ({ shouldNotRun: true })
  }), error => error.code === 'EVIDENCE_INTEGRITY_STALE_DECISION');
  await assert.rejects(recordDependentReasoning(
    db, 'STALE-REASONING', eligible.envelope.decisionId,
    crypto.createHash('sha256').update('stale').digest('hex'),
    '2026-07-26T13:03:00.000Z'
  ), error => error.code === 'EVIDENCE_INTEGRITY_STALE_DECISION');

  const failingDb = { ...db, transaction: async () => { throw new Error('injected'); } };
  await assert.rejects(decision(failingDb, 'atomic.test', acquisition('atomic.test')),
    error => error.code === 'EVIDENCE_INTEGRITY_PERSISTENCE_FAILED');
  assert.strictEqual(await db.get(
    "SELECT decision_id FROM evidence_integrity_decisions WHERE subject_id = 'atomic.test'"
  ), null);

  await db.close();
  console.log('Production Evidence Integrity acquisition-to-invalidation integration: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
