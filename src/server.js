import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { startWebhookWorker, closeWebhookWorker } from './queue/webhookWorker.js';
import { closeWebhookQueue } from './queue/webhookQueue.js';
import { closeRedisClient } from './queue/redis.js';
import { checkDbHealth, closeDbPool } from './db/pool.js';

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  logger.info(`=======================================================`);
  logger.info(`🚀 Distributed Webhook Dispatcher started!`);
  logger.info(`📡 Listening on http://${config.host}:${config.port}`);
  logger.info(`🔧 Environment: ${config.nodeEnv}`);
  logger.info(`⚙️  Retry Config: ${config.maxRetries} retries with exponential backoff`);
  logger.info(`🛡️  SSRF Defense: ${config.security.allowLocalDestinations ? 'DEV MODE (local allowed)' : 'STRICT PRODUCTION'}`);
  logger.info(`⏱️  Rate Limit: ${config.rateLimit.capacity} tokens, ${config.rateLimit.refillRatePerSecond} tokens/sec per destination`);
  logger.info(`=======================================================`);
});

// Start BullMQ background worker
startWebhookWorker();

// Initial database health ping
checkDbHealth().then((connected) => {
  if (connected) {
    logger.info('Database connection verified.');
  } else {
    logger.warn('PostgreSQL database not yet connected. Audit logs are preserved in-memory until DB is started.');
  }
});

/**
 * Graceful shutdown handler.
 */
let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Stop accepting new HTTP requests
  server.close(() => {
    logger.info('HTTP server closed.');
  });

  try {
    // Shutdown queue workers and connections
    await closeWebhookWorker();
    await closeWebhookQueue();
    await closeRedisClient();
    await closeDbPool();
    logger.info('All background workers and connections closed successfully. Exiting.');
    process.exit(0);
  } catch (err) {
    logger.error('Error during graceful shutdown', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
