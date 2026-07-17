export const DEFAULT_CONFIG = {
  llm: {
    provider: 'openai' as const,
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    apiKey: '',
    temperature: 0.1,
    maxRetries: 3,
  },
  browser: {
    executablePath: '',
    headless: true,
    connectTimeout: 30,
    commandTimeout: 60,
    cdpEndpoint: '',
  },
  agent: {
    maxSteps: 40,
    stepDelay: 0.4,
  },
  history: {
    enabled: true,
    dir: '',
  },
  output: {
    defaultFormat: 'table' as const,
    color: true,
  },
};
