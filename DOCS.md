# LobsterCLI — Technical Documentation

## Table of Contents

- [Architecture](#architecture)
- [CLI Commands Reference](#cli-commands-reference)
- [Chrome Extension](#chrome-extension)
- [Library API](#library-api)
- [Brain — Intent Classifier](#brain--intent-classifier)
- [DOM Extraction (6 Strategies)](#dom-extraction-6-strategies)
- [AI Agent](#ai-agent)
- [Run History](#run-history)
- [Pipeline Engine](#pipeline-engine)
- [Site Adapters](#site-adapters)
- [Smart Router](#smart-router)
- [Persistent Profiles](#persistent-profiles)
- [Chrome Attach](#chrome-attach)
- [Stealth Mode](#stealth-mode)
- [Compact Snapshot](#compact-snapshot)
- [Semantic Element Finding](#semantic-element-finding)
- [Domain Guard](#domain-guard)
- [Strategy Cascade](#strategy-cascade)
- [Site Explorer](#site-explorer)
- [IPage Interface](#ipage-interface)
- [Multi-Provider LLM Client](#multi-provider-llm-client)
- [Template Expressions](#template-expressions)
- [Plugin System](#plugin-system)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)

---

## Architecture

```
lobster-cli/
├── src/
│   ├── brain/            → Intent classifier (LLM + heuristic fallback)
│   ├── browser/          → Browser abstraction layer
│   │   ├── manager.ts    → Chrome lifecycle (launch, attach, profiles, stealth)
│   │   ├── page-adapter.ts → PuppeteerPage implements IPage (25+ methods)
│   │   ├── profiles.ts   → Persistent Chrome sessions
│   │   ├── chrome-attach.ts → Connect to running Chrome via CDP
│   │   ├── stealth.ts    → Anti-bot detection scripts
│   │   ├── semantic-find.ts → Natural language element matching
│   │   ├── lightpanda.ts → In-house HTML parser (no Chrome needed)
│   │   ├── interceptor.ts → Network request interception (fetch + XHR)
│   │   ├── wait.ts       → Wait conditions (text, time, network idle)
│   │   └── dom/          → 7 DOM extraction strategies
│   │       ├── snapshot.ts       → 12-stage pruned snapshot with diff marking
│   │       ├── compact-snapshot.ts → Token-efficient (~800 tokens)
│   │       ├── semantic-tree.ts  → W3C accessible names + XPath
│   │       ├── markdown.ts       → Full DOM-to-Markdown
│   │       ├── flat-tree.ts      → Indexed interactive elements for AI
│   │       ├── interactive.ts    → Element classification
│   │       └── form-state.ts     → Form field extraction
│   ├── agent/            → AI agent (observe-think-act loop)
│   │   ├── core.ts       → Agent loop with reflection and history
│   │   ├── macro-tool.ts → Pack all tools into single LLM tool
│   │   ├── auto-fixer.ts → Fix malformed LLM responses (7 strategies)
│   │   └── tools/        → 9 agent tools
│   │       ├── click.ts, type.ts, scroll.ts, select.ts
│   │       ├── wait.ts, done.ts, ask-user.ts, execute-js.ts
│   │       └── find.ts   → Semantic element finding tool
│   ├── llm/              → Multi-provider LLM client
│   │   ├── openai-client.ts → Unified client (OpenAI, Anthropic, Gemini, Ollama)
│   │   ├── client.ts     → High-level LLM with retry + macro tool
│   │   ├── errors.ts     → Typed errors (auth, rate limit, network)
│   │   └── utils.ts      → Zod → OpenAI tool schema conversion
│   ├── pipeline/         → Declarative YAML pipeline engine
│   │   ├── executor.ts   → Sequential step runner with context
│   │   ├── template.ts   → ${{ }} expressions with 16 filters
│   │   └── steps/        → 17 registered steps
│   │       ├── fetch.ts  → HTTP with batch IPC optimization
│   │       ├── browser.ts → navigate, click, type, wait, press, snapshot, evaluate
│   │       ├── transform.ts → select (JSONPath), map, filter, sort, limit
│   │       ├── intercept.ts → Network interception + trigger actions
│   │       ├── download.ts → HTTP + yt-dlp + cookie forwarding
│   │       └── tap.ts    → Vue store action bridge (Pinia/Vuex)
│   ├── history/          → Run persistence (JSONL per run) + ctx export
│   │   ├── store.ts      → RunRecorder, listRuns, resolveRun, clearRuns
│   │   └── export-ctx.ts → ctx-history-jsonl-v1 exporter
│   ├── adapter/          → Site adapter registry
│   ├── router/           → Smart routing (HTTP → Engine → Adapter → Agent)
│   ├── discover/         → API discovery + adapter generation
│   ├── cascade/          → Auth strategy detection
│   ├── domain-guard.ts   → Domain restriction system
│   ├── config/           → Settings (~/.lobster/config.yaml)
│   ├── output/           → Formatters (table, JSON, YAML, CSV, Markdown)
│   ├── plugin/           → GitHub plugin install/uninstall
│   ├── lib.ts            → Library exports
│   ├── cli.ts            → CLI commands
│   └── index.ts          → Entry point
│
├── extension/            → Chrome extension (side panel)
│   ├── sidepanel/        → Chat UI (HTML/CSS/JS)
│   ├── background/       → Service worker (LLM, screenshot, Brain)
│   ├── shared/           → DOM scripts (ported from CLI)
│   ├── options/          → Settings page
│   └── manifest.json     → Chrome Manifest V3
│
└── package.json          → Dual: CLI binary + library exports
```

---

## CLI Commands Reference

### `lobster fetch <url>`

Extract content from any page. No AI needed.

```bash
lobster fetch https://example.com                  # markdown (default)
lobster fetch https://example.com -d snapshot      # LLM-optimized DOM
lobster fetch https://example.com -d compact       # token-efficient snapshot (~800 tokens)
lobster fetch https://example.com -d text          # plain text
lobster fetch https://example.com -d semantic      # W3C accessible tree
lobster fetch https://example.com -d html          # raw HTML
lobster fetch https://example.com -d links         # all links
lobster fetch https://example.com -e fast          # in-house parser only
lobster fetch https://example.com -e chrome -w 5   # Chrome with 5s wait
lobster fetch https://example.com --stealth        # anti-bot mode
lobster fetch https://example.com --profile mysite # use persistent profile
```

### `lobster agent <task>`

AI agent that navigates websites autonomously. Needs API key.

```bash
lobster agent "search for TypeScript" --url https://news.ycombinator.com
lobster agent "find the cheapest flight to Tokyo" --url https://google.com/flights
lobster agent "check my notifications" --url https://github.com --profile github --stealth
lobster agent "what's on this page" --url https://example.com --attach
```

**Agent tools:** click, type, scroll, select dropdown, wait, execute JS, ask user, find element, done.

**Agent loop:**
1. Take DOM snapshot (12-stage or compact)
2. Send to LLM with tool definitions
3. LLM decides action (click, type, scroll, etc.)
4. Execute action with full browser event simulation
5. Repeat until done (max 40 steps)

### `lobster history`

Inspect and export persisted agent runs. No AI needed.

```bash
lobster history list                    # runs, newest first
lobster history show last               # full transcript of the latest run
lobster history show run-20260711       # id prefix works too
lobster history export                  # all runs as ctx-history-jsonl-v1 (stdout)
lobster history export -r last -o out.jsonl
lobster history path                    # print the runs directory
lobster history clear --force           # delete all runs
```

Runs are recorded automatically (disable with `lobster config set history.enabled false`). See [Run History](#run-history).

### `lobster explore <url>`

Discover hidden APIs on any website. No AI needed.

```bash
lobster explore https://reddit.com
lobster explore https://twitter.com -w 5
```

**What it does:**
- Installs network interceptors (fetch + XHR patching)
- Smart auto-scrolls with MutationObserver (lazy-load detection)
- Clicks buttons/tabs to trigger hidden API calls (interactive fuzzing)
- Scores and ranks discovered endpoints
- Detects framework (React, Vue, Next.js, Nuxt, Angular, Svelte)
- Discovers Vue stores (Pinia/Vuex) and their actions
- Infers auth strategy (public, cookie, header, intercept)
- Writes artifacts to `.lobster/explore/<site>/`
- Auto-generates a YAML adapter

### `lobster run <url>`

Smart router — auto-detects best approach. No AI needed.

```bash
lobster run https://api.github.com/users/octocat   # direct HTTP
lobster run https://news.ycombinator.com            # adapter if registered
lobster run https://example.com -f yaml             # output as YAML
```

### `lobster profile`

Manage persistent Chrome profiles.

```bash
lobster profile create work
lobster profile list
lobster profile delete work
lobster profile reset work     # clear cache, keep cookies/extensions
```

### `lobster config`

```bash
lobster config show
lobster config set llm.provider gemini
lobster config set llm.apiKey AIza...
lobster config set browser.stealth true
lobster config set domains.allow "bloomberg.com,yahoo.com"
```

### `lobster plugin`

```bash
lobster plugin install github-user/reddit-adapter
lobster plugin list
lobster plugin uninstall reddit-adapter
```

---

## Chrome Extension

### How it works

The extension opens as a side panel (like Gemini or Claude) docked to the right. It provides:

**Free features (6 chips):**
- Summarize this page
- Extract as Markdown
- Detect all forms
- Show key links
- Monitor API calls
- DOM snapshot
- What's on screen? (needs AI)

**Chat interface:**
- Type any question about the current page
- Brain auto-classifies: needs screenshot? text? forms? network data?
- Gathers only what's needed, sends to AI
- Updates when you switch tabs

**Settings:**
- Click gear icon → options page
- Pick AI provider (OpenAI, Anthropic, Gemini, Ollama)
- Enter API key
- Test connection

---

## Library API

### Exports

```typescript
// Brain
import { Brain, classifyIntent, heuristicClassify } from 'lobster-cli/brain'

// Browser
import { BrowserManager, PuppeteerPage } from 'lobster-cli/browser'
import { createProfile, listProfiles, getProfileDataDir } from 'lobster-cli/browser'
import { discoverChrome, resolveAttachTarget } from 'lobster-cli/browser'
import { injectStealth, STEALTH_SCRIPT } from 'lobster-cli/browser'
import { semanticFind } from 'lobster-cli/browser'

// DOM Scripts
import {
  SNAPSHOT_SCRIPT, COMPACT_SNAPSHOT_SCRIPT, SEMANTIC_TREE_SCRIPT,
  MARKDOWN_SCRIPT, FLAT_TREE_SCRIPT, INTERACTIVE_ELEMENTS_SCRIPT,
  FORM_STATE_SCRIPT
} from 'lobster-cli/dom'

// Agent
import { AgentCore } from 'lobster-cli/agent'

// Run History
import { RunRecorder, listRuns, resolveRun, clearRuns, exportRunsToCtxJsonl } from 'lobster-cli/history'

// LLM
import { LLM } from 'lobster-cli/llm'

// Pipeline
import { executePipeline, registerStep } from 'lobster-cli/pipeline'

// Domain Guard
import { DomainGuard, DomainBlockedError } from 'lobster-cli/domain-guard'

// Discovery
import { exploreSite } from 'lobster-cli/discover'

// Config
import { loadConfig, saveConfig } from 'lobster-cli/config'
```

---

## Brain — Intent Classifier

The Brain analyzes a user's question and decides what data sources are needed before making the main LLM call.

**Two-tier system:**
1. **LLM classifier** (preferred) — uses cheapest model for ~$0.001
2. **Heuristic fallback** (instant) — regex patterns when no AI key

**Output:**
```typescript
{
  screenshot: boolean,  // needs to SEE the page
  markdown: boolean,    // needs page TEXT
  forms: boolean,       // asking about forms
  network: boolean,     // asking about API calls
  intent: string,       // brief description
  source: 'llm' | 'heuristic' | 'custom-rule'
}
```

### Three Levels of Customization

**Level 1: Use as-is (most developers)**

The default Brain works out of the box. No configuration needed.

```typescript
import { classifyIntent } from 'lobster-cli/brain'

const result = await classifyIntent("summarize this page", "Page Title")
// → { screenshot: false, markdown: true, forms: false, network: false }
```

**Level 2: Add custom rules (common)**

Add your own regex patterns that merge with the default classifier. Custom rules run first. If they match, their fields are merged with the default Brain's output — custom wins per-field, defaults fill the rest.

```typescript
import { Brain } from 'lobster-cli/brain'

const brain = new Brain({
  rules: [
    { pattern: /stock|portfolio|holdings/i, screenshot: true },
    { pattern: /api|swagger|endpoint/i, network: true },
    { pattern: /price|cost|plan/i, screenshot: true, markdown: true },
  ],
})

const result = await brain.classify("show me the stock portfolio", "Dashboard")
// Custom rule matches → { screenshot: true }
// Default Brain adds  → { markdown: true, forms: false, network: false }
// Merged result       → { screenshot: true, markdown: true, forms: false, network: false }
```

**Level 3: Full control (advanced)**

Override the classifier prompt and/or add a post-processing hook.

```typescript
const brain = new Brain({
  // Replace the default LLM classifier prompt
  classifierPrompt: `You are a classifier for a financial analysis app.
    Always set screenshot=true for charts, graphs, or portfolio views.
    Respond with JSON: { screenshot, markdown, forms, network, intent }`,

  // Post-process every decision
  onClassify: (result, ctx) => {
    // Always screenshot for Zerodha pages
    if (ctx.pageUrl?.includes('zerodha')) result.screenshot = true;
    // Always check network for API-heavy sites
    if (ctx.pageUrl?.includes('api.')) result.network = true;
    return result;
  },
})
```

### Merge vs Replace Mode

By default, custom rules **merge** with the default Brain. The default classifier always runs, and custom rule fields override specific values.

If you want custom rules to **replace** the default Brain entirely (skip LLM/heuristic when a rule matches):

```typescript
const brain = new Brain({
  rules: [
    { pattern: /stock/i, screenshot: true, markdown: true },
  ],
  mode: 'replace',
})

const result = await brain.classify("show stock chart", "Dashboard")
// Custom rule matches → { screenshot: true, markdown: true }
// Default Brain SKIPPED — only custom result returned
// → { screenshot: true, markdown: true, forms: false, network: false }
```

**When to use replace mode:**
- You've built a domain-specific classifier and don't want the default interfering
- Performance: skip the LLM call when a local rule already knows the answer
- Testing: isolate custom rules from default behavior

### Runtime Rule Management

Add or clear rules dynamically:

```typescript
const brain = new Brain()

// Add a rule at runtime
brain.addRule({ pattern: /chart|graph/i, screenshot: true })

// Clear all custom rules
brain.clearRules()
```

### Custom Fields

Custom rules can set **any field**, not just the built-in four. This lets you create domain-specific categories:

```typescript
const brain = new Brain({
  rules: [
    { pattern: /price|cost|plan/i, pricing: true, markdown: true },
    { pattern: /competitor|alternative/i, competitive: true, markdown: true },
  ],
})

const result = await brain.classify("what's the pricing?", "SaaS Site")
// result.pricing === true  ← your custom field
// result.markdown === true ← default field
```

Your application code can then check `result.pricing` to trigger domain-specific logic.

### Backwards Compatibility

The standalone `classifyIntent()` function is unchanged. It internally creates a default `Brain` with no custom rules. All existing CLI and extension code works exactly as before.

```
classifyIntent()  ← still works, no changes needed
new Brain()       ← NEW, optional, for customization
```

---

## DOM Extraction (6 Strategies)

| Strategy | Tokens | Use case |
|----------|--------|----------|
| **Snapshot** | ~3000 | Full 12-stage pruned DOM for LLM |
| **Compact Snapshot** | ~800 | Token-efficient, interactive elements only |
| **Semantic Tree** | ~2000 | W3C accessible names + XPath |
| **Markdown** | varies | Human-readable content |
| **Flat Tree** | varies | Indexed elements for agent navigation |
| **Form State** | varies | All form fields with labels/values |

### Snapshot — 12-stage pruning pipeline

1. Walk DOM, collect visibility + layout + interactivity signals
2. Prune invisible, zero-area, non-content elements
3. SVG & decoration collapse
4. Shadow DOM traversal
5. Same-origin iframe extraction
6. Bounding-box parent-child dedup
7. Paint-order occlusion detection
8. Attribute whitelist filtering
9. Ad/tracker filtering
10. Scroll position info
11. data-ref annotation for targeting
12. Token-efficient serialization with interactive indices + diff marking

---

## AI Agent

**Observe-think-act loop:**

```
Observe → Take DOM snapshot
Think   → LLM reasons about what to do
Act     → Execute tool (click, type, scroll, etc.)
Repeat  → Until done or max steps reached
```

**9 tools:**

| Tool | What it does |
|------|-------------|
| `click_element_by_index` | Click element by ref index |
| `input_text` | Type text into input field |
| `scroll` | Scroll page in any direction |
| `select_dropdown_option` | Select from dropdown |
| `wait` | Wait for duration |
| `execute_javascript` | Run JS in page context |
| `ask_user` | Ask user for clarification |
| `find_element` | Find element by natural language |
| `done` | Signal task completion |

---

## Run History

Every `lobster agent` run is persisted as append-only JSONL — one file per run in `~/.lobster/runs/<run-id>.jsonl`:

```jsonl
{"record_type":"run_start","schema":"lobster-run-v1","run_id":"run-20260711-084118-7ecc","started_at":"...","task":"find pricing","url":"https://example.com","provider":"gemini","model":"gemini-2.5-flash"}
{"record_type":"event","index":0,"type":"step","step":1,"reflection":{...},"action":{"name":"click_element_by_index","args":{"index":3}},"output":"Clicked element [3]","duration":812,"url":"https://example.com","occurredAt":"..."}
{"record_type":"run_end","ended_at":"...","success":true,"result":"Pro plan is $20/mo","steps":2}
```

Events are appended as they happen, so a crashed or aborted run keeps every completed step (it just has no `run_end`). Persistence failures never break a run — the recorder warns once and disables itself.

**Configuration:**

```yaml
history:
  enabled: true   # set false to disable recording
  dir: ''         # custom runs directory (default ~/.lobster/runs)
```

**Privacy note:** transcripts include page-derived text (tool outputs, URLs). They live only on your machine; nothing is uploaded. Disable recording per above, or wipe with `lobster history clear --force`.

**ctx export** — `lobster history export` emits [ctx-history-jsonl-v1](https://github.com/ctxrs/ctx/blob/main/docs/custom-history-import-format.md), the public import format of [ctx](https://github.com/ctxrs/ctx), a local search CLI over past agent sessions:

```bash
lobster history export -o lobster-history.jsonl
ctx import --format ctx-history-jsonl-v1 --path lobster-history.jsonl
ctx search "pricing page"
```

**ctx history-source plugin** — for continuous sync instead of one-off files, install a plugin manifest so `ctx search` auto-refreshes LobsterCLI history (incremental via ctx's cursor handoff; `history export` detects plugin mode through `CTX_HISTORY_PLUGIN=1`, honors `CTX_HISTORY_CURSOR`, and treats an empty history as a valid empty stream):

```bash
mkdir -p ~/.ctx/plugins/lobster
cat > ~/.ctx/plugins/lobster/ctx-history-plugin.json <<'EOF'
{
  "schema_version": 1,
  "name": "lobster",
  "display_name": "LobsterCLI browser-agent history",
  "version": "0.5.0",
  "history_sources": [
    {
      "id": "default",
      "provider_key": "lobster",
      "source_id": "default",
      "source_format": "lobster-run-v1",
      "enabled": true,
      "refresh": "auto",
      "command": ["lobster", "history", "export"],
      "timeout_seconds": 300
    }
  ]
}
EOF
ctx import --history-source lobster/default   # first import; later ones are automatic
```

Mapping (shaped so ctx's lexical search indexes every meaningful string): run → `session`, task → user `message`, agent step → `tool_call` (goal + action + output in the searchable `text` field), observations/errors → system `message`, run outcome → assistant `summary`, page navigation → `file_touch` with the URL as the path — so `ctx search --file <url>` recalls prior agent work on a site.

**Library API:**

```typescript
import { RunRecorder, listRuns, resolveRun, exportRunsToCtxJsonl } from 'lobster-cli/history'

// Record runs from your own AgentCore usage
const recorder = new RunRecorder({ task, url })
agent.on('historychange', (e) => {
  if (e.type === 'historychange') recorder.sync(e.history)
})
const result = await agent.execute(task)
recorder.finish({ success: result.success, result: result.data, history: result.history })
```

---

## Pipeline Engine

17 registered steps with template expressions:

**Browser steps:** navigate, click, type, wait, press, snapshot, evaluate

**Transform steps:** select (JSONPath with wildcards), map, filter, sort, limit

**Data steps:** fetch (with batch IPC), intercept, download, tap (Vue store bridge)

### Template Expressions

16 built-in filters:

```
${{ args.query | urlencode }}
${{ item.title | truncate(50) }}
${{ data.items | json }}
${{ args.date | default("today") }}
${{ item.path | ext }}
${{ item.path | basename }}
${{ item.html | sanitize }}
```

---

## Site Adapters

### TypeScript adapter

```typescript
export default {
  name: 'search',
  site: 'mysite',
  description: 'Search mysite',
  args: [{ name: 'query', required: true }],
  strategy: 'public',
  browser: false,
  async execute(args, ctx) {
    const resp = await fetch(`https://api.mysite.com/search?q=${args.query}`);
    return resp.json();
  },
};
```

### YAML adapter

```yaml
name: search
site: mysite
description: Search mysite
args:
  - name: query
    required: true
strategy: public
browser: true
steps:
  - navigate: https://mysite.com
  - type:
      ref: '[name="search"]'
      text: ${{ args.query }}
      submit: true
  - wait: { time: 2 }
  - snapshot: true
```

---

## Smart Router

Auto-escalation chain:

```
Level 0: Direct HTTP      → Public APIs, JSON ($0, ~200ms)
Level 1: LobsterEngine    → Static HTML, no JS ($0, ~300ms)
Level 2: Chrome/Puppeteer → JS-rendered SPAs ($0, ~2-5s)
Level 3: Site Adapters    → Known sites with pipelines ($0, ~1-3s)
Level 4: AI Agent         → Unknown sites (~$0.01-0.05, ~10-30s)
```

---

## Persistent Profiles

Store Chrome user data dirs in `~/.lobster/profiles/<name>/`.

Cookies, auth, extensions, local storage all survive across sessions.

```bash
lobster profile create work
lobster agent "check gmail" --profile work    # first run: login manually
lobster agent "check gmail" --profile work    # second run: already logged in
```

---

## Chrome Attach

Connect to your running Chrome instance via CDP.

```bash
# Start Chrome with debug port
google-chrome --remote-debugging-port=9222

# LobsterCLI connects to it (auto-discover)
lobster agent "check inbox" --attach

# Or specify port/URL
lobster agent "check inbox" --attach 9222
lobster agent "check inbox" --attach ws://localhost:9222/devtools/browser/abc
```

When attached, `close()` disconnects without closing your browser.

---

## Stealth Mode

Comprehensive anti-bot detection:

- `navigator.webdriver` removal
- Chrome DevTools Protocol marker cleanup
- Chrome runtime spoofing (loadTimes, csi, runtime)
- Plugin array with Chrome PDF Plugin/Viewer
- WebGL vendor/renderer override (hide SwiftShader)
- Canvas fingerprint noise (seeded per domain)
- Permissions API override
- Language and hardware consistency

---

## Compact Snapshot

Token-efficient DOM snapshot (~800 tokens vs ~3000+):

```
url: https://example.com | scroll: 0%
--- Navigation ---
[0] link "Home"
[1] link "About"
[2] link "Contact"
--- Main Content ---
[3] button "Get Started"
[4] input[text] placeholder="Enter email" val=""
[5] button "Subscribe"
--- Footer ---
[6] link "Privacy Policy"
[7] link "Terms of Service"
```

Only interactive elements + landmark section headers. 4x cheaper AI calls.

---

## Semantic Element Finding

Find elements by natural language instead of index numbers.

```
Query: "login button"
→ [1] button "Sign In" (score: 0.81)
→ [4] button "Submit" (score: 0.74)

Query: "email field"
→ [2] input "Email address" (score: 0.69)
```

**Algorithm:** Jaccard similarity + synonym expansion + role keyword boost + prefix matching. Zero external dependencies.

---

## Domain Guard

Restrict which websites the engine can operate on.

```typescript
import { DomainGuard } from 'lobster-cli/domain-guard'

// Whitelist mode
const finance = new DomainGuard({
  allowDomains: ['bloomberg.com', 'yahoo.com'],
  blockMessage: 'This tool only works on finance sites.',
})

// Blacklist mode
const noSocial = new DomainGuard({
  blockDomains: ['facebook.com', 'tiktok.com'],
})

// No config = works on all sites (default)
const open = new DomainGuard()
```

Subdomain matching included: `api.bloomberg.com` matches `bloomberg.com`.

---

## Strategy Cascade

Auto-detects the right auth approach for a site:

1. **PUBLIC** — no auth, direct fetch works
2. **COOKIE** — needs browser cookies (session-based)
3. **HEADER** — needs Bearer token or CSRF token
4. **INTERCEPT** — needs to intercept signed/dynamic requests

---

## IPage Interface

Universal browser abstraction. Everything talks through this:

```typescript
interface IPage {
  goto(url, options?): Promise<void>
  goBack(): Promise<void>
  url(): Promise<string>
  title(): Promise<string>
  evaluate<T>(js: string): Promise<T>
  snapshot(opts?): Promise<string>
  semanticTree(opts?): Promise<string>
  flatTree(): Promise<FlatDomTree>
  markdown(): Promise<string>
  browserState(): Promise<BrowserState>
  formState(): Promise<FormState>
  click(ref): Promise<void>
  typeText(ref, text): Promise<void>
  pressKey(key): Promise<void>
  selectOption(ref, value): Promise<void>
  scroll(direction, amount?): Promise<void>
  scrollToElement(ref): Promise<void>
  find(query, options?): Promise<FindMatch[]>
  getCookies(opts?): Promise<Cookie[]>
  wait(options): Promise<void>
  networkRequests(includeStatic?): Promise<NetworkEntry[]>
  installInterceptor(pattern): Promise<void>
  getInterceptedRequests(): Promise<unknown[]>
  screenshot(opts?): Promise<Buffer>
  tabs(): Promise<TabInfo[]>
  close(): Promise<void>
}
```

---

## Multi-Provider LLM Client

Unified client supporting 4 providers:

| Provider | Protocol | Auth |
|----------|---------|------|
| OpenAI | OpenAI Chat Completions | Bearer token |
| Anthropic | Messages API (auto-converted) | x-api-key header |
| Google Gemini | OpenAI-compatible endpoint | Bearer token |
| Ollama | OpenAI-compatible (local) | None |

---

## Plugin System

Install community adapters from GitHub:

```bash
lobster plugin install github-user/reddit-adapter
lobster plugin list
lobster plugin uninstall reddit-adapter
```

Plugins are stored in `~/.lobster/plugins/`.

---

## Configuration

Config file: `~/.lobster/config.yaml`

```yaml
llm:
  provider: gemini
  apiKey: AIza...
  model: gemini-2.5-flash
  temperature: 0.1
  maxRetries: 3
browser:
  headless: true
  stealth: false
  profile: ''
agent:
  maxSteps: 40
  stepDelay: 0.4
history:
  enabled: true
  dir: ''
domains:
  allow: []
  block: []
  blockMessage: ''
output:
  defaultFormat: table
  color: true
```

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `LOBSTER_API_KEY` | LLM API key (overrides config) |
| `LOBSTER_MODEL` | LLM model name |
| `LOBSTER_BASE_URL` | LLM API base URL |
| `LOBSTER_CDP_ENDPOINT` | Chrome DevTools Protocol endpoint |
| `LOBSTER_BROWSER_PATH` | Path to Chrome/Chromium binary |

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework |
| `puppeteer-core` | Chrome control (no bundled Chrome) |
| `zod` | Schema validation |
| `chalk` | Terminal colors |
| `cli-table3` | Table formatting |
| `js-yaml` | YAML parsing |
| `ws` | WebSocket |

No AI SDK dependency. LLM calls use native `fetch()`.
