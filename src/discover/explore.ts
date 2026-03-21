/**
 * Site exploration: navigate, capture network, analyze APIs, infer capabilities.
 *
 * Based on OpenCLI's explore module with:
 * - URL pattern normalization (/123 → /{id})
 * - Auth detection (bearer, CSRF, signature)
 * - Response body analysis (item arrays, field roles)
 * - Framework & store detection
 * - Artifact generation
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IPage } from '../types/page.js';
import { log } from '../utils/logger.js';

// ── Known site aliases ──
const SITE_ALIASES: Record<string, string> = {
  'x.com': 'twitter', 'twitter.com': 'twitter',
  'news.ycombinator.com': 'hackernews',
  'old.reddit.com': 'reddit', 'www.reddit.com': 'reddit',
  'bilibili.com': 'bilibili', 'www.bilibili.com': 'bilibili',
  'zhihu.com': 'zhihu', 'www.zhihu.com': 'zhihu',
};

// ── Field role mapping ──
const FIELD_ROLES: Record<string, string[]> = {
  title: ['title', 'name', 'headline', 'subject', 'text', 'caption'],
  url: ['url', 'link', 'href', 'permalink', 'uri', 'web_url'],
  author: ['author', 'user', 'creator', 'owner', 'by', 'username', 'screen_name', 'display_name'],
  score: ['score', 'points', 'likes', 'upvotes', 'karma', 'vote_count', 'favorite_count', 'retweet_count'],
  time: ['time', 'date', 'created', 'created_at', 'timestamp', 'published', 'updated_at', 'posted_at'],
  description: ['description', 'summary', 'snippet', 'excerpt', 'body', 'content', 'selftext'],
  image: ['image', 'thumbnail', 'avatar', 'icon', 'photo', 'cover', 'poster'],
  id: ['id', 'uid', 'pid', 'mid', 'aid', 'bvid'],
};

// ── Volatile query params to ignore ──
const VOLATILE_PARAMS = new Set([
  '_', 't', 'ts', 'timestamp', 'nonce', 'rand', 'random',
  'callback', 'jsonp', '_t', '__t',
]);

export interface EndpointInfo {
  url: string;
  pattern: string;
  method: string;
  status: number;
  contentType: string;
  queryParams: string[];
  hasItems: boolean;
  itemCount: number;
  fields: string[];
  fieldRoles: Record<string, string>;
  authIndicators: string[];
  score: number;
}

export interface ExploreResult {
  site: string;
  domain: string;
  endpoints: EndpointInfo[];
  strategy: string;
  framework?: string;
  stores?: { name: string; type: string; actions: string[] }[];
  capabilities: string[];
  artifactDir?: string;
}

export interface ExploreOptions {
  wait?: number;
  scroll?: boolean;
  fuzz?: boolean;
  outputDir?: string;
  maxButtons?: number;
  scrollAttempts?: number;
}

/**
 * Normalize a URL path to a pattern:
 * /users/123/posts → /users/{id}/posts
 * /item/abc123def → /item/{hex}
 */
function normalizeUrlPattern(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const parts = u.pathname.split('/');
    const normalized = parts.map((p) => {
      if (!p) return p;
      if (/^\d+$/.test(p)) return '{id}';
      if (/^[a-f0-9]{8,}$/i.test(p)) return '{hex}';
      if (/^BV[a-zA-Z0-9]+$/.test(p)) return '{bvid}';
      if (/^[a-z0-9]{20,}$/i.test(p)) return '{token}';
      return p;
    });
    return u.origin + normalized.join('/');
  } catch {
    return urlStr;
  }
}

/**
 * Detect auth indicators in request headers/URL.
 */
function detectAuth(url: string, headers?: Record<string, string>): string[] {
  const indicators: string[] = [];
  if (url.includes('signature') || url.includes('sign=') || url.includes('sig=')) indicators.push('signature');
  if (url.includes('token=') || url.includes('access_token=')) indicators.push('token');
  if (url.includes('api_key=') || url.includes('apikey=')) indicators.push('api_key');
  if (headers) {
    if (headers['authorization']?.startsWith('Bearer')) indicators.push('bearer');
    if (headers['x-csrf-token'] || headers['x-xsrf-token']) indicators.push('csrf');
  }
  return indicators;
}

