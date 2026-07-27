class DomainAccessError extends Error {
  constructor(code, status = 404) {
    super(code);
    this.name = 'DomainAccessError';
    this.code = code;
    this.status = status;
  }
}

function deny() {
  throw new DomainAccessError('OBJECT_NOT_FOUND', 404);
}

async function resolveOrganizationMembership(db, { organizationId, userId }) {
  if (!organizationId || !userId) deny();
  const membership = await db.get(`SELECT organization_id,user_id,role_class
    FROM organization_memberships
    WHERE organization_id = ? AND user_id = ? AND membership_state = 'ACTIVE'`,
  [organizationId, userId]);
  if (!membership) deny();
  return Object.freeze(membership);
}

async function resolveWorkspaceAccess(db, { organizationId, workspaceId, userId }) {
  if (!organizationId || !workspaceId || !userId) deny();
  const access = await db.get(`SELECT access.organization_id,access.workspace_id,
      access.owner_user_id,workspace.current_version,workspace.lifecycle
    FROM workspace_organization_access access
    JOIN organization_memberships membership
      ON membership.organization_id = access.organization_id
      AND membership.user_id = ?
      AND membership.membership_state = 'ACTIVE'
    JOIN opportunity_workspaces workspace
      ON workspace.workspace_id = access.workspace_id
    WHERE access.organization_id = ?
      AND access.workspace_id = ?
      AND access.access_state = 'ACTIVE'`,
  [userId, organizationId, workspaceId]);
  if (!access) deny();
  return Object.freeze(access);
}

module.exports = {
  DomainAccessError,
  resolveOrganizationMembership,
  resolveWorkspaceAccess
};
