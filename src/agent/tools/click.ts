import { z } from 'zod';
import type { AgentTool } from '../../types/agent.js';
import type { IPage } from '../../types/page.js';

const DEFAULT_DANGEROUS_KEYWORDS = [
  'send', 'post', 'submit', 'delete', 'remove', 'publish',
  'confirm', 'connect', 'pay', 'purchase', 'buy', 'order',
  'approve', 'block', 'report', 'sign up', 'subscribe',
  'unsubscribe', 'cancel', 'deactivate', 'close account',
];

export interface ClickToolOptions {
  confirmBeforeIrreversible?: boolean;
  dangerousKeywords?: string[];
  onConfirm?: (question: string) => Promise<string>;
}

export function createClickTool(page: IPage, options?: ClickToolOptions): AgentTool {
  const shouldConfirm = options?.confirmBeforeIrreversible ?? true;
  const keywords = options?.dangerousKeywords ?? DEFAULT_DANGEROUS_KEYWORDS;
  const onConfirm = options?.onConfirm;

  return {
    description: 'Click on an interactive element by its index number from the page content.',
    inputSchema: z.object({
      index: z.number().describe('The index of the element to click'),
    }),
    execute: async (args) => {
      // Check for irreversible action before clicking
      if (shouldConfirm && onConfirm) {
        try {
          const elementInfo = await page.evaluate(`
            (() => {
              const el = document.querySelector('[data-ref="${args.index}"]');
              if (!el) return null;
              return {
                text: (el.textContent || '').trim(),
                ariaLabel: el.getAttribute('aria-label') || '',
                tagName: el.tagName.toLowerCase(),
                type: el.getAttribute('type') || '',
              };
            })()
          `) as { text: string; ariaLabel: string; tagName: string; type: string } | null;

          if (elementInfo) {
            const combined = (elementInfo.text + ' ' + elementInfo.ariaLabel).toLowerCase();
            const matchedKeyword = keywords.find((kw) => combined.includes(kw));

            if (matchedKeyword) {
              const displayText = elementInfo.text.slice(0, 60) || elementInfo.ariaLabel.slice(0, 60) || elementInfo.tagName;
              const answer = await onConfirm(
                `About to click "${displayText}" (matched: "${matchedKeyword}"). This looks like an irreversible action. Proceed? (yes/no)`,
              );
              if (!answer.toLowerCase().includes('yes') && !answer.toLowerCase().startsWith('y')) {
                return `Click on [${args.index}] "${displayText}" cancelled by user.`;
              }
            }
          }
        } catch {
          // Element lookup failed — proceed with click anyway
        }
      }

      await page.click(args.index);
      return `Clicked element [${args.index}]`;
    },
  };
}
