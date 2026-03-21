import { z } from 'zod';
import type { AgentTool } from '../../types/agent.js';
import type { IPage } from '../../types/page.js';

export function createClickTool(page: IPage): AgentTool {
  return {
    description: 'Click on an interactive element by its index number from the page content.',
    inputSchema: z.object({
      index: z.number().describe('The index of the element to click'),
    }),
    execute: async (args) => {
      await page.click(args.index);
      return `Clicked element [${args.index}]`;
    },
  };
}
