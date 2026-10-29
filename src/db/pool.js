import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

let pool = null;
let isConnected = false;

export function getDbPool() {
  if (pool) return pool;

  const poolConfig = config.db.connectionString
    ? {
        connectionString: config.db.connectionString,
        max: config.db.maxPoolSize || 10,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        keepAlive: true,
      }
    : {
        host: config.db.host,
        port: config.db.port,
        database: config.db.database,
        user: config.db.user,
        password: config.db.password,
        max: config.db.maxPoolSize,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        keepAlive: true,
      };

  pool = new Pool(poolConfig);

  pool.on('connect', () => {
    isConnected = true;
    logger.info('Connected to PostgreSQL database');
  });

  pool.on('error', (err) => {
    isConnected = false;
    logger.error('Unexpected error on idle PostgreSQL client', {
      error: err.message,
    });
  });

  return pool;
}

export async function checkDbHealth() {
  let timeoutId;

  try {
    const currentPool = getDbPool();

    const result = await Promise.race([
      currentPool.query('SELECT 1 AS alive'),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Postgres connection timeout')),
          5000
        );
      }),
    ]);

    isConnected = Number(result.rows?.[0]?.alive) === 1;
    return isConnected;
  } catch (err) {
    isConnected = false;
    logger.warn('PostgreSQL health check failed', {
      error: err.message,
    });
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

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