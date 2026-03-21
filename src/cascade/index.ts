import { Strategy } from '../types/adapter.js';
import { log } from '../utils/logger.js';

export interface CascadeResult {
  strategy: Strategy;
  confidence: number;
  details: string;
}

export async function cascadeProbe(url: string): Promise<CascadeResult> {
  // Level 1: Try PUBLIC (bare fetch)
  try {
    const resp = await fetch(url, { redirect: 'follow' });
    if (resp.ok) {
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const body = await resp.json();
        if (body && typeof body === 'object' && Object.keys(body).length > 0) {
          return { strategy: Strategy.PUBLIC, confidence: 0.9, details: 'Public JSON endpoint' };
        }
      } else {
        const text = await resp.text();
        if (text.length > 100) {
          return { strategy: Strategy.PUBLIC, confidence: 0.7, details: 'Public HTML endpoint' };
        }
      }
    }

    if (resp.status === 401 || resp.status === 403) {
      log.debug(`PUBLIC probe returned ${resp.status}, escalating to COOKIE`);
    }
  } catch (err) {
    log.debug(`PUBLIC probe failed: ${err}`);
  }

  // Level 2: COOKIE (need browser to test)
  // Can't probe COOKIE without a browser session — return as default
  return { strategy: Strategy.COOKIE, confidence: 0.5, details: 'Defaulting to cookie-based auth (browser required)' };
}
