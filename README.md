# LobsterCLI

One CLI for all web automation. Fetch pages, run pipelines, explore APIs, and let AI agents navigate sites — all from a single command.

```bash
lobster fetch https://example.com              # no AI, no Chrome, instant
lobster run https://news.ycombinator.com       # smart routing, auto-detect best approach
lobster agent "find pricing on example.com"    # AI figures it out autonomously
lobster explore https://reddit.com             # discover hidden APIs, generate adapters
```

## Why LobsterCLI

Most tools do one thing. Puppeteer gives you browser control. LangChain gives you AI chains. Scrapy gives you crawling. You wire them together yourself, pick the right one for each job, and maintain the glue.

LobsterCLI merges all three approaches into one tool with a smart router that picks the best strategy automatically:

```
Your query
    |
    ├── Known site?        → Adapter (pre-built, instant, $0)
    ├── Simple page?       → LobsterEngine (in-house parser, no Chrome, $0)
    ├── JS-heavy page?     → Chrome via Puppeteer (full rendering, $0)
    └── Complex task?      → AI Agent (LLM-powered, autonomous, ~$0.01-0.05)
```

**You don't choose the strategy. The CLI does.**

### What makes it different

| Feature | Puppeteer | Playwright | Scrapy | LobsterCLI |
|---------|-----------|------------|--------|------------|
| Headless browsing | Yes | Yes | No | Yes |
| No-browser fast fetch | No | No | Yes | Yes (built-in engine) |
| AI agent mode | No | No | No | Yes |
| Site adapters (YAML) | No | No | No | Yes |
| Pipeline engine | No | No | Partial | Yes (17 steps) |
| Auto API discovery | No | No | No | Yes |
| Smart routing | No | No | No | Yes |
| Multi-provider LLM | No | No | No | Yes (OpenAI, Anthropic, Gemini, Ollama) |
| Plugin ecosystem | No | No | Yes | Yes |
| Works without AI key | N/A | N/A | N/A | Yes — most features are free |

## Install

```bash
# Install globally
npm install -g lobster-cli

# Or clone and build
git clone https://github.com/iexcalibur/lobster-cli.git
cd lobster-cli
npm install
npm run build
npm link
```

**Requirements:**
- Node.js 20+
- Chrome/Chromium (only for browser features — `fetch` command works without it)

### First-time setup

```bash
lobster setup
```

Interactive wizard that walks you through:
1. Pick an AI provider (or skip — most features work without one)
2. Enter API key
3. Choose model
4. Validates with a test call

```
  Available providers:

    1. OpenAI
    2. Anthropic
    3. Google Gemini
    4. Ollama (free, runs locally)
    5. Skip — I'll set it up later
```

**AI is optional.** These commands work with zero configuration:
- `lobster fetch` — fetch and extract content
- `lobster run` — run site adapters and pipelines
- `lobster explore` — discover site APIs
- `lobster list` — list available adapters

Only `lobster agent` needs an LLM API key.

### Alternative setup (no wizard)

```bash
# One-liner
lobster config set llm.provider gemini
lobster config set llm.apiKey AIza...
lobster config set llm.model gemini-2.0-flash

# Or environment variable
export LOBSTER_API_KEY=sk-your-key-here
export LOBSTER_MODEL=gpt-4o
```

### Verify installation

```bash
lobster doctor
```

Shows provider, model, API key status, Chrome detection, registered adapters, and installed plugins.

## Commands

### `lobster fetch <url>` — Extract content from any page

No Chrome, no AI. Uses the built-in LobsterEngine (in-house HTML parser) for speed. Falls back to Chrome only if the page needs JavaScript.

```bash
lobster fetch https://example.com                       # markdown output
lobster fetch https://example.com -d snapshot           # LLM-optimized DOM snapshot
lobster fetch https://example.com -d text               # plain text
lobster fetch https://example.com -d semantic            # W3C accessible tree
lobster fetch https://example.com -d html               # raw HTML
lobster fetch https://example.com -e chrome -w 5        # force Chrome, wait 5s
```

**Engines:**
- `auto` (default) — tries fast engine first, falls back to Chrome if JS is needed
- `fast` — in-house parser only, no Chrome
- `chrome` — full Puppeteer browser

### `lobster run <url>` — Smart router

Auto-detects the best approach for a URL. If an adapter exists for the site, uses it. Otherwise escalates through the engine chain.

```bash
lobster run https://api.github.com/users/octocat        # direct HTTP (public API)
lobster run https://news.ycombinator.com                 # adapter if registered
lobster run https://example.com -t "get all links"       # with task description
lobster run https://example.com -f yaml                  # output as YAML
```

### `lobster agent <task>` — AI-powered automation

Give it a task in plain English. The agent observes the DOM, reasons about what to do, and acts — clicking, typing, scrolling, and extracting data autonomously.

