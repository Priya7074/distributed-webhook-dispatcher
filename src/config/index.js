import dotenv from 'dotenv';

// Load environment variables from .env if present
dotenv.config();

export const config = {
  // Server Configuration
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  maxPayloadSize: process.env.MAX_PAYLOAD_SIZE || '256kb',

  // Redis & BullMQ Configuration
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    url: process.env.REDIS_URL || undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
  },
  queueName: process.env.QUEUE_NAME || 'webhook-dispatcher',

  // Retry & Backoff Configuration
  // 3 retries after the initial attempt = 4 total attempts
  maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
  initialBackoffMs: parseInt(process.env.INITIAL_BACKOFF_MS || '1000', 10),

  // Dispatcher & HTTP Client Configuration
  webhookTimeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS || '5000', 10),
  webhookSigningSecret: process.env.WEBHOOK_SIGNING_SECRET || 'dev-webhook-secret-key-32chars-min',

  // Per-Destination Rate Limiting Configuration
  rateLimit: {
    // Maximum tokens/requests per window per destination host
    capacity: parseInt(process.env.RATE_LIMIT_CAPACITY || '10', 10),
    // Token refill rate: tokens added per second
    refillRatePerSecond: parseFloat(process.env.RATE_LIMIT_REFILL_PER_SEC || '2'),
  },

  // PostgreSQL Database Configuration
  db: {
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'webhook_dispatcher',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    maxPoolSize: parseInt(process.env.DB_POOL_SIZE || '10', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_TIMEOUT_MS || '3000', 10),
  },

  // Security & SSRF Defense Configuration
  security: {
    // By default, strict SSRF blocking is ON. Set ALLOW_LOCAL_DESTINATIONS=true ONLY in tests/dev.
    allowLocalDestinations: process.env.ALLOW_LOCAL_DESTINATIONS === 'true',
  },
};
