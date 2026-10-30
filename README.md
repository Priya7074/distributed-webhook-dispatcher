# Distributed Webhook Dispatcher

A reliable, production-grade distributed webhook delivery engine built with **Node.js**, **Express.js**, **BullMQ**, **Redis**, and **PostgreSQL**.

Designed to handle high-volume webhook delivery with **resilient exponential retries**, **anti-SSRF defense**, **per-destination token bucket rate limiting**, and **persistent audit logs**.

---

## ðŸ—ï¸ Architecture Overview

```
                      [ Client Application / Event Producer ]
                                         â”‚
                                         â–¼ POST /api/webhooks/dispatch
                        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                        â”‚   Express API Ingestion Layer   â”‚
                        â”‚  - Payload Validation (< 256kb) â”‚
                        â”‚  - Anti-SSRF Pre-flight Check   â”‚
                        â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                         â”‚ Enqueue (HTTP 202 Accepted)
                                         â–¼
                        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                        â”‚    Redis / BullMQ Job Queue     â”‚
                        â”‚  - 3 Retries (4 total attempts) â”‚
                        â”‚  - Exponential Backoff (1s,2s..)â”‚
                        â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                         â”‚ Pull Job
                                         â–¼
                        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                        â”‚      BullMQ Worker Process      â”‚
                        â”‚  - Per-Destination Token Bucket â”‚
                        â”‚  - SSRF Verification & Redirectsâ”‚
                        â”‚  - HMAC-SHA256 Signature Header â”‚
                        â”‚  - HTTP POST with Timeout (10s)  â”‚
                        â””â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
                                â”‚                 â”‚
                       HTTP POSTâ”‚                 â”‚ Insert Audit Log
                                â–¼                 â–¼
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚ Destination URL   â”‚  â”‚ PostgreSQL DB     â”‚
                    â”‚ (Customer Server) â”‚  â”‚ - Job ID, Event IDâ”‚
                    â”‚ 2xx / 4xx / 5xx   â”‚  â”‚ - Status, Outcome â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚ - Latency & Errorsâ”‚
                                           â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## ðŸŒŸ Key Engineering Highlights

### 1. Asynchronous Ingestion (Immediate HTTP 202 Accepted)
- `POST /api/webhooks/dispatch` never blocks waiting for the customer's server.
- The request is validated, enqueued into BullMQ, and immediately responds with `HTTP 202 Accepted` and a unique `jobId`.

### 2. Configurable Exponential Retries
- Configured for **3 retries after the initial attempt** (4 attempts total).
- Exponential backoff algorithm (`backoff: { type: 'exponential', delay: 2000 }`):
  - Attempt 1: Immediate
  - Attempt 2 (Retry 1): ~2,000 ms delay
  - Attempt 3 (Retry 2): ~4,000 ms delay
  - Attempt 4 (Retry 3): ~8,000 ms delay

### 3. Smart Retryable vs. Permanent Failure Classification
- **Retryable Failures** (rescheduled via BullMQ):
  - Network errors (`ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`)
  - Request timeouts (aborted after 10,000 ms)
  - `HTTP 429 Too Many Requests` (destination rate limit)
  - `HTTP 5xx` Server Errors (500, 502, 503, 504)
- **Permanent Failures** (halted immediately, **not** endlessly retried):
  - `HTTP 4xx` Client Errors (400, 401, 403, 404, 410, 422)
  - SSRF-blocked destinations
  - Logged with `outcome: 'PERMANENT_FAILURE'` and completed without re-throwing to BullMQ.

### 4. Enterprise-Grade Anti-SSRF Defense
- Validates the destination URL scheme (`http:` and `https:` only).
- Disallows embedded credentials (`http://user:pass@evil.com`).
- Resolves hostnames to IP addresses via DNS and checks all IPs against blocked CIDR ranges:
  - Loopbacks: `127.0.0.0/8`, `::1`
  - Cloud Metadata Services: `169.254.0.0/16` (blocks AWS, GCP, Azure metadata at `169.254.169.254`)
  - RFC 1918 Private Ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
  - Carrier-grade NAT: `100.64.0.0/10`
  - IPv6 Unique Local: `fc00::/7` and Link-Local: `fe80::/10`
