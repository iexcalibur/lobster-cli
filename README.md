<p align="center">
  <img src="logo.svg" width="80" height="80" alt="LobsterCLI Logo" />
</p>

<h1 align="center">LobsterCLI</h1>

<p align="center">
  Web automation engine — CLI, Chrome extension, and importable library.<br/>
  Fetch pages, run pipelines, explore APIs, and let AI agents navigate sites.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20-black?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-black?style=flat-square" />
  <img src="https://img.shields.io/badge/AI-optional-c9a84c?style=flat-square" />
</p>

---

## What is LobsterCLI

LobsterCLI is a web automation engine that works in three ways:

| Product | What it is | Install |
|---------|-----------|---------|
| **CLI** | Terminal tool — fetch, scrape, explore, automate | `npm install -g lobster-cli` |
| **Chrome Extension** | Side panel chat UI — analyze any page you're browsing | Load `extension/` folder in Chrome |
| **Library** | Import into your own Node.js project | `import { ... } from 'lobster-cli'` |

All three share the same core engine — same Brain, same DOM extraction, same LLM client, same agent loop.

---

## When AI is needed vs when it's free

This is the most important thing to understand:

### CLI — What's free, what needs AI

| Command | AI needed? | What it does |
|---------|-----------|-------------|
| `lobster fetch <url>` | **No** | Fetch page, extract as markdown/text/snapshot/HTML. Uses in-house parser, no Chrome needed. |
| `lobster fetch <url> -e chrome` | **No** | Same but with full Chrome for JS-heavy pages. |
| `lobster explore <url>` | **No** | Discover APIs, intercept network calls, detect frameworks, generate adapters. |
| `lobster run <url>` | **No** | Run pre-built site adapters and YAML pipelines. |
| `lobster list` | **No** | List all registered adapters. |
| `lobster config` | **No** | View/edit settings. |
| `lobster doctor` | **No** | Diagnose setup, check Chrome, verify API key. |
| `lobster setup` | **No** | Interactive setup wizard (AI provider selection is optional). |
| `lobster plugin install` | **No** | Install community adapters from GitHub. |
| `lobster agent "task"` | **Yes** | AI agent that reads pages, reasons, clicks, types, and navigates autonomously. |

**80% of CLI features work without any API key.**

### Chrome Extension — What's free, what needs AI

| Action | AI needed? | What it does |
|--------|-----------|-------------|
| Click **"Summarize this page"** | **No** | Extracts headings, word count, content preview, page type, framework detection. |
| Click **"Extract as Markdown"** | **No** | Converts full page DOM to clean Markdown. Copy to clipboard. |
| Click **"Detect all forms"** | **No** | Scans all form fields — labels, types, values, required/disabled state. |
| Click **"Show key links"** | **No** | Extracts all meaningful links from the page. |
| Click **"Monitor API calls"** | **No** | Intercepts fetch/XHR, shows live API calls with method/URL/status. |
| Click **"DOM snapshot"** | **No** | 12-stage pruned DOM snapshot, LLM-optimized. |
| Type any question | **Yes** | Brain classifies intent, gathers right data, sends to LLM for answer. |
| Click **"What's on screen?"** | **Yes** | Captures screenshot + sends to vision model for visual analysis. |

**The 6 built-in chips work without AI. Typed questions need an API key.**

### What the Brain does (smart intent classification)

When you type a question, the Brain decides what data to gather before answering:

```
"summarize this page"              → Brain: { screenshot: false, markdown: true }
                                     Cost: ~$0.001 (text only)

"what is this email about"         → Brain: { screenshot: false, markdown: true }
                                     Cost: ~$0.001 (text only)

"what images are on this page"     → Brain: { screenshot: true, markdown: true }
                                     Cost: ~$0.01 (screenshot + text)

"what does the layout look like"   → Brain: { screenshot: true, markdown: false }
                                     Cost: ~$0.01 (screenshot only)

"what forms are on this page"      → Brain: { screenshot: false, forms: true }
                                     Cost: ~$0.001 (form extraction + text)
```

