import { z } from 'zod';
import type { AgentTool } from '../../types/agent.js';
import { createInterface } from 'node:readline';

export function createAskUserTool(): AgentTool {
  return {
    description: 'Ask the user a question when you need clarification or input to proceed.',
    inputSchema: z.object({
      question: z.string().describe('The question to ask the user'),
    }),
    execute: async (args) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      return new Promise<string>((resolve) => {
        rl.question(`\n🤖 Agent asks: ${args.question}\n> `, (answer) => {
          rl.close();
          resolve(`User answered: ${answer}`);
        });
      });
    },
  };
}
