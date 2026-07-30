const assert = require('assert');
const path = require('path');

process.env.OPPORTUNITY_WORKSPACE_ENABLED = 'false';
process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic_local_only';

const { readiness, requireDatastoreReady, startServer } = require('./backend/server');
const backendPackage = require(path.join(__dirname, 'backend/package.json'));

function listening(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

function closed(server) {
  return new Promise((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve()));
}

async function waitFor(status) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (readiness.status === status) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(`readiness did not become ${status}`);
}

async function exercise(verifySchema, expectedReadiness) {
  const server = startServer({ port: 0, verifySchema });
  await listening(server);
  await waitFor(expectedReadiness);
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${base}/api/health`);
  assert.strictEqual(health.status, 200);
  const body = await health.json();
  assert.strictEqual(body.status, 'ok');
  assert.strictEqual(body.readiness, expectedReadiness);

  const protectedResponse = await fetch(`${base}/api/leads`);
  if (expectedReadiness === 'READY') {
    assert.notStrictEqual(protectedResponse.status, 503);
  } else {
    assert.strictEqual(protectedResponse.status, 503);
    assert.strictEqual((await protectedResponse.json()).readiness, expectedReadiness);
  }
  await closed(server);
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
  await exercise(
    async () => { throw Object.assign(new Error('synthetic unavailable'), { code: 'LEDGER_MISSING' }); },
    'UNREADY'
  );
  await exercise(async () => ({ status: 'VERIFIED' }), 'READY');
  console.log('PASS startup liveness/readiness separation');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
