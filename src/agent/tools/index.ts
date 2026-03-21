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

export function createDefaultTools(page: IPage): Record<string, AgentTool> {
  return {
    click_element_by_index: createClickTool(page),
    input_text: createTypeTool(page),
    scroll: createScrollTool(page),
    select_dropdown_option: createSelectTool(page),
    wait: createWaitTool(),
    done: createDoneTool(),
    ask_user: createAskUserTool(),
    execute_javascript: createExecuteJsTool(page),
  };
}
