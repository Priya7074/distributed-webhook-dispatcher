const PRESETS = {
  success: {
    url: 'https://httpbin.org/post',
    eventId: 'evt_order_created_' + Math.floor(Math.random() * 10000),
    payload: {
      event: 'order.created',
      orderId: 'ord_9901',
      customer: 'jane.doe@example.com',
      amount: 129.99,
      currency: 'USD',
      items: [{ id: 'sku_book_1', qty: 1 }],
    },
  },
  retry_500: {
    url: 'https://httpbin.org/status/500',
    eventId: 'evt_payment_retry_' + Math.floor(Math.random() * 10000),
    payload: {
      event: 'payment.failed',
      note: 'Simulating 500 error: will trigger 3 retries with exponential backoff!',
    },
  },
  retry_429: {
    url: 'https://httpbin.org/status/429',
    eventId: 'evt_rate_limited_' + Math.floor(Math.random() * 10000),
    payload: {
      event: 'sync.batch',
      note: 'Simulating 429 Too Many Requests: treated as retryable failure.',
    },
  },
  permanent_404: {
    url: 'https://httpbin.org/status/404',
    eventId: 'evt_not_found_' + Math.floor(Math.random() * 10000),
    payload: {
      event: 'user.deleted',
      note: 'Simulating 404 client error: stops immediately without endlessly retrying.',
    },
  },
  ssrf_local: {
    url: 'http://localhost:8080/internal/admin',
    eventId: 'evt_ssrf_attempt_' + Math.floor(Math.random() * 10000),
    payload: {
      attack: 'ssrf_probe',
      target: 'localhost internal port',
    },
  },
  ssrf_metadata: {
    url: 'http://169.254.169.254/latest/meta-data/',
    eventId: 'evt_metadata_probe_' + Math.floor(Math.random() * 10000),
    payload: {
      attack: 'cloud_metadata_exfiltration',
    },
  },
};

function loadPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;

  document.getElementById('destinationUrl').value = preset.url;
  document.getElementById('eventId').value = preset.eventId;
  document.getElementById('payload').value = JSON.stringify(preset.payload, null, 2);
}

window.loadPreset = loadPreset;

// Initial preset
loadPreset('success');

// System Health Polling
async function checkSystemHealth() {
  const badge = document.getElementById('systemHealthBadge');
  const text = document.getElementById('healthStatusText');
  const banner = document.getElementById('modeBanner');
  const title = document.getElementById('modeTitle');
  const desc = document.getElementById('modeDesc');
  const redisPill = document.getElementById('redisPill');
  const dbPill = document.getElementById('dbPill');

  try {
    const res = await fetch('/health');
    const data = await res.json();

    const redisOk = data.services?.redis === 'connected';
    const dbOk = data.services?.database === 'connected';

    if (redisPill) {
      redisPill.className = redisOk ? 'pill pill-green' : 'pill pill-red';
      redisPill.textContent = redisOk ? '🟢 Redis (BullMQ): Connected' : '🔴 Redis (BullMQ): Disconnected';
    }

    if (dbPill) {
      dbPill.className = dbOk ? 'pill pill-green' : 'pill pill-red';
      dbPill.textContent = dbOk ? '🟢 PostgreSQL: Connected' : '🔴 PostgreSQL: Disconnected';
    }

    if (data.status === 'healthy') {
      badge.className = 'health-badge';
      text.textContent = 'Production Mode (Connected)';
      if (banner) {
        banner.className = 'mode-banner production-mode';
        title.textContent = 'Production Mode Active';
        desc.textContent = 'All backing services connected. Real BullMQ distributed queue and PostgreSQL audit persistence are active.';
      }
    } else {
      badge.className = 'health-badge degraded';
      text.textContent = 'Standalone Preview Mode';
      if (banner) {
        banner.className = 'mode-banner preview-mode';
        title.textContent = 'Standalone Preview Mode Active';
        desc.textContent = 'The Express HTTP server is running safely on port 3000 without requiring real credentials. Real background queue processing (BullMQ) and persistent audit logging (PostgreSQL) require external backing services.';
      }
    }
  } catch (err) {
    badge.className = 'health-badge degraded';
    text.textContent = 'Server Offline';
  }
}

// Dispatch Form Submission
document.getElementById('dispatchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('dispatchSubmitBtn');
  const responseBox = document.getElementById('dispatchResponse');
  const responseCode = document.getElementById('dispatchResponseCode');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Dispatching...';

  const destinationUrl = document.getElementById('destinationUrl').value.trim();
  const eventId = document.getElementById('eventId').value.trim();
  let payload;

  try {
    payload = JSON.parse(document.getElementById('payload').value);
  } catch (err) {
    alert('Invalid JSON in payload: ' + err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Dispatch Webhook (Immediate 202 Accepted)';
    return;
  }

  try {
    const res = await fetch('/api/webhooks/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationUrl, eventId, payload }),
    });

    const contentType = res.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: 'Server returned non-JSON response', body: text.slice(0, 300) };
      }
    }

    responseBox.classList.remove('hidden');
    responseCode.textContent = `HTTP ${res.status} ${res.statusText}\n\n` + JSON.stringify(data, null, 2);

    // Refresh logs immediately
    setTimeout(fetchDeliveryLogs, 300);
  } catch (err) {
    responseBox.classList.remove('hidden');
    responseCode.textContent = 'Error: ' + err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Dispatch Webhook (Immediate 202 Accepted)';
  }
});

// Fetch Delivery Logs
async function fetchDeliveryLogs() {
  const tbody = document.getElementById('logsTableBody');

  try {
    const res = await fetch('/api/webhooks/logs?limit=30');
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return;
    }
    const data = await res.json();
    const logs = data.logs || [];

    if (logs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-state">No delivery attempts recorded yet. Dispatch a webhook above!</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = logs
      .map((log) => {
        const timeStr = new Date(log.created_at).toLocaleTimeString();
        const outcomeClass = `outcome-${log.outcome}`;
        const statusDisplay = log.http_status ?? '—';
        const details = log.error_message || (log.response_body ? `Resp: ${log.response_body.slice(0, 40)}...` : 'OK');

        return `
          <tr>
            <td title="${log.created_at}">${timeStr}</td>
            <td><strong>${escapeHtml(log.event_id)}</strong></td>
            <td><small>${escapeHtml(log.job_id)}</small></td>
            <td title="${escapeHtml(log.destination_url)}">${escapeHtml(truncate(log.destination_url, 35))}</td>
            <td>#${log.attempt_number}</td>
            <td><span class="outcome-badge ${outcomeClass}">${log.outcome}</span></td>
            <td><strong>${statusDisplay}</strong></td>
            <td>${log.duration_ms}ms</td>
            <td title="${escapeHtml(log.error_message || log.response_body || '')}"><small>${escapeHtml(truncate(details, 30))}</small></td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    console.error('Failed to fetch logs:', err);
  }
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.getElementById('refreshLogsBtn').addEventListener('click', fetchDeliveryLogs);

// Poll health & logs
checkSystemHealth();
fetchDeliveryLogs();
setInterval(checkSystemHealth, 10000);

let autoRefreshInterval = setInterval(() => {
  if (document.getElementById('autoRefreshToggle').checked) {
    fetchDeliveryLogs();
  }
}, 2000);

document.getElementById('autoRefreshToggle').addEventListener('change', (e) => {
  if (!e.target.checked) {
    clearInterval(autoRefreshInterval);
  } else {
    autoRefreshInterval = setInterval(fetchDeliveryLogs, 2000);
  }
});
