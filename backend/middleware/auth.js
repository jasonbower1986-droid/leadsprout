const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'leadsprout-super-secret-key-2026';

module.exports = function (req, res, next) {
  // Get token from header
  const authHeader = req.header('Authorization');
  if (!authHeader) {
    return res.status(401).json({ error: 'No token, authorization denied' });
  }

  // Check for Bearer token
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Token format must be Bearer <token>' });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Contains id, email, plan
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token is not valid' });
  }
};
