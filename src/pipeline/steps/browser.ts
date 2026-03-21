import type { PipelineContext } from '../../types/pipeline.js';
import { renderTemplate } from '../template.js';
import { registerStep } from '../registry.js';

registerStep('navigate', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  if (!ctx.page) throw new Error('Browser page required for navigate step');
  const url = renderTemplate(params, { args: ctx.args, data: ctx.data }) as string;
  await ctx.page.goto(url);
  return ctx.data;
});

registerStep('click', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  if (!ctx.page) throw new Error('Browser page required for click step');
  const ref = renderTemplate(params, { args: ctx.args, data: ctx.data });
  await ctx.page.click(ref as string | number);
  return ctx.data;
});

registerStep('type', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  if (!ctx.page) throw new Error('Browser page required for type step');
  const p = renderTemplate(params, { args: ctx.args, data: ctx.data }) as Record<string, unknown>;
  await ctx.page.typeText(p.ref as string | number, p.text as string);
  if (p.submit) await ctx.page.pressKey('Enter');
  return ctx.data;
});

registerStep('wait', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  if (!ctx.page) throw new Error('Browser page required for wait step');
  const rendered = renderTemplate(params, { args: ctx.args, data: ctx.data });
  if (typeof rendered === 'number') {
    await ctx.page.wait(rendered);
  } else {
    await ctx.page.wait(rendered as { text?: string; time?: number; timeout?: number });
  }
  return ctx.data;
});

registerStep('press', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  if (!ctx.page) throw new Error('Browser page required for press step');
  const key = renderTemplate(params, { args: ctx.args, data: ctx.data }) as string;
  await ctx.page.pressKey(key);
  return ctx.data;
});

registerStep('snapshot', async (ctx: PipelineContext, _params: unknown): Promise<unknown> => {
  if (!ctx.page) throw new Error('Browser page required for snapshot step');
  return ctx.page.snapshot();
});

registerStep('evaluate', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  if (!ctx.page) throw new Error('Browser page required for evaluate step');
  const js = renderTemplate(params, { args: ctx.args, data: ctx.data }) as string;
  const result = await ctx.page.evaluate(js);
  // Auto-parse JSON strings
  if (typeof result === 'string') {
    try { return JSON.parse(result); } catch { return result; }
  }
  return result;
});
