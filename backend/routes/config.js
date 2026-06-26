const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

router.get('/personas', (req, res) => {
  const configPath = '/home/team/shared/persona_config.json';
  try {
    const data = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(data);
    res.json(config);
  } catch (err) {
    console.error('Error reading persona config:', err);
    res.status(500).json({ error: 'Failed to load persona configuration' });
  }
});

module.exports = router;
