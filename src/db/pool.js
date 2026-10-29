import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

let pool = null;
let isConnected = false;

export function getDbPool() {
  if (pool) return pool;

  const poolConfig = config.db.connectionString
    ? { connectionString: config.db.connectionString }
    : {
        host: config.db.host,
        port: config.db.port,
        database: config.db.database,
        user: config.db.user,
        password: config.db.password,
        max: config.db.maxPoolSize,
        connectionTimeoutMillis: config.db.connectionTimeoutMillis,
      };

  pool = new Pool(poolConfig);

  pool.on('connect', () => {
    isConnected = true;
    logger.info('Connected to PostgreSQL database');
  });

  pool.on('error', (err) => {
    isConnected = false;
    logger.error('Unexpected error on idle PostgreSQL client', { error: err.message });
  });

  return pool;
}

/**
 * Checks if the database is reachable.
 *
 * @returns {Promise<boolean>}
 */
export async function checkDbHealth() {
  try {
    const currentPool = getDbPool();
    const queryPromise = currentPool.query('SELECT 1 as alive');
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Postgres connection timeout')), 800)
    );
    const result = await Promise.race([queryPromise, timeoutPromise]);
    isConnected = result.rows?.[0]?.alive === 1;
    return isConnected;
  } catch (err) {
    isConnected = false;
    return false;
  }
}

/**
 * Gracefully shuts down the PostgreSQL pool.
 */
export async function closeDbPool() {
  if (pool) {
    logger.info('Closing PostgreSQL pool...');
    await pool.end();
    pool = null;
    isConnected = false;
  }
}

export function isDbConnected() {
  return isConnected;
}
