import type { PipelineContext } from '../../types/pipeline.js';
import { renderTemplate } from '../template.js';
import { registerStep } from '../registry.js';

registerStep('fetch', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  const data = ctx.data;

  // Single URL fetch
  if (typeof params === 'string') {
    const url = renderTemplate(params, { args: ctx.args, data }) as string;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  // Object with url + options
  if (typeof params === 'object' && params !== null) {
    const p = params as Record<string, unknown>;
    const url = renderTemplate(p.url, { args: ctx.args, data }) as string;
    const headers = p.headers ? renderTemplate(p.headers, { args: ctx.args, data }) as Record<string, string> : {};
    const method = (p.method as string) || 'GET';

    const resp = await fetch(url, { method, headers });
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  throw new Error('Invalid fetch params');
});