- **Redirect Revalidation**: HTTP redirects are intercepted (`redirect: 'manual'`) and the `Location` header is strictly revalidated before following.

### 5. Per-Destination Token Bucket Rate Limiting
- Each destination host has an isolated token bucket (e.g. `api.partner.com`).
- Configurable capacity (burst) and continuous refill rate (tokens/second).
- One destination experiencing high volume or throttling will **never** starve or delay webhooks destined for other customers.
- Powered by an atomic Redis Lua script in distributed environments with an in-memory fallback.

### 6. Audit Logging in PostgreSQL
- Delivery attempts are recorded in `webhook_delivery_logs`.
- Records: `job_id`, `event_id`, `destination_url`, `destination_host`, `attempt_number`, `http_status`, `outcome`, `error_message`, `response_body` (truncated), `duration_ms`, and `created_at`.
- Indexed for high-speed queries by `event_id`, `job_id`, `destination_host`, and timestamp.

---

## ðŸ“‹ Required Backing Services

Before running the application in a full production environment, the following two external services must be configured and running:

1. **Redis (v6.2+)**:
   - Required for BullMQ job queue management, worker coordination, and distributed per-destination rate limiting.
   - Default host: `127.0.0.1:6379`.
2. **PostgreSQL (v14+)**:
   - Required for persistent storage of delivery attempt audit logs.
   - Default host: `127.0.0.1:5432`, Database: `webhook_dispatcher`.

> **Note on Standalone / Fallback Mode:**
> If Redis or PostgreSQL are not yet running, the service automatically detects this, logs a helpful diagnostic message, and runs in-memory fallbacks so you can test endpoints, run unit tests, and inspect responses immediately.

---

## ðŸš€ Quick Start Guide

### Option A: 1-Command Startup with Docker Compose (Recommended)

Starts Redis, PostgreSQL, runs database migrations, and launches the Webhook Dispatcher:

```bash
# 1. Start all services in the background
docker compose up -d

# 2. View running logs
docker compose logs -f app
```

The Webhook Dispatcher is now available at `http://localhost:3000`.

---

### Option B: Local Node.js Development

#### 1. Start Redis & PostgreSQL with Docker

```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
docker run -d --name postgres -p 5432:5432 -e POSTGRES_DB=webhook_dispatcher -e POSTGRES_PASSWORD=postgres postgres:15-alpine
```

#### 2. Install Dependencies

```bash
npm install
```

#### 3. Configure Environment Variables

```bash
cp .env.example .env
```

#### 4. Run PostgreSQL Schema Migrations

```bash
npm run migrate
```

#### 5. Start the Webhook Dispatcher

```bash
# Development mode
npm run dev

# Or production mode
npm start
```

Visit `http://localhost:3000` to access the interactive Developer Console & API Playground!

---

## ðŸ§ª Running Automated Tests

Run the comprehensive test suite verifying delivery, retries, SSRF defense, rate limiting, and input validation:

```bash
npm test
```

Test coverage includes:
- `tests/ssrfValidator.test.js`: Validates CIDR range blocking (loopbacks, RFC1918, cloud metadata 169.254.169.254, IPv6) and protocol restrictions.
- `tests/rateLimiter.test.js`: Validates token bucket burst capacity, refill intervals, and per-destination isolation.
- `tests/validation.test.js`: Tests 400 Bad Request on missing fields, SSRF URL rejection, and 413 Payload Too Large.
- `tests/retryAndFailure.test.js`: Tests HTTP status classification (429 and 5xx trigger retries; 4xx halts immediately).
- `tests/dispatcher.test.js`: Tests end-to-end delivery, HTTP header delivery (`X-Event-ID`, `X-Attempt-Number`, `X-Delivery-Timestamp`, `X-Webhook-Signature`), and audit logging.

---

## ðŸ“¡ API Reference & cURL Examples

### 1. Dispatch a Webhook

**Endpoint:** `POST /api/webhooks/dispatch`

**Headers:** `Content-Type: application/json`

