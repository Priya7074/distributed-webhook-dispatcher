-- Migration: 001_create_webhook_logs.sql
-- Description: Creates table and indexes for persistent webhook delivery attempt audit logs

CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
  id SERIAL PRIMARY KEY,
  job_id VARCHAR(100) NOT NULL,
  event_id VARCHAR(100) NOT NULL,
  destination_url TEXT NOT NULL,
  destination_host VARCHAR(255) NOT NULL,
  attempt_number INT NOT NULL,
  http_status INT,
  outcome VARCHAR(50) NOT NULL, -- 'SUCCESS', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE'
  error_message TEXT,
  response_body TEXT,
  duration_ms INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying by event, job, destination, and timestamp
CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_id ON webhook_delivery_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_job_id ON webhook_delivery_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_destination_host ON webhook_delivery_logs(destination_host);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_delivery_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_outcome ON webhook_delivery_logs(outcome);
