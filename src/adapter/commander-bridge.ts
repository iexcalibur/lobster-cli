import type { Command } from 'commander';
import { getAllSites, getAdapterBySite, getAdapter } from './registry.js';
import { render } from '../output/index.js';
import { SmartRouter } from '../router/index.js';
import { loadConfig } from '../config/index.js';
import type { Adapter } from '../types/adapter.js';
import type { OutputFormat } from '../types/router.js';

export function bridgeAdaptersToCommander(program: Command): void {
  const sites = getAllSites();

  for (const site of sites) {
    const adapters = getAdapterBySite(site);
    if (adapters.length === 0) continue;

    const siteCmd = program
      .command(site)
      .description(`${site} commands`);

    for (const adapter of adapters) {
      const cmd = siteCmd
        .command(adapter.name)
        .description(adapter.description);

      // Add arguments
      for (const arg of adapter.args) {
        if (arg.positional) {
          const bracket = arg.required ? `<${arg.name}>` : `[${arg.name}]`;
          cmd.argument(bracket, arg.help || '');
        } else {
          const flag = `--${arg.name}${arg.type === 'boolean' ? '' : ` <${arg.type || 'string'}>`}`;
          if (arg.default !== undefined) {
            cmd.option(flag, arg.help || '', String(arg.default));
          } else if (arg.required) {
            cmd.requiredOption(flag, arg.help || '');
          } else {
            cmd.option(flag, arg.help || '');
          }
        }
      }

      cmd.option('-f, --format <format>', 'Output format', 'table');

      // Action handler — executes the adapter
      cmd.action(async (...rawArgs: unknown[]) => {
        // Commander passes positional args first, then opts object, then Command
        const opts = rawArgs[rawArgs.length - 2] as Record<string, unknown>;
        const positionalArgs = rawArgs.slice(0, -2) as string[];

        // Build kwargs from positional + options
        const kwargs: Record<string, unknown> = { ...opts };
        let posIdx = 0;
        for (const arg of adapter.args) {
          if (arg.positional && posIdx < positionalArgs.length) {
            kwargs[arg.name] = positionalArgs[posIdx++];
          }
        }

        // Coerce types
        for (const arg of adapter.args) {
          if (kwargs[arg.name] !== undefined) {
            if (arg.type === 'int') kwargs[arg.name] = parseInt(String(kwargs[arg.name]));
            else if (arg.type === 'float') kwargs[arg.name] = parseFloat(String(kwargs[arg.name]));
            else if (arg.type === 'boolean') kwargs[arg.name] = kwargs[arg.name] === 'true' || kwargs[arg.name] === true;
          } else if (arg.default !== undefined) {
            kwargs[arg.name] = arg.default;
          }
        }

        const format = (kwargs.format as OutputFormat) || 'table';
        delete kwargs.format;

        const config = loadConfig();
        const router = new SmartRouter(config);

        try {
          const { data } = await router.execute({
            task: '',
            site: adapter.site,
            command: adapter.name,
            args: kwargs,
            format,
          });
          console.log(render(data, format, adapter.columns));
        } finally {
          await router.close();
        }
      });
    }
  }
}

export function resolveAdapterFromArgs(site: string, command: string): Adapter | undefined {
  return getAdapter(site, command);
}
