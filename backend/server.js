const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { verifySchema } = require('./scripts/verify_schema');
const authRoutes = require('./routes/auth');
const leadRoutes = require('./routes/leads');
const userRoutes = require('./routes/users');
const checkoutRoutes = require('./routes/checkout');
const crmRoutes = require('./routes/crm');
const configRoutes = require('./routes/config');
const opportunityWorkspaceRoutes = require('./routes/opportunity-workspaces');
const reportRoutes = require('./routes/reports');
const activityRoutes = require('./routes/activity');
const preferenceRoutes = require('./routes/preferences');
const { requireOpportunityWorkspace } = require('./config/opportunity-workspace');

const app = express();
const PORT = process.env.PORT || 3000;
const readiness = {
  status: 'STARTING',
  verifiedAt: null
};

function requireDatastoreReady(req, res, next) {
  if (readiness.status !== 'READY') {
    return res.status(503).json({
      error: 'Service unavailable',
      readiness: readiness.status
    });
  }
  next();
}

// trust proxy for environments behind a load balancer/proxy
app.set('trust proxy', 1);

// Enable CORS
app.use(cors());

// Special handler for Stripe Webhook to capture raw body
app.use('/api/checkout/webhook', express.raw({ type: 'application/json' }));

// Regular JSON parsing for all other routes
app.use(express.json());

// Process liveness is independent of datastore readiness.
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'LeadSprout API',
    readiness: readiness.status,
    time: new Date()
  });
});

// Customer and application APIs remain fail-closed until the complete
// read-only schema and Evidence Integrity verification succeeds.
app.use('/api', requireDatastoreReady);

// Register API Routes
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log(`  Host: ${req.headers.host}`);
  console.log(`  X-Forwarded-Host: ${req.headers['x-forwarded-host']}`);
  console.log(`  X-Forwarded-For: ${req.headers['x-forwarded-for']}`);
  next();
});
app.use('/api/auth', authRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/users', userRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/config', configRoutes);
app.use('/api/opportunity-workspaces', requireOpportunityWorkspace, opportunityWorkspaceRoutes);
app.use('/api/reports', requireOpportunityWorkspace, reportRoutes);
app.use('/api/activity', requireOpportunityWorkspace, activityRoutes);
app.use('/api/settings/preferences', preferenceRoutes);

// Serve screenshots from shared directory
const screenshotsDir = '/home/team/shared/screenshots';
if (fs.existsSync(screenshotsDir)) {
  console.log('Serving screenshots from:', screenshotsDir);
  app.use('/screenshots', requireDatastoreReady, express.static(screenshotsDir));
}

// Serve Compiled React Static Assets in Production
const frontendDist = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDist)) {
  console.log('Frontend build detected. Serving static assets from:', frontendDist);
  app.use(express.static(frontendDist));
  
  // Catch-all route to support React Client Router (SPA)
  app.get('*', (req, res) => {
    // Exclude API routes from catch-all to prevent 404 loops
    if (req.originalUrl.startsWith('/api')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  console.log('Frontend build not detected at:', frontendDist);
  console.log('API running in standalone mode.');
  
  app.get('/', (req, res) => {
    res.send('LeadSprout API is running. Build the React frontend to serve client pages.');
  });
}

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start liveness first; datastore initialization remains a separate controlled action.
function startServer(options = {}) {
  const verify = options.verifySchema || verifySchema;
  const listen = options.listen || ((...args) => app.listen(...args));
  const port = options.port ?? PORT;
  readiness.status = 'VERIFYING';
  readiness.verifiedAt = null;

  return listen(port, '0.0.0.0', () => {
      console.log(`==================================================`);
      console.log(` LeadSprout API is running on port ${port} (0.0.0.0)`);
      console.log(` Access it at http://localhost:${port}`);
      console.log(`==================================================`);
      Promise.resolve()
        .then(() => verify())
        .then(() => {
          readiness.status = 'READY';
          readiness.verifiedAt = new Date().toISOString();
        })
        .catch(error => {
          readiness.status = 'UNREADY';
          readiness.verifiedAt = null;
          console.error('Startup readiness verification failed:', error.code || error.message);
        });
  });
}

if (require.main === module) startServer();

module.exports = { app, readiness, requireDatastoreReady, startServer };
