import { z } from 'zod';
import type { AgentTool } from '../../types/agent.js';

export function createWaitTool(): AgentTool {
  return {
    description: 'Wait for a specified number of seconds before continuing.',
    inputSchema: z.object({
      seconds: z.number().min(0.1).max(30).describe('Seconds to wait'),
    }),
    execute: async (args) => {
      await new Promise((r) => setTimeout(r, args.seconds * 1000));
      return `Waited ${args.seconds} seconds`;
    },
  };
}
