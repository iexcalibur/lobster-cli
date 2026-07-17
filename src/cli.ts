import { Command } from 'commander';
import { loadConfig, setConfigValue } from './config/index.js';
import { render } from './output/index.js';
import { SmartRouter } from './router/index.js';
import { getAllAdapters, getAllSites, getAdapter, getAdapterBySite } from './adapter/registry.js';
import { bridgeAdaptersToCommander } from './adapter/commander-bridge.js';
import { installPlugin, uninstallPlugin, listPlugins } from './plugin/index.js';
import { log } from './utils/logger.js';
import type { OutputFormat } from './types/router.js';

export function createCLI(): Command {
  const program = new Command();

  program
    .name('lobster')
    .description('Unified CLI for intelligent web automation')
    .version('0.5.0');

  // === lobster run <url> ===
  program
    .command('run <url>')
    .description('Smart router: auto-detect best approach for a URL')
    .option('-t, --task <task>', 'Task to perform on the page')
    .option('-f, --format <format>', 'Output format', 'json')
    .action(async (url, opts) => {
      const config = loadConfig();
      const router = new SmartRouter(config);
      try {
        const { data, format } = await router.execute({
          task: opts.task || '',
          url,
          format: opts.format as OutputFormat,
        });
        console.log(render(data, format));
      } finally {
        await router.close();
      }
    });

  // === lobster agent <task> ===
  program
    .command('agent <task>')
    .description('Use AI agent to complete a web task')
    .option('-u, --url <url>', 'Starting URL')
    .option('-f, --format <format>', 'Output format', 'json')
    .action(async (task, opts) => {
      const config = loadConfig();
      const router = new SmartRouter(config);
      try {
        const { data, format } = await router.execute({
          task,
          url: opts.url,
          format: opts.format as OutputFormat,
        });
        console.log(render(data, format));
      } finally {
        await router.close();
      }
    });

  // === lobster fetch <url> ===
  program
    .command('fetch <url>')
    .description('Fetch a URL and return structured content (markdown, text, snapshot, html, links)')
    .option('-d, --dump <format>', 'Output: markdown, snapshot, text, html, links', 'markdown')
    .option('-w, --wait <seconds>', 'Wait after page load (chrome engine only)', '2')
    .option('-e, --engine <engine>', 'Engine: auto, fast, chrome', 'auto')
    .option('--no-headless', 'Show browser window (chrome engine only)')
    .action(async (url, opts) => {
      const config = loadConfig();
      const engine = opts.engine as string;
      const dump = opts.dump as string;

      // ── Document detection: PDF, DOCX, XLSX, PPTX, EPUB, CSV, JSON ──
      const docExtensions = /\.(pdf|docx?|xlsx?|pptx?|epub|csv|tsv|json|jsonl)(\?.*)?$/i;
      const isDocument = docExtensions.test(url) || /\/pdf\//.test(url) || /arxiv\.org\/pdf/.test(url);

      if (isDocument) {
        const { convertDocument } = await import('./doc/index.js');

        // Check if AI-assisted PDF repair is available
        const hasAIKey = !!(config.llm?.apiKey);
        const isPdf = /\.pdf(\?.*)?$/i.test(url) || /\/pdf\//.test(url) || /arxiv\.org\/pdf/.test(url);

        try {
          const result = await convertDocument(url, {
            pdf: isPdf && hasAIKey ? {
              aiAssist: true,
              sourceUrl: url,
              getBrowser: async () => {
                const { BrowserManager } = await import('./browser/manager.js');
                const manager = new BrowserManager({
                  executablePath: config.browser?.executablePath || undefined,
                  headless: true,
                });
                const page = await manager.newPage();
                return {
                  page,
                  close: async () => { await manager.close(); },
                };
              },
              callAI: async (prompt: string, screenshot: string) => {
                const { OpenAIClient } = await import('./llm/openai-client.js');
                const client = new OpenAIClient({
                  baseURL: config.llm.baseURL,
                  apiKey: config.llm.apiKey,
                  model: config.llm.model,
                  provider: config.llm.provider as any,
                });
                return client.chatWithVision(prompt, screenshot);
              },
            } : undefined,
          });
          console.log(`Source: ${result.source}`);
          console.log(`Format: ${result.format} | Pages: ${result.pages} | Words: ${result.wordCount}`);
          console.log(`Title: ${result.title}`);
          console.log(`Engine: LobsterDoc${isPdf && hasAIKey ? ' + AI Doctor' : ''} (${result.duration}ms)`);
          console.log(`---`);
          console.log(result.markdown);
          return;
        } catch (err: any) {
          log.debug(`LobsterDoc failed: ${err.message}, falling back to fetch`);
        }
      }

      // ── Fast engine: in-house parser, no Chrome needed ──
      const useFast = engine === 'fast' || engine === 'auto';

      if (useFast) {
        const { lobsterFetch } = await import('./browser/lightpanda.js');

        try {
          const result = await lobsterFetch(url, {
            dump: dump as any,
            timeout: 30000,
          });

          console.log(`URL: ${result.finalUrl}`);
          console.log(`Title: ${result.title}`);
          console.log(`Engine: fast (${result.duration}ms) | Status: ${result.status || result.statusCode}`);
          console.log(`---`);
          console.log(result.content);
          return;
        } catch (err: any) {
          if (engine === 'fast') throw err;
          // auto mode: fast failed (probably needs JS), fall through to chrome
          log.debug(`Fast engine failed: ${err.message}, falling back to Chrome`);
        }
      }

      // ── Chrome engine: full browser with JS execution ──
      const { BrowserManager } = await import('./browser/manager.js');
      const { PuppeteerPage } = await import('./browser/page-adapter.js');

      const manager = new BrowserManager({
        executablePath: config.browser.executablePath || undefined,
        headless: opts.headless ?? config.browser.headless,
      });

      try {
        const rawPage = await manager.newPage();
        const page = new PuppeteerPage(rawPage, { stealth: config.browser.stealth });
        const start = Date.now();

        await page.goto(url);
        await page.wait(parseInt(opts.wait) || 2);

        let output: string;

        switch (dump) {
          case 'markdown': case 'md':
            output = await page.markdown();
            break;
          case 'snapshot': case 'snap':
            output = await page.snapshot();
            break;
          case 'semantic': case 'tree':
            output = await page.semanticTree();
            break;
          case 'html':
            output = await page.evaluate<string>('document.documentElement.outerHTML');
            break;
          case 'text':
            output = await page.evaluate<string>('document.body.innerText');
            break;
          default:
            output = await page.markdown();
        }

        const elapsed = Date.now() - start;
        const state = await page.browserState();
        console.log(`URL: ${state.url}`);
        console.log(`Title: ${state.title}`);
        console.log(`Engine: chrome (${elapsed}ms) | Page: ${state.pageWidth}x${state.pageHeight}px`);
        console.log(`---`);
        console.log(output);

        await page.close();
      } finally {
        await manager.close();
      }
    });

  // === lobster list ===
  program
    .command('list')
    .description('List all registered adapters')
    .option('-f, --format <format>', 'Output format', 'table')
    .action((opts) => {
      const adapters = getAllAdapters();
      const data = adapters.map((a) => ({
        site: a.site,
        command: a.name,
        description: a.description,
        strategy: a.strategy,
        browser: a.browser ? 'yes' : 'no',
      }));
      console.log(render(data, opts.format as OutputFormat, ['site', 'command', 'description', 'strategy', 'browser']));
    });

  // === lobster config ===
  const configCmd = program.command('config').description('Manage configuration');

  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key, value) => {
      setConfigValue(key, value);
      log.success(`Set ${key} = ${value}`);
    });

  configCmd
    .command('show')
    .description('Show current configuration')
    .action(() => {
      const config = loadConfig();
      // Mask API key
      const display = JSON.parse(JSON.stringify(config));
      if (display.llm?.apiKey) {
        display.llm.apiKey = display.llm.apiKey.slice(0, 8) + '...';
      }
      console.log(render(display, 'yaml'));
    });

  // === lobster history ===
  const historyCmd = program.command('history').description('Inspect and export past agent runs');

  historyCmd
    .command('list')
    .description('List persisted agent runs (newest first)')
    .option('-f, --format <format>', 'Output format', 'table')
    .option('-n, --limit <count>', 'Max runs to show', '20')
    .action(async (opts) => {
      const config = loadConfig();
      const { listRuns } = await import('./history/index.js');
      const parsedLimit = parseInt(opts.limit);
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;
      const runs = listRuns(config.history.dir || undefined).slice(0, limit);
      if (runs.length === 0) {
        log.info('No runs recorded yet. Run `lobster agent "<task>" --url <url>` first.');
        return;
      }
      const data = runs.map((r) => ({
        run: r.runId,
        started: r.startedAt.replace('T', ' ').slice(0, 19),
        status: r.success === undefined ? 'incomplete' : r.success ? 'ok' : 'failed',
        steps: r.steps,
        task: r.task.length > 50 ? r.task.slice(0, 47) + '...' : r.task,
        url: r.url || '',
      }));
      console.log(render(data, opts.format as OutputFormat, ['run', 'started', 'status', 'steps', 'task', 'url']));
    });

  historyCmd
    .command('show <run>')
    .description('Show one run transcript (use a run id, id prefix, or "last")')
    .action(async (runArg) => {
      const config = loadConfig();
      const { resolveRun } = await import('./history/index.js');
      const run = resolveRun(runArg, config.history.dir || undefined);
      if (run && 'ambiguous' in run) {
        log.error(`Ambiguous run id "${runArg}" matches ${run.ambiguous.length} runs:\n  ${run.ambiguous.join('\n  ')}`);
        process.exitCode = 1;
        return;
      }
      if (!run) {
        log.error(`Run not found: ${runArg}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Run:      ${run.runId}`);
      console.log(`Task:     ${run.task}`);
      if (run.url) console.log(`URL:      ${run.url}`);
      console.log(`Started:  ${run.startedAt}`);
      if (run.endedAt) console.log(`Ended:    ${run.endedAt}`);
      console.log(`Status:   ${run.success === undefined ? 'incomplete' : run.success ? 'success' : 'failed'}`);
      if (run.model) console.log(`Model:    ${run.provider}/${run.model}`);
      if (run.result) console.log(`Result:   ${run.result}`);
      console.log('');
      for (const event of run.events) {
        if (event.type === 'step') {
          console.log(`[step ${event.step}] ${event.action.name}(${JSON.stringify(event.action.args)})`);
          if (event.reflection?.next_goal) console.log(`  goal:   ${event.reflection.next_goal}`);
          if (event.url) console.log(`  url:    ${event.url}`);
          console.log(`  result: ${event.output.slice(0, 200)}`);
        } else if (event.type === 'observation') {
          console.log(`[obs] ${event.message}`);
        } else if (event.type === 'error') {
          console.log(`[error @ step ${event.step}] ${event.error}`);
        }
      }
    });

  historyCmd
    .command('export')
    .description('Export runs as ctx-history-jsonl-v1 (for `ctx import`; works as a ctx history-source plugin)')
    .option('-r, --run <run>', 'Export a single run (id, prefix, or "last")')
    .option('-o, --out <file>', 'Write to file instead of stdout')
    .action(async (opts) => {
      const config = loadConfig();
      const dir = config.history.dir || undefined;
      const { listRuns, resolveRun, exportRunsToCtxJsonl } = await import('./history/index.js');

      // ctx history-source plugin protocol: emit a valid (possibly empty)
      // stream on stdout, honor the incremental cursor, exit 0.
      const pluginMode = process.env.CTX_HISTORY_PLUGIN === '1';
      let prevCursor = '';
      if (pluginMode && process.env.CTX_HISTORY_FULL_RESCAN !== '1') {
        prevCursor = process.env.CTX_HISTORY_CURSOR || '';
        if (process.env.CTX_HISTORY_CURSOR_FILE) {
          try {
            const { readFileSync } = await import('node:fs');
            prevCursor = readFileSync(process.env.CTX_HISTORY_CURSOR_FILE, 'utf-8').trim();
          } catch {}
        }
      }

      const allRuns = listRuns(dir);
      let runs = allRuns;
      if (opts.run) {
        const run = resolveRun(opts.run, dir);
        if (run && 'ambiguous' in run) {
          log.error(`Ambiguous run id "${opts.run}" matches ${run.ambiguous.length} runs:\n  ${run.ambiguous.join('\n  ')}`);
          process.exitCode = 1;
          return;
        }
        if (!run) {
          log.error(`Run not found: ${opts.run}`);
          process.exitCode = 1;
          return;
        }
        runs = [run];
      } else if (prevCursor) {
        // Watermark on endedAt || startedAt: a run exported mid-flight
        // (no run_end yet) re-exports after it finishes, so ctx upserts
        // its final status instead of keeping it "interrupted" forever.
        runs = runs.filter((r) => (r.endedAt || r.startedAt) > prevCursor);
      }

      if (runs.length === 0 && !pluginMode) {
        log.error('No runs to export.');
        process.exitCode = 1;
        return;
      }

      const watermark = allRuns.reduce((max, r) => {
        const t = r.endedAt || r.startedAt;
        return t > max ? t : max;
      }, prevCursor || '');
      const jsonl = exportRunsToCtxJsonl(runs, {
        dir,
        sourceId: pluginMode ? process.env.CTX_HISTORY_SOURCE_ID : undefined,
        cursorAfter: pluginMode ? (watermark || new Date(0).toISOString()) : undefined,
      });
      if (opts.out) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(opts.out, jsonl, 'utf-8');
        log.success(`Exported ${runs.length} run(s) to ${opts.out}`);
      } else {
        process.stdout.write(jsonl);
      }
    });

  historyCmd
    .command('path')
    .description('Print the runs directory')
    .action(async () => {
      const config = loadConfig();
      const { getRunsDir } = await import('./history/index.js');
      console.log(getRunsDir(config.history.dir || undefined));
    });

  historyCmd
    .command('clear')
    .description('Delete all persisted runs')
    .option('--force', 'Actually delete (required)')
    .action(async (opts) => {
      const config = loadConfig();
      const { listRuns, clearRuns } = await import('./history/index.js');
      const dir = config.history.dir || undefined;
      const count = listRuns(dir).length;
      if (!opts.force) {
        log.info(`Would delete ${count} run(s). Re-run with --force to confirm.`);
        return;
      }
      const removed = clearRuns(dir);
      log.success(`Deleted ${removed} run(s).`);
    });

  // === lobster explore ===
  program
    .command('explore <url>')
    .description('Discover APIs and capabilities of a website')
    .option('-w, --wait <seconds>', 'Wait time for page load', '3')
    .action(async (url, opts) => {
      const config = loadConfig();
      const { BrowserManager } = await import('./browser/manager.js');
      const { PuppeteerPage } = await import('./browser/page-adapter.js');
      const { exploreSite } = await import('./discover/explore.js');
      const { synthesizeAdapter } = await import('./discover/synthesize.js');

      const manager = new BrowserManager({
        executablePath: config.browser.executablePath || undefined,
        headless: config.browser.headless,
      });

      try {
        const rawPage = await manager.newPage();
        const page = new PuppeteerPage(rawPage, { stealth: config.browser.stealth });
        const result = await exploreSite(page, url, { wait: parseInt(opts.wait) });
        await page.close();

        console.log('\n--- Explore Results ---');
        console.log(`Site: ${result.site}`);
        console.log(`Domain: ${result.domain}`);
        console.log(`Framework: ${result.framework}`);
        console.log(`Strategy: ${result.strategy}`);
        console.log(`Endpoints found: ${result.endpoints.length}`);

        if (result.endpoints.length > 0) {
          console.log('\n--- Top Endpoints ---');
          for (const ep of result.endpoints.slice(0, 5)) {
            console.log(`  ${ep.method} ${ep.url} [score: ${ep.score}]`);
          }

          console.log('\n--- Generated Adapter ---');
          console.log(synthesizeAdapter(result));
        }
      } finally {
        await manager.close();
      }
    });

  // === lobster setup ===
  program
    .command('setup')
    .description('Interactive setup wizard — configure AI provider, API key, and model')
    .action(async () => {
      const { runSetup } = await import('./setup.js');
      await runSetup();
    });

  // === lobster doctor ===
  program
    .command('doctor')
    .description('Diagnose setup and connectivity')
    .action(async () => {
      const config = loadConfig();
      console.log('LobsterCLI Doctor\n');

      // Check config
      console.log('Configuration:');
      console.log(`  LLM Provider: ${config.llm.provider || 'openai'}`);
      console.log(`  LLM Model: ${config.llm.model}`);
      console.log(`  LLM API Key: ${config.llm.apiKey ? 'set' : 'NOT SET — run lobster setup'}`);
      console.log(`  LLM Base URL: ${config.llm.baseURL}`);
      console.log(`  Browser Path: ${config.browser.executablePath || 'auto-detect'}`);
      console.log(`  CDP Endpoint: ${config.browser.cdpEndpoint || 'none'}`);

      // Check engines
      console.log('\nEngines:');
      console.log('  LobsterEngine (fast): BUILT-IN — in-house HTML parser, no Chrome needed');

      console.log('\nChrome (full browser):');
      try {
        const { BrowserManager } = await import('./browser/manager.js');
        const manager = new BrowserManager({
          executablePath: config.browser.executablePath || undefined,
          headless: true,
        });
        const browser = await manager.connect();
        const version = await browser.version();
        console.log(`  Chrome: ${version}`);
        await manager.close();
      } catch (err) {
        console.log(`  Chrome: NOT FOUND (${err})`);
      }

      // Check adapters
      const adapters = getAllAdapters();
      console.log(`\nAdapters: ${adapters.length} registered`);
      const sites = getAllSites();
      console.log(`Sites: ${sites.join(', ') || 'none'}`);

      // Check plugins
      const plugins = listPlugins();
      console.log(`Plugins: ${plugins.length} installed`);
    });

  // === lobster plugin ===
  const pluginCmd = program.command('plugin').description('Manage plugins');

  pluginCmd
    .command('install <source>')
    .description('Install a plugin from GitHub')
    .action((source) => installPlugin(source));

  pluginCmd
    .command('uninstall <name>')
    .description('Uninstall a plugin')
    .action((name) => uninstallPlugin(name));

  pluginCmd
    .command('list')
    .description('List installed plugins')
    .action(() => {
      const plugins = listPlugins();
      if (plugins.length === 0) {
        console.log('No plugins installed');
      } else {
        for (const p of plugins) {
          console.log(`  ${p.name} → ${p.path}`);
        }
      }
    });

  // Bridge registered adapters into Commander subcommands
  bridgeAdaptersToCommander(program);

  return program;
}
