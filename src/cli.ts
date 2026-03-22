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
    .version('0.3.0');

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
        const page = new PuppeteerPage(rawPage);
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
        const page = new PuppeteerPage(rawPage);
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
