const FEATURE_ENV = 'OPPORTUNITY_WORKSPACE_ENABLED';

function isOpportunityWorkspaceEnabled(env = process.env) {
  return env[FEATURE_ENV] === 'true';
}

function requireOpportunityWorkspace(req, res, next) {
  if (!isOpportunityWorkspaceEnabled()) {
    return res.status(404).json({ error: 'Opportunity Workspace is not available', code: 'FEATURE_DISABLED' });
  }
  next();
}

module.exports = { FEATURE_ENV, isOpportunityWorkspaceEnabled, requireOpportunityWorkspace };
