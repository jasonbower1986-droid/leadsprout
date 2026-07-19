const assert = require('assert');
const {
  STATUSES,
  CONFIDENCE,
  CLAIM_CLASSIFICATIONS,
  synthesiseOpportunityUnderstanding,
  validateOpportunityUnderstanding
} = require('./backend/utils/opportunity-understanding');
const { enrichLeadData } = require('./backend/utils/enrichment');

function investigation(findingsByDimension) {
  const dimensions = {};
  for (const dimension of ['accessibility', 'trust', 'conversion', 'localSEO']) {
    const findings = findingsByDimension[dimension] || [];
    dimensions[dimension] = { score: findings[0]?.severity || 0, findings };
  }
  return { dimensions, overall: { totalFindings: Object.values(findingsByDimension).flat().length }, scoredForModel: 'Hybrid' };
}

function lead(overrides = {}) {
  return {
    id: 'LEAD-001', domain: 'example.com', business_name: 'Example Business', niche: 'General',
    speed_score: 40, responsive_status: 'not_responsive', address_detected: false,
    seo_gaps: [], conversion_gaps: [], ...overrides
  };
}

function assertClaimTraceability(result) {
  const references = new Set(result.supporting_evidence_references.map(item => item.reference_id));
  const claims = [result.attention_rationale, result.commercial_significance,
    result.initial_commercial_direction, ...result.opportunity_signals];
  assert(claims.every(item => item.evidence_references.every(reference => references.has(reference))));
}

async function run() {
  const complete = synthesiseOpportunityUnderstanding({
    lead: lead(),
    investigation: investigation({
      accessibility: [
        { signal: 'slow_speed', detail: 'Speed score 40/100 — poor', severity: 8 },
        { signal: 'not_responsive', detail: 'Site is not mobile-responsive', severity: 9 }
      ],
      trust: [{ signal: 'no_address', detail: 'No physical address detected', severity: 6 }]
    })
  });
  assert.strictEqual(complete.status, STATUSES.COMPLETE);
  assert.strictEqual(complete.confidence_classification, CONFIDENCE.HIGH);
  assert.strictEqual(validateOpportunityUnderstanding(complete).valid, true);
  assert.strictEqual(complete.opportunity_signals.length, 3);
  assert(complete.opportunity_signals.every(item => item.classification === CLAIM_CLASSIFICATIONS.OBSERVATION));
  assert.strictEqual(complete.attention_rationale.classification, CLAIM_CLASSIFICATIONS.INTERPRETATION);
  assertClaimTraceability(complete);

  const limited = synthesiseOpportunityUnderstanding({
    lead: lead({ business_name: 'Limited Evidence Business' }),
    investigation: investigation({ conversion: [
      { signal: 'no_cta', detail: 'No clear Call-To-Action found', severity: 7 }
    ] })
  });
  assert.strictEqual(limited.status, STATUSES.LIMITED);
  assert.strictEqual(limited.confidence_classification, CONFIDENCE.LOW);
  assert(limited.material_limitations.length > 0);
  assertClaimTraceability(limited);

  const insufficient = synthesiseOpportunityUnderstanding({
    lead: lead({ business_name: 'Healthy Business' }),
    investigation: investigation({})
  });
  assert.strictEqual(insufficient.status, STATUSES.INSUFFICIENT_EVIDENCE);
  assert.strictEqual(insufficient.confidence_classification, CONFIDENCE.UNDETERMINED);
  assert.strictEqual(insufficient.opportunity_signals.length, 0);
  assert(insufficient.material_limitations.length > 0);

  const contradictory = synthesiseOpportunityUnderstanding({
    lead: lead({
      _evidence: { contradictoryEvidence: ['Mobile evidence conflicts with the desktop observation.'] }
    }),
    investigation: investigation({ trust: [
      { signal: 'missing_ssl', detail: 'SSL certificate missing or invalid', severity: 7 }
    ] })
  });
  assert(contradictory.material_limitations.includes('Mobile evidence conflicts with the desktop observation.'));

  const unsupported = {
    ...complete,
    commercial_significance: {
      ...complete.commercial_significance,
      statement: 'This will generate $10,000 in revenue.'
    }
  };
  const unsupportedValidation = validateOpportunityUnderstanding(unsupported);
  assert.strictEqual(unsupportedValidation.valid, false);
  assert(unsupportedValidation.errors.includes('unsupported_commercial_claim'));

  assert.throws(
    () => synthesiseOpportunityUnderstanding({ lead: lead(), investigation: null }),
    error => error.code === 'OPPORTUNITY_UNDERSTANDING_INPUT_UNAVAILABLE'
  );

  const enriched = enrichLeadData(lead({
    seo_gaps: ['Missing Meta Description'],
    conversion_gaps: ['No clear Call-To-Action (CTA) buttons found']
  }));
  assert(enriched.opportunity_understanding);
  assert(Object.keys(enriched).indexOf('opportunity_understanding') < Object.keys(enriched).indexOf('strategy_report'));
  assert(enriched.strategy_report, 'Existing Commercial Intelligence remains available');

  const previousFlag = process.env.OPPORTUNITY_UNDERSTANDING_ENABLED;
  process.env.OPPORTUNITY_UNDERSTANDING_ENABLED = 'false';
  const rolledBack = enrichLeadData(lead());
  assert.strictEqual(Object.hasOwn(rolledBack, 'opportunity_understanding'), false);
  assert(rolledBack.strategy_report, 'Rollback preserves the previous Commercial Intelligence sequence');
  if (previousFlag === undefined) delete process.env.OPPORTUNITY_UNDERSTANDING_ENABLED;
  else process.env.OPPORTUNITY_UNDERSTANDING_ENABLED = previousFlag;

  console.log('Opportunity Understanding verification: PASS');
}

run().catch(error => { console.error(error); process.exit(1); });
