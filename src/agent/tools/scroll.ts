import { z } from 'zod';
import type { AgentTool } from '../../types/agent.js';
import type { IPage } from '../../types/page.js';

export function createScrollTool(page: IPage): AgentTool {
  return {
    description: 'Scroll the page in a given direction. Use to reveal more content.',
    inputSchema: z.object({
      direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction'),
      amount: z.number().optional().describe('Pixels to scroll (default 500)'),
    }),
    execute: async (args) => {
      await page.scroll(args.direction, args.amount);
      return `Scrolled ${args.direction}${args.amount ? ` ${args.amount}px` : ''}`;
    },
  };
}
