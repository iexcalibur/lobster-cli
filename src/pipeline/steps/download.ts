import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { PipelineContext } from '../../types/pipeline.js';
import { renderTemplate } from '../template.js';
import { registerStep } from '../registry.js';

registerStep('download', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  const p = params as { url?: string; dir?: string; filename?: string; concurrency?: number };
  const dir = (renderTemplate(p.dir || './downloads', { args: ctx.args, data: ctx.data }) as string);

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Single URL or array of URLs from data
  const urls: string[] = [];
  if (p.url) {
    urls.push(renderTemplate(p.url, { args: ctx.args, data: ctx.data }) as string);
  } else if (Array.isArray(ctx.data)) {
    for (const item of ctx.data) {
      const url = typeof item === 'string' ? item : (item as Record<string, unknown>).url as string;
      if (url) urls.push(url);
    }
  }

  const results: { url: string; file: string; success: boolean }[] = [];
  const concurrency = p.concurrency || 3;

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (url) => {
        try {
          const resp = await fetch(url);
          if (!resp.ok) {
            results.push({ url, file: '', success: false });
            return;
          }
          const buffer = Buffer.from(await resp.arrayBuffer());
          const filename = p.filename
            ? (renderTemplate(p.filename, { args: ctx.args, item: { url }, data: ctx.data, index: i }) as string)
            : basename(new URL(url).pathname) || 'download';
          const filepath = join(dir, filename);
          writeFileSync(filepath, buffer);
          results.push({ url, file: filepath, success: true });
        } catch {
          results.push({ url, file: '', success: false });
        }
      })
    );
  }

  return results;
});
