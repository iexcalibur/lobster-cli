import type { IPage } from '../types/page.js';
import { log } from '../utils/logger.js';

export interface ExploreResult {
  site: string;
  domain: string;
  endpoints: EndpointInfo[];
  strategy: string;
  framework?: string;
}

export interface EndpointInfo {
  url: string;
  method: string;
  status: number;
  contentType: string;
  hasItems: boolean;
  score: number;
}

export async function exploreSite(page: IPage, url: string, options?: { wait?: number }): Promise<ExploreResult> {
  const parsedUrl = new URL(url);
  const domain = parsedUrl.hostname;
  const site = domain.replace(/^www\./, '').split('.')[0];

  log.info(`Exploring ${url}...`);
  await page.goto(url);
  await page.wait(options?.wait || 3);

  // Capture network requests
  const requests = await page.networkRequests(false);

  // Analyze endpoints
  const endpoints: EndpointInfo[] = [];
  for (const req of requests) {
    if (req.status < 200 || req.status >= 400) continue;
    if (!req.type.includes('json') && !req.type.includes('api')) continue;

    const score = scoreEndpoint(req);
    endpoints.push({
      url: req.url,
      method: req.method,
      status: req.status,
      contentType: req.type,
      hasItems: false,
      score,
    });
  }

  // Sort by score
  endpoints.sort((a, b) => b.score - a.score);

  // Detect framework
  const framework = await page.evaluate(`
    (() => {
      if (window.__NEXT_DATA__) return 'nextjs';
      if (window.__NUXT__) return 'nuxt';
      if (window.__vue_app__) return 'vue';
      if (document.querySelector('[data-reactroot]') || document.querySelector('#__next')) return 'react';
      if (window.angular) return 'angular';
      return 'unknown';
    })()
  `).catch(() => 'unknown');

  return {
    site,
    domain,
    endpoints: endpoints.slice(0, 20),
    strategy: endpoints.length > 0 ? 'public' : 'cookie',
    framework: framework as string,
  };
}

function scoreEndpoint(req: { url: string; method: string; type: string }): number {
  let score = 0;
  if (req.type.includes('json')) score += 10;
  if (req.url.includes('/api/')) score += 5;
  if (req.method === 'GET') score += 2;
  if (req.url.includes('search') || req.url.includes('list') || req.url.includes('hot') || req.url.includes('trending')) score += 5;
  // Penalize static assets
  if (req.url.includes('.js') || req.url.includes('.css') || req.url.includes('.png')) score -= 20;
  return score;
}
