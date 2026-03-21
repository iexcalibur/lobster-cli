import type { IPage } from '../types/page.js';
import type { PipelineContext, PipelineStepDef } from '../types/pipeline.js';
import { getStep } from './registry.js';
import { log } from '../utils/logger.js';

export async function executePipeline(
  steps: PipelineStepDef[],
  page: IPage | null,
  args: Record<string, unknown>,
  debug = false
): Promise<unknown> {
  const ctx: PipelineContext = { page, args, data: null, debug };

  for (let i = 0; i < steps.length; i++) {
    const stepDef = steps[i];
    const [stepName, params] = Object.entries(stepDef)[0];

    const handler = getStep(stepName);
    if (!handler) {
      throw new Error(`Unknown pipeline step: ${stepName}`);
    }

    if (debug) {
      log.step(i + 1, `${stepName}`);
    }

    ctx.data = await handler(ctx, params);

    if (debug && ctx.data !== undefined) {
      const preview = JSON.stringify(ctx.data)?.slice(0, 200);
      log.dim(`  → ${preview}...`);
    }
  }

  return ctx.data;
}
