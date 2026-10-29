
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { sendWebhook } from '../src/services/dispatcher.js';
import { getDeliveryLogs, clearInMemoryLogs } from '../src/db/logsRepository.js';
import { closeDbPool } from '../src/db/pool.js';
import { computeSignature } from '../src/utils/signature.js';
import { config } from '../src/config/index.js';

test('Dispatcher - Successful Webhook Delivery and Audit Logging', async () => {
  clearInMemoryLogs();

  // Generate unique IDs for every test run
  const eventId = `evt_order_${Date.now()}`;
  const jobId = `job_test_success_${Date.now()}`;

  const prevAllow = config.security.allowLocalDestinations;
  config.security.allowLocalDestinations = true;

  let receivedHeaders = null;
  let receivedBody = null;

  // Spin up temporary mock receiver returning 200 OK
  const server = http.createServer((req, res) => {
    receivedHeaders = req.headers;
    let body = '';

    req.on('data', (chunk) => (body += chunk));

    req.on('end', () => {
      receivedBody = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'received' }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const port = server.address().port;
  const destinationUrl = `http://127.0.0.1:${port}/webhook/order-events`;

  const payload = {
    orderId: 'ord_12345',
    customer: 'buyer@example.com',
    itemsCount: 3,
  };

  try {
    const result = await sendWebhook({
      destinationUrl,
      eventId,
      payload,
      attemptNumber: 1,
      jobId,
    });

    // 1. Verify dispatch result
    assert.equal(result.success, true);
    assert.equal(result.outcome, 'SUCCESS');
    assert.equal(result.httpStatus, 200);
    assert.equal(result.retryable, false);

    // 2. Verify receiver received all expected headers
    assert.equal(receivedHeaders['x-event-id'], eventId);
    assert.equal(receivedHeaders['x-attempt-number'], '1');
    assert.ok(receivedHeaders['x-delivery-timestamp']);

    // 3. Verify HMAC-SHA256 signature
    const expectedSig = computeSignature(payload, config.webhookSigningSecret);
    assert.equal(receivedHeaders['x-webhook-signature'], expectedSig);

    // 4. Verify received payload body
    assert.deepEqual(receivedBody, payload);

    // 5. Verify audit log entry
    const logs = await getDeliveryLogs({ eventId });

    assert.equal(logs.length, 1);
    assert.equal(logs[0].event_id, eventId);
    assert.equal(logs[0].job_id, jobId);
    assert.equal(logs[0].outcome, 'SUCCESS');
    assert.equal(logs[0].http_status, 200);
    assert.equal(logs[0].attempt_number, 1);

  } finally {
    server.close();
    config.security.allowLocalDestinations = prevAllow;
    await closeDbPool();
  }
});
