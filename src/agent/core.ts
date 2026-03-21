import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IPage } from '../types/page.js';
import type {
  AgentConfig, AgentTool, ExecutionResult, HistoricalEvent,
  AgentStepEvent, ObservationEvent, AgentStatus,
  AgentEvent, AgentEventListener, AgentEventType,
} from '../types/agent.js';
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
  private _status: AgentStatus = 'idle';
  private listeners = new Map<AgentEventType, Set<AgentEventListener>>();
  private previousElementHashes = new Set<string>();
  private totalWaitTime = 0;

  constructor(page: IPage, config: AgentConfig) {
    this.page = page;
    this.config = config;
    this.llm = new LLM(config.llm);
  }

  // ── Event system ──
  on(event: AgentEventType, listener: AgentEventListener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  off(event: AgentEventType, listener: AgentEventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: AgentEvent): void {
    const listeners = this.listeners.get(event.type as AgentEventType);
    if (listeners) {
      for (const fn of listeners) {
        try { fn(event); } catch {}
      }
    }
  }

  get status(): AgentStatus { return this._status; }

  private setStatus(newStatus: AgentStatus): void {
    const prev = this._status;
    this._status = newStatus;
    this.emit({ type: 'statuschange', status: newStatus, previousStatus: prev });
  }

  private pushHistory(event: HistoricalEvent): void {
    this.history.push(event);
    this.emit({ type: 'historychange', history: this.history });
  }

  async execute(task: string, abortSignal?: AbortSignal): Promise<ExecutionResult> {
    this.setStatus('running');
    this.history = [];
    this.previousElementHashes.clear();
    this.totalWaitTime = 0;

    const maxSteps = this.config.maxSteps ?? 40;
    const stepDelay = this.config.stepDelay ?? 0.4;

    // Build tools
    const tools: Record<string, AgentTool> = {
      ...createDefaultTools(this.page),
      ...(this.config.customTools || {}),
    };
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
        this.setStatus('error');
        return { success: false, data: 'Aborted', history: this.history };
      }

      // ── Observe phase ──
      const browserState = await this.page.browserState().catch(() => ({
        url: '', title: '', viewportWidth: 0, viewportHeight: 0,
        pageWidth: 0, pageHeight: 0, scrollX: 0, scrollY: 0,
        scrollPercent: 0, pixelsAbove: 0, pixelsBelow: 0,
      }));

      const flatTree = await this.page.flatTree().catch(() => ({ rootId: '', map: {} }));
      const pageContent = flatTreeToString(flatTree);

      // ── New element tracking ──
      const currentHashes = new Set<string>();
      let newElementCount = 0;
      for (const node of Object.values(flatTree.map)) {
        if (node.isInteractive && node.highlightIndex !== undefined) {
          const hash = `${node.tagName}:${node.text || ''}:${JSON.stringify(node.attributes || {})}`;
          currentHashes.add(hash);
          if (!this.previousElementHashes.has(hash)) {
            newElementCount++;
          }
        }
      }
      this.previousElementHashes = currentHashes;

      // ── Build observations ──
      const observations: string[] = [];
      if (browserState.url !== lastURL && lastURL) {
        observations.push(`Navigated to ${browserState.url}`);
      }
      lastURL = browserState.url;

      if (newElementCount > 0 && step > 1) {
        observations.push(`${newElementCount} new interactive element(s) appeared`);
      }

      if (this.totalWaitTime > 3) {
        observations.push(`Total wait time: ${this.totalWaitTime.toFixed(1)}s — consider if page is still loading`);
      }

      if (step >= maxSteps - 5) {
        observations.push(`Warning: ${maxSteps - step} steps remaining`);
      }

      if (this.config.instructions?.getPageInstructions) {
        try {
          const pi = this.config.instructions.getPageInstructions(browserState.url);
          if (pi) observations.push(`Page instructions: ${pi}`);
        } catch {}
      }

      for (const obs of observations) {
        this.pushHistory({ type: 'observation', message: obs } as ObservationEvent);
        this.emit({ type: 'activity', kind: 'observation', message: obs, step });
      }

      // ── Assemble user prompt with browser state ──
      const userPrompt = assembleUserPrompt(
        task, pageContent, browserState, this.history, step, maxSteps,
      );

      // ── Think phase ──
      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      log.step(step, `Thinking... (${browserState.url})`);
      this.emit({ type: 'activity', kind: 'thinking', message: `Step ${step}: thinking`, step });

      if (this.config.onBeforeStep) await this.config.onBeforeStep(step);

      const startTime = Date.now();
      let result;
      try {
        result = await this.llm.invoke(messages, macroTool, abortSignal);
      } catch (err) {
        log.error(`LLM error at step ${step}: ${err}`);
        this.pushHistory({ type: 'error', error: String(err), step });
        this.emit({ type: 'activity', kind: 'error', message: String(err), step });
        continue;
      }
      const duration = Date.now() - startTime;

      // ── Act phase ──
      const args = result.toolCall.args;
      const action = (args.action || args) as Record<string, unknown>;
      const [actionName, actionInput] = Object.entries(action)[0] || ['unknown', {}];

      this.emit({ type: 'activity', kind: 'executing', message: actionName, step });

      // Track wait time
      if (actionName === 'wait') {
        const secs = (actionInput as any)?.seconds || 0;
        this.totalWaitTime += secs;
      }

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
      this.pushHistory(stepEvent);

      log.step(step, `Action: ${actionName} → ${result.toolResult.slice(0, 100)}`);
      this.emit({ type: 'activity', kind: 'executed', message: `${actionName}: ${result.toolResult.slice(0, 80)}`, step, duration });

      if (this.config.onAfterStep) await this.config.onAfterStep(this.history);

      // Check for done
      if (actionName === 'done') {
        try {
          const doneResult = JSON.parse(result.toolResult);
          this.setStatus('completed');
          return { success: doneResult.success, data: doneResult.text || result.toolResult, history: this.history };
        } catch {
          this.setStatus('completed');
          return { success: true, data: result.toolResult, history: this.history };
        }
      }

      if (stepDelay > 0) {
        await new Promise((r) => setTimeout(r, stepDelay * 1000));
      }
    }

    this.setStatus('error');
    return { success: false, data: `Reached maximum steps (${maxSteps})`, history: this.history };
  }
}

function assembleUserPrompt(
  task: string,
  pageContent: string,
  state: { url: string; title: string; viewportWidth: number; viewportHeight: number; pageHeight: number; scrollPercent: number; pixelsAbove: number; pixelsBelow: number },
  history: HistoricalEvent[],
  step: number,
  maxSteps: number,
): string {
  let prompt = `# Task\n${task}\n\n`;

  // Browser state header
  prompt += `# Current Page\n`;
  prompt += `URL: ${state.url}\n`;
  prompt += `Title: ${state.title}\n`;
  prompt += `Viewport: ${state.viewportWidth}x${state.viewportHeight} | Page height: ${state.pageHeight}px\n`;
  prompt += `Scroll: ${state.scrollPercent}%`;
  if (state.pixelsAbove > 50) prompt += ` | ${state.pixelsAbove}px above`;
  if (state.pixelsBelow > 50) prompt += ` | ${state.pixelsBelow}px below`;
  prompt += `\nStep: ${step}/${maxSteps}\n\n`;

  prompt += `# Browser State\n${pageContent}\n\n`;

  if (history.length > 0) {
    prompt += `# History\n`;
    const recent = history.slice(-10);
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
