import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Token Bucket Rate Limiter for Per-Destination Throttling.
 *
 * Each destination host gets its own bucket with a maximum capacity (burst)
 * and a steady refill rate (tokens per second).
 */
export class TokenBucketRateLimiter {
  constructor(options = {}) {
    this.capacity = options.capacity ?? config.rateLimit.capacity;
    this.refillRate = options.refillRate ?? config.rateLimit.refillRatePerSecond;
    this.buckets = new Map();
    this.redisClient = options.redisClient ?? null;
  }

  setRedisClient(client) {
    this.redisClient = client;
  }

  /**
   * Cleans up buckets that have been inactive for more than 10 minutes.
   */
  cleanupIdleBuckets() {
    const now = Date.now();
    const maxIdleMs = 10 * 60 * 1000;
    for (const [host, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > maxIdleMs) {
        this.buckets.delete(host);
      }
    }
  }

  /**
   * In-memory token bucket consumption.
   *
   * @param {string} host
   * @param {number} cost
   * @returns {{ allowed: boolean, remainingTokens: number, waitMs: number }}
   */
  _consumeInMemory(host, cost = 1) {
    const now = Date.now();
    let bucket = this.buckets.get(host);

    if (!bucket) {
      bucket = {
        tokens: this.capacity,
        lastRefill: now,
      };
      this.buckets.set(host, bucket);
    } else {
      // Calculate refilled tokens based on elapsed time
      const elapsedSeconds = (now - bucket.lastRefill) / 1000;
      const refilled = elapsedSeconds * this.refillRate;
      bucket.tokens = Math.min(this.capacity, bucket.tokens + refilled);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return {
        allowed: true,
        remainingTokens: Math.floor(bucket.tokens),
        waitMs: 0,
      };
    }

    // Calculate how long until enough tokens are available
    const missingTokens = cost - bucket.tokens;
    const waitMs = Math.ceil((missingTokens / this.refillRate) * 1000);

    return {
      allowed: false,
      remainingTokens: 0,
      waitMs: Math.max(waitMs, 100),
    };
  }

  /**
   * Redis-backed token bucket consumption using Lua script for atomicity across distributed workers.
   *
   * @param {string} host
   * @param {number} cost
   * @returns {Promise<{ allowed: boolean, remainingTokens: number, waitMs: number }>}
   */
  async _consumeRedis(host, cost = 1) {
    const key = `ratelimit:dest:${host}`;
    const now = Date.now();

    // Redis Lua script for atomic Token Bucket
    const luaScript = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local capacity = tonumber(ARGV[2])
      local refillRate = tonumber(ARGV[3])
      local cost = tonumber(ARGV[4])

      local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
      local tokens = tonumber(data[1])
      local lastRefill = tonumber(data[2])

      if not tokens or not lastRefill then
        tokens = capacity
        lastRefill = now
      else
        local elapsedSeconds = (now - lastRefill) / 1000.0
        local refilled = elapsedSeconds * refillRate
        tokens = math.min(capacity, tokens + refilled)
        lastRefill = now
      end

      if tokens >= cost then
        tokens = tokens - cost
        redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
        redis.call('EXPIRE', key, 600)
        return {1, math.floor(tokens), 0}
      else
        local missingTokens = cost - tokens
        local waitMs = math.ceil((missingTokens / refillRate) * 1000)
        redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
        redis.call('EXPIRE', key, 600)
        return {0, 0, waitMs}
      end
    `;

    try {
      const result = await this.redisClient.eval(
        luaScript,
        1,
        key,
        now,
        this.capacity,
        this.refillRate,
        cost
      );

      const [allowedInt, remainingTokens, waitMs] = result;
      return {
        allowed: allowedInt === 1,
        remainingTokens,
        waitMs,
      };
    } catch (err) {
      logger.warn(`Redis rate limit check failed for ${host}, falling back to in-memory: ${err.message}`);
      return this._consumeInMemory(host, cost);
    }
  }

  /**
   * Attempts to consume a token for a given destination host.
   *
   * @param {string} host - Destination hostname (e.g. "api.customer.com")
   * @param {number} [cost=1]
   * @returns {Promise<{ allowed: boolean, remainingTokens: number, waitMs: number }>}
   */
  async consume(host, cost = 1) {
    if (this.redisClient && this.redisClient.status === 'ready') {
      return this._consumeRedis(host, cost);
    }
    return this._consumeInMemory(host, cost);
  }

  /**
   * Resets rate limiter state (useful for tests).
   */
  reset() {
    this.buckets.clear();
  }
}

export const rateLimiter = new TokenBucketRateLimiter();