/**
 * Analyze a JSON response body to find item arrays and extract fields.
 */
function analyzeResponseBody(body: unknown): {
  hasItems: boolean;
  itemCount: number;
  fields: string[];
  fieldRoles: Record<string, string>;
} {
  if (!body || typeof body !== 'object') {
    return { hasItems: false, itemCount: 0, fields: [], fieldRoles: {} };
  }

  // Find the item array — could be at root or nested
  let items: unknown[] | null = null;

  if (Array.isArray(body)) {
    items = body;
  } else {
    // Search common nested paths: data, results, items, list, entries, records, hits
    const obj = body as Record<string, unknown>;
    for (const key of ['data', 'results', 'items', 'list', 'entries', 'records', 'hits', 'posts', 'articles', 'stories']) {
      const val = obj[key];
      if (Array.isArray(val) && val.length > 0) {
        items = val;
        break;
      }
      // One level deeper: data.items, data.list, etc.
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        for (const subKey of ['items', 'list', 'data', 'results', 'entries']) {
          const subVal = (val as Record<string, unknown>)[subKey];
          if (Array.isArray(subVal) && subVal.length > 0) {
            items = subVal;
            break;
          }
        }
        if (items) break;
      }
    }
  }

  if (!items || items.length === 0) {
    return { hasItems: false, itemCount: 0, fields: [], fieldRoles: {} };
  }

  // Extract fields from first item
  const firstItem = items[0];
  if (!firstItem || typeof firstItem !== 'object') {
    return { hasItems: true, itemCount: items.length, fields: [], fieldRoles: {} };
  }

  const fields = Object.keys(firstItem as Record<string, unknown>);

  // Map fields to semantic roles
  const fieldRoles: Record<string, string> = {};
  for (const field of fields) {
    const lower = field.toLowerCase();
    for (const [role, patterns] of Object.entries(FIELD_ROLES)) {
      if (patterns.some((p) => lower.includes(p))) {
        fieldRoles[field] = role;
        break;
      }
    }
  }

  return { hasItems: true, itemCount: items.length, fields, fieldRoles };
}

/**
 * Score an endpoint for relevance.
 */
function scoreEndpoint(ep: Omit<EndpointInfo, 'score'>): number {
  let score = 0;

  // Content type
  if (ep.contentType.includes('json')) score += 10;

  // Response analysis
  if (ep.hasItems) score += 5;
  if (ep.itemCount > 3) score += 3;
  if (ep.itemCount > 10) score += 2;
  if (Object.keys(ep.fieldRoles).length > 2) score += 3;

  // URL patterns
  if (ep.url.includes('/api/')) score += 5;
  if (ep.url.includes('/v1/') || ep.url.includes('/v2/') || ep.url.includes('/v3/')) score += 3;
  const path = new URL(ep.url).pathname.toLowerCase();
  if (/search|query|find/.test(path)) score += 4;
  if (/hot|trending|popular|top|feed|timeline/.test(path)) score += 4;
  if (/list|index|all|latest|recent/.test(path)) score += 3;

  // Query params
  if (ep.queryParams.some((p) => /search|keyword|query|q/.test(p))) score += 3;
  if (ep.queryParams.some((p) => /page|offset|cursor|limit|count|num/.test(p))) score += 2;

  // Method
  if (ep.method === 'GET') score += 2;

  // Auth complexity penalty
  if (ep.authIndicators.includes('signature')) score -= 2;

  // Penalize static assets
  if (/\.(js|css|png|jpg|gif|svg|woff|ico)/.test(ep.url)) score -= 30;

  // Penalize tracking/analytics
  if (/analytics|tracking|pixel|beacon|log\b/.test(ep.url)) score -= 20;

  return score;
}

/**
 * Infer capabilities from discovered endpoints.
 */
