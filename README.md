<p align="center">
  <img src="logo.svg" width="80" height="80" alt="LobsterCLI Logo" />
</p>

<h1 align="center">LobsterCLI</h1>

<p align="center">
  Web automation engine — CLI, Chrome extension, and importable library.<br/>
  Fetch pages, run pipelines, explore APIs, and let AI agents navigate sites.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/lobster-cli"><img src="https://img.shields.io/npm/v/lobster-cli?style=flat-square&color=c9a84c" alt="npm" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-black?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-black?style=flat-square" />
  <img src="https://img.shields.io/badge/AI-optional-c9a84c?style=flat-square" />
</p>

---

## Why LobsterCLI

Every web automation tool today does one thing. Puppeteer gives you browser control — but no intelligence. LangChain gives you AI chains — but no browser. Scrapy gives you crawling — but no JavaScript. You end up wiring 3-4 tools together, writing glue code, and deciding which tool to use for each task.

LobsterCLI is a single engine that does all of it. It has a **Smart Router** that automatically picks the best approach for your task — from a simple HTTP fetch to a full AI agent — so you never have to choose.

**What makes it unique:**

- **One tool, not four.** Fetch, scrape, explore, and AI-navigate — all from `lobster`.
- **AI is optional.** 80% of features work without any API key. The free tier covers most use cases.
- **Smart Brain.** When you do use AI, the Brain classifies your intent and gathers only what's needed — no wasted tokens on screenshots when text is enough.
- **Three interfaces, one engine.** CLI for developers, Chrome extension for everyone, npm library for builders. Same core, same results.
- **Persistent sessions.** Login once with `--profile`, your cookies and auth survive forever. Attach to your running Chrome with `--attach` — use your real logged-in sessions.
- **Stealth built-in.** Anti-bot detection out of the box. No separate puppeteer-stealth plugin, no extra config.
- **Domain restrictions.** Build vertical products on top — a finance tool that only works on Bloomberg, a legal tool that only works on case databases. One config line.
- **Actually works on modern sites.** Full React/Vue event simulation, shadow DOM, iframe extraction, dynamic content detection. Not just static HTML scraping.

---

## What is LobsterCLI

LobsterCLI is a web automation engine that works in three ways:

| Product | What it is | Install |
|---------|-----------|---------|
| **CLI** | Terminal tool — fetch, scrape, explore, automate | `npm install -g lobster-cli` |
| **Chrome Extension** | Side panel chat UI — analyze any page you're browsing | Load `extension/` in Chrome |
| **Library** | Import into your own Node.js project | `npm install lobster-cli` |

All three share the same core engine. **80% of features work without any AI key.**

---

## Install

```bash
npm install -g lobster-cli
```

Or clone and build:

```bash
git clone https://github.com/iexcalibur/lobster-cli.git
cd lobster-cli
npm install && npm run build && npm link
```

Requires Node.js 20+. Chrome/Chromium needed only for browser features.

---

## Quick Start

```bash
# Extract content from any page (no AI, no Chrome)
lobster fetch https://example.com

# Discover hidden APIs on a site
lobster explore https://reddit.com

# AI agent navigates autonomously (needs API key)
lobster agent "find pricing on example.com" --url https://example.com

# Use stealth mode to avoid bot detection
lobster fetch https://linkedin.com --stealth

# Use a persistent profile (cookies survive restarts)
lobster agent "check my notifications" --url https://github.com --profile work

# Attach to your running Chrome (use your logged-in sessions)
lobster agent "check inbox" --url https://gmail.com --attach
```

---

## What's Free vs What Needs AI

### CLI

| Command | AI? | What it does |
|---------|-----|-------------|
| `lobster fetch <url>` | No | Extract as markdown, text, snapshot, HTML, semantic tree |
| `lobster explore <url>` | No | Discover APIs, detect frameworks, generate adapters |
| `lobster run <url>` | No | Run site adapters and YAML pipelines |
| `lobster list` | No | List registered adapters |
| `lobster config` | No | View/edit settings |
| `lobster doctor` | No | Diagnose setup |
| `lobster setup` | No | Interactive setup wizard |
| `lobster plugin install` | No | Install community adapters |
| `lobster agent "task"` | **Yes** | AI agent that reasons, clicks, types, navigates |

