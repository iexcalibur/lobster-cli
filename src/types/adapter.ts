import type { IPage } from './page.js';

export enum Strategy {
  PUBLIC = 'public',
  COOKIE = 'cookie',
  HEADER = 'header',
  INTERCEPT = 'intercept',
  UI = 'ui',
}

export interface Arg {
  name: string;
  type?: 'string' | 'int' | 'float' | 'boolean';
  default?: unknown;
  required?: boolean;
  positional?: boolean;
  help?: string;
  choices?: string[];
}

export interface Adapter {
  site: string;
  name: string;
  description: string;
  domain?: string;
  strategy: Strategy;
  browser: boolean;
  args: Arg[];
  columns?: string[];
  func?: (page: IPage, kwargs: Record<string, unknown>) => Promise<unknown>;
  pipeline?: Record<string, unknown>[];
  timeoutSeconds?: number;
  navigateBefore?: boolean | string;
}