The Brain saves money by **not** taking screenshots when they aren't needed. Most questions only need text.

### Library — Same rules apply

```typescript
import { classifyIntent } from 'lobster-cli/brain'  // No AI needed for heuristic mode
import { PuppeteerPage } from 'lobster-cli/page'     // No AI needed
import { MARKDOWN_SCRIPT } from 'lobster-cli/dom'     // No AI needed
import { exploreSite } from 'lobster-cli/discover'    // No AI needed
import { AgentCore } from 'lobster-cli/agent'         // Needs AI
import { LLM } from 'lobster-cli/llm'                 // Needs AI
```

---

## Install

### CLI

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

Requires Node.js 20+. Chrome/Chromium needed only for browser features.

### Chrome Extension

1. Clone this repo
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the `extension/` folder
5. Click the LobsterCLI icon → opens as a side panel

### Library (in your own project)

```bash
npm install lobster-cli
```

```typescript
import { classifyIntent, heuristicClassify } from 'lobster-cli/brain'
import { PuppeteerPage, BrowserManager } from 'lobster-cli/browser'
import { SNAPSHOT_SCRIPT, MARKDOWN_SCRIPT } from 'lobster-cli/dom'
import { AgentCore } from 'lobster-cli/agent'
import { exploreSite } from 'lobster-cli/discover'
import { executePipeline } from 'lobster-cli/pipeline'
import { LLM } from 'lobster-cli/llm'
```

---

## AI Setup (optional)

AI is only needed for `lobster agent` and typed chat questions in the extension.

```bash
lobster setup
```

| Provider | Default Model | Cost | Best for |
|----------|--------------|------|----------|
| **Google Gemini** | gemini-2.5-flash | **Free tier** | Most users — free, fast, vision support |
| **OpenAI** | gpt-4o | Pay per token | Best reasoning |
| **Anthropic** | claude-sonnet-4 | Pay per token | Best for code analysis |
| **Ollama** | llama3.1 | **Free (local)** | Privacy, offline use |

Or set manually:

```bash
lobster config set llm.provider gemini
lobster config set llm.apiKey AIza...
lobster config set llm.model gemini-2.5-flash
```

---

## CLI Commands

### `lobster fetch <url>` — Extract content (no AI)

```bash
lobster fetch https://example.com                  # markdown output
lobster fetch https://example.com -d snapshot      # LLM-optimized DOM
lobster fetch https://example.com -d text          # plain text
lobster fetch https://example.com -d semantic      # W3C accessible tree
lobster fetch https://example.com -d html          # raw HTML
lobster fetch https://example.com -e chrome -w 5   # force Chrome, wait 5s
```

Engines: `auto` (default), `fast` (in-house parser, no Chrome), `chrome` (full browser).

### `lobster run <url>` — Smart router (no AI)

```bash
lobster run https://api.github.com/users/octocat   # direct HTTP fetch
lobster run https://news.ycombinator.com            # adapter if registered
lobster run https://example.com -f yaml             # output as YAML
```

### `lobster agent <task>` — AI agent (needs API key)

```bash
lobster agent "search for TypeScript on Hacker News" --url https://news.ycombinator.com
lobster agent "find the cheapest flight to Tokyo" --url https://google.com/flights
lobster agent "log in and check my notifications" --url https://github.com
```

The agent observes the DOM → sends to LLM → decides what to click/type/scroll → repeats until done (max 40 steps).

### `lobster explore <url>` — Discover APIs (no AI)

```bash
lobster explore https://reddit.com
lobster explore https://twitter.com -w 5
```

Intercepts network calls, clicks around to find hidden APIs, detects frameworks, scores endpoints, and generates adapter files.

### `lobster config` — Settings

```bash
lobster config show
lobster config set llm.provider anthropic
lobster config set browser.headless false
```

### `lobster plugin` — Community adapters

```bash
lobster plugin install github-user/reddit-adapter
lobster plugin list
```

---

## Chrome Extension

The extension is a chat-style side panel (like Gemini or Claude) docked to the right of your browser.

