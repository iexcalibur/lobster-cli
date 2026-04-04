<p align="center">
  <img src="logo.svg" width="80" height="80" alt="LobsterCLI Logo" />
</p>

<h1 align="center">LobsterCLI</h1>

<p align="center">
  Web automation for everyone — fetch pages, analyze content, and let AI navigate sites for you.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/lobster-cli"><img src="https://img.shields.io/npm/v/lobster-cli?style=flat-square&color=c9a84c" alt="npm" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-black?style=flat-square" />
  <img src="https://img.shields.io/badge/AI-optional-c9a84c?style=flat-square" />
</p>

---

## What is LobsterCLI

LobsterCLI is a web automation tool that works as a **CLI**, a **Chrome extension**, and an **npm library**. It handles everything from simple page fetching to full AI-powered browser automation — and 80% of features work without any API key.

```bash
npm install -g lobster-cli
```

Requires Node.js 20+.

---

## CLI

```bash
# Extract content from any page
lobster fetch https://example.com

# Discover APIs on a site
lobster explore https://reddit.com

# AI agent navigates a site for you
lobster agent "find pricing on example.com" --url https://example.com

# Stealth mode for bot-protected sites
lobster fetch https://linkedin.com --stealth

# Use a persistent browser profile (cookies survive restarts)
lobster agent "check my notifications" --url https://github.com --profile work

# Attach to your running Chrome (use your logged-in sessions)
lobster agent "check inbox" --url https://gmail.com --attach
```

### Commands

| Command | AI needed? | What it does |
|---------|-----------|-------------|
| `lobster fetch <url>` | No | Extract page content as markdown, text, or structured data |
| `lobster explore <url>` | No | Discover APIs, detect frameworks, find hidden endpoints |
| `lobster run <url>` | No | Run site-specific adapters and automation pipelines |
| `lobster agent "task"` | Yes | AI agent that reasons, clicks, types, and navigates for you |
| `lobster setup` | No | Interactive setup wizard |
| `lobster doctor` | No | Diagnose your setup |
| `lobster config` | No | View and edit settings |

---

## Chrome Extension

Chat-style side panel that analyzes any page you're browsing.

**Install from Chrome Web Store** or load the extension manually:
1. Open `chrome://extensions/` and enable Developer mode
2. Click "Load unpacked" and select the `extension/` folder
3. Click the LobsterCLI icon to open the side panel

### What it can do

**Without AI (free):**
- Summarize any page — headings, word count, content preview, framework detection
- Extract full page as Markdown
- Detect all forms and input fields
- Show key links on the page
- Monitor live API calls
- DOM snapshot

**With AI (bring your own key):**
- Ask any question about the current page
- YouTube video transcript extraction and Q&A
- PDF document analysis
- Visual analysis — describes what's on screen
- Smart intent detection — only gathers what's needed to answer your question

---

## AI Setup (optional)

```bash
lobster setup
```

| Provider | Cost |
|----------|------|
| **Google Gemini** | Free tier available |
| **Ollama** | Free (runs locally) |
| **OpenAI** | Pay per token |
| **Anthropic** | Pay per token |

The extension has its own settings page — click the gear icon in the side panel.

---

## Key Capabilities

- **Works without AI** — most features need zero API keys or tokens
- **Persistent browser sessions** — login once, cookies survive restarts
- **Chrome attach** — connect to your running Chrome with all your logins
- **Stealth mode** — anti-bot detection built in
- **Site-specific adapters** — custom automation for any website
- **Domain restrictions** — lock the tool to specific websites for vertical products
- **Full modern web support** — React, Vue, Angular, shadow DOM, iframes, dynamic content

---

## License

Copyright (c) 2025 iexcalibur. All rights reserved.

See [LICENSE](LICENSE) for terms.
