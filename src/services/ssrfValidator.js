import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { config } from '../config/index.js';

// Blocked private, loopback, link-local, and reserved ranges
const BLOCKED_IPV4_RANGES = [
  'unspecified',         // 0.0.0.0/8
  'broadcast',           // 255.255.255.255/32
  'linkLocal',           // 169.254.0.0/16 (AWS / GCP / Azure metadata service)
  'loopback',            // 127.0.0.0/8
  'private',             // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  'carrierGradeNat',     // 100.64.0.0/10
  'multicast',           // 224.0.0.0/4
  'reserved',            // 240.0.0.0/4
];

const BLOCKED_IPV6_RANGES = [
  'unspecified',         // ::/128
  'linkLocal',           // fe80::/10
  'multicast',           // ff00::/8
  'loopback',            // ::1/128
  'uniqueLocal',         // fc00::/7
  'reserved',
];

/**
 * Checks if an IP address string belongs to a private/internal/restricted range.
 *
 * @param {string} ipString
 * @param {boolean} allowLocal
 * @returns {{ isBlocked: boolean, range: string }}
 */
export function isPrivateOrRestrictedIp(ipString, allowLocal = false) {
  try {
    const addr = ipaddr.parse(ipString);

    // If it's an IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1), unmap to IPv4
    if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
      const ipv4 = addr.toIPv4Address();
      const range = ipv4.range();
      if (allowLocal && range === 'loopback') {
        return { isBlocked: false, range };
      }
      return {
        isBlocked: BLOCKED_IPV4_RANGES.includes(range),
        range,
      };
    }

    if (addr.kind() === 'ipv4') {
      const range = addr.range();
      if (allowLocal && range === 'loopback') {
        return { isBlocked: false, range };
      }
      return {
        isBlocked: BLOCKED_IPV4_RANGES.includes(range),
        range,
      };
    }

    if (addr.kind() === 'ipv6') {
      const range = addr.range();
      if (allowLocal && range === 'loopback') {
        return { isBlocked: false, range };
      }
      return {
        isBlocked: BLOCKED_IPV6_RANGES.includes(range),
        range,
      };
    }

    return { isBlocked: true, range: 'unknown' };
  } catch {
    return { isBlocked: true, range: 'invalid_ip' };
  }
}

/**
 * Validates a destination URL for SSRF vulnerabilities.
 * Checks protocol, parses hostname, resolves DNS records, and blocks private/loopback/cloud-metadata IPs.
 *
 * @param {string} urlString
 * @param {object} [options]
 * @param {boolean} [options.allowLocal=false] - Override for testing environments
 * @returns {Promise<{ valid: boolean, error?: string, parsedUrl?: URL, resolvedIps?: string[] }>}
 */
export async function validateDestinationUrl(urlString, options = {}) {
  const allowLocal = options.allowLocal ?? config.security.allowLocalDestinations;

  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, error: 'Destination URL is required and must be a string' };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(urlString.trim());
  } catch {
    return { valid: false, error: 'Malformed or invalid URL format' };
  }

  // 1. Enforce allowed schemes: http and https only
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return {
      valid: false,
      error: `Invalid protocol "${parsedUrl.protocol}". Only HTTP and HTTPS are permitted.`,
    };
  }

  // 2. Disallow credentials in URL
  if (parsedUrl.username || parsedUrl.password) {
    return { valid: false, error: 'URLs containing embedded credentials are not permitted' };
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // 3. Fast-path check for obvious internal/local hostnames
  const localHostnames = ['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback'];
  if (localHostnames.includes(hostname) || hostname.endsWith('.localhost')) {
    if (!allowLocal) {
      return {
        valid: false,
        error: `SSRF defense blocked request to local hostname: ${hostname}`,
      };
    }
  }

  // 4. If hostname is directly an IP address
  if (ipaddr.isValid(hostname)) {
    const { isBlocked, range } = isPrivateOrRestrictedIp(hostname, allowLocal);
    if (isBlocked) {
      return {
        valid: false,
        error: `SSRF defense blocked destination IP (${hostname}) in restricted range: ${range}`,
      };
    }
    return { valid: true, parsedUrl, resolvedIps: [hostname] };
  }

  // 5. Perform DNS resolution to prevent DNS rebinding / internal domain bypasses
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records || records.length === 0) {
      return { valid: false, error: `Could not resolve hostname "${hostname}" via DNS` };
    }

    const resolvedIps = records.map((r) => r.address);

    for (const ip of resolvedIps) {
      const { isBlocked, range } = isPrivateOrRestrictedIp(ip, allowLocal);
      if (isBlocked) {
        return {
          valid: false,
          error: `SSRF defense blocked hostname "${hostname}" which resolved to restricted IP ${ip} (${range})`,
        };
      }
    }

    return { valid: true, parsedUrl, resolvedIps };
  } catch (err) {
    return {
      valid: false,
      error: `DNS resolution failed for hostname "${hostname}": ${err.message}`,
    };
  }
}