### Free features (no API key)

Click any of the 6 built-in chips:

- **Summarize this page** — page type, headings, word count, framework, content preview
- **Extract as Markdown** — full DOM-to-Markdown with copy button
- **Detect all forms** — every form field with label, type, value, required state
- **Show key links** — all meaningful links on the page
- **Monitor API calls** — live fetch/XHR interception
- **DOM snapshot** — 12-stage pruned snapshot

### AI features (needs API key)

Type any question in the chat:

- "What is this email about?" — reads page text, gives natural language answer
- "What images are on this page?" — captures screenshot, uses vision model
- "Draft a reply to this email" — reads content, writes a response
- "What color is the header?" — captures screenshot, analyzes visually

The **Brain** automatically decides whether to capture a screenshot or just read text, so you don't pay for vision when you don't need it.

### Setup AI in extension

Click the gear icon → Settings → pick provider → enter key → Save.

---

## Use as a library

LobsterCLI exports every module for use in your own projects:

```typescript
// Brain — intent classification
import { classifyIntent, heuristicClassify } from 'lobster-cli/brain'

// Browser — page control
import { BrowserManager, PuppeteerPage } from 'lobster-cli/browser'

// DOM scripts — run in any browser context
import { SNAPSHOT_SCRIPT, MARKDOWN_SCRIPT, FORM_STATE_SCRIPT } from 'lobster-cli/dom'

// Agent — autonomous web navigation
import { AgentCore } from 'lobster-cli/agent'

// LLM — multi-provider client
import { LLM } from 'lobster-cli/llm'

// Pipeline — declarative YAML execution
import { executePipeline } from 'lobster-cli/pipeline'

// Discovery — find site APIs
import { exploreSite } from 'lobster-cli/discover'

// Config — load/save settings
import { loadConfig, saveConfig } from 'lobster-cli/config'
```

### Example: build a search agent

```typescript
import { BrowserManager } from 'lobster-cli/browser'
import { AgentCore } from 'lobster-cli/agent'
import { LLM } from 'lobster-cli/llm'
import { classifyIntent } from 'lobster-cli/brain'

async function search(query) {
  // Brain decides what data is needed
  const intent = await classifyIntent(query, 'Google Search')

  // Launch browser
  const browser = new BrowserManager({ headless: true })
  const page = await browser.launch('https://google.com')

  // Run agent
  const agent = new AgentCore({ page, llm: new LLM(config), maxSteps: 20 })
  const result = await agent.execute(query)

  await page.close()
  return result
}
```

---

## Architecture

