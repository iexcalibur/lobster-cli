import type { z } from 'zod';

export interface LLMConfig {
  provider?: string;
  baseURL: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  maxRetries?: number;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface InvokeResult {
  toolCall: { name: string; args: Record<string, unknown> };
  toolResult: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
