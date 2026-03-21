import { z } from 'zod';
import type { AgentTool } from '../../types/agent.js';
import type { IPage } from '../../types/page.js';

export function createSelectTool(page: IPage): AgentTool {
  return {
    description: 'Select an option from a dropdown/select element by its index.',
    inputSchema: z.object({
      index: z.number().describe('The index of the select element'),
      value: z.string().describe('The option text or value to select'),
    }),
    execute: async (args) => {
      await page.selectOption(args.index, args.value);
      return `Selected "${args.value}" in element [${args.index}]`;
    },
  };
}