```bash
lobster agent "search for TypeScript on Hacker News" --url https://news.ycombinator.com
lobster agent "find the cheapest flight to Tokyo" --url https://google.com/flights
lobster agent "log in and check my notifications" --url https://github.com
```

**How it works:**
1. Takes a DOM snapshot (12-stage pruned, LLM-optimized)
2. Sends to LLM with tool definitions
3. LLM decides: click, type, scroll, wait, or done
4. Executes the action with full browser event simulation
5. Repeats until task is complete (max 40 steps)

**Agent tools:** click, type, scroll, select dropdown, wait, execute JS, ask user, done.

### `lobster explore <url>` — Discover site APIs

Navigates to a site, intercepts all network requests, clicks around to trigger hidden APIs, and outputs a full analysis.

```bash
lobster explore https://reddit.com
lobster explore https://twitter.com -w 5
```

**What it does:**
- Installs network interceptors (fetch + XHR patching)
- Smart auto-scrolls with MutationObserver (detects lazy-loaded content)
- Clicks buttons/tabs to trigger hidden API calls (interactive fuzzing)
- Scores and ranks discovered endpoints
- Detects framework (React, Vue, Next.js, Nuxt, Angular, Svelte)
- Discovers Vue stores (Pinia/Vuex) and their actions
- Infers auth strategy (public, cookie, header, intercept)
- Writes artifacts to `.lobster/explore/<site>/`:
  - `manifest.json` — site metadata
  - `endpoints.json` — all discovered endpoints with scores
  - `capabilities.json` — inferred CLI commands
  - `auth.json` — auth indicators
  - `stores.json` — Vue/React store details
- Auto-generates a YAML adapter you can use immediately

### `lobster list` — Show available adapters

```bash
lobster list
lobster list -f json
```

### `lobster config` — Manage settings

```bash
lobster config show                              # show all settings (key masked)
lobster config set llm.provider anthropic        # switch provider
lobster config set llm.model claude-sonnet-4-20250514
lobster config set llm.apiKey sk-ant-...
lobster config set browser.headless false        # show browser window
lobster config set output.defaultFormat yaml     # default output format
```

Config is stored at `~/.lobster/config.yaml`.

### `lobster plugin` — Extend with community adapters

```bash
lobster plugin install github-user/reddit-adapter
lobster plugin list
lobster plugin uninstall reddit-adapter
```

## Supported AI Providers

