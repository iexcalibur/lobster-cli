/**
 * Pipeline step: fetch — HTTP API requests with batch IPC optimization.
 *
 * When data is an array and URL references `item`, all per-item fetches
 * are batched into a single browser evaluate() call — eliminating N-1
 * cross-process IPC round trips.
 */

import type { PipelineContext } from '../../types/pipeline.js';
import { renderTemplate } from '../template.js';
import { registerStep } from '../registry.js';

/**
 * Batch fetch: send all URLs into the browser as a single evaluate() call.
 * All fetches execute inside V8, results return as one JSON array.
 */
async function fetchBatchInBrowser(
  page: NonNullable<PipelineContext['page']>,
  urls: string[],
  method: string,
  headers: Record<string, string>,
  concurrency: number,
): Promise<unknown[]> {
  const headersJs = JSON.stringify(headers);
  const urlsJs = JSON.stringify(urls);

  return page.evaluate<unknown[]>(`
    (async () => {
      const urls = ${urlsJs};
      const method = ${JSON.stringify(method)};
      const headers = ${headersJs};
      const concurrency = ${concurrency};

      const results = new Array(urls.length);
      let idx = 0;

      async function worker() {
        while (idx < urls.length) {
          const i = idx++;
          try {
            const resp = await fetch(urls[i], { method, headers, credentials: "include" });
            results[i] = await resp.json();
          } catch (e) {
            results[i] = { error: e.message };
          }
        }
      }

      const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
      await Promise.all(workers);
      return results;
    })()
  `);
}

/**
 * Concurrent pool for non-browser fetches.
 */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Single URL fetch — browser or direct.
 */
async function fetchSingle(
  page: PipelineContext['page'],
  url: string,
  method: string,
  headers: Record<string, string>,
): Promise<unknown> {
  if (page) {
    const headersJs = JSON.stringify(headers);
    const urlJs = JSON.stringify(url);
    const methodJs = JSON.stringify(method);
    return page.evaluate(`
      (async () => {
        const resp = await fetch(${urlJs}, {
          method: ${methodJs}, headers: ${headersJs}, credentials: "include"
        });
        return await resp.json();
      })()
    `);
  }

  const resp = await fetch(url, { method, headers });
  return resp.json();
}

registerStep('fetch', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  const data = ctx.data;
  const urlOrObj = typeof params === 'string' ? params : ((params as any)?.url ?? '');
  const method = ((params as any)?.method as string) || 'GET';
  const rawHeaders: Record<string, unknown> = (params as any)?.headers ?? {};
  const rawParams: Record<string, unknown> = (params as any)?.params ?? {};
  const urlTemplate = String(urlOrObj);

  // Render headers
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    headers[k] = String(renderTemplate(v, { args: ctx.args, data }));
  }

  // Per-item batch fetch when data is array and URL references `item`
  if (Array.isArray(data) && urlTemplate.includes('item')) {
    const concurrency = typeof (params as any)?.concurrency === 'number'
      ? (params as any).concurrency : 5;

    // Render all URLs upfront
    const renderedParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawParams)) {
      renderedParams[k] = String(renderTemplate(v, { args: ctx.args, data }));
    }

    const urls = data.map((item: unknown, index: number) => {
      let url = String(renderTemplate(urlTemplate, { args: ctx.args, data, item, index }));
      if (Object.keys(renderedParams).length > 0) {
        const qs = new URLSearchParams(renderedParams).toString();
        url = `${url}${url.includes('?') ? '&' : '?'}${qs}`;
      }
      return url;
    });

    // BATCH IPC: if browser available, run all fetches in a single evaluate()
    if (ctx.page) {
      return fetchBatchInBrowser(ctx.page, urls, method.toUpperCase(), headers, concurrency);
    }

    // Non-browser: concurrent pool
    return mapConcurrent(urls, concurrency, async (url) => {
      return fetchSingle(null, url, method.toUpperCase(), headers);
    });
  }

  // Single URL fetch
  let url = String(renderTemplate(urlOrObj, { args: ctx.args, data }));

  // Append query params
  const renderedParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawParams)) {
    renderedParams[k] = String(renderTemplate(v, { args: ctx.args, data }));
  }
  if (Object.keys(renderedParams).length > 0) {
    const qs = new URLSearchParams(renderedParams).toString();
    url = `${url}${url.includes('?') ? '&' : '?'}${qs}`;
  }

  return fetchSingle(ctx.page, url, method.toUpperCase(), headers);
});
