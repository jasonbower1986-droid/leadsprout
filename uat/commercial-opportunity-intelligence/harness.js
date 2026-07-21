const { scenarios, participants } = require('./fixtures');

const CRITERIA = Object.freeze(['UAT-01','UAT-02','UAT-03','UAT-04','UAT-05','UAT-06','UAT-07','UAT-08']);
const OVERALL_THRESHOLDS = Object.freeze({ 'UAT-01':.90,'UAT-02':.90,'UAT-03':.90,'UAT-04':.90,'UAT-05':.90,'UAT-06':.85,'UAT-07':.90,'UAT-08':.90,'UAT-09':.80 });
const COHORT_FLOORS = Object.freeze({ 'UAT-01':.80,'UAT-02':.80,'UAT-03':.80,'UAT-04':.80,'UAT-05':.80,'UAT-06':.75,'UAT-07':.80,'UAT-08':.80,'UAT-09':.70 });

function validateStudyDesign() {
  if (participants.length < 18) throw new Error('At least 18 participants required.');
  for (const persona of ['consultant','freelancer','agency_owner']) if (participants.filter(p => p.persona === persona).length < 6) throw new Error('Six participants per persona required.');
  if (scenarios.length < 6) throw new Error('At least six scenarios required.');
  if (participants.some(p => p.scenarios.length !== 3)) throw new Error('Three scenarios per participant required.');
  const disciplines = participants.reduce((map,p) => map.set(p.service_discipline,(map.get(p.service_discipline)||0)+1),new Map());
  if ([...disciplines.values()].some(count => count > participants.length/3)) throw new Error('No service discipline may exceed one third.');
  return true;
}

function adjudicateScore(scores, context) {
  if (!Array.isArray(scores) || scores.length < 2) throw new Error(`Two independent assessors required for ${context}.`);
  for (const score of scores) if (!score.assessor_id || ![0,1,2].includes(score.score) || !score.rationale || !Array.isArray(score.evidence_chain)) throw new Error(`Auditable 0/1/2 score required for ${context}.`);
  const [a,b,third] = scores;
  const aPass = a.score === 2; const bPass = b.score === 2;
  if (aPass !== bPass && !third) throw new Error(`Third assessor required for ${context} pass/non-pass disagreement.`);
  const final = aPass === bPass ? Math.min(a.score,b.score) : third.score;
  return { score: final, materially_accurate: final === 2, assessor_ids: scores.map(item => item.assessor_id), adjudicated: aPass !== bPass, adjudicator_id: aPass !== bPass ? third.assessor_id : null };
}

