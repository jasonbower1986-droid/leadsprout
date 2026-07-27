const crypto = require('crypto');

class DomainOutboxError extends Error {
  constructor(code) {
    super(code);
    this.name = 'DomainOutboxError';
    this.code = code;
  }
}

const now = clock => (clock ? clock() : new Date().toISOString());
const identifier = prefix => `${prefix}-${crypto.randomUUID()}`;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonical(value[key]);
      return result;
    }, {});
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonical(value));
}

function outboxInsertOperation(event, options = {}) {
  const createdAt = options.createdAt || now(options.clock);
  const row = {
    outboxId: options.outboxId || identifier('outbox'),
    organizationId: event.organizationId,
    workspaceId: event.workspaceId || null,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    payloadJson: stableJson(event.payload || {}),
    policyVersion: event.policyVersion,
    idempotencyKey: event.idempotencyKey,
    availableAt: event.availableAt || createdAt,
    createdAt
  };
  if (!row.organizationId || !row.aggregateType || !row.aggregateId ||
      !row.eventType || !row.policyVersion || !row.idempotencyKey) {
    throw new DomainOutboxError('OUTBOX_INPUT_INVALID');
  }
  return {
    row,
    operation: {
      sql: `INSERT INTO domain_outbox
        (outbox_id,organization_id,workspace_id,aggregate_type,aggregate_id,event_type,
         payload_json,policy_version,idempotency_key,state,attempt_count,available_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,'PENDING',0,?,?)`,
      params: [
        row.outboxId, row.organizationId, row.workspaceId, row.aggregateType,
        row.aggregateId, row.eventType, row.payloadJson, row.policyVersion,
        row.idempotencyKey, row.availableAt, row.createdAt
      ]
    }
  };
}

async function enqueue(db, event, options = {}) {
  const prepared = outboxInsertOperation(event, options);
  try {
    await db.run(prepared.operation.sql, prepared.operation.params);
    return Object.freeze({ ...prepared.row, state: 'PENDING', replay: false });
  } catch (error) {
    if (!/UNIQUE constraint failed/.test(error.message || '')) throw error;
    const existing = await db.get('SELECT * FROM domain_outbox WHERE idempotency_key = ?', [
      prepared.row.idempotencyKey
    ]);
    const equivalent = existing &&
      existing.organization_id === prepared.row.organizationId &&
      (existing.workspace_id || null) === prepared.row.workspaceId &&
      existing.aggregate_type === prepared.row.aggregateType &&
      existing.aggregate_id === prepared.row.aggregateId &&
      existing.event_type === prepared.row.eventType &&
      existing.payload_json === prepared.row.payloadJson &&
      existing.policy_version === prepared.row.policyVersion;
    if (!equivalent) throw new DomainOutboxError('OUTBOX_IDEMPOTENCY_CONFLICT');
    return Object.freeze({ ...existing, replay: true });
  }
}

async function claimNext(db, { workerId, at } = {}) {
  if (!workerId) throw new DomainOutboxError('OUTBOX_WORKER_REQUIRED');
  const claimedAt = at || now();
  return db.get(`UPDATE domain_outbox
    SET state = 'CLAIMED',locked_by = ?,locked_at = ?,attempt_count = attempt_count + 1
    WHERE outbox_id = (
      SELECT outbox_id FROM domain_outbox
      WHERE state = 'PENDING' AND available_at <= ?
      ORDER BY available_at,created_at,outbox_id LIMIT 1
    ) AND state = 'PENDING'
    RETURNING *`, [workerId, claimedAt, claimedAt]);
}

async function complete(db, { outboxId, workerId, at } = {}) {
  const completedAt = at || now();
  const row = await db.get(`UPDATE domain_outbox
    SET state = 'COMPLETED',locked_by = NULL,locked_at = NULL,completed_at = ?,last_error_code = NULL
    WHERE outbox_id = ? AND state = 'CLAIMED' AND locked_by = ?
    RETURNING *`, [completedAt, outboxId, workerId]);
  if (!row) throw new DomainOutboxError('OUTBOX_CLAIM_LOST');
  return row;
}

async function failClaim(db, { outboxId, workerId, errorCode, retryAt } = {}) {
  if (!/^[A-Z0-9_]{1,80}$/.test(errorCode || '')) {
    throw new DomainOutboxError('OUTBOX_ERROR_CODE_INVALID');
  }
  const retry = Boolean(retryAt);
  const row = await db.get(`UPDATE domain_outbox
    SET state = ?,locked_by = NULL,locked_at = NULL,available_at = COALESCE(?,available_at),
        last_error_code = ?
    WHERE outbox_id = ? AND state = 'CLAIMED' AND locked_by = ?
    RETURNING *`,
  [retry ? 'PENDING' : 'FAILED', retryAt || null, errorCode, outboxId, workerId]);
  if (!row) throw new DomainOutboxError('OUTBOX_CLAIM_LOST');
  return row;
}

async function recoverInterrupted(db, { olderThan, retryAt } = {}) {
  if (!olderThan || !retryAt) throw new DomainOutboxError('OUTBOX_RECOVERY_INPUT_INVALID');
  return db.all(`UPDATE domain_outbox
    SET state = 'PENDING',locked_by = NULL,locked_at = NULL,available_at = ?,
        last_error_code = 'INTERRUPTED'
    WHERE state = 'CLAIMED' AND locked_at < ?
    RETURNING outbox_id`, [retryAt, olderThan]);
}

module.exports = {
  DomainOutboxError,
  claimNext,
  complete,
  enqueue,
  failClaim,
  outboxInsertOperation,
  recoverInterrupted,
  stableJson
};