```
lobster-cli/
├── src/
│   ├── brain/          → Intent classifier (LLM + heuristic fallback)
│   ├── browser/        → IPage interface, Puppeteer adapter, DOM scripts
│   │   └── dom/        → 6 extraction strategies (snapshot, markdown, semantic, etc.)
│   ├── agent/          → Observe-think-act loop, 8 tools, auto-fixer
│   ├── llm/            → Multi-provider client (OpenAI, Anthropic, Gemini, Ollama)
│   ├── pipeline/       → YAML pipeline engine, 17 steps, template expressions
│   ├── adapter/        → Site adapter registry, YAML/TS loaders
│   ├── router/         → Smart routing (HTTP → Engine → Adapter → Agent)
│   ├── discover/       → API discovery, endpoint scoring, adapter generation
│   ├── cascade/        → Auth strategy detection (public → cookie → header → intercept)
│   ├── config/         → Settings (~/.lobster/config.yaml)
│   ├── output/         → Formatters (table, JSON, YAML, CSV, Markdown)
│   ├── plugin/         → GitHub plugin install/uninstall
│   ├── lib.ts          → Library exports (for npm import)
│   ├── cli.ts          → CLI commands (commander)
│   └── index.ts        → CLI entry point
│
├── extension/          → Chrome extension (side panel)
│   ├── sidepanel/      → Chat UI (HTML/CSS/JS)
│   ├── background/     → Service worker (LLM calls, screenshot capture)
│   ├── shared/         → DOM scripts (same code as CLI, ported to browser JS)
│   ├── options/        → Settings page
│   └── manifest.json   → Chrome extension manifest (v3, side panel API)
│
├── logo.svg            → Logo (SVG)
├── logo.png            → Logo (512px PNG)
└── package.json        → Dual: CLI binary + library exports
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

No AI SDK. LLM calls use native `fetch()` with our own protocol adapters.

---

## Origin — Built from three projects

LobsterCLI wasn't built from scratch. It was created by studying three open-source projects, extracting the best ideas from each, and combining them into one unified tool with all code written in-house.

### The three source projects

| Project | What it is | What we learned |
|---------|-----------|----------------|
| **Lightpanda** (browser-main) | Headless browser engine written in Zig. 11x faster than Chrome, no GUI. | How to build a fast HTML parser, DOM tree construction, semantic tree generation, markdown extraction |
| **Page Agent** (page-agent-main) | AI agent that navigates websites autonomously using LLM reasoning. | Observe-think-act loop, full click/type event simulation, DOM snapshot for LLM, auto-fixer for malformed responses |
| **OpenCLI** (opencli-main) | CLI tool with pre-built adapters for 30+ sites, pipeline engine, Chrome session reuse. | YAML pipeline system, site adapter pattern, strategy cascade, 12-stage DOM pruning, network interception, explore/discovery engine |

### What we took from each

**From Lightpanda:**
- In-house HTML parser (LobsterEngine) — no Chrome needed for simple pages
- Semantic tree with W3C accessible name algorithm
- Markdown extraction with full table/list/link support
- XPath generation for element location

**From Page Agent:**
- Agent loop: observe DOM → LLM reasons → act → repeat (max 40 steps)
- Full click event sequence: mouseenter → mouseover → mousedown → focus → mouseup → click
- Full type system: synthetic InputEvents → execCommand fallback → native value setter (works on React/Vue)
- MacroTool pattern: pack all tools into single LLM function with reflection fields
- Auto-fixer: 7 strategies to fix malformed LLM responses

**From OpenCLI:**
- 12-stage DOM snapshot: visibility, occlusion, shadow DOM, iframes, ad filtering, diff marking
- Pipeline engine: 17 YAML steps with template expressions and 16 filters
- Strategy cascade: PUBLIC → COOKIE → HEADER → INTERCEPT auto-detection
- Explore engine: smart scroll, interactive fuzzing, endpoint scoring, artifact generation
- Adapter registry: YAML/TypeScript adapters with lazy loading
- Network interceptor: dual fetch + XHR patching
- Download system: HTTP + yt-dlp + cookie forwarding + progress tracking
- Batch IPC: N fetch requests in single evaluate() call

### What makes LobsterCLI different from all three

None of the original projects could do everything:

| Capability | Lightpanda | Page Agent | OpenCLI | LobsterCLI |
|-----------|-----------|-----------|---------|------------|
| Fast fetch (no Chrome) | Yes | No | No | **Yes** |
| AI agent navigation | No | Yes | No | **Yes** |
| Site adapters (YAML) | No | No | Yes | **Yes** |
| Pipeline engine | No | No | Yes | **Yes** |
| API discovery | No | No | Yes | **Yes** |
| Smart routing | No | No | Partial | **Yes** |
| Works without AI | Yes | No | Yes | **Yes** |
| Chrome extension | No | No | Yes (different) | **Yes** |
| Importable as library | No | No | No | **Yes** |
| Intent classifier (Brain) | No | No | No | **Yes** |
| Screenshot + vision | No | No | No | **Yes** |
| Multi-provider LLM | No | Yes (OpenAI only) | No | **Yes** (4 providers) |

**LobsterCLI is the first tool that combines all three approaches** — fast headless fetching, AI agent automation, and pre-built site adapters — into a single installable package that works as a CLI, a Chrome extension, and an importable library.

All code is written in-house. No wrappers, no imports from the source projects. We took inspiration and patterns, then built everything from scratch in TypeScript.

---

## License

MIT
