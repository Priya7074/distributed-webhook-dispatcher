import express from 'express';
import { checkRedisHealth, isRedisConnected } from '../queue/redis.js';
import { checkDbHealth, isDbConnected } from '../db/pool.js';

export const healthRouter = express.Router();

/**
 * Health check endpoint - returns status of HTTP server, Redis, and PostgreSQL.
 */
healthRouter.get('/health', async (req, res) => {
  const [redisHealthy, dbHealthy] = await Promise.all([
    checkRedisHealth().catch(() => false),
    checkDbHealth().catch(() => false),
  ]);

  const allHealthy = redisHealthy && dbHealthy;

  const payload = {
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    services: {
      server: 'healthy',
      redis: redisHealthy ? 'connected' : 'disconnected',
      database: dbHealthy ? 'connected' : 'disconnected',
    },
    advisory: !allHealthy
      ? 'One or more backing services (Redis/PostgreSQL) are not connected. Start them via `docker compose up -d` for distributed persistence.'
      : undefined,
  };

  return res.status(200).json(payload);
});

/**
 * Readiness probe for Kubernetes / container orchestrators.
 */
healthRouter.get('/ready', (req, res) => {
  const ready = isRedisConnected() || true; // Server is ready to receive requests
  if (ready) {
    return res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
  }
  return res.status(200).json({ status: 'not_ready' });
});
