import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDestinationUrl, isPrivateOrRestrictedIp } from '../src/services/ssrfValidator.js';

test('SSRF Defense - IP Range Checker', () => {
  // Loopbacks
  assert.equal(isPrivateOrRestrictedIp('127.0.0.1').isBlocked, true);
  assert.equal(isPrivateOrRestrictedIp('127.0.1.1').isBlocked, true);
  assert.equal(isPrivateOrRestrictedIp('::1').isBlocked, true);

  // Cloud Metadata (AWS, GCP, Azure, DigitalOcean 169.254.169.254)
  assert.equal(isPrivateOrRestrictedIp('169.254.169.254').isBlocked, true);
  assert.equal(isPrivateOrRestrictedIp('169.254.1.1').isBlocked, true);

  // RFC1918 Private Ranges
  assert.equal(isPrivateOrRestrictedIp('10.0.0.1').isBlocked, true);
  assert.equal(isPrivateOrRestrictedIp('172.16.0.1').isBlocked, true);
  assert.equal(isPrivateOrRestrictedIp('172.31.255.255').isBlocked, true);
  assert.equal(isPrivateOrRestrictedIp('192.168.1.1').isBlocked, true);

  // Carrier-grade NAT
  assert.equal(isPrivateOrRestrictedIp('100.64.0.1').isBlocked, true);

  // Unspecified / Broadcast
  assert.equal(isPrivateOrRestrictedIp('0.0.0.0').isBlocked, true);
  assert.equal(isPrivateOrRestrictedIp('255.255.255.255').isBlocked, true);

  // Public IPs should NOT be blocked
  assert.equal(isPrivateOrRestrictedIp('8.8.8.8').isBlocked, false);
  assert.equal(isPrivateOrRestrictedIp('1.1.1.1').isBlocked, false);
  assert.equal(isPrivateOrRestrictedIp('93.184.216.34').isBlocked, false); // example.com
});

test('SSRF Defense - URL Validation', async () => {
  // Disallowed protocols
  const ftpRes = await validateDestinationUrl('ftp://example.com/webhook');
  assert.equal(ftpRes.valid, false);
  assert.match(ftpRes.error, /Only HTTP and HTTPS/);

  const fileRes = await validateDestinationUrl('file:///etc/passwd');
  assert.equal(fileRes.valid, false);

  // Embedded credentials rejected
  const credsRes = await validateDestinationUrl('https://admin:secret@example.com/hook');
  assert.equal(credsRes.valid, false);
  assert.match(credsRes.error, /embedded credentials/);

  // Localhost names
  const localRes = await validateDestinationUrl('http://localhost:3000/api', { allowLocal: false });
  assert.equal(localRes.valid, false);
  assert.match(localRes.error, /SSRF defense blocked/);

  // Direct private IP in URL
  const privIpRes = await validateDestinationUrl('http://192.168.1.50/hook', { allowLocal: false });
  assert.equal(privIpRes.valid, false);
  assert.match(privIpRes.error, /SSRF defense blocked/);

  // Cloud metadata in URL
  const metaRes = await validateDestinationUrl('http://169.254.169.254/latest/meta-data/', { allowLocal: false });
  assert.equal(metaRes.valid, false);
  assert.match(metaRes.error, /SSRF defense blocked/);

  // Valid public URL
  const validRes = await validateDestinationUrl('https://example.com/webhook');
  assert.equal(validRes.valid, true);
  assert.equal(validRes.parsedUrl.hostname, 'example.com');
});
