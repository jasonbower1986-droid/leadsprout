const { scenarios, participants } = require('./fixtures');

function validateStudyDesign() {
  if (participants.length < 18) throw new Error('At least 18 participants required.');
  for (const persona of ['consultant','freelancer','agency_owner']) if (participants.filter(p => p.persona === persona).length < 6) throw new Error('Six participants per persona required.');
  if (scenarios.length < 6) throw new Error('At least six scenarios required.');
  if (participants.some(p => p.scenarios.length !== 3)) throw new Error('Three scenarios per participant required.');
  const disciplines = participants.reduce((map,p) => map.set(p.service_discipline,(map.get(p.service_discipline)||0)+1),new Map());
  if ([...disciplines.values()].some(count => count > participants.length/3)) throw new Error('No service discipline may exceed one third.');
  return true;
}

function adjudicateAttempt(attempt) {
  if (!attempt.assessors || attempt.assessors.length < 2) throw new Error('Two independent assessors required.');
  const [a,b,third] = attempt.assessors;
  if (a.pass !== b.pass && !third) throw new Error('Third assessor required for pass/non-pass disagreement.');
  return a.pass === b.pass ? a.pass : third.pass;
}

function calculateResults(attempts) {
  validateStudyDesign();
  if (attempts.length < 54) throw new Error('At least 54 valid attempts required.');
  const scenarioCounts = Object.fromEntries(scenarios.map(s => [s.scenario_id, attempts.filter(a => a.scenario_id === s.scenario_id).length]));
  if (Object.values(scenarioCounts).some(count => count < 9)) throw new Error('At least nine attempts per scenario required.');
  const criticalFailures = attempts.filter(a => a.product_caused_critical_truthfulness_failure);
  const passed = attempts.filter(adjudicateAttempt).length;
  return { valid_attempts: attempts.length, passed, pass_rate: passed/attempts.length, scenario_counts: scenarioCounts, critical_failures: criticalFailures.length, uat_09_participants: new Set(attempts.filter(a => a.uat_09).map(a => a.participant_id)).size };
}

function assertActivationControls(env = process.env) {
  if (!env.COI_UAT_RETENTION_DAYS) throw new Error('Executive/UAT retention period is required before participant activation.');
  if (env.NODE_ENV === 'production') throw new Error('Non-customer UAT harness cannot run in the paying-customer production runtime.');
}

class UatStore {
  constructor({ retentionDays, now = () => new Date() }) {
    if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error('Valid retention period required.');
    this.retentionDays = retentionDays; this.now = now; this.attempts = []; this.audit = [];
  }
  add(attempt) {
    if (!/^P\d{2}$/.test(attempt.participant_id) || attempt.name || attempt.email) throw new Error('Only pseudonymous participant records are permitted.');
    const record = { ...attempt, captured_at: this.now().toISOString() };
    this.attempts.push(record); this.audit.push({ action: 'ADD', attempt_id: record.attempt_id, at: record.captured_at }); return record;
  }
  export() { this.audit.push({ action: 'EXPORT', at: this.now().toISOString() }); return { attempts: this.attempts.map(item => ({ ...item })), audit: [...this.audit] }; }
  deleteExpired() {
    const cutoff = this.now().getTime() - this.retentionDays * 86400000;
    const removed = this.attempts.filter(item => new Date(item.captured_at).getTime() < cutoff);
    this.attempts = this.attempts.filter(item => !removed.includes(item));
    this.audit.push({ action: 'RETENTION_DELETE', count: removed.length, at: this.now().toISOString() }); return removed.length;
  }
}

module.exports = { validateStudyDesign, adjudicateAttempt, calculateResults, assertActivationControls, UatStore };