function inferCapabilities(endpoints: EndpointInfo[]): string[] {
  const caps: string[] = [];
  for (const ep of endpoints) {
    const path = ep.url.toLowerCase();
    if (/search|query|find/.test(path) && !caps.includes('search')) caps.push('search');
    if (/hot|trending|popular/.test(path) && !caps.includes('hot')) caps.push('hot');
    if (/feed|timeline|home/.test(path) && !caps.includes('feed')) caps.push('feed');
    if (/detail|item\/\{|article\/\{|post\/\{/.test(ep.pattern) && !caps.includes('detail')) caps.push('detail');
    if (/comment|reply|discuss/.test(path) && !caps.includes('comments')) caps.push('comments');
    if (/user|profile|me\b|account/.test(path) && !caps.includes('me')) caps.push('me');
    if (/favorite|bookmark|saved|like/.test(path) && !caps.includes('favorites')) caps.push('favorites');
    if (/history|watch|read/.test(path) && !caps.includes('history')) caps.push('history');
  }
  return caps;
}

/**
 * Smart auto-scroll with MutationObserver-based lazy-load detection.
 * Waits for new DOM nodes to appear after each scroll instead of fixed delays.
 */
async function smartAutoScroll(page: IPage, attempts: number): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const scrolled = await page.evaluate<boolean>(`
      (async () => {
        const lastHeight = document.body.scrollHeight;
        window.scrollTo(0, lastHeight);

        // Wait for new content via MutationObserver or timeout
        const result = await new Promise((resolve) => {
          let timeoutId;
          const observer = new MutationObserver(() => {
            if (document.body.scrollHeight > lastHeight) {
              clearTimeout(timeoutId);
              observer.disconnect();
              setTimeout(() => resolve(true), 100);
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          timeoutId = setTimeout(() => { observer.disconnect(); resolve(false); }, 2000);
        });
        return result;
      })()
    `);
    if (!scrolled) break; // No new content loaded, stop scrolling
  }
}

/**
 * Interactive fuzzing — click buttons/tabs to trigger hidden API calls.
 * Clicks up to maxButtons interactive elements that look like data triggers.
 */
async function interactiveFuzz(page: IPage, maxButtons: number): Promise<void> {
  await page.evaluate(`
    (async () => {
      const clickTargets = [];
      const selectors = [
        'button:not([disabled])',
        '[role="tab"]',
        '[role="button"]',
        '.tab', '.nav-link', '.dropdown-toggle',
        'a[data-toggle]', '[data-bs-toggle]',
      ];

      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 &&
              rect.top >= 0 && rect.top < window.innerHeight * 2) {
            const text = el.textContent?.trim()?.slice(0, 40) || '';
            // Skip destructive-looking buttons
            if (/delete|remove|logout|sign.?out|cancel|close/i.test(text)) continue;
            clickTargets.push(el);
          }
        }
      }

      // Click up to N targets with delays
      const max = Math.min(${maxButtons}, clickTargets.length);
      for (let i = 0; i < max; i++) {
        try {
          clickTargets[i].click();
          await new Promise(r => setTimeout(r, 800));
        } catch {}
      }
    })()
  `);
  await page.wait(1.5);
}

/**
 * Re-fetch JSON endpoints whose response body was missing from interception.
 * Uses an iframe to avoid CORS issues (same-origin cookies).
 */
async function recoverMissingBodies(
  page: IPage,
  endpoints: EndpointInfo[],
): Promise<void> {
  const needsRecovery = endpoints.filter(
    (ep) => !ep.hasItems && ep.contentType.includes('json') && ep.score > 5,
  );

  if (needsRecovery.length === 0) return;

  const urls = needsRecovery.map((ep) => ep.url).slice(0, 8);

  const bodies = await page.evaluate<(unknown | null)[]>(`
    (async () => {
      const urls = ${JSON.stringify(urls)};
      const results = [];
      for (const url of urls) {
        try {
          const resp = await fetch(url, { credentials: 'include' });
          if (resp.ok) {
            const json = await resp.json();
            results.push(json);
          } else {
            results.push(null);
          }
        } catch { results.push(null); }
      }
      return results;
    })()
  `);

  if (!bodies) return;

  for (let i = 0; i < urls.length; i++) {
    if (!bodies[i]) continue;
    const ep = needsRecovery[i];
    const analysis = analyzeResponseBody(bodies[i]);
    if (analysis.hasItems) {
      ep.hasItems = analysis.hasItems;
      ep.itemCount = analysis.itemCount;
      ep.fields = analysis.fields;
      ep.fieldRoles = analysis.fieldRoles;
      ep.score = scoreEndpoint(ep);
    }
  }
}

/**
 * Write exploration artifacts to disk.
 */
function writeArtifacts(dir: string, result: ExploreResult): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // manifest.json — site metadata
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    site: result.site,
    domain: result.domain,
    framework: result.framework,
    strategy: result.strategy,
    capabilities: result.capabilities,
    endpointCount: result.endpoints.length,
    exploredAt: new Date().toISOString(),
  }, null, 2));

  // endpoints.json — all discovered endpoints with scores/fields
  writeFileSync(join(dir, 'endpoints.json'), JSON.stringify(
    result.endpoints.map((ep) => ({
      url: ep.url,
      pattern: ep.pattern,
      method: ep.method,
      status: ep.status,
      score: ep.score,
      hasItems: ep.hasItems,
      itemCount: ep.itemCount,
      fields: ep.fields,
      fieldRoles: ep.fieldRoles,
      queryParams: ep.queryParams,
      authIndicators: ep.authIndicators,
    })),
    null, 2,
  ));

  // capabilities.json — inferred CLI commands
  writeFileSync(join(dir, 'capabilities.json'), JSON.stringify(
    result.capabilities.map((cap) => {
      const matchingEndpoints = result.endpoints.filter((ep) => {
        const path = ep.url.toLowerCase();
        if (cap === 'search') return /search|query|find/.test(path);
        if (cap === 'hot') return /hot|trending|popular/.test(path);
        if (cap === 'feed') return /feed|timeline|home/.test(path);
        return false;
      });
      return {
        name: cap,
        description: `${cap} capability`,
        endpoint: matchingEndpoints[0]?.pattern || null,
        strategy: result.strategy,
        confidence: matchingEndpoints.length > 0 ? 0.8 : 0.5,
        recommendedColumns: matchingEndpoints[0]?.fields?.slice(0, 6) || [],
      };
    }),
    null, 2,
  ));

  // auth.json — auth indicators
  const authSummary: Record<string, string[]> = {};
  for (const ep of result.endpoints) {
    for (const ind of ep.authIndicators) {
      if (!authSummary[ind]) authSummary[ind] = [];
      authSummary[ind].push(ep.pattern);
    }
  }
  writeFileSync(join(dir, 'auth.json'), JSON.stringify(authSummary, null, 2));

  // stores.json — Vue/React stores if detected
  if (result.stores && result.stores.length > 0) {
    writeFileSync(join(dir, 'stores.json'), JSON.stringify(result.stores, null, 2));
  }

  log.success(`Artifacts written to ${dir}/`);
}

