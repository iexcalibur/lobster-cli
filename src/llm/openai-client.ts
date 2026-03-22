import type { Message, ToolCall } from '../types/llm.js';
import type { LLMTool } from '../types/llm.js';
import { InvokeError, InvokeErrorType } from './errors.js';
import type { LLMProvider } from '../config/schema.js';

export interface OpenAIClientConfig {
  baseURL: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  provider?: LLMProvider;
}

export class OpenAIClient {
  private config: OpenAIClientConfig;

  constructor(config: OpenAIClientConfig) {
    this.config = config;
  }

  /**
   * Build auth headers based on the provider.
   * - OpenAI/Gemini/Ollama: Bearer token
   * - Anthropic: x-api-key header + anthropic-version
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (!this.config.apiKey) return headers;

    if (this.config.provider === 'anthropic') {
      headers['x-api-key'] = this.config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  /**
   * Build the request body based on provider.
   * Anthropic Messages API is different from OpenAI chat completions.
   */
  private buildBody(
    messages: Message[],
    tools?: LLMTool[],
    opts?: { toolChoice?: string | { type: 'function'; function: { name: string } } },
  ): { url: string; body: Record<string, unknown> } {
    if (this.config.provider === 'anthropic') {
      return this.buildAnthropicBody(messages, tools, opts);
    }

    // OpenAI-compatible format (OpenAI, Gemini, Ollama all use this)
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

    return { url: `${this.config.baseURL}/chat/completions`, body };
  }

  /**
   * Build Anthropic Messages API request.
   * Converts OpenAI-style messages/tools to Anthropic format.
   */
  private buildAnthropicBody(
    messages: Message[],
    tools?: LLMTool[],
    opts?: { toolChoice?: string | { type: 'function'; function: { name: string } } },
  ): { url: string; body: Record<string, unknown> } {
    // Extract system message
    let system: string | undefined;
    const anthropicMessages: Record<string, unknown>[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system = msg.content as string;
      } else {
        anthropicMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content,
        });
      }
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: anthropicMessages,
      max_tokens: 4096,
      temperature: this.config.temperature ?? 0.1,
    };

    if (system) body.system = system;

    // Convert OpenAI tools format to Anthropic tools format
    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => {
        const fn = (t as any).function;
        return {
          name: fn.name,
          description: fn.description,
          input_schema: fn.parameters,
        };
      });

      if (opts?.toolChoice) {
        if (typeof opts.toolChoice === 'string') {
          body.tool_choice = opts.toolChoice === 'required'
            ? { type: 'any' }
            : { type: opts.toolChoice };
        } else {
          body.tool_choice = { type: 'tool', name: opts.toolChoice.function.name };
        }
      }
    }

    return { url: `${this.config.baseURL}/messages`, body };
  }

  /**
   * Parse Anthropic response into our unified format.
   */
  private parseAnthropicResponse(json: Record<string, unknown>): {
    toolCalls?: ToolCall[];
    content?: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  } {
    const content = json.content as any[];
    if (!content || !Array.isArray(content)) {
      throw new InvokeError(InvokeErrorType.UNKNOWN, 'No content in Anthropic response', { rawResponse: json });
    }

    let textContent: string | undefined;
    const toolCalls: ToolCall[] = [];

    for (const block of content) {
      if (block.type === 'text') {
        textContent = block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    const usage = json.usage as Record<string, number> | undefined;

    return {
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      content: textContent,
      usage: usage ? {
        promptTokens: usage.input_tokens ?? 0,
        completionTokens: usage.output_tokens ?? 0,
        totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      } : undefined,
    };
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
    const { url, body } = this.buildBody(messages, tools, opts);
    const headers = this.buildHeaders();

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
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

    // Route to provider-specific parser
    if (this.config.provider === 'anthropic') {
      return this.parseAnthropicResponse(json);
    }

    // OpenAI-compatible response parsing (OpenAI, Gemini, Ollama)
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

  /**
   * Simple vision call — send a screenshot + text prompt, get text back.
   * Used by PDF Doctor for targeted issue resolution.
   */
  async chatWithVision(prompt: string, screenshotBase64: string): Promise<string> {
    const headers = this.buildHeaders();

    if (this.config.provider === 'anthropic') {
      // Anthropic vision format
      const body = {
        model: this.config.model,
        max_tokens: 1024,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: screenshotBase64,
              },
            },
            { type: 'text', text: prompt },
          ],
        }],
      };

      const resp = await fetch(`${this.config.baseURL}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!resp.ok) throw new Error(`Anthropic vision error: ${resp.status}`);
      const json = await resp.json() as Record<string, unknown>;
      const content = json.content as any[];
      return content?.[0]?.text || '';
    }

    // OpenAI-compatible vision format (OpenAI, Gemini, Ollama)
    const body = {
      model: this.config.model,
      max_tokens: 1024,
      temperature: 0.1,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${screenshotBase64}`,
            },
          },
          { type: 'text', text: prompt },
        ],
      }],
    };

    const resp = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) throw new Error(`Vision API error: ${resp.status}`);
    const json = await resp.json() as Record<string, unknown>;
    const choice = (json.choices as any[])?.[0];
    return choice?.message?.content || '';
  }
}