### Chrome Extension

| Action | AI? | What it does |
|--------|-----|-------------|
| Summarize this page | No | Headings, word count, content preview, framework detection |
| Extract as Markdown | No | Full DOM-to-Markdown with copy button |
| Detect all forms | No | Labels, types, values, required/disabled state |
| Show key links | No | All meaningful links on the page |
| Monitor API calls | No | Live fetch/XHR interception |
| DOM snapshot | No | 12-stage pruned snapshot |
| Type any question | **Yes** | Brain classifies intent, gathers data, sends to LLM |
| What's on screen? | **Yes** | Captures screenshot + vision model analysis |

---

## AI Setup (optional)

```bash
lobster setup
```

| Provider | Model | Cost |
|----------|-------|------|
| **Google Gemini** | gemini-2.5-flash | Free tier available |
| **OpenAI** | gpt-4o | Pay per token |
| **Anthropic** | claude-sonnet-4 | Pay per token |
| **Ollama** | llama3.1 | Free (runs locally) |

---

## Key Features

### Smart Brain
When you ask a question, the Brain classifies your intent and gathers only what's needed:

```
"summarize this page"           → reads text only (~$0.001)
"what images are showing"       → captures screenshot + text (~$0.01)
"what forms are on this page"   → extracts form data (~$0.001)
```

### Persistent Profiles
Store Chrome sessions that survive restarts — cookies, auth, extensions.

```bash
lobster profile create work
lobster agent "check gmail" --profile work    # login persists
```

### Chrome Attach
Connect to your running Chrome with all your logins.

```bash
lobster agent "check notifications" --attach
```

### Stealth Mode
Anti-bot detection — hides headless Chrome fingerprint.

```bash
lobster fetch https://protected-site.com --stealth
```

### Compact Snapshot
Token-efficient DOM snapshots (~800 tokens vs ~3000+).

```bash
lobster fetch https://example.com -d snapshot --compact
```

### Semantic Element Finding
AI agent finds elements by name instead of guessing index numbers.

```
"click the login button" → finds [1] button "Sign In" (score: 0.81)
```

### Domain Guard
Restrict which websites the engine can operate on.

```typescript
import { DomainGuard } from 'lobster-cli/domain-guard'

const guard = new DomainGuard({
  allowDomains: ['bloomberg.com', 'yahoo.com'],
  blockMessage: 'This tool only works on finance sites.',
})
```

### Site Explorer
Discover hidden APIs on any website — no AI needed.

```bash
lobster explore https://reddit.com
```

Intercepts network calls, clicks buttons to trigger hidden APIs, detects frameworks, scores endpoints, and generates YAML adapters.

### Pipeline Engine
Declarative YAML pipelines with 17 steps and template expressions.

```yaml
steps:
  - navigate: https://news.ycombinator.com
  - evaluate: |
      [...document.querySelectorAll('.titleline > a')]
        .map(a => ({ title: a.textContent, url: a.href }))
  - limit: 10
```

---

## Use as a Library

```bash
npm install lobster-cli
```

```typescript
import { classifyIntent } from 'lobster-cli/brain'
import { BrowserManager, PuppeteerPage } from 'lobster-cli/browser'
import { SNAPSHOT_SCRIPT, MARKDOWN_SCRIPT } from 'lobster-cli/dom'
import { AgentCore } from 'lobster-cli/agent'
import { DomainGuard } from 'lobster-cli/domain-guard'
import { exploreSite } from 'lobster-cli/discover'
import { executePipeline } from 'lobster-cli/pipeline'
import { LLM } from 'lobster-cli/llm'
```

---

## Chrome Extension

Chat-style side panel docked to the right of your browser (like Gemini or Claude).

**Install:**
1. Clone this repo
2. Open `chrome://extensions/` → enable Developer mode
3. Click Load unpacked → select `extension/` folder
4. Click LobsterCLI icon → side panel opens

**AI setup:** Click gear icon → Settings → pick provider → enter key → Save.

---

## Documentation

For detailed technical documentation, see **[DOCS.md](DOCS.md)**.

---

## License

MIT License — Copyright (c) 2025 iexcalibur

See [LICENSE](LICENSE) for full text.
