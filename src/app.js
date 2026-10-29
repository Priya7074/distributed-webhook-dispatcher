import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config/index.js';
import { webhookRouter } from './routes/webhookRoutes.js';
import { healthRouter } from './routes/healthRoutes.js';
import { testReceiverRouter } from './routes/testReceiverRoutes.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();

  // 1. Payload size limits
  app.use(express.json({ limit: config.maxPayloadSize }));

  // 2. Handle payload parser errors (e.g. malformed JSON or payload too large)
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
      logger.warn('Rejected request exceeding payload size limit', {
        limit: config.maxPayloadSize,
        ip: req.ip,
      });
      return res.status(413).json({
        success: false,
        error: `Payload Too Large. Maximum allowed size is ${config.maxPayloadSize}.`,
      });
    }
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({
        success: false,
        error: 'Malformed JSON payload in request body.',
      });
    }
    next(err);
  });

  // 3. HTTP Request Logging Middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      // Don't clutter logs with static asset queries
      if (!req.url.startsWith('/public') && !req.url.includes('.')) {
        logger.info(`${req.method} ${req.originalUrl} - ${res.statusCode} (${Date.now() - start}ms)`);
      }
    });
    next();
  });

  // 4. Serve Static Developer Dashboard & Documentation
  app.use(express.static(path.join(__dirname, 'public')));

  // 5. Mount API Routes
  app.use('/', healthRouter);
  app.use('/api/webhooks', webhookRouter);
  app.use('/api/test', testReceiverRouter);

  // 6. 404 Handler for undefined API routes
  app.use('/api', (req, res) => {
    return res.status(404).json({
      error: 'Not Found',
      message: `The endpoint ${req.method} ${req.originalUrl} does not exist.`,
    });
  });

  // 7. Global Error Handler
  app.use((err, req, res, next) => {
    logger.error('Unhandled application error', { error: err.message, stack: err.stack });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: config.nodeEnv === 'production' ? 'An unexpected error occurred.' : err.message,
    });
  });

  return app;
}
