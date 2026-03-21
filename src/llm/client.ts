import type { z } from 'zod';
import type { Message, InvokeResult, LLMTool } from '../types/llm.js';
import type { LLMConfig } from '../types/llm.js';
import { OpenAIClient } from './openai-client.js';
import { InvokeError, InvokeErrorType } from './errors.js';
import { zodToOpenAITool } from './utils.js';

export interface MacroTool {
  name: string;
  description: string;
  schema: z.ZodType;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export class LLM {
  private client: OpenAIClient;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    this.client = new OpenAIClient({
      baseURL: config.baseURL,
      model: config.model,
      apiKey: config.apiKey,
      temperature: config.temperature,
    });
  }

  async invoke(
    messages: Message[],
    tool: MacroTool,
    abortSignal?: AbortSignal
  ): Promise<InvokeResult> {
    const openaiTool = zodToOpenAITool(tool.name, tool.description, tool.schema);

    return this.withRetry(async () => {
      if (abortSignal?.aborted) throw new Error('Aborted');

      const response = await this.client.chatCompletion(
        messages,
        [openaiTool],
        { toolChoice: { type: 'function', function: { name: tool.name } } }
      );

      // Extract tool call
      const toolCall = response.toolCalls?.[0];
      if (!toolCall) {
        // Try to extract from content (some models put JSON in content)
        if (response.content) {
          const extracted = extractJsonFromString(response.content);
          if (extracted) {
            const args = typeof extracted === 'string' ? JSON.parse(extracted) : extracted;
            const result = await tool.execute(args);
            return {
              toolCall: { name: tool.name, args },
              toolResult: result,
              usage: response.usage,
            };
          }
        }
        throw new InvokeError(InvokeErrorType.NO_TOOL_CALL, 'No tool call in response');
      }

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        // Try double-parse (some models double-stringify)
        try {
          args = JSON.parse(JSON.parse(toolCall.function.arguments));
        } catch {
          throw new InvokeError(InvokeErrorType.INVALID_TOOL_ARGS, `Invalid JSON in tool args: ${toolCall.function.arguments}`);
        }
      }

      let result: string;
      try {
        result = await tool.execute(args);
      } catch (err) {
        throw new InvokeError(InvokeErrorType.TOOL_EXECUTION_ERROR, `Tool execution failed: ${err}`, { rawError: err });
      }

      return {
        toolCall: { name: tool.name, args },
        toolResult: result,
        usage: response.usage,
      };
    });
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const maxRetries = this.config.maxRetries ?? 3;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (err instanceof InvokeError && !err.retryable) throw err;
        if (err instanceof Error && err.name === 'AbortError') throw err;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        }
      }
    }

    throw lastError;
  }
}

function extractJsonFromString(str: string): unknown | null {
  const start = str.indexOf('{');
  const end = str.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(str.slice(start, end + 1));
  } catch {
    return null;
  }
}
