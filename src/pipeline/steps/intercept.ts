import type { PipelineContext } from '../../types/pipeline.js';
import { renderTemplate } from '../template.js';
import { registerStep } from '../registry.js';

registerStep('intercept', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  if (!ctx.page) throw new Error('Browser page required for intercept step');
  const p = params as { pattern: string; trigger?: string; select?: string; timeout?: number };
  const pattern = renderTemplate(p.pattern, { args: ctx.args, data: ctx.data }) as string;

  await ctx.page.installInterceptor(pattern);

  // Trigger action
  if (p.trigger) {
    const trigger = renderTemplate(p.trigger, { args: ctx.args, data: ctx.data }) as string;
    const [action, value] = trigger.split(':');
    switch (action) {
      case 'navigate': await ctx.page.goto(value); break;
      case 'click': await ctx.page.click(value); break;
      case 'evaluate': await ctx.page.evaluate(value); break;
      case 'scroll': await ctx.page.scroll('down'); break;
    }
  }

  // Wait for intercepted requests
  const timeout = p.timeout || 10;
  await ctx.page.wait(timeout);

  const requests = await ctx.page.getInterceptedRequests();
  if (requests.length === 0) return ctx.data;

  let result: unknown = requests.map((r: any) => r.body);
  if (result && Array.isArray(result) && result.length === 1) result = result[0];

  // Optional sub-selection
  if (p.select && result) {
    const parts = p.select.split('.');
    let current: unknown = result;
    for (const part of parts) {
      if (current && typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      }
    }
    result = current;
  }

  return result;
});
