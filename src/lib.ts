/**
 * LobsterCLI — Library exports.
 *
 * This is the public API for using LobsterCLI as a library in other projects.
 *
 * Usage:
 *   import { brain, llm, page, dom, pipeline, explore } from 'lobster-cli'
 *
 * Or tree-shakeable imports:
 *   import { classifyIntent } from 'lobster-cli/brain'
 *   import { PuppeteerPage } from 'lobster-cli/page'
 */

// ── Brain — Intent classification ──
export { classifyIntent, heuristicClassify } from './brain/index.js';
export type { BrainDecision } from './brain/index.js';

// ── LLM — Multi-provider client ──
export { LLM } from './llm/client.js';
export { OpenAIClient } from './llm/openai-client.js';
export type { LLMConfig, Message, ToolCall, LLMTool, InvokeResult } from './types/llm.js';

// ── Browser — Page interface + Puppeteer adapter ──
export { BrowserManager } from './browser/manager.js';
export { PuppeteerPage } from './browser/page-adapter.js';
export type { IPage, BrowserState, Cookie, NetworkEntry, DomNode, FlatDomTree, FormState, FormField, FormInfo, FindMatch, FindOptions } from './types/page.js';

// ── Profiles — Persistent Chrome sessions ──
export { createProfile, listProfiles, removeProfile, getProfileDataDir, resetProfileCache } from './browser/profiles.js';

// ── Chrome Attach — Connect to running Chrome ──
export { discoverChrome, resolveAttachTarget } from './browser/chrome-attach.js';

// ── Stealth — Anti-bot detection ──
export { STEALTH_SCRIPT, injectStealth, STEALTH_ARGS } from './browser/stealth.js';

// ── Semantic Find — Natural language element matching ──
export { semanticFind } from './browser/semantic-find.js';

// ── DOM Scripts — Run inside any browser context ──
export {
  SNAPSHOT_SCRIPT,
  buildSnapshotScript,
  SEMANTIC_TREE_SCRIPT,
  MARKDOWN_SCRIPT,
  FLAT_TREE_SCRIPT,
  flatTreeToString,
  INTERACTIVE_ELEMENTS_SCRIPT,
  FORM_STATE_SCRIPT,
  COMPACT_SNAPSHOT_SCRIPT,
  buildCompactSnapshotScript,
} from './browser/dom/index.js';

// ── In-house HTML Parser — No Chrome needed ──
export { lobsterFetch, parseHtml, extractMarkdown, extractText, extractSnapshot, extractLinks } from './browser/lightpanda.js';

// ── Network Interceptor ──
export { buildInterceptorScript, GET_INTERCEPTED_SCRIPT } from './browser/interceptor.js';

// ── Pipeline Engine ──
export { executePipeline } from './pipeline/executor.js';
export { renderTemplate } from './pipeline/template.js';
export { registerStep, getStep, getStepNames } from './pipeline/registry.js';
export type { PipelineContext } from './types/pipeline.js';

// ── Adapter System ──
export { cli, getAdapter, getAllAdapters, getAllSites, getAdapterBySite, getAdapterByDomain } from './adapter/registry.js';
export type { Adapter } from './types/adapter.js';
export { Strategy } from './types/adapter.js';

// ── Site Discovery ──
export { exploreSite } from './discover/explore.js';
export { synthesizeAdapter } from './discover/synthesize.js';
export type { ExploreResult, EndpointInfo, ExploreOptions } from './discover/explore.js';

// ── Strategy Cascade ──
export { cascadeProbe } from './cascade/index.js';

// ── Router ──
export { makeRoutingDecision } from './router/decision.js';

// ── Agent ──
export { AgentCore } from './agent/core.js';
export type { AgentConfig, AgentTool } from './types/agent.js';

// ── Config ──
export { loadConfig, saveConfig, getConfigDir } from './config/index.js';
export { LLM_PROVIDERS, configSchema } from './config/schema.js';
export type { LobsterConfig, LLMProvider } from './config/schema.js';

// ── Output Formatters ──
export { render } from './output/index.js';
