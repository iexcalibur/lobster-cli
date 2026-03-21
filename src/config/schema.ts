import { z } from 'zod';

export const configSchema = z.object({
  llm: z.object({
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
