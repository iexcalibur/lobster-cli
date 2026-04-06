import type { AgentTool } from '../../types/agent.js';
import type { IPage } from '../../types/page.js';
import { createClickTool } from './click.js';
import { createTypeTool } from './type.js';
import { createScrollTool } from './scroll.js';
import { createSelectTool } from './select.js';
import { createWaitTool } from './wait.js';
import { createDoneTool } from './done.js';
import { createAskUserTool } from './ask-user.js';
import { createExecuteJsTool } from './execute-js.js';
import { createWaitForTool } from './wait-for.js';

export interface DefaultToolOptions {
  confirmBeforeIrreversible?: boolean;
  dangerousKeywords?: string[];
}

export function createDefaultTools(page: IPage, options?: DefaultToolOptions): Record<string, AgentTool> {
  const askUserTool = createAskUserTool();
  return {
    click_element_by_index: createClickTool(page, {
      confirmBeforeIrreversible: options?.confirmBeforeIrreversible ?? true,
      dangerousKeywords: options?.dangerousKeywords,
      onConfirm: async (question: string) => askUserTool.execute({ question }),
    }),
    input_text: createTypeTool(page),
    scroll: createScrollTool(page),
    select_dropdown_option: createSelectTool(page),
    wait: createWaitTool(),
    wait_for: createWaitForTool(page),
    done: createDoneTool(),
    ask_user: askUserTool,
    execute_javascript: createExecuteJsTool(page),
  };
}
