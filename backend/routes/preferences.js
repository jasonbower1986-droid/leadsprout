const express = require('express');
const auth = require('../middleware/auth');
const { dbQuery } = require('../database');
const { isOpportunityWorkspaceEnabled } = require('../config/opportunity-workspace');
const {
  PreferenceError,
  getPreferences,
  updatePreference
} = require('../services/preferenceService');

const router = express.Router();

async function membership(userId) {
  return dbQuery.get(`SELECT organization_id,user_id,role_class
    FROM organization_memberships
    WHERE user_id=? AND membership_state='ACTIVE'
    ORDER BY organization_id ASC LIMIT 1`, [userId]);
}

function fail(res, error) {
  if (error instanceof PreferenceError) {
    const status = error.code === 'STALE_WRITE' ? 409 :
      error.code === 'MEMBERSHIP_REQUIRED' ? 403 : 400;
    return res.status(status).json({
      error: status === 409 ? 'Preference changed elsewhere' : 'Preference request refused',
      code: error.code
    });
  }
  console.error('[Preferences]', error.code || error.message);
  return res.status(503).json({
    error: 'Settings are temporarily unavailable',
    code: 'PREFERENCES_UNAVAILABLE'
  });
}

router.get('/', auth, async (req, res) => {
  try {
    const active = await membership(req.user.id);
    if (!active) throw new PreferenceError('MEMBERSHIP_REQUIRED');
    return res.json(await getPreferences(dbQuery, {
      organizationId: active.organization_id,
      userId: req.user.id,
      roleClass: active.role_class,
      featureEnabled: isOpportunityWorkspaceEnabled()
    }));
  } catch (error) {
    return fail(res, error);
  }
});

router.put('/', auth, async (req, res) => {
  try {
    const active = await membership(req.user.id);
    if (!active) throw new PreferenceError('MEMBERSHIP_REQUIRED');
    const preference = await updatePreference(dbQuery, {
      organizationId: active.organization_id,
      userId: req.user.id,
      workspaceId: req.body.workspace_id || null,
      fieldName: req.body.field_name,
      fieldValue: req.body.field_value,
      expectedRevision: req.body.expected_revision,
      updateSource: 'CUSTOMER'
    });
    return res.json({ preference });
  } catch (error) {
    return fail(res, error);
  }
});

module.exports = router;
