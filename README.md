# LobsterCLI

Unified CLI for intelligent web automation — adapters, pipelines, AI agents, and headless browsing in one tool.

## Architecture

LobsterCLI combines three approaches to web automation into a single escalation chain:

```
Level 0: Direct HTTP    → fastest, for public APIs
Level 1: Headless Browser → for JS-rendered pages
Level 2: Site Adapters   → pre-built commands for known sites
Level 3: AI Agent        → autonomous navigation for unknown sites
```

The Smart Router automatically picks the best approach for each task.

## Install

```bash
npm install -g lobster-cli
```

Requires Node.js 20+ and Chrome/Chromium for browser features.

## Usage

```bash
# Run a pre-built adapter
lobster hackernews top --limit 5

# Smart route a URL
lobster run https://api.example.com/data.json

# AI agent for complex tasks
lobster agent "search for TypeScript on Hacker News" --url https://news.ycombinator.com

# Explore a site's APIs
lobster explore https://example.com

# List available adapters
lobster list

# Configure
lobster config set llm.apiKey sk-...
lobster config set llm.model gpt-4o
```

## Project Structure

```
src/
  types/        → Shared TypeScript interfaces
  config/       → Config loading (~/.lobster/config.yaml)
  output/       → Formatters (table, json, yaml, csv, markdown)
  llm/          → OpenAI-compatible LLM client with retry logic
  browser/      → Puppeteer wrapper implementing IPage interface
    dom/        → DOM extraction (flat tree, snapshot, semantic tree, markdown)
  pipeline/     → YAML pipeline engine with template expressions
    steps/      → Pipeline steps (fetch, browser, transform, intercept, download)
  adapter/      → Adapter registry, YAML loader, Commander bridge
  agent/        → AI agent (observe-think-act loop, tools, auto-fixer)
    tools/      → Agent tools (click, type, scroll, select, wait, done)
  router/       → Smart Router with escalation chain
  discover/     → Site exploration and adapter generation
  plugin/       → Plugin install/uninstall from GitHub
  cascade/      → Auth strategy cascade probe
  http/         → Direct HTTP fetch (Level 0)
  adapters/     → Built-in site adapters
```

## Key Concepts

- **IPage** — Universal browser abstraction. Everything talks through this interface.
- **Adapters** — Pre-built commands for known sites (TypeScript or YAML).
- **Pipelines** — Declarative YAML steps: `fetch → select → map → limit`.
- **Template Expressions** — `${{ args.keyword | truncate(50) }}` with filters.
- **Agent Loop** — Observe DOM → LLM thinks → Act → Repeat.
- **MacroTool** — All agent tools packed into one LLM tool with reflection fields.
- **Strategy Cascade** — Auto-detect auth: PUBLIC → COOKIE → HEADER → INTERCEPT.

## License

MIT
