import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isRetryableHttpStatus, sendWebhook } from '../src/services/dispatcher.js';
import { config } from '../src/config/index.js';
import { closeDbPool } from '../src/db/pool.js';

test.after(async () => {
  await closeDbPool();
});

test('Failure Classification - isRetryableHttpStatus', () => {
  // Retryable statuses
  assert.equal(isRetryableHttpStatus(429), true);
  assert.equal(isRetryableHttpStatus(500), true);
  assert.equal(isRetryableHttpStatus(502), true);
  assert.equal(isRetryableHttpStatus(503), true);
  assert.equal(isRetryableHttpStatus(504), true);

  // Non-retryable permanent client errors (must NOT be endlessly retried)
  assert.equal(isRetryableHttpStatus(400), false);
  assert.equal(isRetryableHttpStatus(401), false);
  assert.equal(isRetryableHttpStatus(403), false);
  assert.equal(isRetryableHttpStatus(404), false);
  assert.equal(isRetryableHttpStatus(410), false);
  assert.equal(isRetryableHttpStatus(422), false);

  // Success statuses
  assert.equal(isRetryableHttpStatus(200), false);
  assert.equal(isRetryableHttpStatus(201), false);
  assert.equal(isRetryableHttpStatus(204), false);
});

test('Dispatcher - HTTP 500 triggers RETRYABLE_FAILURE', async (t) => {
  // Allow local destination for test server
  const prevAllow = config.security.allowLocalDestinations;
  config.security.allowLocalDestinations = true;

  // Spin up temporary mock server returning 500
  const server = http.createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const destinationUrl = `http://127.0.0.1:${port}/hook`;

  try {
    const result = await sendWebhook({
      destinationUrl,
      eventId: 'evt_fail_500',
      payload: { test: true },
      attemptNumber: 1,
      jobId: 'job_test_500',
    });

    assert.equal(result.success, false);
    assert.equal(result.retryable, true);
    assert.equal(result.outcome, 'RETRYABLE_FAILURE');
    assert.equal(result.httpStatus, 500);
  } finally {
    server.close();
    config.security.allowLocalDestinations = prevAllow;
  }
});

test('Dispatcher - HTTP 404 triggers PERMANENT_FAILURE (does not retry)', async (t) => {
  const prevAllow = config.security.allowLocalDestinations;
  config.security.allowLocalDestinations = true;

  // Spin up temporary mock server returning 404
  const server = http.createServer((req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const destinationUrl = `http://127.0.0.1:${port}/hook`;

  try {
    const result = await sendWebhook({
      destinationUrl,
      eventId: 'evt_fail_404',
      payload: { test: true },
      attemptNumber: 1,
      jobId: 'job_test_404',
    });

    assert.equal(result.success, false);
    assert.equal(result.retryable, false);
    assert.equal(result.outcome, 'PERMANENT_FAILURE');
    assert.equal(result.httpStatus, 404);
  } finally {
    server.close();
    config.security.allowLocalDestinations = prevAllow;
  }
});

test('Dispatcher - HTTP 429 triggers RETRYABLE_FAILURE', async (t) => {
  const prevAllow = config.security.allowLocalDestinations;
  config.security.allowLocalDestinations = true;

  const server = http.createServer((req, res) => {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const destinationUrl = `http://127.0.0.1:${port}/hook`;

  try {
    const result = await sendWebhook({
      destinationUrl,
      eventId: 'evt_fail_429',
      payload: { test: true },
      attemptNumber: 1,
      jobId: 'job_test_429',
    });

    assert.equal(result.success, false);
    assert.equal(result.retryable, true);
    assert.equal(result.outcome, 'RETRYABLE_FAILURE');
    assert.equal(result.httpStatus, 429);
  } finally {
    server.close();
    config.security.allowLocalDestinations = prevAllow;
  }
});
