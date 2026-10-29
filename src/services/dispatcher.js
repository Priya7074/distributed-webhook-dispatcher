import { validateDestinationUrl } from './ssrfValidator.js';
import { computeSignature } from '../utils/signature.js';
import { recordDeliveryAttempt } from '../db/logsRepository.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Determines whether an HTTP status code is a retryable failure.
 *
 * Retryable:
 * - 429 Too Many Requests
 * - 5xx Server Errors (500, 502, 503, 504, etc.)
 *
 * Permanent (Non-retryable):
 * - 4xx Client Errors (400, 401, 403, 404, 410, 422, etc.)
 *
 * @param {number} status
 * @returns {boolean}
 */
export function isRetryableHttpStatus(status) {
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

/**
 * Dispatches a webhook payload via HTTP POST with anti-SSRF validation,
 * custom headers, payload signature, timeout handling, and delivery logging.
 *
 * @param {object} params
 * @param {string} params.destinationUrl
 * @param {string} params.eventId
 * @param {any} params.payload
 * @param {number} params.attemptNumber
 * @param {string} params.jobId
 * @param {string} [params.signingSecret]
 * @returns {Promise<{
 *   success: boolean,
 *   retryable: boolean,
 *   outcome: 'SUCCESS'|'RETRYABLE_FAILURE'|'PERMANENT_FAILURE',
 *   httpStatus: number|null,
 *   durationMs: number,
 *   responseBody: string|null,
 *   errorMessage: string|null
 * }>}
 */
export async function sendWebhook(params) {
  const {
    destinationUrl,
    eventId,
    payload,
    attemptNumber,
    jobId,
    signingSecret = config.webhookSigningSecret,
  } = params;

  let currentUrl = destinationUrl;
  let parsedUrl;
  try {
    parsedUrl = new URL(currentUrl);
  } catch {
    const errorMsg = 'Invalid destination URL format';
    await recordDeliveryAttempt({
      jobId,
      eventId,
      destinationUrl: currentUrl,
      destinationHost: 'invalid',
      attemptNumber,
      httpStatus: null,
      outcome: 'PERMANENT_FAILURE',
      errorMessage: errorMsg,
      responseBody: null,
      durationMs: 0,
    });
    return {
      success: false,
      retryable: false,
      outcome: 'PERMANENT_FAILURE',
      httpStatus: null,
      durationMs: 0,
      responseBody: null,
      errorMessage: errorMsg,
    };
  }

  const destinationHost = parsedUrl.hostname;
  const startTime = Date.now();

  // 1. Anti-SSRF Validation
  const validation = await validateDestinationUrl(currentUrl);
  if (!validation.valid) {
    const durationMs = Date.now() - startTime;
    logger.warn('SSRF validation failed for destination URL', {
      destinationUrl: currentUrl,
      error: validation.error,
      eventId,
      jobId,
    });

    await recordDeliveryAttempt({
      jobId,
      eventId,
      destinationUrl: currentUrl,
      destinationHost,
      attemptNumber,
      httpStatus: null,
      outcome: 'PERMANENT_FAILURE',
      errorMessage: validation.error,
      responseBody: null,
      durationMs,
    });

    return {
      success: false,
      retryable: false,
      outcome: 'PERMANENT_FAILURE',
      httpStatus: null,
      durationMs,
      responseBody: null,
      errorMessage: validation.error,
    };
  }

  // 2. Prepare Headers and Signature
  const bodyString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signature = computeSignature(bodyString, signingSecret);

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'DistributedWebhookDispatcher/1.0',
    'X-Event-ID': eventId,
    'X-Attempt-Number': String(attemptNumber),
    'X-Delivery-Timestamp': new Date().toISOString(),
  };

  if (signature) {
    headers['X-Webhook-Signature'] = signature;
  }

  // 3. Execute HTTP POST with Timeout and Redirect Validation
  const timeoutMs = config.webhookTimeoutMs;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let httpStatus = null;
  let responseBody = null;
  let errorMessage = null;
  let outcome = 'RETRYABLE_FAILURE';
  let retryable = true;
  let success = false;

  try {
    let response = await fetch(currentUrl, {
      method: 'POST',
      headers,
      body: bodyString,
      signal: controller.signal,
      redirect: 'manual', // Prevent unvalidated automatic redirects
    });

    // Check for redirects and revalidate redirect target
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const redirectLocation = response.headers.get('location');
      if (redirectLocation) {
        const resolvedRedirectUrl = new URL(redirectLocation, currentUrl).href;
        logger.info('Following validated redirect', { from: currentUrl, to: resolvedRedirectUrl });

        const redirectValidation = await validateDestinationUrl(resolvedRedirectUrl);
        if (!redirectValidation.valid) {
          throw new Error(`Redirect target blocked by SSRF defense: ${redirectValidation.error}`);
        }

        // Follow single validated redirect
        response = await fetch(resolvedRedirectUrl, {
          method: 'POST',
          headers,
          body: bodyString,
          signal: controller.signal,
          redirect: 'manual',
        });
      }
    }

    httpStatus = response.status;
    const rawText = await response.text();
    responseBody = rawText.slice(0, 1024);

    if (httpStatus >= 200 && httpStatus < 300) {
      outcome = 'SUCCESS';
      retryable = false;
      success = true;
    } else if (isRetryableHttpStatus(httpStatus)) {
      outcome = 'RETRYABLE_FAILURE';
      retryable = true;
      errorMessage = `Server responded with retryable status: ${httpStatus}`;
    } else {
      // 4xx client errors (excluding 429): permanent failure
      outcome = 'PERMANENT_FAILURE';
      retryable = false;
      errorMessage = `Server rejected request with permanent client error: ${httpStatus}`;
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      errorMessage = `Request timed out after ${timeoutMs}ms`;
      outcome = 'RETRYABLE_FAILURE';
      retryable = true;
    } else if (err.message?.includes('SSRF defense')) {
      errorMessage = err.message;
      outcome = 'PERMANENT_FAILURE';
      retryable = false;
    } else {
      // Network errors (DNS, ECONNREFUSED, socket hang up)
      errorMessage = `Network error: ${err.message}`;
      outcome = 'RETRYABLE_FAILURE';
      retryable = true;
    }
  } finally {
    clearTimeout(timeoutId);
  }

  const durationMs = Date.now() - startTime;

  // 4. Persist Delivery Attempt Log
  await recordDeliveryAttempt({
    jobId,
    eventId,
    destinationUrl: currentUrl,
    destinationHost,
    attemptNumber,
    httpStatus,
    outcome,
    errorMessage,
    responseBody,
    durationMs,
  });

  return {
    success,
    retryable,
    outcome,
    httpStatus,
    durationMs,
    responseBody,
    errorMessage,
  };
}
