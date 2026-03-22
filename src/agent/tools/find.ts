/**
 * Agent tool: find_element — find interactive elements by natural language.
 *
 * Instead of guessing index numbers, the agent can say:
 *   find_element({ query: "login button" })
 * And get back:
 *   [3] button "Log In" (score: 0.87)
 *   [7] link "Sign In" (score: 0.65)
 */

import type { IPage } from '../../types/page.js';

export function createFindTool(page: IPage) {
  return {
    name: 'find_element',
    description: 'Find an interactive element by natural language description instead of index number. Returns the best matching elements with their ref indices for use with click_element_by_index or input_text.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string' as const,
          description: 'Natural language description of the element, e.g. "login button", "search input", "submit form", "email field"',
        },
      },
      required: ['query'] as const,
    },
    execute: async (args: unknown) => {
      const { query } = args as { query: string };
      const matches = await page.find(query);

      if (matches.length === 0) {
        return 'No matching elements found for "' + query + '". Try a different description or use the DOM snapshot to find the element index.';
      }

      const lines = matches.map(
        (m) => `[${m.ref}] ${m.role} "${m.text}" (score: ${m.score.toFixed(2)})`
      );

      return 'Found ' + matches.length + ' match(es):\n' + lines.join('\n');
    },
  };
}
