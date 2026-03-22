/**
 * Chrome Attach — discover and connect to a running Chrome instance.
 *
 * Probes common debug ports for Chrome's /json/version endpoint
 * and returns the WebSocket debugger URL for Puppeteer.connect().
 *
 * Inspired by PinchTab's attach mode, built from scratch.
 */

import http from 'node:http';
import { log } from '../utils/logger.js';

export interface ChromeDiscoveryResult {
  wsEndpoint: string;
  port: number;
  version: string;
  browser: string;
}

const DEFAULT_PORTS = [9222, 9229, 9333, 9515];
const PROBE_TIMEOUT = 1500; // ms

/**
 * Probe a single port for Chrome's DevTools endpoint.
 */
function probePort(port: number): Promise<ChromeDiscoveryResult | null> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, {
      timeout: PROBE_TIMEOUT,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          if (info.webSocketDebuggerUrl) {
            resolve({
              wsEndpoint: info.webSocketDebuggerUrl,
              port,
              version: info['Protocol-Version'] || '',
              browser: info.Browser || '',
            });
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Discover a running Chrome instance by probing common debug ports.
 * Returns the first responding instance, or null if none found.
 */
export async function discoverChrome(ports?: number[]): Promise<ChromeDiscoveryResult | null> {
  const portsToCheck = ports || DEFAULT_PORTS;
  log.debug(`Scanning ports for Chrome: ${portsToCheck.join(', ')}`);

  // Probe all ports in parallel for speed
  const results = await Promise.all(portsToCheck.map(probePort));
  const found = results.find(Boolean) || null;

  if (found) {
    log.info(`Found Chrome on port ${found.port}: ${found.browser}`);
  } else {
    log.debug('No running Chrome instance found on debug ports.');
  }

  return found;
}

/**
 * Get WebSocket debugger URL from a specific port.
 */
export async function getWebSocketDebuggerUrl(port: number): Promise<string | null> {
  const result = await probePort(port);
  return result?.wsEndpoint || null;
}

/**
 * Parse an attach target — could be:
 * - "true" / true → auto-discover
 * - "ws://..." → explicit WebSocket URL
 * - "9222" → specific port number
 */
export async function resolveAttachTarget(target: boolean | string): Promise<string> {
  if (target === true || target === 'true') {
    const result = await discoverChrome();
    if (!result) {
      throw new Error(
        'No running Chrome found. Start Chrome with:\n' +
        '  google-chrome --remote-debugging-port=9222\n' +
        '  # or on Mac:\n' +
        '  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222'
      );
    }
    return result.wsEndpoint;
  }

  if (typeof target === 'string') {
    // Explicit WebSocket URL
    if (target.startsWith('ws://') || target.startsWith('wss://')) {
      return target;
    }

    // Port number
    const port = parseInt(target, 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      const url = await getWebSocketDebuggerUrl(port);
      if (!url) {
        throw new Error(`No Chrome found on port ${port}. Make sure Chrome is running with --remote-debugging-port=${port}`);
      }
      return url;
    }

    throw new Error(`Invalid attach target: "${target}". Use "true" for auto-discover, a port number, or a ws:// URL.`);
  }

  throw new Error('Invalid attach target.');
}