**Request Body:**
```json
{
  "destinationUrl": "https://httpbin.org/post",
  "eventId": "evt_order_created_12345",
  "payload": {
    "orderId": "ord_9901",
    "customerEmail": "jane@example.com",
    "total": 89.50,
    "currency": "USD"
  }
}
```

**cURL Command:**
```bash
curl -i -X POST http://localhost:3000/api/webhooks/dispatch \
  -H "Content-Type: application/json" \
  -d '{
    "destinationUrl": "https://httpbin.org/post",
    "eventId": "evt_order_created_12345",
    "payload": {
      "orderId": "ord_9901",
      "customerEmail": "jane@example.com",
      "total": 89.50,
      "currency": "USD"
    }
  }'
```

**Response (HTTP 202 Accepted):**
```json
{
  "success": true,
  "message": "Webhook accepted for dispatch",
  "jobId": "webhook_evt_order_created_12345_a1b2c3d4",
  "eventId": "evt_order_created_12345",
  "destinationUrl": "https://httpbin.org/post",
  "enqueuedAt": "2026-10-29T16:20:00.000Z"
}
```

---

### 2. Query Delivery Audit Logs

**Endpoint:** `GET /api/webhooks/logs`

**Query Parameters:**
- `limit`: Maximum records to return (default: 50, max: 100)
- `eventId`: Filter by event identifier (e.g. `evt_order_created_12345`)
- `jobId`: Filter by queue job identifier
- `outcome`: Filter by `SUCCESS`, `RETRYABLE_FAILURE`, or `PERMANENT_FAILURE`

**cURL Command:**
```bash
curl -s "http://localhost:3000/api/webhooks/logs?limit=10"
```

**Response (HTTP 200 OK):**
```json
{
  "count": 1,
  "logs": [
    {
      "id": 1,
      "job_id": "webhook_evt_order_created_12345_a1b2c3d4",
      "event_id": "evt_order_created_12345",
      "destination_url": "https://httpbin.org/post",
      "destination_host": "httpbin.org",
      "attempt_number": 1,
      "http_status": 200,
      "outcome": "SUCCESS",
      "error_message": null,
      "response_body": "{\"url\": \"https://httpbin.org/post\"...}",
      "duration_ms": 142,
      "created_at": "2026-10-29T16:20:00.250Z"
    }
  ]
}
```

---

### 3. Check System Health

**Endpoint:** `GET /health`

**cURL Command:**
```bash
curl -s http://localhost:3000/health
```

**Response (HTTP 200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2026-10-29T16:20:00.000Z",
  "uptimeSeconds": 120,
  "services": {
    "server": "healthy",
    "redis": "connected",
    "database": "connected"
  }
}
```

---

### 4. Built-In Mock Receiver for Local Testing

For convenience during development and testing, a mock webhook receiver is included:

**Endpoint:** `POST /api/test/receiver`

Query parameters allow simulating various delivery scenarios:
- `?status=200`: Simulates normal success
- `?status=500`: Simulates server failure (triggers 3 retries with backoff)
- `?status=429`: Simulates rate limiting (triggers backoff retry)
- `?status=404`: Simulates missing endpoint (halts retries immediately)
- `?delay=1000`: Simulates high-latency receiver

```bash
# Test a 500 error that triggers automatic retries:
curl -X POST http://localhost:3000/api/webhooks/dispatch \
  -H "Content-Type: application/json" \
  -d '{
    "destinationUrl": "http://localhost:3000/api/test/receiver?status=500",
    "eventId": "evt_test_retry",
    "payload": { "ping": true }
  }'
```

---

## ðŸ”’ Security & Webhook Signatures

Every outbound webhook includes security headers:
- `Content-Type: application/json`
- `User-Agent: DistributedWebhookDispatcher/1.0`
- `X-Event-ID: <eventId>`
- `X-Attempt-Number: <attemptNumber>`
- `X-Delivery-Timestamp: <ISO timestamp>`
- `X-Webhook-Signature: sha256=<hex-digest>`

### Verifying Signatures at the Destination:
```javascript
import crypto from 'node:crypto';

function verifyWebhook(payloadString, signatureHeader, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadString, 'utf8');
  const expected = `sha256=${hmac.digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}
```

