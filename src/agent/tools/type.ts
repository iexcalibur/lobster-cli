import { z } from 'zod';
import type { AgentTool } from '../../types/agent.js';
import type { IPage } from '../../types/page.js';

export function createTypeTool(page: IPage): AgentTool {
  return {
    description: 'Type text into an input field identified by its index number.',
    inputSchema: z.object({
      index: z.number().describe('The index of the input element'),
      text: z.string().describe('The text to type'),
    }),
    execute: async (args) => {
      await page.typeText(args.index, args.text);
      return `Typed "${args.text}" into element [${args.index}]`;
    },
  };
}
