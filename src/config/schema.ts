import { z } from 'zod';

export const LLM_PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    keyPrefix: 'sk-',
    keyEnvHint: 'https://platform.openai.com/api-keys',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
  },
  anthropic: {
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    keyPrefix: 'sk-ant-',
    keyEnvHint: 'https://console.anthropic.com/settings/keys',
    models: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
  },
  gemini: {
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    keyPrefix: 'AI',
    keyEnvHint: 'https://aistudio.google.com/apikey',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-flash-preview-05-20', 'gemini-2.5-pro-preview-05-06'],
  },
  ollama: {
    name: 'Ollama (local, free)',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    keyPrefix: '',
    keyEnvHint: 'No API key needed — install from https://ollama.ai',
    models: ['llama3.1', 'llama3.2', 'mistral', 'codestral', 'qwen2.5', 'deepseek-r1'],
  },
} as const;

export type LLMProvider = keyof typeof LLM_PROVIDERS;

export const configSchema = z.object({
  llm: z.object({
    provider: z.enum(['openai', 'anthropic', 'gemini', 'ollama']).default('openai'),
    baseURL: z.string().default('https://api.openai.com/v1'),
    model: z.string().default('gpt-4o'),
    apiKey: z.string().default(''),
    temperature: z.number().min(0).max(2).default(0.1),
    maxRetries: z.number().int().min(0).default(3),
  }).default({}),
  browser: z.object({
    executablePath: z.string().default(''),
    headless: z.boolean().default(true),
    connectTimeout: z.number().default(30),
    commandTimeout: z.number().default(60),
    cdpEndpoint: z.string().default(''),
  }).default({}),
  agent: z.object({
    maxSteps: z.number().int().default(40),
    stepDelay: z.number().default(0.4),
  }).default({}),
  output: z.object({
    defaultFormat: z.enum(['table', 'json', 'yaml', 'markdown', 'csv']).default('table'),
    color: z.boolean().default(true),
  }).default({}),
});

export type LobsterConfig = z.infer<typeof configSchema>;