---

## ðŸ“ Project Directory Structure

```
.
â”œâ”€â”€ .env.example              # Documented environment variables template
â”œâ”€â”€ docker-compose.yml        # Redis, PostgreSQL, and App orchestration
â”œâ”€â”€ Dockerfile                # Production multi-stage container build
â”œâ”€â”€ package.json              # Project scripts and dependencies
â”œâ”€â”€ README.md                 # Complete system documentation
â”œâ”€â”€ migrations/
â”‚   â””â”€â”€ 001_create_webhook_logs.sql # PostgreSQL schema and indexes
â”œâ”€â”€ scripts/
â”‚   â””â”€â”€ migrate.js            # Automated migration execution script
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ app.js                # Express app setup and middleware
â”‚   â”œâ”€â”€ server.js             # HTTP server entry point and graceful shutdown
â”‚   â”œâ”€â”€ config/
â”‚   â”‚   â””â”€â”€ index.js          # Central configuration management
â”‚   â”œâ”€â”€ db/
â”‚   â”‚   â”œâ”€â”€ pool.js           # PostgreSQL connection pool with resilience
â”‚   â”‚   â””â”€â”€ logsRepository.js # Delivery attempt log persistence
â”‚   â”œâ”€â”€ queue/
â”‚   â”‚   â”œâ”€â”€ redis.js          # Redis client and connection checks
â”‚   â”‚   â”œâ”€â”€ webhookQueue.js   # BullMQ Queue instance and job enqueueing
â”‚   â”‚   â””â”€â”€ webhookWorker.js  # BullMQ Worker and execution logic
â”‚   â”œâ”€â”€ services/
â”‚   â”‚   â”œâ”€â”€ dispatcher.js     # HTTP client, header creation, redirect validation
â”‚   â”‚   â”œâ”€â”€ rateLimiter.js    # Per-destination Token Bucket rate limiter
â”‚   â”‚   â””â”€â”€ ssrfValidator.js  # Anti-SSRF URL and DNS IP range verification
â”‚   â”œâ”€â”€ routes/
â”‚   â”‚   â”œâ”€â”€ webhookRoutes.js  # /api/webhooks/dispatch and /api/webhooks/logs
â”‚   â”‚   â”œâ”€â”€ healthRoutes.js   # /health and /ready probes
â”‚   â”‚   â””â”€â”€ testReceiverRoutes.js # /api/test/receiver mock endpoint
â”‚   â”œâ”€â”€ utils/
â”‚   â”‚   â”œâ”€â”€ logger.js         # Structured JSON logger
â”‚   â”‚   â””â”€â”€ signature.js      # HMAC-SHA256 signature generator
â”‚   â””â”€â”€ public/
â”‚       â”œâ”€â”€ index.html        # Interactive Developer Console & Documentation
â”‚       â”œâ”€â”€ app.js            # Frontend dashboard scripts
â”‚       â””â”€â”€ style.css         # Dashboard styling
â””â”€â”€ tests/
    â”œâ”€â”€ ssrfValidator.test.js # SSRF range and URL validation tests
    â”œâ”€â”€ rateLimiter.test.js   # Token bucket burst and refill tests
    â”œâ”€â”€ validation.test.js    # API input and payload size tests
    â”œâ”€â”€ retryAndFailure.test.js # Retryable vs non-retryable failure tests
    â””â”€â”€ dispatcher.test.js    # End-to-end delivery and signature tests
```


---

## Live Deployment

**Public API Base URL:**

https://distributed-webhook-dispatcher-8o75.onrender.com

**Health Check:**

https://distributed-webhook-dispatcher-8o75.onrender.com/health

**Dispatch Endpoint:**

POST https://distributed-webhook-dispatcher-8o75.onrender.com/api/webhooks/dispatch

### Production Configuration

- Queue: BullMQ with Redis
- Persistent delivery logs: PostgreSQL
- Maximum attempts: 4 (1 initial + 3 retries)
- Exponential retry delays: 2s, 4s, 8s
- Webhook request timeout: 10 seconds
- Per-destination token bucket: 10-token capacity, 2 tokens/second refill
- Worker concurrency: 5

