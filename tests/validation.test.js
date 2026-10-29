import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closeWebhookQueue } from '../src/queue/webhookQueue.js';
import { closeRedisClient } from '../src/queue/redis.js';
import { closeDbPool } from '../src/db/pool.js';

process.env.NODE_ENV = 'test';
const app = createApp();

test.after(async () => {
  await closeWebhookQueue();
  await closeRedisClient();
  await closeDbPool();
});

test('API Validation - Missing Fields in /api/webhooks/dispatch', async () => {
  // Empty body
  const res1 = await request(app)
    .post('/api/webhooks/dispatch')
    .send({})
    .expect(400);

  assert.equal(res1.body.success, false);
  assert.match(res1.body.error, /Missing required field/);

  // Missing destinationUrl
  const res2 = await request(app)
    .post('/api/webhooks/dispatch')
    .send({ eventId: 'evt_1', payload: { ok: true } })
    .expect(400);

  assert.match(res2.body.error, /destinationUrl/);

  // Missing eventId
  const res3 = await request(app)
    .post('/api/webhooks/dispatch')
    .send({ destinationUrl: 'https://example.com/webhook', payload: { ok: true } })
    .expect(400);

  assert.match(res3.body.error, /eventId/);

  // Missing payload
  const res4 = await request(app)
    .post('/api/webhooks/dispatch')
    .send({ destinationUrl: 'https://example.com/webhook', eventId: 'evt_1' })
    .expect(400);

  assert.match(res4.body.error, /payload/);
});

test('API Validation - SSRF Rejection at Dispatch Time', async () => {
  const res = await request(app)
    .post('/api/webhooks/dispatch')
    .send({
      destinationUrl: 'http://169.254.169.254/latest/meta-data/',
      eventId: 'evt_probe',
      payload: { test: true },
    })
    .expect(400);

  assert.equal(res.body.success, false);
  assert.match(res.body.error, /SSRF Validation Failed/);
});

test('API Validation - Valid Request returns HTTP 202 with Job ID', async () => {
  const res = await request(app)
    .post('/api/webhooks/dispatch')
    .send({
      destinationUrl: 'https://example.com/test-webhook-receiver',
      eventId: 'evt_valid_100',
      payload: { message: 'hello', amount: 100 },
    })
    .expect(202);

  assert.equal(res.body.success, true);
  assert.equal(res.body.message, 'Webhook accepted for dispatch');
  assert.ok(res.body.jobId);
  assert.equal(res.body.eventId, 'evt_valid_100');
  assert.ok(res.body.enqueuedAt);
});

test('API Validation - Payload Size Limit (413 Payload Too Large)', async () => {
  // Create a payload larger than 256kb
  const largeString = 'X'.repeat(300 * 1024); // 300KB
  const res = await request(app)
    .post('/api/webhooks/dispatch')
    .send({
      destinationUrl: 'https://example.com/webhook',
      eventId: 'evt_large',
      payload: { data: largeString },
    })
    .expect(413);

  assert.match(res.body.error, /Payload Too Large/);
});
