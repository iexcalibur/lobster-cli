import { z } from 'zod';
import type { AgentTool } from '../../types/agent.js';
import type { IPage } from '../../types/page.js';

export function createExecuteJsTool(page: IPage): AgentTool {
  return {
    description: 'Execute JavaScript code on the current page. Returns the result.',
    inputSchema: z.object({
      code: z.string().describe('JavaScript code to execute on the page'),
    }),
    execute: async (args) => {
      const result = await page.evaluate(args.code);
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    },
  };
}
