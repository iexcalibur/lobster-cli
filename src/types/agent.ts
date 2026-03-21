import type { z } from 'zod';
import type { LLMConfig } from './llm.js';

export interface AgentTool<TParams = unknown> {
  description: string;
  inputSchema: z.ZodType<TParams>;
  execute: (args: TParams) => Promise<string>;
}

export interface AgentConfig {
  llm: LLMConfig;
  maxSteps?: number;
  stepDelay?: number;
  customTools?: Record<string, AgentTool | null>;
  instructions?: {
    system?: string;
    getPageInstructions?: (url: string) => string | undefined;
  };
  onBeforeStep?: (step: number) => Promise<void> | void;
  onAfterStep?: (history: HistoricalEvent[]) => Promise<void> | void;
}

export interface AgentReflection {
  evaluation_previous_goal: string;
  memory: string;
  next_goal: string;
}

export interface MacroToolInput extends Partial<AgentReflection> {
  action: Record<string, unknown>;
}

export type AgentStatus = 'idle' | 'running' | 'completed' | 'error';

export interface AgentStepEvent {
  type: 'step';
  step: number;
  reflection?: AgentReflection;
  action: { name: string; args: Record<string, unknown> };
  output: string;
  duration: number;
}

export interface AgentErrorEvent {
  type: 'error';
  error: string;
  step: number;
}

export interface ObservationEvent {
  type: 'observation';
  message: string;
}

export type HistoricalEvent = AgentStepEvent | AgentErrorEvent | ObservationEvent;

export interface ExecutionResult {
  success: boolean;
  data: string;
  history: HistoricalEvent[];
}
