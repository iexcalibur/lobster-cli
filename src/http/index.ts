export interface HttpResult {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
  contentType: string;
}

export async function directFetch(url: string, options?: {
  method?: string;
  headers?: Record<string, string>;
  timeout?: number;
}): Promise<HttpResult> {
  const controller = new AbortController();
  const timeout = options?.timeout || 30000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(url, {
      method: options?.method || 'GET',
      headers: options?.headers,
      signal: controller.signal,
      redirect: 'follow',
    });

    const contentType = resp.headers.get('content-type') || '';
    const headers: Record<string, string> = {};
    resp.headers.forEach((v, k) => { headers[k] = v; });

    let body: unknown;
    if (contentType.includes('json')) {
      body = await resp.json();
    } else {
      body = await resp.text();
    }

    return { url, status: resp.status, headers, body, contentType };
  } finally {
    clearTimeout(timer);
  }
}

export async function batchFetch(urls: string[], concurrency = 5): Promise<HttpResult[]> {
  const results: HttpResult[] = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((url) => directFetch(url).catch((err) => ({
        url, status: 0, headers: {}, body: `Error: ${err}`, contentType: 'text/plain'
      } as HttpResult)))
    );
    results.push(...batchResults);
  }

  return results;
}
