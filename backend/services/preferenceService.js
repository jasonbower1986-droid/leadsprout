const crypto = require('crypto');
const { resolveOrganizationMembership, resolveWorkspaceAccess } = require('./reportAccess');

class PreferenceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PreferenceError';
    this.code = code;
  }
}

const RULES = Object.freeze({
  evidence_density: Object.freeze({
    values: Object.freeze(['COMPACT', 'BALANCED', 'EXPANDED']),
    workspaceAllowed: true,
    defaultValue: 'BALANCED'
  }),
  reduced_motion: Object.freeze({
    values: Object.freeze(['true', 'false']),
    workspaceAllowed: false,
    defaultValue: 'false'
  }),
  material_change_notifications: Object.freeze({
    values: Object.freeze(['ENABLED', 'DISABLED']),
    workspaceAllowed: true,
    defaultValue: 'ENABLED'
  })
});

const id = prefix => `${prefix}-${crypto.randomUUID()}`;
const timestamp = clock => clock ? clock() : new Date().toISOString();

function validate(fieldName, fieldValue, workspaceId) {
  const rule = RULES[fieldName];
  if (!rule || !rule.values.includes(String(fieldValue))) {
    throw new PreferenceError('PREFERENCE_INVALID');
  }
  if (workspaceId && !rule.workspaceAllowed) throw new PreferenceError('PREFERENCE_SCOPE_INVALID');
  return String(fieldValue);
}

async function assertOwner(db, input) {
  await resolveOrganizationMembership(db, input);
  if (input.workspaceId) await resolveWorkspaceAccess(db, input);
}

async function getPreference(db, input) {
  await assertOwner(db, input);
  const row = await db.get(`SELECT * FROM user_presentation_preferences
    WHERE organization_id = ? AND user_id = ? AND field_name = ?
      AND ((workspace_id = ?) OR (workspace_id IS NULL AND ? IS NULL))`,
  [input.organizationId, input.userId, input.fieldName, input.workspaceId || null, input.workspaceId || null]);
  const rule = RULES[input.fieldName];
  if (!rule) throw new PreferenceError('PREFERENCE_INVALID');
  return row || Object.freeze({
    organization_id: input.organizationId,
    user_id: input.userId,
    workspace_id: input.workspaceId || null,
    field_name: input.fieldName,
    field_value: rule.defaultValue,
    revision: 0,
    persisted: false
  });
}

async function updatePreference(db, input, options = {}) {
  await assertOwner(db, input);
  const workspaceId = input.workspaceId || null;
  const value = validate(input.fieldName, input.fieldValue, workspaceId);
  const current = await db.get(`SELECT * FROM user_presentation_preferences
    WHERE organization_id = ? AND user_id = ? AND field_name = ?
      AND ((workspace_id = ?) OR (workspace_id IS NULL AND ? IS NULL))`,
  [input.organizationId, input.userId, input.fieldName, workspaceId, workspaceId]);
  const expected = Number(input.expectedRevision);
  const actual = Number(current?.revision || 0);
  if (!Number.isInteger(expected) || expected !== actual) throw new PreferenceError('STALE_WRITE');
  const occurredAt = options.occurredAt || timestamp(options.clock);
  const nextRevision = actual + 1;
  const preferenceId = current?.preference_id || options.preferenceId || id('preference');
  const auditId = options.auditId || id('preference-audit');
  const operations = current ? [
    {
      sql: `UPDATE user_presentation_preferences
        SET field_value = ?,revision = ?,updated_at = ?
        WHERE preference_id = ? AND revision = ?`,
      params: [value, nextRevision, occurredAt, preferenceId, actual]
    }
  ] : [
    {
      sql: `INSERT INTO user_presentation_preferences
        (preference_id,organization_id,user_id,workspace_id,field_name,field_value,revision,created_at,updated_at)
        VALUES (?,?,?,?,?,?,1,?,?)`,
      params: [
        preferenceId, input.organizationId, input.userId, workspaceId,
        input.fieldName, value, occurredAt, occurredAt
      ]
    }
  ];
  operations.push({
    sql: `INSERT INTO preference_audit_events
      (audit_event_id,preference_id,organization_id,user_id,workspace_id,field_name,
       prior_value,new_value,prior_revision,new_revision,update_source,occurred_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?
      WHERE EXISTS (
        SELECT 1 FROM user_presentation_preferences WHERE preference_id = ? AND revision = ?
      )`,
    params: [
      auditId, preferenceId, input.organizationId, input.userId, workspaceId,
      input.fieldName, current?.field_value || null, value, actual, nextRevision,
      input.updateSource || 'CUSTOMER', occurredAt, preferenceId, nextRevision
    ]
  });
  try {
    await db.transaction(operations);
  } catch (error) {
    if (/UNIQUE constraint failed/.test(error.message || '')) throw new PreferenceError('STALE_WRITE');
    throw error;
  }
  const audit = await db.get('SELECT audit_event_id FROM preference_audit_events WHERE audit_event_id = ?', [
    auditId
  ]);
  if (!audit) throw new PreferenceError('STALE_WRITE');
  const persisted = await db.get('SELECT * FROM user_presentation_preferences WHERE preference_id = ?', [
    preferenceId
  ]);
  if (!persisted || Number(persisted.revision) !== nextRevision ||
      persisted.field_value !== value) throw new PreferenceError('STALE_WRITE');
  return Object.freeze(persisted);
}

module.exports = {
  PreferenceError,
  RULES,
  getPreference,
  updatePreference,
  validate
};
