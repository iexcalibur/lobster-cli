import { z } from 'zod';
import type { AgentTool } from '../types/agent.js';
import type { MacroTool } from '../llm/client.js';
import { normalizeResponse } from './auto-fixer.js';

export function packMacroTool(
  tools: Record<string, AgentTool>
): MacroTool {
  // Build the action union schema
  const actionSchemas: z.ZodTypeAny[] = [];
  const toolNames: string[] = [];

  for (const [name, tool] of Object.entries(tools)) {
    toolNames.push(name);
    actionSchemas.push(
      z.object({ [name]: tool.inputSchema }).describe(tool.description)
    );
  }

  const actionSchema = actionSchemas.length === 1
    ? actionSchemas[0]
    : z.union(actionSchemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);

  const macroSchema = z.object({
    evaluation_previous_goal: z.string().optional().describe('Evaluate whether the previous goal was achieved'),
    memory: z.string().optional().describe('Important information to remember for future steps'),
    next_goal: z.string().optional().describe('The next immediate goal to achieve'),
    action: actionSchema.describe('The action to take'),
  });

  return {
    name: 'AgentOutput',
    description: 'The agent\'s output containing reflection and action. Must be called every step.',
    schema: macroSchema,
    execute: async (args: Record<string, unknown>) => {
      // Normalize messy LLM output
      const normalized = normalizeResponse(args, 'AgentOutput', toolNames);
      const action = normalized.action as Record<string, unknown>;

      // Find the tool to execute
      const [toolName, toolInput] = Object.entries(action)[0];
      const tool = tools[toolName];

      if (!tool) {
        return `Error: Unknown tool "${toolName}". Available: ${toolNames.join(', ')}`;
      }

      try {
        const result = await tool.execute(toolInput as any);
        return result;
      } catch (err) {
        return `Error executing ${toolName}: ${err}`;
      }
    },
  };
}
