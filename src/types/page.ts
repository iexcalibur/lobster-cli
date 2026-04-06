export type WaitCondition = 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';

export interface BrowserState {
  url: string;
  title: string;
  viewportWidth: number;
  viewportHeight: number;
  pageWidth: number;
  pageHeight: number;
  scrollX: number;
  scrollY: number;
  scrollPercent: number;
  pixelsAbove: number;
  pixelsBelow: number;
}

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface NetworkEntry {
  url: string;
  method: string;
  status: number;
  type: string;
  size: number;
  responseBody?: unknown;
}

export interface TabInfo {
  id: number;
  url: string;
  title: string;
  active: boolean;
}

export interface SnapshotOptions {
  interactive?: boolean;
  compact?: boolean;
  maxDepth?: number;
}

export interface SemanticTreeOptions {
  maxDepth?: number;
  interactiveOnly?: boolean;
  prune?: boolean;
}

export interface DomNode {
  id: string;
  tagName: string;
  text?: string;
  attributes?: Record<string, string>;
  children?: string[];
  parentId?: string;
  isInteractive?: boolean;
  highlightIndex?: number;
  role?: string;
  ariaLabel?: string;
  scrollable?: { left: number; top: number; right: number; bottom: number };
}

export interface FlatDomTree {
  rootId: string;
  map: Record<string, DomNode>;
}

export interface FormField {
  tag: string;
  type: string;
  name: string;
  label: string;
  value: unknown;
  required: boolean;
  disabled: boolean;
  ref: string | null;
}

export interface FormInfo {
  id: string;
  name: string;
  action: string;
  method: string;
  fields: FormField[];
}

export interface FormState {
  forms: FormInfo[];
  orphanFields: FormField[];
}

export interface FindMatch {
  ref: number;
  score: number;
  text: string;
  role: string;
  tag: string;
}

export interface FindOptions {
  maxResults?: number;
  minScore?: number;
}

export interface IPage {
  goto(url: string, options?: { waitUntil?: WaitCondition; timeout?: number }): Promise<void>;
  goBack(): Promise<void>;
  url(): Promise<string>;
  title(): Promise<string>;
  evaluate<T = unknown>(js: string): Promise<T>;
  snapshot(opts?: SnapshotOptions): Promise<string>;
  semanticTree(opts?: SemanticTreeOptions): Promise<string>;
  flatTree(): Promise<FlatDomTree>;
  markdown(): Promise<string>;
  browserState(): Promise<BrowserState>;
  formState(): Promise<FormState>;
  click(ref: string | number): Promise<void>;
  typeText(ref: string | number, text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  selectOption(ref: string | number, value: string): Promise<void>;
  scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void>;
  scrollToElement(ref: string | number): Promise<void>;
  getCookies(opts?: { domain?: string }): Promise<Cookie[]>;
  wait(options: number | { text?: string; time?: number; timeout?: number }): Promise<void>;
  networkRequests(includeStatic?: boolean): Promise<NetworkEntry[]>;
  installInterceptor(pattern: string): Promise<void>;
  getInterceptedRequests(): Promise<unknown[]>;
  screenshot(opts?: { format?: 'png' | 'jpeg'; fullPage?: boolean }): Promise<Buffer>;
  find(query: string, options?: FindOptions): Promise<FindMatch[]>;
  waitForSelector(selector: string, timeout?: number): Promise<void>;
  waitForUrl(pattern: string, timeout?: number): Promise<void>;
  tabs(): Promise<TabInfo[]>;
  close(): Promise<void>;
}
