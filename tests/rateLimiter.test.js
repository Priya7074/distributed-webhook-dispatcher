import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucketRateLimiter } from '../src/services/rateLimiter.js';

test('Rate Limiter - Token Bucket Burst and Refill', async () => {
  // Create a rate limiter with capacity 3 and refill rate 5 tokens/sec
  const limiter = new TokenBucketRateLimiter({
    capacity: 3,
    refillRate: 5,
  });

  const host = 'api.customer-a.com';

  // First 3 requests should succeed immediately (consuming burst capacity)
  const res1 = await limiter.consume(host);
  assert.equal(res1.allowed, true);
  assert.equal(res1.remainingTokens, 2);

  const res2 = await limiter.consume(host);
  assert.equal(res2.allowed, true);
  assert.equal(res2.remainingTokens, 1);

  const res3 = await limiter.consume(host);
  assert.equal(res3.allowed, true);
  assert.equal(res3.remainingTokens, 0);

  // 4th immediate request should be rejected / throttled
  const res4 = await limiter.consume(host);
  assert.equal(res4.allowed, false);
  assert.ok(res4.waitMs > 0);

  // Wait 250ms for tokens to refill (5 tokens/sec -> 1.25 tokens in 250ms)
  await new Promise((resolve) => setTimeout(resolve, 250));

  const res5 = await limiter.consume(host);
  assert.equal(res5.allowed, true);
});

test('Rate Limiter - Per-Destination Isolation', async () => {
  const limiter = new TokenBucketRateLimiter({
    capacity: 2,
    refillRate: 1,
  });

  const hostA = 'alpha.domain.com';
  const hostB = 'beta.domain.com';

  // Exhaust tokens for hostA
  await limiter.consume(hostA);
  await limiter.consume(hostA);
  const hostARejected = await limiter.consume(hostA);
  assert.equal(hostARejected.allowed, false);

  // hostB must NOT be affected by hostA being throttled!
  const hostBAllowed = await limiter.consume(hostB);
  assert.equal(hostBAllowed.allowed, true);
});
