import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDbPool, closeDbPool } from '../src/db/pool.js';
import { logger } from '../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  logger.info('Starting PostgreSQL schema migrations...');
  const pool = getDbPool();

  try {
    const migrationFilePath = path.join(__dirname, '../migrations/001_create_webhook_logs.sql');
    const sql = await fs.readFile(migrationFilePath, 'utf8');

    logger.info(`Applying migration: 001_create_webhook_logs.sql`);
    await pool.query(sql);

    logger.info('Migrations applied successfully! Table `webhook_delivery_logs` is ready.');
  } catch (err) {
    logger.error('Failed to run migration:', { error: err.message });
    process.exitCode = 1;
  } finally {
    await closeDbPool();
  }
}

runMigrations();
