import { z } from 'zod';
import type { AgentTool } from '../../types/agent.js';

export function createDoneTool(): AgentTool {
  return {
    description: 'Signal that the task is complete. Call this when you have finished the task or cannot proceed further.',
    inputSchema: z.object({
      success: z.boolean().describe('Whether the task was completed successfully'),
      text: z.string().describe('Summary of the result or explanation of failure'),
    }),
    execute: async (args) => {
      return JSON.stringify({ done: true, success: args.success, text: args.text });
    },
  };
}
