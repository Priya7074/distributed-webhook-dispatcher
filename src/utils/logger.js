/**
 * Structured logger for Distributed Webhook Dispatcher
 * Outputs JSON format in production or structured readable logs in development.
 */

const LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const currentLevel = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
const currentLevelValue = LEVELS[currentLevel] ?? LEVELS.INFO;

function formatMessage(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...meta,
  };

  if (process.env.NODE_ENV === 'production') {
    return JSON.stringify(logEntry);
  }

  // Readable developer format
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level}] ${message}${metaStr}`;
}

export const logger = {
  debug(message, meta) {
    if (currentLevelValue <= LEVELS.DEBUG) {
      console.debug(formatMessage('DEBUG', message, meta));
    }
  },
  info(message, meta) {
    if (currentLevelValue <= LEVELS.INFO) {
      console.log(formatMessage('INFO', message, meta));
    }
  },
  warn(message, meta) {
    if (currentLevelValue <= LEVELS.WARN) {
      console.warn(formatMessage('WARN', message, meta));
    }
  },
  error(message, meta) {
    if (currentLevelValue <= LEVELS.ERROR) {
      console.error(formatMessage('ERROR', message, meta));
    }
  },
};
