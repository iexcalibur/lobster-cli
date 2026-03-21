import type { Adapter } from './adapter.js';

export enum ExecutionLevel {
  HTTP = 0,
  BROWSER = 1,
  ADAPTER = 2,
  AGENT = 3,
}

export type OutputFormat = 'table' | 'json' | 'yaml' | 'markdown' | 'csv';

export interface RoutingDecision {
  level: ExecutionLevel;
  reason: string;
  adapter?: Adapter;
}

export interface ExecutionRequest {
  task: string;
  url?: string;
  site?: string;
  command?: string;
  args?: Record<string, unknown>;
  format?: OutputFormat;
}
