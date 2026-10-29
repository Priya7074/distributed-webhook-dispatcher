import { getDbPool } from './pool.js';
import { logger } from '../utils/logger.js';

// In-memory fallback ring-buffer for audit logs (stores last 200 logs)
const inMemoryLogs = [];
const MAX_IN_MEMORY_LOGS = 200;

/**
 * Persists a webhook delivery attempt log into PostgreSQL, with in-memory buffering.
 *
 * @param {object} logData
 * @param {string} logData.jobId
 * @param {string} logData.eventId
 * @param {string} logData.destinationUrl
 * @param {string} logData.destinationHost
 * @param {number} logData.attemptNumber
 * @param {number|null} logData.httpStatus
 * @param {'SUCCESS'|'RETRYABLE_FAILURE'|'PERMANENT_FAILURE'} logData.outcome
 * @param {string|null} logData.errorMessage
 * @param {string|null} logData.responseBody
 * @param {number} logData.durationMs
 * @param {string} [logData.createdAt]
 * @returns {Promise<object>}
 */
export async function recordDeliveryAttempt(logData) {
  const timestamp = logData.createdAt ? new Date(logData.createdAt) : new Date();

  // Truncate response body and error message safely to avoid storage bloat
  const truncatedResponse = logData.responseBody
    ? String(logData.responseBody).slice(0, 1024)
    : null;
  const truncatedError = logData.errorMessage
    ? String(logData.errorMessage).slice(0, 1024)
    : null;

  const entry = {
    id: inMemoryLogs.length + 1,
    job_id: logData.jobId,
    event_id: logData.eventId,
    destination_url: logData.destinationUrl,
    destination_host: logData.destinationHost,
    attempt_number: logData.attemptNumber,
    http_status: logData.httpStatus ?? null,
    outcome: logData.outcome,
    error_message: truncatedError,
    response_body: truncatedResponse,
    duration_ms: logData.durationMs,
    created_at: timestamp.toISOString(),
  };

  entry.persisted = false;

  // Buffer in memory (tagged with persisted: false unless PostgreSQL confirms write)
  inMemoryLogs.unshift(entry);
  if (inMemoryLogs.length > MAX_IN_MEMORY_LOGS) {
    inMemoryLogs.pop();
  }

  // Persist to PostgreSQL if available
  try {
    const pool = getDbPool();
    const query = `
      INSERT INTO webhook_delivery_logs (
        job_id, event_id, destination_url, destination_host,
        attempt_number, http_status, outcome, error_message,
        response_body, duration_ms, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, created_at;
    `;
    const values = [
      entry.job_id,
      entry.event_id,
      entry.destination_url,
      entry.destination_host,
      entry.attempt_number,
      entry.http_status,
      entry.outcome,
      entry.error_message,
      entry.response_body,
      entry.duration_ms,
      timestamp,
    ];

    const result = await pool.query(query, values);
    if (result.rows && result.rows[0]) {
      entry.id = result.rows[0].id;
      entry.persisted = true;
    }
  } catch (err) {
    entry.persisted = false;
    logger.warn('PostgreSQL is not connected. Delivery log was not persisted.', {
      error: err.message,
      jobId: logData.jobId,
      eventId: logData.eventId,
    });
  }

  return entry;
}

/**
 * Retrieves delivery logs with optional filtering.
 *
 * @param {object} [filters]
 * @param {number} [filters.limit=50]
 * @param {string} [filters.eventId]
 * @param {string} [filters.jobId]
 * @param {string} [filters.outcome]
 * @returns {Promise<Array<object>>}
 */
export async function getDeliveryLogs(filters = {}) {
  const limit = Math.min(parseInt(filters.limit || '50', 10), 100);

  try {
    const pool = getDbPool();
    const conditions = [];
    const values = [];
    let paramIndex = 1;

    if (filters.eventId) {
      conditions.push(`event_id = $${paramIndex++}`);
      values.push(filters.eventId);
    }
    if (filters.jobId) {
      conditions.push(`job_id = $${paramIndex++}`);
      values.push(filters.jobId);
    }
    if (filters.outcome) {
      conditions.push(`outcome = $${paramIndex++}`);
      values.push(filters.outcome);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT id, job_id, event_id, destination_url, destination_host,
             attempt_number, http_status, outcome, error_message,
             response_body, duration_ms, created_at
      FROM webhook_delivery_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex};
    `;
    values.push(limit);

    const result = await pool.query(query, values);
    return result.rows.map((row) => ({ ...row, persisted: true }));
  } catch (err) {
    logger.debug('PostgreSQL is offline. Returning unpersisted in-memory logs (persisted: false).', { error: err.message });
    return inMemoryLogs
      .filter((log) => {
        if (filters.eventId && log.event_id !== filters.eventId) return false;
        if (filters.jobId && log.job_id !== filters.jobId) return false;
        if (filters.outcome && log.outcome !== filters.outcome) return false;
        return true;
      })
      .slice(0, limit);
  }
}

/**
 * Clears in-memory logs (for testing purposes).
 */
export function clearInMemoryLogs() {
  inMemoryLogs.length = 0;
}
