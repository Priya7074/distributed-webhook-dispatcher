import crypto from 'node:crypto';

/**
 * Computes an HMAC-SHA256 signature for a webhook payload.
 *
 * @param {string|object} payload - The body to sign
 * @param {string} secret - Secret key used for signing
 * @returns {string} Signature in format "sha256=<hex>"
 */
export function computeSignature(payload, secret) {
  if (!secret) return '';

  const bodyString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(bodyString, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
}
