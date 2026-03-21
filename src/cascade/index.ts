/**
 * Strategy Cascade: automatic strategy downgrade chain.
 *
 * Probes an API endpoint starting from the simplest strategy (PUBLIC)
 * and downgrades through tiers until one works:
 *
 *   PUBLIC → COOKIE → HEADER → INTERCEPT → UI
 */

import { Strategy } from '../types/adapter.js';
import type { IPage } from '../types/page.js';
import { log } from '../utils/logger.js';

const CASCADE_ORDER: Strategy[] = [
  Strategy.PUBLIC,
  Strategy.COOKIE,
  Strategy.HEADER,
  Strategy.INTERCEPT,
  Strategy.UI,
];

export interface ProbeResult {
  strategy: Strategy;
  success: boolean;
  statusCode?: number;
  hasData?: boolean;
  error?: string;
  responsePreview?: string;
}

export interface CascadeResult {
  bestStrategy: Strategy;
  probes: ProbeResult[];
  confidence: number;
}

/**
 * Build JavaScript source for a fetch probe that runs inside the browser.
 * Handles credentials and CSRF token extraction.
 */
function buildFetchProbeJs(url: string, opts: {
  credentials?: boolean;
  extractCsrf?: boolean;
}): string {
  const credentialsLine = opts.credentials ? `credentials: 'include',` : '';
  const headerSetup = opts.extractCsrf
    ? `
      const cookies = document.cookie.split(';').map(c => c.trim());
      const csrf = cookies.find(c =>
        c.startsWith('ct0=') || c.startsWith('csrf_token=') ||
        c.startsWith('_csrf=') || c.startsWith('XSRF-TOKEN=')
      )?.split('=').slice(1).join('=');
      const headers = {};
      if (csrf) { headers['X-Csrf-Token'] = csrf; headers['X-XSRF-Token'] = csrf; }
    `
    : 'const headers = {};';

  return `
    (async () => {
      try {
        ${headerSetup}
        const resp = await fetch(${JSON.stringify(url)}, {
          ${credentialsLine}
          headers
        });
        const status = resp.status;
        if (!resp.ok) return { status, ok: false };
        const text = await resp.text();
        let hasData = false;
        try {
          const json = JSON.parse(text);
          hasData = !!json && (Array.isArray(json) ? json.length > 0 :
            typeof json === 'object' && Object.keys(json).length > 0);
          // API-level error codes (common in Chinese sites)
          if (json.code !== undefined && json.code !== 0) hasData = false;
          if (json.error || json.message === 'Unauthorized') hasData = false;
        } catch {}
        return { status, ok: true, hasData, preview: text.slice(0, 200) };
      } catch (e) { return { ok: false, error: e.message }; }
    })()
  `;
}

/**
 * Probe an endpoint with a specific strategy using in-browser JS evaluation.
 */
export async function probeEndpoint(
  page: IPage,
  url: string,
  strategy: Strategy,
): Promise<ProbeResult> {
  const result: ProbeResult = { strategy, success: false };

  try {
    switch (strategy) {
      case Strategy.PUBLIC: {
        const resp = await page.evaluate<any>(buildFetchProbeJs(url, {}));
        result.statusCode = resp?.status;
        result.success = resp?.ok && resp?.hasData;
        result.hasData = resp?.hasData;
        result.responsePreview = resp?.preview;
        break;
      }

      case Strategy.COOKIE: {
        const resp = await page.evaluate<any>(buildFetchProbeJs(url, { credentials: true }));
        result.statusCode = resp?.status;
        result.success = resp?.ok && resp?.hasData;
        result.hasData = resp?.hasData;
        result.responsePreview = resp?.preview;
        break;
      }

      case Strategy.HEADER: {
        const resp = await page.evaluate<any>(buildFetchProbeJs(url, { credentials: true, extractCsrf: true }));
        result.statusCode = resp?.status;
        result.success = resp?.ok && resp?.hasData;
        result.hasData = resp?.hasData;
        result.responsePreview = resp?.preview;
        break;
      }

      case Strategy.INTERCEPT:
      case Strategy.UI:
        result.success = false;
        result.error = `Strategy ${strategy} requires site-specific implementation`;
        break;
    }
  } catch (err: any) {
    result.success = false;
    result.error = err.message ?? String(err);
  }

  return result;
}

/**
 * Run the cascade: try each strategy in order until one works.
 */
export async function cascadeProbe(
  page: IPage,
  url: string,
  opts: { maxStrategy?: Strategy } = {},
): Promise<CascadeResult> {
  const maxIdx = opts.maxStrategy
    ? CASCADE_ORDER.indexOf(opts.maxStrategy)
    : CASCADE_ORDER.indexOf(Strategy.HEADER);

  const probes: ProbeResult[] = [];

  for (let i = 0; i <= Math.min(maxIdx, CASCADE_ORDER.length - 1); i++) {
    const strategy = CASCADE_ORDER[i];
    log.debug(`Probing strategy: ${strategy}`);
    const probe = await probeEndpoint(page, url, strategy);
    probes.push(probe);

    if (probe.success) {
      return {
        bestStrategy: strategy,
        probes,
        confidence: 1.0 - (i * 0.1),
      };
    }
  }

  return {
    bestStrategy: Strategy.COOKIE,
    probes,
    confidence: 0.3,
  };
}

export function renderCascadeResult(result: CascadeResult): string {
  const lines = [
    `Strategy Cascade: ${result.bestStrategy} (${(result.confidence * 100).toFixed(0)}% confidence)`,
  ];
  for (const probe of result.probes) {
    const icon = probe.success ? '\u2705' : '\u274C';
    const status = probe.statusCode ? ` [${probe.statusCode}]` : '';
    const err = probe.error ? ` \u2014 ${probe.error}` : '';
    lines.push(`  ${icon} ${probe.strategy}${status}${err}`);
  }
  return lines.join('\n');
}
