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
    .version('0.1.0');

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
    .description('Fetch a URL with browser (JS execution) and return structured content')
    .option('-d, --dump <format>', 'Output format: markdown, snapshot, semantic, html, text', 'markdown')
    .option('-w, --wait <seconds>', 'Wait after page load', '2')
    .option('--no-headless', 'Show browser window')
    .action(async (url, opts) => {
      const config = loadConfig();
      const { BrowserManager } = await import('./browser/manager.js');
      const { PuppeteerPage } = await import('./browser/page-adapter.js');

      const manager = new BrowserManager({
        executablePath: config.browser.executablePath || undefined,
        headless: opts.headless ?? config.browser.headless,
      });

      try {
        const rawPage = await manager.newPage();
        const page = new PuppeteerPage(rawPage);

        await page.goto(url);
        await page.wait(parseInt(opts.wait) || 2);

        let output: string;
        const dump = opts.dump as string;

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

        // Also show browser state header
        const state = await page.browserState();
        console.log(`URL: ${state.url}`);
        console.log(`Title: ${state.title}`);
        console.log(`Page: ${state.pageWidth}x${state.pageHeight}px`);
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

  // === lobster doctor ===
  program
    .command('doctor')
    .description('Diagnose setup and connectivity')
    .action(async () => {
      const config = loadConfig();
      console.log('LobsterCLI Doctor\n');

      // Check config
      console.log('Configuration:');
      console.log(`  LLM Model: ${config.llm.model}`);
      console.log(`  LLM API Key: ${config.llm.apiKey ? 'set' : 'NOT SET'}`);
      console.log(`  Browser Path: ${config.browser.executablePath || 'auto-detect'}`);
      console.log(`  CDP Endpoint: ${config.browser.cdpEndpoint || 'none'}`);

      // Check browser
      console.log('\nBrowser:');
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