| Provider | Models | Cost | Setup |
|----------|--------|------|-------|
| **OpenAI** | gpt-4o, gpt-4o-mini, o1, o3-mini | Pay per token | `lobster setup` → choose OpenAI |
| **Anthropic** | claude-opus-4, claude-sonnet-4, claude-haiku-4.5 | Pay per token | `lobster setup` → choose Anthropic |
| **Google Gemini** | gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash | Free tier available | `lobster setup` → choose Gemini |
| **Ollama** | llama3.1, mistral, deepseek-r1, codestral | Free (local) | Install [Ollama](https://ollama.ai), then `lobster setup` |

All providers work through a unified client. Anthropic uses its native Messages API (auto-converted). OpenAI, Gemini, and Ollama use the OpenAI-compatible chat completions format.

## Architecture

```
src/
  cli.ts              → Command definitions (commander)
  setup.ts            → Interactive setup wizard
  index.ts            → Entry point

  config/             → Config loading, schema, defaults (~/.lobster/config.yaml)
  types/              → Shared TypeScript interfaces (IPage, LLMConfig, etc.)

  router/             → Smart Router — picks best approach per query
    decision.ts       → Routing logic (adapter → engine → agent)

  browser/            → Browser abstraction layer
    page-adapter.ts   → PuppeteerPage implements IPage
    manager.ts        → Chrome lifecycle (launch, connect, close)
    lightpanda.ts     → LobsterEngine — in-house HTML parser (no Chrome)
    wait.ts           → Wait conditions (text, time, network idle)
    interceptor.ts    → Network request interception (fetch + XHR)
    dom/              → 6 DOM extraction strategies
      flat-tree.ts    → Indexed interactive elements for AI agent
      snapshot.ts     → 12-stage pruned snapshot with diff marking
      semantic-tree.ts→ W3C accessible names + XPath
      markdown.ts     → Full DOM-to-Markdown (tables, lists, links)
      interactive.ts  → Interactive element classification
      form-state.ts   → Form field extraction (labels, values, state)

  pipeline/           → Declarative YAML pipeline engine
    executor.ts       → Step-by-step execution with context passing
    template.ts       → Template expressions (${{ }}) with 16 filters
    registry.ts       → Step registration
    steps/
      fetch.ts        → HTTP requests with batch IPC
      browser.ts      → navigate, click, type, wait, press, snapshot, evaluate
      transform.ts    → select (JSONPath), map, filter, sort, limit
      intercept.ts    → Network interception + trigger actions
      download.ts     → HTTP + yt-dlp + document extraction
      tap.ts          → Vue store action bridge (Pinia/Vuex)

  adapter/            → Site adapter system
    registry.ts       → Global adapter registry
    loader.ts         → Load TS adapters
    yaml-loader.ts    → Load YAML adapters
    commander-bridge.ts → Bridge adapters to CLI subcommands

  agent/              → AI agent (observe-think-act loop)
    core.ts           → Agent loop with reflection and history
    macro-tool.ts     → Pack all tools into single LLM tool
    auto-fixer.ts     → Fix malformed LLM responses (7 strategies)
    prompts/system.md → System prompt
    tools/            → 8 agent tools (click, type, scroll, etc.)

  llm/                → Multi-provider LLM client
    openai-client.ts  → Unified client (OpenAI, Anthropic, Gemini, Ollama)
    client.ts         → High-level LLM with retry + macro tool
    errors.ts         → Typed errors (auth, rate limit, network, etc.)
    utils.ts          → Zod → OpenAI tool schema conversion

  discover/           → Site exploration and adapter generation
    explore.ts        → API discovery (smart scroll, fuzzing, artifacts)
    synthesize.ts     → Auto-generate YAML adapter from explore results

  cascade/            → Auth strategy cascade (PUBLIC → COOKIE → HEADER → INTERCEPT)
  http/               → Direct HTTP fetch (Level 0)
  output/             → Output formatters (table, json, yaml, csv, markdown)
  plugin/             → Plugin install/uninstall from GitHub
  utils/              → Logger, timeout helpers
```

## Key Concepts

### IPage Interface

Every browser interaction goes through `IPage` — a unified abstraction over Puppeteer (and potentially other backends). This means the agent, pipelines, and adapters all use the same API:

```typescript
interface IPage {
  goto(url): Promise<void>
  snapshot(): Promise<string>          // LLM-optimized DOM
  semanticTree(): Promise<string>      // W3C accessible tree
  markdown(): Promise<string>          // content as markdown
  formState(): Promise<FormState>      // all form fields
  click(ref): Promise<void>            // full event sequence
  typeText(ref, text): Promise<void>   // React/Vue compatible
  scroll(direction): Promise<void>     // nested container aware
  networkRequests(): Promise<NetworkEntry[]>
  // ... 20+ methods
}
```

### Smart Router Escalation

```
Level 0: Direct HTTP     → Public APIs, JSON endpoints ($0, ~200ms)
Level 1: LobsterEngine   → Static HTML pages, no JS ($0, ~300ms)
Level 2: Chrome/Puppeteer → JS-rendered SPAs ($0, ~2-5s)
Level 3: Site Adapters    → Known sites with pipelines ($0, ~1-3s)
Level 4: AI Agent         → Unknown sites, complex tasks (~$0.01-0.05, ~10-30s)
```

### Pipeline System

Declarative YAML pipelines with 17 registered steps:

```yaml
name: hackernews-top
site: hackernews
steps:
  - navigate: https://news.ycombinator.com
  - snapshot: true
  - evaluate: |
      [...document.querySelectorAll('.titleline > a')].map(a => ({
        title: a.textContent, url: a.href
      }))
  - limit: ${{ args.limit | default(10) }}
```

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

### Strategy Cascade

Auto-detects the right auth approach for a site:

1. **PUBLIC** — no auth, direct fetch works
2. **COOKIE** — needs browser cookies (session-based)
3. **HEADER** — needs Bearer token or CSRF token
4. **INTERCEPT** — needs to intercept signed/dynamic requests

### Snapshot Diff Marking

Between agent steps, new DOM elements are marked with `*`:

```
[0] <button> Search
[1] <input> text field
*[2] <div> New result that appeared after clicking Search
*[3] <a> Another new element
```

The agent sees exactly what changed — no need to diff the entire DOM.

## Writing Adapters

### TypeScript adapter

```typescript
// adapters/mysite/search.ts
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

### YAML adapter (pipeline)

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

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `LOBSTER_API_KEY` | LLM API key (overrides config file) |
| `LOBSTER_MODEL` | LLM model name |
| `LOBSTER_BASE_URL` | LLM API base URL |
| `LOBSTER_CDP_ENDPOINT` | Chrome DevTools Protocol endpoint |
| `LOBSTER_BROWSER_PATH` | Path to Chrome/Chromium binary |

## Dependencies

LobsterCLI keeps dependencies minimal:

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework |
| `puppeteer-core` | Chrome control (no bundled Chrome) |
| `zod` | Schema validation |
| `chalk` | Terminal colors |
| `cli-table3` | Table formatting |
| `js-yaml` | YAML parsing |
| `ws` | WebSocket client |

No AI SDK dependency. LLM calls use native `fetch()` with our own protocol adapters.

## License

MIT
