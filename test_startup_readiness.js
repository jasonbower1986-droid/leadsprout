const assert = require('assert');
const { EventEmitter } = require('events');
const path = require('path');

process.env.OPPORTUNITY_WORKSPACE_ENABLED = 'false';
process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic_local_only';

const { readiness, requireDatastoreReady, startServer } = require('./backend/server');
const backendPackage = require(path.join(__dirname, 'backend/package.json'));

function fakeListen(events) {
  return (port, host, callback) => {
    events.push(`listen:${host}:${port}`);
    const server = new EventEmitter();
    queueMicrotask(callback);
    return server;
  };
}

async function run() {
  assert.strictEqual(
    backendPackage.scripts.start,
    'OPPORTUNITY_WORKSPACE_ENABLED=false node server.js'
  );
  readiness.status = 'UNREADY';
  let nextCalled = false;
  const response = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  requireDatastoreReady({}, response, () => { nextCalled = true; });
  assert.strictEqual(response.statusCode, 503);
  assert.strictEqual(response.body.readiness, 'UNREADY');
  assert.strictEqual(nextCalled, false);
  let listenCalled = false;
  await assert.rejects(
    startServer({
      port: 0,
      verifyDeploymentConfig: async () => ({ status: 'VERIFIED' }),
      verifySchema: async () => {
        throw Object.assign(new Error('synthetic unavailable'), { code: 'LEDGER_MISSING' });
      },
      listen: () => {
        listenCalled = true;
        throw new Error('listener must not be opened');
      }
    }),
    error => error.code === 'LEDGER_MISSING'
  );
  assert.strictEqual(listenCalled, false);
  assert.strictEqual(readiness.status, 'UNREADY');
  const events = [];
  const server = await startServer({
    port: 4321,
    verifyDeploymentConfig: async () => {
      events.push('configuration-verified');
      return { status: 'VERIFIED' };
    },
    verifySchema: async () => {
      events.push('verified');
      return { status: 'VERIFIED' };
    },
    listen: fakeListen(events)
  });
  assert.ok(server instanceof EventEmitter);
  assert.deepStrictEqual(events, ['configuration-verified', 'verified', 'listen:0.0.0.0:4321']);
  assert.strictEqual(readiness.status, 'READY');
  nextCalled = false;
  response.statusCode = null;
  response.body = null;
  requireDatastoreReady({}, response, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(response.statusCode, null);
  console.log('PASS startup verifies before listen and fails closed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