function ratio(items) { return items.length ? items.filter(item => item.materially_accurate).length / items.length : 0; }
function calculateResults(attempts, participantValues) {
  validateStudyDesign();
  if (attempts.length < 54) throw new Error('At least 54 valid attempts required.');
  const participantById = new Map(participants.map(item => [item.participant_id,item]));
  const scenarioCounts = Object.fromEntries(scenarios.map(s => [s.scenario_id, attempts.filter(a => a.scenario_id === s.scenario_id).length]));
  if (Object.values(scenarioCounts).some(count => count < 9)) throw new Error('At least nine attempts per scenario required.');
  const trace = [];
  for (const attempt of attempts) {
    if (!participantById.has(attempt.participant_id)) throw new Error('Unknown participant.');
    if (!scenarios.some(item => item.scenario_id === attempt.scenario_id)) throw new Error('Unknown scenario.');
    for (const criterion of CRITERIA) {
      const resolved = adjudicateScore(attempt.criteria?.[criterion], `${attempt.attempt_id}/${criterion}`);
      trace.push({ attempt_id: attempt.attempt_id, participant_id: attempt.participant_id, persona: participantById.get(attempt.participant_id).persona, scenario_id: attempt.scenario_id, criterion, ...resolved });
    }
  }
  if (!Array.isArray(participantValues) || participantValues.length !== participants.length || new Set(participantValues.map(item => item.participant_id)).size !== participants.length) throw new Error('UAT-09 requires one result per participant.');
  const uat09 = participantValues.map(item => ({ participant_id: item.participant_id, persona: participantById.get(item.participant_id)?.persona, criterion: 'UAT-09', ...adjudicateScore(item.assessors, `${item.participant_id}/UAT-09`) }));
  const criterion_results = {};
  for (const criterion of CRITERIA) {
    const rows = trace.filter(item => item.criterion === criterion);
    const cohorts = Object.fromEntries(['consultant','freelancer','agency_owner'].map(persona => [persona, ratio(rows.filter(item => item.persona === persona))]));
    criterion_results[criterion] = { denominator: rows.length, materially_accurate: rows.filter(item => item.materially_accurate).length, rate: ratio(rows), threshold: OVERALL_THRESHOLDS[criterion], cohort_floor: COHORT_FLOORS[criterion], cohorts, pass: ratio(rows) >= OVERALL_THRESHOLDS[criterion] && Object.values(cohorts).every(value => value >= COHORT_FLOORS[criterion]) };
  }
  const uat09Cohorts = Object.fromEntries(['consultant','freelancer','agency_owner'].map(persona => [persona, ratio(uat09.filter(item => item.persona === persona))]));
  criterion_results['UAT-09'] = { denominator: uat09.length, materially_accurate: uat09.filter(item => item.materially_accurate).length, rate: ratio(uat09), threshold: .80, cohort_floor: .70, cohorts: uat09Cohorts, pass: ratio(uat09) >= .80 && Object.values(uat09Cohorts).every(value => value >= .70) };
  const scenario_results = {};
  for (const scenario of scenarios) for (const criterion of CRITERIA.slice(0,5)) {
    const rows = trace.filter(item => item.scenario_id === scenario.scenario_id && item.criterion === criterion);
    scenario_results[`${scenario.scenario_id}/${criterion}`] = { denominator: rows.length, rate: ratio(rows), floor: .70, pass: ratio(rows) >= .70 };
  }
  const criticalFailures = attempts.filter(item => item.product_caused_critical_truthfulness_failure);
  const failures = [
    ...Object.entries(criterion_results).filter(([,value]) => !value.pass).map(([key]) => `CRITERION_OR_COHORT:${key}`),
    ...Object.entries(scenario_results).filter(([,value]) => !value.pass).map(([key]) => `SCENARIO:${key}`),
    ...(criticalFailures.length ? ['PRODUCT_CRITICAL_TRUTHFULNESS_FAILURE'] : [])
  ];
  return { contract: 'PROD-SPEC-002/1.1 Section 13', valid_attempts: attempts.length, participants: participantValues.length, scenario_counts: scenarioCounts, criterion_results, scenario_results, critical_failures: criticalFailures.length, assessor_trace: [...trace,...uat09], failures, final_decision: failures.length ? 'FAIL' : 'PASS' };
}

function assertActivationControls(env = process.env) {
  if (!env.COI_UAT_RETENTION_DAYS) throw new Error('Executive/UAT retention period is required before participant activation.');
  if (env.NODE_ENV === 'production') throw new Error('Non-customer UAT harness cannot run in the paying-customer production runtime.');
}

class UatStore {
  constructor({ retentionDays, now = () => new Date() }) { if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error('Valid retention period required.'); this.retentionDays = retentionDays; this.now = now; this.attempts = []; this.audit = []; }
  add(attempt) { if (!/^P\d{2}$/.test(attempt.participant_id) || attempt.name || attempt.email) throw new Error('Only pseudonymous participant records are permitted.'); const record = { ...attempt, captured_at: this.now().toISOString() }; this.attempts.push(record); this.audit.push({ action: 'ADD', attempt_id: record.attempt_id, at: record.captured_at }); return record; }
  export(results) { this.audit.push({ action: 'EXPORT', at: this.now().toISOString() }); return { attempts: this.attempts.map(item => ({ ...item })), results, audit: [...this.audit] }; }
  deleteExpired() { const cutoff = this.now().getTime() - this.retentionDays * 86400000; const removed = this.attempts.filter(item => new Date(item.captured_at).getTime() < cutoff); this.attempts = this.attempts.filter(item => !removed.includes(item)); this.audit.push({ action: 'RETENTION_DELETE', count: removed.length, at: this.now().toISOString() }); return removed.length; }
}

module.exports = { CRITERIA, OVERALL_THRESHOLDS, COHORT_FLOORS, validateStudyDesign, adjudicateScore, calculateResults, assertActivationControls, UatStore };
