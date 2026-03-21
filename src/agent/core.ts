import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IPage } from '../types/page.js';
import type { AgentConfig, AgentTool, ExecutionResult, HistoricalEvent, AgentStepEvent, ObservationEvent } from '../types/agent.js';
import { LLM } from '../llm/client.js';
import type { Message } from '../types/llm.js';
import { createDefaultTools } from './tools/index.js';
import { packMacroTool } from './macro-tool.js';
import { flatTreeToString } from '../browser/dom/flat-tree.js';
import { log } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class AgentCore {
  private page: IPage;
  private config: AgentConfig;
  private llm: LLM;
  private history: HistoricalEvent[] = [];
  private status: 'idle' | 'running' | 'completed' | 'error' = 'idle';

  constructor(page: IPage, config: AgentConfig) {
    this.page = page;
    this.config = config;
    this.llm = new LLM(config.llm);
  }

  async execute(task: string, abortSignal?: AbortSignal): Promise<ExecutionResult> {
    this.status = 'running';
    this.history = [];

    const maxSteps = this.config.maxSteps ?? 40;
    const stepDelay = this.config.stepDelay ?? 0.4;

    // Build tools
    const tools: Record<string, AgentTool> = {
      ...createDefaultTools(this.page),
      ...(this.config.customTools || {}),
    };

    // Remove nulled tools
    for (const [name, tool] of Object.entries(tools)) {
      if (tool === null) delete tools[name];
    }

    const macroTool = packMacroTool(tools as Record<string, AgentTool>);

    // Load system prompt
    let systemPrompt: string;
    try {
      systemPrompt = readFileSync(join(__dirname, 'prompts', 'system.md'), 'utf-8');
    } catch {
      systemPrompt = 'You are an AI web agent that navigates web pages to complete tasks.';
    }

    if (this.config.instructions?.system) {
      systemPrompt += '\n\n' + this.config.instructions.system;
    }

    let lastURL = '';

    for (let step = 1; step <= maxSteps; step++) {
      if (abortSignal?.aborted) {
        this.status = 'error';
        return { success: false, data: 'Aborted', history: this.history };
      }

      // Observe
      const currentURL = await this.page.url().catch(() => '');
      const flatTree = await this.page.flatTree().catch(() => ({ rootId: '', map: {} }));
      const pageContent = flatTreeToString(flatTree);
      const pageTitle = await this.page.title().catch(() => '');

      // Detect URL changes
      const observations: string[] = [];
      if (currentURL !== lastURL && lastURL) {
        observations.push(`Navigated from ${lastURL} to ${currentURL}`);
      }
      lastURL = currentURL;

      // Page instructions
      if (this.config.instructions?.getPageInstructions) {
        const pageInstructions = this.config.instructions.getPageInstructions(currentURL);
        if (pageInstructions) observations.push(`Page instructions: ${pageInstructions}`);
      }

      // Add observations to history
      for (const obs of observations) {
        this.history.push({ type: 'observation', message: obs } as ObservationEvent);
      }

      // Assemble user prompt
      const userPrompt = assembleUserPrompt(task, pageContent, currentURL, pageTitle, this.history, step, maxSteps);

      // Think
      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      log.step(step, `Thinking... (${currentURL})`);

      if (this.config.onBeforeStep) {
        await this.config.onBeforeStep(step);
      }

      const startTime = Date.now();
      let result;
      try {
        result = await this.llm.invoke(messages, macroTool, abortSignal);
      } catch (err) {
        log.error(`LLM error at step ${step}: ${err}`);
        this.history.push({ type: 'error', error: String(err), step });
        continue;
      }

      const duration = Date.now() - startTime;

      // Parse the action
      const args = result.toolCall.args;
      const action = (args.action || args) as Record<string, unknown>;
      const [actionName, actionInput] = Object.entries(action)[0] || ['unknown', {}];

      // Record step
      const stepEvent: AgentStepEvent = {
        type: 'step',
        step,
        reflection: {
          evaluation_previous_goal: (args.evaluation_previous_goal as string) || '',
          memory: (args.memory as string) || '',
          next_goal: (args.next_goal as string) || '',
        },
        action: { name: actionName, args: actionInput as Record<string, unknown> },
        output: result.toolResult,
        duration,
      };
      this.history.push(stepEvent);

      log.step(step, `Action: ${actionName} → ${result.toolResult.slice(0, 100)}`);

      if (this.config.onAfterStep) {
        await this.config.onAfterStep(this.history);
      }

      // Check for done
      if (actionName === 'done') {
        try {
          const doneResult = JSON.parse(result.toolResult);
          this.status = 'completed';
          return {
            success: doneResult.success,
            data: doneResult.text || result.toolResult,
            history: this.history,
          };
        } catch {
          this.status = 'completed';
          return { success: true, data: result.toolResult, history: this.history };
        }
      }

      // Step delay
      if (stepDelay > 0) {
        await new Promise((r) => setTimeout(r, stepDelay * 1000));
      }
    }

    this.status = 'error';
    return { success: false, data: `Reached maximum steps (${maxSteps})`, history: this.history };
  }
}

function assembleUserPrompt(
  task: string,
  pageContent: string,
  url: string,
  title: string,
  history: HistoricalEvent[],
  step: number,
  maxSteps: number
): string {
  let prompt = `# Task\n${task}\n\n`;
  prompt += `# Current Page\nURL: ${url}\nTitle: ${title}\nStep: ${step}/${maxSteps}\n\n`;
  prompt += `# Browser State\n${pageContent}\n\n`;

  if (history.length > 0) {
    prompt += `# History\n`;
    const recent = history.slice(-10); // Last 10 events
    for (const event of recent) {
      if (event.type === 'step') {
        const s = event as AgentStepEvent;
        prompt += `<step_${s.step}>\n`;
        if (s.reflection) {
          prompt += `  eval: ${s.reflection.evaluation_previous_goal}\n`;
          prompt += `  memory: ${s.reflection.memory}\n`;
          prompt += `  goal: ${s.reflection.next_goal}\n`;
        }
        prompt += `  action: ${s.action.name}(${JSON.stringify(s.action.args)})\n`;
        prompt += `  result: ${s.output.slice(0, 200)}\n`;
        prompt += `</step_${s.step}>\n`;
      } else if (event.type === 'observation') {
        prompt += `<sys>${(event as ObservationEvent).message}</sys>\n`;
      }
    }
  }

  return prompt;
}
