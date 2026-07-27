const express = require('express');
const auth = require('../middleware/auth');
const { dbQuery } = require('../database');
const { ActivityServiceError, listActivity, affectedObject } = require('../services/activityService');

const router = express.Router();
const fail = (res, error) => {
  if (error instanceof ActivityServiceError) {
    return res.status(error.status).json({
      error: error.status === 404 ? 'Activity object unavailable' : 'Activity request invalid',
      code: error.code
    });
  }
  console.error('[Activity]', error.code || error.message);
  return res.status(503).json({ error: 'Activity unavailable', code: 'ACTIVITY_UNAVAILABLE' });
};

router.get('/', auth, async (req, res) => {
  try {
    return res.json(await listActivity(dbQuery, {
      userId: req.user.id,
      pageSize: req.query.page_size,
      cursor: req.query.cursor
    }));
  } catch (error) { return fail(res, error); }
});

router.get('/:activityEventId/affected-object', auth, async (req, res) => {
  try {
    return res.json(await affectedObject(dbQuery, {
      userId: req.user.id,
      activityEventId: req.params.activityEventId
    }));
  } catch (error) { return fail(res, error); }
});

module.exports = router;
