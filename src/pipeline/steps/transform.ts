import type { PipelineContext } from '../../types/pipeline.js';
import { renderTemplate } from '../template.js';
import { registerStep } from '../registry.js';

registerStep('select', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  const path = renderTemplate(params, { args: ctx.args, data: ctx.data }) as string;
  const parts = path.split('.');
  let current: unknown = ctx.data;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
});

registerStep('map', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  if (!Array.isArray(ctx.data)) throw new Error('map requires array data');
  const template = params as Record<string, unknown>;
  return ctx.data.map((item, index) =>
    renderTemplate(template, { args: ctx.args, item, data: ctx.data, index })
  );
});

registerStep('filter', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  if (!Array.isArray(ctx.data)) throw new Error('filter requires array data');
  const expr = params as string;
  return ctx.data.filter((item, index) => {
    const result = renderTemplate(`\${{ ${expr} }}`, { args: ctx.args, item, data: ctx.data, index });
    return Boolean(result);
  });
});

registerStep('sort', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  if (!Array.isArray(ctx.data)) throw new Error('sort requires array data');
  const p = params as { by: string; order?: 'asc' | 'desc' };
  const sorted = [...ctx.data].sort((a, b) => {
    const va = (a as Record<string, unknown>)[p.by];
    const vb = (b as Record<string, unknown>)[p.by];
    if (typeof va === 'number' && typeof vb === 'number') return va - vb;
    return String(va).localeCompare(String(vb));
  });
  return p.order === 'desc' ? sorted.reverse() : sorted;
});

registerStep('limit', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  if (!Array.isArray(ctx.data)) return ctx.data;
  const n = renderTemplate(params, { args: ctx.args, data: ctx.data });
  return ctx.data.slice(0, Number(n) || 20);
});
