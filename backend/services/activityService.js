const PAGE_SIZES = new Set([25, 50]);
const RETENTION_MONTHS = 24;

class ActivityServiceError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'ActivityServiceError';
    this.code = code;
    this.status = status;
  }
}

const actorClass = value => ({
  AUTHENTICATED_USER: 'CUSTOMER_USER',
  SYSTEM: 'SYSTEM_SERVICE',
  AUTHORISED_OPERATOR: 'AUTHORISED_OPERATOR',
  AUTHORISED_INTEGRATION: 'EXTERNAL_SYSTEM',
  UNAVAILABLE: 'UNAVAILABLE'
}[value] || 'UNAVAILABLE');

const actorName = row => {
  if (row.actor_class === 'SYSTEM') return 'LeadSprout';
  return row.actor_display_name || 'Actor unavailable';
};

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({
    occurred_at: row.occurred_at,
    activity_event_id: row.activity_event_id
  })).toString('base64url');
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed.occurred_at || !parsed.activity_event_id ||
        Object.keys(parsed).some(key => !['occurred_at', 'activity_event_id'].includes(key))) {
      throw new Error('invalid');
    }
    return parsed;
  } catch (_) {
    throw new ActivityServiceError('ACTIVITY_CURSOR_INVALID');
  }
}

const retentionCutoff = now => {
  const cutoff = new Date(now);
  if (Number.isNaN(cutoff.getTime())) throw new ActivityServiceError('ACTIVITY_TIME_INVALID');
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
  return cutoff.toISOString();
};

function isRetentionException(row) {
  if (row.event_category === 'WORKSPACE_VERSION_CURRENT') {
    return Number(row.workspace_version) === Number(row.current_version);
  }
  if (['REPORT_AVAILABLE', 'REPORT_PARTIAL_EVIDENCE'].includes(row.event_category)) {
    return row.affected_object_id === row.current_report_version_id;
  }
  return row.event_category === 'EVIDENCE_INTEGRITY_BLOCKED' && !row.restored_event_id;
}

function present(row, sources) {
  const accessibleSources = sources.filter(source => source.source_object_accessible === 1);
  const causeRestricted = sources.some(source =>
    source.relationship_type === 'CAUSE' && source.source_object_accessible !== 1);
  return Object.freeze({
    activity_event_id: row.activity_event_id,
    event_category: row.event_category,
    actor: { class: actorClass(row.actor_class), display_name: actorName(row) },
    affected_object: {
      type: row.affected_object_type,
      id: row.affected_object_id,
      href: `/api/activity/${encodeURIComponent(row.activity_event_id)}/affected-object`
    },
    event_summary: row.event_summary,
    commercial_consequence: row.commercial_consequence || 'Consequence undetermined',
    communication_status: row.communication_status || 'NOT_RECORDED',
    evidence_integrity_state: row.evidence_integrity_state,
    workspace_version: row.workspace_version,
    occurred_at: row.occurred_at,
    recorded_at: row.recorded_at,
    correction_of_activity_event_id: row.correction_of_activity_event_id,
    supersedes_activity_event_id: row.supersedes_activity_event_id,
    causal_chain: causeRestricted ? {
      state: 'PARTIAL',
      detail: 'One or more causal objects are not accessible.'
    } : {
      state: accessibleSources.some(source => source.relationship_type === 'CAUSE') ? 'AVAILABLE' : 'NOT_RECORDED',
      sources: accessibleSources.map(source => ({
        type: source.source_object_type,
        id: source.source_object_id,
        relationship: source.relationship_type
      }))
    }
  });
}

