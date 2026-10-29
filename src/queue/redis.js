import Redis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

let redisClient = null;
let isConnected = false;

/**
 * Creates and returns the shared Redis client instance.
 *
 * @returns {Redis}
 */
export function getRedisClient() {
  if (redisClient) return redisClient;

  const redisOptions = config.redis.url
    ? config.redis.url
    : {
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        maxRetriesPerRequest: null, // Required by BullMQ
        enableReadyCheck: true,
        retryStrategy(times) {
          if (process.env.NODE_ENV === 'test' && times > 1) {
            return null; // Stop reconnection loop in test mode
          }
          // Exponential retry strategy with 3s maximum delay
          const delay = Math.min(times * 200, 3000);
          return delay;
        },
      };

  redisClient = new Redis(redisOptions);

  redisClient.on('connect', () => {
    logger.info('Connected to Redis');
  });

  redisClient.on('ready', () => {
    isConnected = true;
    logger.info('Redis connection ready for BullMQ operations');
  });

  redisClient.on('error', (err) => {
    isConnected = false;
    logger.warn(`Redis connection error: ${err.message}. To run Redis locally: docker compose up -d`);
  });

  redisClient.on('close', () => {
    isConnected = false;
  });

  return redisClient;
}

/**
 * Checks Redis connectivity.
 *
 * @returns {Promise<boolean>}
 */
export async function checkRedisHealth() {
  try {
    const client = getRedisClient();
    if (!client || client.status !== 'ready') {
      isConnected = false;
      return false;
    }
    const pingPromise = client.ping();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 500)
    );
    const ping = await Promise.race([pingPromise, timeoutPromise]);
    isConnected = ping === 'PONG';
    return isConnected;
  } catch {
    isConnected = false;
    return false;
  }
}

/**
 * Gracefully shuts down the Redis connection.
 */
export async function closeRedisClient() {
  if (redisClient) {
    logger.info('Closing Redis client...');
    await redisClient.quit().catch(() => redisClient.disconnect());
    redisClient = null;
    isConnected = false;
  }
}

export function isRedisConnected() {
  return isConnected;
}
