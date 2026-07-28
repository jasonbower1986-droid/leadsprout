const crypto = require('crypto');

class PreferenceRetentionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PreferenceRetentionError';
    this.code = code;
  }
}

const stableId = (prefix, value) =>
  `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32)}`;

async function createHold(db, input) {
  if (!['LEGAL', 'SECURITY'].includes(input.authorityDomain) ||
      !input.externalRecordReference || !/^[a-f0-9]{64}$/.test(input.externalRecordDigest || '') ||
      !input.reasonClass || !input.verifiedActorIdentity || input.actorVerified !== true) {
    throw new PreferenceRetentionError('RETENTION_HOLD_AUTHORITY_REQUIRED');
  }
  const holdId = input.holdId || stableId('hold', [
    input.retentionCaseId, input.authorityDomain, input.externalRecordDigest
  ].join('|'));
  await db.run(`INSERT INTO preference_retention_holds
    (retention_hold_id,retention_case_id,authority_domain,external_record_reference,
     external_record_digest,reason_class,verified_actor_identity,state,created_at,released_at)
    VALUES (?,?,?,?,?,?,?,'ACTIVE',?,NULL)`, [
    holdId, input.retentionCaseId, input.authorityDomain, input.externalRecordReference,
    input.externalRecordDigest, input.reasonClass, input.verifiedActorIdentity, input.occurredAt
  ]);
  return db.get('SELECT * FROM preference_retention_holds WHERE retention_hold_id=?', [holdId]);
}

async function releaseHold(db, input) {
  if (!input.verifiedActorIdentity || input.actorVerified !== true) {
    throw new PreferenceRetentionError('RETENTION_HOLD_AUTHORITY_REQUIRED');
  }
  const hold = await db.get(
    "SELECT * FROM preference_retention_holds WHERE retention_hold_id=? AND state='ACTIVE'",
    [input.holdId]
  );
  if (!hold) throw new PreferenceRetentionError('RETENTION_HOLD_NOT_ACTIVE');
  await db.run(`UPDATE preference_retention_holds SET state='RELEASED',released_at=?
    WHERE retention_hold_id=? AND state='ACTIVE'`, [input.occurredAt, input.holdId]);
  return db.get('SELECT * FROM preference_retention_holds WHERE retention_hold_id=?', [input.holdId]);
}

async function dueCases(db, now) {
  return db.all(`SELECT retention_case_id FROM preference_retention_cases retention
    WHERE state IN ('PENDING','FAILED') AND deletion_due_at<=?
      AND NOT EXISTS (SELECT 1 FROM preference_retention_holds hold
        WHERE hold.retention_case_id=retention.retention_case_id AND hold.state='ACTIVE')
    ORDER BY deletion_due_at,retention_case_id`, [now]);
}

module.exports = {
  PreferenceRetentionError,
  createHold,
  dueCases,
  releaseHold,
  stableId
};
