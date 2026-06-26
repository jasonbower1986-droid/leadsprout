const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { initializeSchema } = require('./database');
const authRoutes = require('./routes/auth');
const leadRoutes = require('./routes/leads');
const userRoutes = require('./routes/users');
const checkoutRoutes = require('./routes/checkout');
const crmRoutes = require('./routes/crm');
const configRoutes = require('./routes/config');

const app = express();
const PORT = process.env.PORT || 3000;

// trust proxy for environments behind a load balancer/proxy
app.set('trust proxy', 1);

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'LeadSprout API', time: new Date() });
});

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

// Initialize database and start the server
async function startServer() {
  try {
    // Verify SQLite tables are prepared
    await initializeSchema();
    
    // Bind web server to all interfaces ('0.0.0.0') as required for public port 3000 exposure
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`==================================================`);
      console.log(` LeadSprout API is running on port ${PORT} (0.0.0.0)`);
      console.log(` Access it at http://localhost:${PORT}`);
      console.log(`==================================================`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
