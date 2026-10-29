import express from 'express';
import { validateDestinationUrl } from '../services/ssrfValidator.js';
import { enqueueWebhook } from '../queue/webhookQueue.js';
import { getDeliveryLogs } from '../db/logsRepository.js';
import { logger } from '../utils/logger.js';

import { isDbConnected } from '../db/pool.js';

export const webhookRouter = express.Router();

/**
 * POST /api/webhooks/dispatch
 *
 * Validates incoming JSON payload, validates destination against SSRF,
 * enqueues background delivery job, and returns 202 Accepted with job ID.
 */
webhookRouter.post('/dispatch', async (req, res) => {
  const { destinationUrl, eventId, payload } = req.body || {};

  // 1. Input Validation
  const missingFields = [];
  if (!destinationUrl) missingFields.push('destinationUrl');
  if (!eventId) missingFields.push('eventId');
  if (payload === undefined) missingFields.push('payload');

  if (missingFields.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Missing required field(s): ${missingFields.join(', ')}`,
      received: { destinationUrl, eventId, payloadPresent: payload !== undefined },
    });
  }

  if (typeof destinationUrl !== 'string' || destinationUrl.trim() === '') {
    return res.status(400).json({
      success: false,
      error: 'destinationUrl must be a non-empty string',
    });
  }

  if (typeof eventId !== 'string' || eventId.trim() === '') {
    return res.status(400).json({
      success: false,
      error: 'eventId must be a non-empty string',
    });
  }

  // 2. SSRF Pre-validation
  const ssrfCheck = await validateDestinationUrl(destinationUrl);
  if (!ssrfCheck.valid) {
    logger.warn('SSRF pre-check rejected dispatch request', {
      destinationUrl,
      error: ssrfCheck.error,
      eventId,
    });
    return res.status(400).json({
      success: false,
      error: `SSRF Validation Failed: ${ssrfCheck.error}`,
    });
  }

  // 3. Enqueue Background Delivery Job
  try {
    const enqueueResult = await enqueueWebhook({
      destinationUrl: destinationUrl.trim(),
      eventId: eventId.trim(),
      payload,
    });

    if (enqueueResult.queued === false) {
      return res.status(422).json({
        success: false,
        status: enqueueResult.status,
        mode: enqueueResult.mode,
        error: enqueueResult.error,
        message: 'Preview Mode Active: Real BullMQ queueing requires an active Redis service.',
        remediation: enqueueResult.remediation,
      });
    }

    // 4. Return HTTP 202 Accepted immediately
    return res.status(202).json({
      success: true,
      message: 'Webhook accepted for dispatch',
      jobId: enqueueResult.jobId,
      eventId: eventId.trim(),
      destinationUrl: destinationUrl.trim(),
      enqueuedAt: enqueueResult.enqueuedAt,
      mode: enqueueResult.inMemory ? 'preview_in_memory' : 'production_bullmq',
    });
  } catch (err) {
    logger.error('Failed to enqueue webhook dispatch job', {
      error: err.message,
      eventId,
    });
    return res.status(500).json({
      success: false,
      error: `Failed to enqueue webhook job: ${err.message}`,
    });
  }
});

/**
 * GET /api/webhooks/logs
 *
 * Query delivery attempt logs with optional filters:
 * - ?limit=50
 * - ?eventId=order_123
 * - ?jobId=webhook_xyz
 * - ?outcome=SUCCESS | RETRYABLE_FAILURE | PERMANENT_FAILURE
 */
webhookRouter.get('/logs', async (req, res) => {
  try {
    const { limit, eventId, jobId, outcome } = req.query;
    const logs = await getDeliveryLogs({ limit, eventId, jobId, outcome });
    return res.status(200).json({
      databaseConnected: isDbConnected(),
      mode: isDbConnected() ? 'production' : 'preview_mode',
      count: logs.length,
      logs,
      notice: !isDbConnected()
        ? 'PostgreSQL is not connected. Persistent delivery logs are only recorded when PostgreSQL is running.'
        : undefined,
    });
  } catch (err) {
    logger.error('Failed to retrieve delivery logs', { error: err.message });
    return res.status(500).json({
      error: 'Failed to retrieve delivery logs',
      details: err.message,
    });
  }
});

/**
 * GET /api/webhooks/jobs/:id
 *
 * Retrieves delivery logs for a specific job ID.
 */
webhookRouter.get('/jobs/:id', async (req, res) => {
  try {
    const jobId = req.params.id;
    const logs = await getDeliveryLogs({ jobId });
    return res.status(200).json({
      jobId,
      attemptsCount: logs.length,
      logs,
    });
  } catch (err) {
    return res.status(500).json({
      error: `Failed to retrieve logs for job ${req.params.id}`,
    });
  }
});
