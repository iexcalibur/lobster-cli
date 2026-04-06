import { z } from 'zod';
import type { AgentTool } from '../../types/agent.js';
import type { IPage } from '../../types/page.js';

export function createWaitForTool(page: IPage): AgentTool {
  return {
    description:
      'Wait for a specific condition: an element to appear (CSS selector), ' +
      'a URL to match (regex pattern), or text to appear on the page. ' +
      'Use after clicking search buttons, submitting forms, or navigating.',
    inputSchema: z.object({
      type: z.enum(['element', 'url', 'text']).describe(
        'What to wait for: "element" (CSS selector), "url" (regex pattern), "text" (visible text)',
      ),
      value: z.string().describe(
        'CSS selector for element, regex pattern for URL, or text string for text',
      ),
      timeout: z.number().min(1).max(30).optional().default(10).describe(
        'Max seconds to wait (default 10)',
      ),
    }),
    execute: async (args) => {
      const timeoutMs = (args.timeout ?? 10) * 1000;

      try {
        switch (args.type) {
          case 'element':
            await page.waitForSelector(args.value, timeoutMs);
            return `Element "${args.value}" appeared on page`;

          case 'url':
            await page.waitForUrl(args.value, timeoutMs);
            return `URL matched pattern "${args.value}": ${await page.url()}`;

          case 'text':
            await page.wait({ text: args.value, timeout: timeoutMs });
            return `Text "${args.value}" found on page`;

          default:
            return `Unknown wait type: ${args.type}`;
        }
      } catch (err) {
        return `Timed out after ${args.timeout}s waiting for ${args.type}: "${args.value}"`;
      }
    },
  };
}