async function listActivity(db, input, options = {}) {
  const pageSize = input.pageSize == null ? 25 : Number(input.pageSize);
  if (!PAGE_SIZES.has(pageSize)) throw new ActivityServiceError('ACTIVITY_PAGE_SIZE_INVALID');
  const cursor = decodeCursor(input.cursor);
  const parameters = [input.userId];
  let cursorSql = '';
  if (cursor) {
    cursorSql = `AND (event.occurred_at < ? OR
      (event.occurred_at = ? AND event.activity_event_id < ?))`;
    parameters.push(cursor.occurred_at, cursor.occurred_at, cursor.activity_event_id);
  }
  const rows = await db.all(`SELECT event.*,workspace.current_version,
      lineage.current_report_version_id,
      (SELECT restored.activity_event_id FROM customer_activity_events restored
       WHERE restored.organization_id = event.organization_id
         AND restored.workspace_id = event.workspace_id
         AND restored.event_category = 'EVIDENCE_INTEGRITY_RESTORED'
         AND restored.occurred_at > event.occurred_at
       ORDER BY restored.occurred_at ASC,restored.activity_event_id ASC LIMIT 1) AS restored_event_id
    FROM customer_activity_events event
    JOIN organization_memberships membership
      ON membership.organization_id = event.organization_id
      AND membership.user_id = ?
      AND membership.membership_state = 'ACTIVE'
    JOIN workspace_organization_access access
      ON access.organization_id = event.organization_id
      AND access.workspace_id = event.workspace_id
      AND access.access_state = 'ACTIVE'
    JOIN opportunity_workspaces workspace ON workspace.workspace_id = event.workspace_id
    LEFT JOIN report_lineages lineage
      ON event.affected_object_type IN ('REPORT','REPORT_VERSION')
      AND (lineage.report_id = event.affected_object_id
        OR lineage.current_report_version_id = event.affected_object_id)
    WHERE 1=1 ${cursorSql}
    ORDER BY event.occurred_at DESC,event.activity_event_id DESC`, parameters);
  const cutoff = retentionCutoff(options.now || new Date().toISOString());
  const retained = rows.filter(row => row.occurred_at >= cutoff || isRetentionException(row));
  const selected = retained.slice(0, pageSize + 1);
  const visible = selected.slice(0, pageSize);
  const ids = visible.map(row => row.activity_event_id);
  let sources = [];
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    sources = await db.all(`SELECT source.*,
        CASE
          WHEN source.source_object_type IN ('WORKSPACE','WORKSPACE_VERSION')
            THEN EXISTS(SELECT 1 FROM workspace_organization_access access
              JOIN organization_memberships membership
                ON membership.organization_id=access.organization_id
                AND membership.user_id=? AND membership.membership_state='ACTIVE'
              WHERE access.workspace_id=source.source_object_id
                AND access.access_state='ACTIVE')
          WHEN source.source_object_type IN ('REPORT','REPORT_VERSION')
            THEN EXISTS(SELECT 1 FROM report_lineages report
              JOIN organization_memberships membership
                ON membership.organization_id=report.organization_id
                AND membership.user_id=? AND membership.membership_state='ACTIVE'
              WHERE report.report_id=source.source_object_id
                OR report.current_report_version_id=source.source_object_id)
          ELSE 0
        END AS source_object_accessible
      FROM activity_event_sources source
      WHERE source.activity_event_id IN (${placeholders})`,
    [input.userId, input.userId, ...ids]);
  }
  return Object.freeze({
    events: visible.map(row => present(
      row, sources.filter(source => source.activity_event_id === row.activity_event_id)
    )),
    next_cursor: selected.length > pageSize ? encodeCursor(visible[visible.length - 1]) : null,
    history_boundary: {
      retention_months: RETENTION_MONTHS,
      complete: selected.length <= pageSize && rows.every(row => row.occurred_at >= cutoff || isRetentionException(row))
    }
  });
}

async function affectedObject(db, { userId, activityEventId }) {
  const row = await db.get(`SELECT event.affected_object_type,event.affected_object_id,
      event.workspace_id
    FROM customer_activity_events event
    JOIN organization_memberships membership
      ON membership.organization_id=event.organization_id
      AND membership.user_id=? AND membership.membership_state='ACTIVE'
    JOIN workspace_organization_access access
      ON access.organization_id=event.organization_id
      AND access.workspace_id=event.workspace_id AND access.access_state='ACTIVE'
    WHERE event.activity_event_id=?`, [userId, activityEventId]);
  if (!row) throw new ActivityServiceError('OBJECT_NOT_FOUND', 404);
  let href = ['WORKSPACE', 'WORKSPACE_VERSION'].includes(row.affected_object_type)
    ? `/opportunities/${encodeURIComponent(row.workspace_id)}` : null;
  if (row.affected_object_type === 'REPORT') {
    href = `/reports/${encodeURIComponent(row.affected_object_id)}`;
  } else if (row.affected_object_type === 'REPORT_VERSION') {
    const version = await db.get(`SELECT version.report_id FROM report_versions version
      JOIN report_lineages report ON report.report_id=version.report_id
      JOIN organization_memberships membership
        ON membership.organization_id=report.organization_id
        AND membership.user_id=? AND membership.membership_state='ACTIVE'
      WHERE version.report_version_id=?`, [userId, row.affected_object_id]);
    if (version) href = `/reports/${encodeURIComponent(version.report_id)}/versions/${encodeURIComponent(row.affected_object_id)}`;
  }
  if (!href) throw new ActivityServiceError('AFFECTED_OBJECT_ROUTE_UNAVAILABLE', 404);
  return { href };
}

module.exports = {
  ActivityServiceError,
  PAGE_SIZES,
  RETENTION_MONTHS,
  decodeCursor,
  encodeCursor,
  listActivity,
  affectedObject
};
