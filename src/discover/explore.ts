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

export async function exploreSite(
  page: IPage,
  url: string,
  options?: { wait?: number; scroll?: boolean },
): Promise<ExploreResult> {
  const parsedUrl = new URL(url);
  const domain = parsedUrl.hostname;
  const site = SITE_ALIASES[domain] || domain.replace(/^www\./, '').split('.')[0];

  log.info(`Exploring ${url}...`);

  // Install network interceptor before navigation
  await page.installInterceptor('');
  await page.goto(url);
  await page.wait(options?.wait || 3);

  // Optional scroll to trigger lazy-loaded APIs
  if (options?.scroll !== false) {
    await page.scroll('down', 800);
    await page.wait(1);
    await page.scroll('down', 800);
    await page.wait(1);
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

  endpoints.sort((a, b) => b.score - a.score);

  // Detect framework
  const framework = await page.evaluate<string>(`
    (() => {
      if (window.__NEXT_DATA__) return 'nextjs';
      if (window.__NUXT__) return 'nuxt';
      if (window.__vue_app__) return 'vue';
      if (window.__pinia) return 'vue+pinia';
      if (window.__VUEX__) return 'vue+vuex';
      if (document.querySelector('[data-reactroot]') || document.querySelector('#__next') || document.querySelector('#root')?.['_reactRootContainer']) return 'react';
      if (window.angular || document.querySelector('[ng-version]')) return 'angular';
      if (window.__svelte_meta) return 'svelte';
      return 'unknown';
    })()
  `).catch(() => 'unknown');

  // Detect stores (Pinia/Vuex)
  const stores = await page.evaluate<{ name: string; type: string; actions: string[] }[]>(`
    (() => {
      const results = [];
      // Pinia
      if (window.__pinia) {
        try {
          const pinia = window.__pinia;
          for (const [id, store] of pinia._s || []) {
            const actions = Object.keys(store).filter(k => typeof store[k] === 'function' && !k.startsWith('$') && !k.startsWith('_'));
            results.push({ name: id, type: 'pinia', actions: actions.slice(0, 20) });
          }
        } catch {}
      }
      // Vuex
      if (window.__VUEX__) {
        try {
          const store = window.__VUEX__;
          const actions = Object.keys(store._actions || {});
          results.push({ name: 'vuex', type: 'vuex', actions: actions.slice(0, 20) });
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

  return {
    site,
    domain,
    endpoints: endpoints.slice(0, 30),
    strategy,
    framework,
    stores: stores.length > 0 ? stores : undefined,
    capabilities,
  };
}
