import type { Message, ToolCall } from '../types/llm.js';
import type { LLMTool } from '../types/llm.js';
import { InvokeError, InvokeErrorType } from './errors.js';

export interface OpenAIClientConfig {
  baseURL: string;
  model: string;
  apiKey?: string;
  temperature?: number;
}

export class OpenAIClient {
  private config: OpenAIClientConfig;

  constructor(config: OpenAIClientConfig) {
    this.config = config;
  }

  async chatCompletion(
    messages: Message[],
    tools?: LLMTool[],
    opts?: { toolChoice?: string | { type: 'function'; function: { name: string } } }
  ): Promise<{
    toolCalls?: ToolCall[];
    content?: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  }> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature ?? 0.1,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.parallel_tool_calls = false;
      if (opts?.toolChoice) {
        body.tool_choice = typeof opts.toolChoice === 'string'
          ? opts.toolChoice
          : opts.toolChoice;
      }
    }

    const url = `${this.config.baseURL}/chat/completions`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new InvokeError(InvokeErrorType.NETWORK_ERROR, `Network error: ${err}`, { rawError: err });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (response.status === 401) {
        throw new InvokeError(InvokeErrorType.AUTH_ERROR, `Authentication failed: ${text}`, { retryable: false, rawResponse: text });
      }
      if (response.status === 429) {
        throw new InvokeError(InvokeErrorType.RATE_LIMIT, `Rate limited: ${text}`, { rawResponse: text });
      }
      if (response.status >= 500) {
        throw new InvokeError(InvokeErrorType.SERVER_ERROR, `Server error ${response.status}: ${text}`, { rawResponse: text });
      }
      throw new InvokeError(InvokeErrorType.UNKNOWN, `HTTP ${response.status}: ${text}`, { rawResponse: text });
    }

    const json = await response.json() as Record<string, unknown>;
    const choice = (json.choices as any[])?.[0];
    if (!choice) {
      throw new InvokeError(InvokeErrorType.UNKNOWN, 'No choices in response', { rawResponse: json });
    }

    const message = choice.message;
    const finishReason = choice.finish_reason;

    if (finishReason === 'content_filter') {
      throw new InvokeError(InvokeErrorType.CONTENT_FILTER, 'Content filtered', { retryable: false, rawResponse: json });
    }

    if (finishReason === 'length') {
      throw new InvokeError(InvokeErrorType.CONTEXT_LENGTH, 'Context length exceeded', { retryable: false, rawResponse: json });
    }

    const usage = json.usage as Record<string, number> | undefined;

    return {
      toolCalls: message.tool_calls as ToolCall[] | undefined,
      content: message.content as string | undefined,
      usage: usage ? {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
      } : undefined,
    };
  }
}
