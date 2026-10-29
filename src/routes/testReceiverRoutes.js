import express from 'express';
import { logger } from '../utils/logger.js';

export const testReceiverRouter = express.Router();

/**
 * Built-in mock webhook receiver for testing delivery scenarios.
 *
 * Query parameters:
 * - ?status=200 (default: success)
 * - ?status=500 (simulates server crash for retry testing)
 * - ?status=429 (simulates rate limiting)
 * - ?status=404 (simulates permanent client error)
 * - ?delay=1000 (simulates slow receiver)
 */
testReceiverRouter.post('/receiver', async (req, res) => {
  const requestedStatus = parseInt(req.query.status || '200', 10);
  const delayMs = parseInt(req.query.delay || '0', 10);

  const eventId = req.headers['x-event-id'];
  const attempt = req.headers['x-attempt-number'];
  const signature = req.headers['x-webhook-signature'];

  logger.info(`Test receiver received webhook for event "${eventId}" (attempt ${attempt}) - responding with HTTP ${requestedStatus}`);

  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const responseBody = {
    received: true,
    eventId,
    attemptNumber: attempt,
    hasSignature: Boolean(signature),
    statusReturned: requestedStatus,
    timestamp: new Date().toISOString(),
    payloadReceived: req.body,
  };

  return res.status(requestedStatus).json(responseBody);
});
