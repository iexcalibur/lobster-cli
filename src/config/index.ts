import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import { configSchema, type LobsterConfig } from './schema.js';
import { DEFAULT_CONFIG } from './defaults.js';

export type { LobsterConfig };

const CONFIG_DIR = join(homedir(), '.lobster');
const CONFIG_FILE = join(CONFIG_DIR, 'config.yaml');

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): LobsterConfig {
  ensureConfigDir();

  let fileConfig: Record<string, unknown> = {};
  if (existsSync(CONFIG_FILE)) {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    fileConfig = (yaml.load(raw) as Record<string, unknown>) || {};
  }

  // Env var overrides
  const envOverrides: Record<string, unknown> = {};
  if (process.env.LOBSTER_API_KEY) {
    envOverrides.llm = { ...(fileConfig.llm as Record<string, unknown> || {}), apiKey: process.env.LOBSTER_API_KEY };
  }
  if (process.env.LOBSTER_MODEL) {
    envOverrides.llm = { ...(envOverrides.llm as Record<string, unknown> || fileConfig.llm as Record<string, unknown> || {}), model: process.env.LOBSTER_MODEL };
  }
  if (process.env.LOBSTER_BASE_URL) {
    envOverrides.llm = { ...(envOverrides.llm as Record<string, unknown> || fileConfig.llm as Record<string, unknown> || {}), baseURL: process.env.LOBSTER_BASE_URL };
  }
  if (process.env.LOBSTER_CDP_ENDPOINT) {
    envOverrides.browser = { ...(fileConfig.browser as Record<string, unknown> || {}), cdpEndpoint: process.env.LOBSTER_CDP_ENDPOINT };
  }
  if (process.env.LOBSTER_BROWSER_PATH) {
    envOverrides.browser = { ...(envOverrides.browser as Record<string, unknown> || fileConfig.browser as Record<string, unknown> || {}), executablePath: process.env.LOBSTER_BROWSER_PATH };
  }

  const merged = { ...fileConfig, ...envOverrides };
  return configSchema.parse(merged);
}

export function saveConfig(config: Partial<LobsterConfig>): void {
  ensureConfigDir();
  const existing = loadConfig();
  const merged = deepMerge(existing, config);
  writeFileSync(CONFIG_FILE, yaml.dump(merged, { indent: 2 }), 'utf-8');
}

export function setConfigValue(keyPath: string, value: string): void {
  const parts = keyPath.split('.');
  const obj: Record<string, unknown> = {};
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = {};
    current = current[parts[i]] as Record<string, unknown>;
  }
  // Try to parse as number or boolean
  let parsed: unknown = value;
  if (value === 'true') parsed = true;
  else if (value === 'false') parsed = false;
  else if (!isNaN(Number(value)) && value !== '') parsed = Number(value);

  current[parts[parts.length - 1]] = parsed;
  saveConfig(obj as Partial<LobsterConfig>);
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