export async function exploreSite(
  page: IPage,
  url: string,
  options?: ExploreOptions,
): Promise<ExploreResult> {
  const parsedUrl = new URL(url);
  const domain = parsedUrl.hostname;
  const site = SITE_ALIASES[domain] || domain.replace(/^www\./, '').split('.')[0];

  log.info(`Exploring ${url}...`);

  // Install network interceptor before navigation
  await page.installInterceptor('');
  await page.goto(url);
  await page.wait(options?.wait || 3);

  // Smart auto-scroll with MutationObserver lazy-load detection
  if (options?.scroll !== false) {
    log.debug('Smart auto-scrolling to trigger lazy-loaded APIs...');
    await smartAutoScroll(page, options?.scrollAttempts || 4);
  }

  // Interactive fuzzing — click buttons/tabs to discover hidden APIs
  if (options?.fuzz !== false) {
    log.debug('Fuzzing interactive elements...');
    await interactiveFuzz(page, options?.maxButtons || 12);
  }

  // Capture intercepted network requests
  const rawRequests = await page.getInterceptedRequests();

  // Analyze each request
  const seen = new Set<string>();
  const endpoints: EndpointInfo[] = [];

  for (const raw of rawRequests as any[]) {
    if (!raw?.url || !raw?.status) continue;
    if (raw.status < 200 || raw.status >= 400) continue;

    const pattern = normalizeUrlPattern(raw.url);
    const dedupeKey = `${raw.method || 'GET'}:${pattern}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // Extract query params
    let queryParams: string[] = [];
    try {
      const u = new URL(raw.url);
      queryParams = [...u.searchParams.keys()].filter((k) => !VOLATILE_PARAMS.has(k));
    } catch {}

    const authIndicators = detectAuth(raw.url);
    const bodyAnalysis = analyzeResponseBody(raw.body);

    const ep: Omit<EndpointInfo, 'score'> = {
      url: raw.url,
      pattern,
      method: raw.method || 'GET',
      status: raw.status,
      contentType: 'json',
      queryParams,
      ...bodyAnalysis,
      authIndicators,
    };

    endpoints.push({ ...ep, score: scoreEndpoint(ep) });
  }

  // Response body recovery — re-fetch endpoints that had missing bodies
  log.debug('Recovering missing response bodies...');
  await recoverMissingBodies(page, endpoints);

  endpoints.sort((a, b) => b.score - a.score);

  // Detect framework
  const framework = await page.evaluate<string>(`
    (() => {
      const app = document.querySelector('#app');
      if (window.__NEXT_DATA__) return 'nextjs';
      if (window.__NUXT__) return 'nuxt';
      if (app && app.__vue_app__) {
        const gp = app.__vue_app__.config?.globalProperties;
        if (gp?.$pinia) return 'vue+pinia';
        if (gp?.$store) return 'vue+vuex';
        return 'vue';
      }
      if (app && app.__vue__) return 'vue2';
      if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) return 'react';
      if (document.querySelector('[data-reactroot]') || document.querySelector('#__next') || document.querySelector('#root')?.['_reactRootContainer']) return 'react';
      if (window.angular || document.querySelector('[ng-version]')) return 'angular';
      if (window.__svelte_meta) return 'svelte';
      return 'unknown';
    })()
  `).catch(() => 'unknown');

  // Detect stores (Pinia/Vuex) — improved detection via __vue_app__
  const stores = await page.evaluate<{ name: string; type: string; actions: string[] }[]>(`
    (() => {
      const results = [];
      const app = document.querySelector('#app');

      // Pinia via __vue_app__
      if (app && app.__vue_app__) {
        try {
          const pinia = app.__vue_app__.config?.globalProperties?.$pinia;
          if (pinia && pinia._s) {
            pinia._s.forEach((store, id) => {
              const actions = Object.keys(store).filter(k =>
                typeof store[k] === 'function' && !k.startsWith('$') && !k.startsWith('_')
              );
              const stateKeys = Object.keys(store).filter(k =>
                typeof store[k] !== 'function' && !k.startsWith('$') && !k.startsWith('_')
              );
              results.push({ name: id, type: 'pinia', actions: actions.slice(0, 20), stateKeys: stateKeys.slice(0, 20) });
            });
          }
        } catch {}

        // Vuex via __vue_app__
        try {
          const store = app.__vue_app__.config?.globalProperties?.$store;
          if (store && store._actions) {
            const actions = Object.keys(store._actions);
            results.push({ name: 'vuex', type: 'vuex', actions: actions.slice(0, 20) });
          }
        } catch {}
      }

      // Legacy Pinia global
      if (results.length === 0 && window.__pinia) {
        try {
          const pinia = window.__pinia;
          for (const [id, store] of pinia._s || []) {
            const actions = Object.keys(store).filter(k => typeof store[k] === 'function' && !k.startsWith('$') && !k.startsWith('_'));
            results.push({ name: id, type: 'pinia', actions: actions.slice(0, 20) });
          }
        } catch {}
      }

      return results;
    })()
  `).catch(() => []);

  // Infer strategy
  let strategy = 'public';
  if (endpoints.length > 0) {
    const topEp = endpoints[0];
    if (topEp.authIndicators.includes('signature')) strategy = 'intercept';
    else if (topEp.authIndicators.includes('bearer') || topEp.authIndicators.includes('csrf')) strategy = 'header';
    else if (endpoints.some((e) => !e.hasItems) && endpoints.some((e) => e.hasItems)) strategy = 'cookie';
  } else {
    strategy = 'cookie';
  }

  const capabilities = inferCapabilities(endpoints);

  const result: ExploreResult = {
    site,
    domain,
    endpoints: endpoints.slice(0, 30),
    strategy,
    framework,
    stores: stores.length > 0 ? stores : undefined,
    capabilities,
  };

  // Write artifacts to disk if outputDir specified
  const outputDir = options?.outputDir || join(process.cwd(), '.lobster', 'explore', site);
  writeArtifacts(outputDir, result);
  result.artifactDir = outputDir;

  return result;
}
