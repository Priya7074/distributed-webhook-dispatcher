import { Worker } from 'bullmq';
import { config } from '../config/index.js';
import { getRedisClient, isRedisConnected } from './redis.js';
import { sendWebhook } from '../services/dispatcher.js';
import { rateLimiter } from '../services/rateLimiter.js';
import { logger } from '../utils/logger.js';

let webhookWorker = null;

/**
 * Core processor for a webhook dispatch job.
 * Handles rate-limiting, sending, and distinguishing between retryable vs permanent failures.
 *
 * @param {object} job - BullMQ job or simulated job object
 * @returns {Promise<object>}
 */
export async function processWebhookJob(job) {
  const { destinationUrl, eventId, payload } = job.data;
  const attemptNumber = (job.attemptsMade ?? 0) + 1;
  const maxAttempts = job.opts?.attempts ?? (config.maxRetries + 1);

  logger.info(`Processing webhook delivery attempt ${attemptNumber}/${maxAttempts}`, {
    jobId: job.id,
    eventId,
    destinationUrl,
    attemptNumber,
  });

  // 1. Extract hostname for per-destination rate limiting
  let destinationHost = 'unknown';
  try {
    destinationHost = new URL(destinationUrl).hostname;
  } catch {
    destinationHost = 'invalid';
  }

  // 2. Per-Destination Rate Limiting (Token Bucket)
  const rateLimitResult = await rateLimiter.consume(destinationHost);
  if (!rateLimitResult.allowed) {
    logger.warn(`Destination rate limit reached for host "${destinationHost}". Throttling execution for ${rateLimitResult.waitMs}ms`, {
      jobId: job.id,
      destinationHost,
      waitMs: rateLimitResult.waitMs,
    });

    // Wait until a token is available to avoid overwhelming the destination
    await new Promise((resolve) => setTimeout(resolve, Math.min(rateLimitResult.waitMs, 5000)));
  }

  // 3. Dispatch Webhook HTTP POST
  const dispatchResult = await sendWebhook({
    destinationUrl,
    eventId,
    payload,
    attemptNumber,
    jobId: job.id,
  });

  // 4. Handle Delivery Outcome
  if (dispatchResult.success) {
    logger.info('Webhook successfully delivered!', {
      jobId: job.id,
      eventId,
      destinationUrl,
      attemptNumber,
      httpStatus: dispatchResult.httpStatus,
      durationMs: dispatchResult.durationMs,
    });
    return dispatchResult;
  }

  // Handle Failure: Permanent (4xx, SSRF) vs Retryable (5xx, 429, Network error)
  if (!dispatchResult.retryable) {
    // Non-retryable permanent failure: DO NOT re-throw error!
    // Returning cleanly signals to BullMQ that the job is finished and should NOT be retried.
    logger.warn('Webhook delivery permanently failed (non-retryable client error or SSRF). Halting retries.', {
      jobId: job.id,
      eventId,
      destinationUrl,
      attemptNumber,
      httpStatus: dispatchResult.httpStatus,
      errorMessage: dispatchResult.errorMessage,
    });
    return dispatchResult;
  }

  // Retryable failure (network timeout, 429, 5xx):
  if (attemptNumber < maxAttempts) {
    logger.warn(`Retryable failure on attempt ${attemptNumber}/${maxAttempts}. Scheduling exponential backoff retry...`, {
      jobId: job.id,
      eventId,
      destinationUrl,
      httpStatus: dispatchResult.httpStatus,
      errorMessage: dispatchResult.errorMessage,
    });

    // In preview/standalone mode when Redis is offline, schedule retry using in-memory timer
    if (!isRedisConnected()) {
      const backoffDelay = config.initialBackoffMs * Math.pow(2, attemptNumber - 1);
      setTimeout(async () => {
        try {
          await processWebhookJob({
            ...job,
            attemptsMade: attemptNumber,
          });
        } catch (err) {
          logger.error('In-memory retry processing error', { jobId: job.id, error: err.message });
        }
      }, backoffDelay);
      return dispatchResult;
    }

    // Throwing an Error causes BullMQ to reschedule the job using its configured backoff strategy
    throw new Error(`Retryable failure: ${dispatchResult.errorMessage} (attempt ${attemptNumber})`);
  } else {
    logger.error(`Webhook exhausted all ${maxAttempts} attempts. Moving to failed state.`, {
      jobId: job.id,
      eventId,
      destinationUrl,
      errorMessage: dispatchResult.errorMessage,
    });
    throw new Error(`Exhausted retries: ${dispatchResult.errorMessage}`);
  }
}

/**
 * Initializes and starts the BullMQ background worker.
 *
 * @returns {Worker|null}
 */
export function startWebhookWorker() {
  if (webhookWorker) return webhookWorker;

  const redisConnection = getRedisClient();

  // Attach rate limiter to Redis client for distributed rate limiting
  rateLimiter.setRedisClient(redisConnection);

  try {
    webhookWorker = new Worker(
      config.queueName,
      async (job) => {
        return processWebhookJob(job);
      },
      {
        connection: redisConnection,
        concurrency: 5, // Concurrent jobs per worker process
      }
    );

    webhookWorker.on('completed', (job) => {
      logger.info(`Job completed: ${job.id}`);
    });

    webhookWorker.on('failed', (job, err) => {
      logger.error(`Job failed: ${job?.id} with error: ${err.message}`);
    });

    webhookWorker.on('error', (err) => {
      logger.warn(`BullMQ Worker warning: ${err.message}`);
    });

    logger.info(`BullMQ Worker initialized for queue: ${config.queueName}`);
    return webhookWorker;
  } catch (err) {
    logger.warn(`Could not start BullMQ worker: ${err.message}`);
    return null;
  }
}

/**
 * Gracefully shuts down the BullMQ Worker.
 */
export async function closeWebhookWorker() {
  if (webhookWorker) {
    logger.info('Closing BullMQ Worker...');
    await webhookWorker.close();
    webhookWorker = null;
  }
}
