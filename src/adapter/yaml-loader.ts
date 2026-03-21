import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { cli } from './registry.js';
import { Strategy } from '../types/adapter.js';
import type { Adapter, Arg } from '../types/adapter.js';

export function loadYamlAdapter(filePath: string): Adapter {
  const raw = readFileSync(filePath, 'utf-8');
  const def = yaml.load(raw) as Record<string, unknown>;

  if (!def.site || !def.name) {
    throw new Error(`YAML adapter missing site/name: ${filePath}`);
  }

  // Normalize args
  const args: Arg[] = [];
  if (def.args && typeof def.args === 'object') {
    for (const [name, val] of Object.entries(def.args as Record<string, unknown>)) {
      if (typeof val === 'object' && val !== null) {
        args.push({ name, ...(val as Omit<Arg, 'name'>) });
      } else {
        args.push({ name, default: val });
      }
    }
  }

  const strategy = def.strategy
    ? (Object.values(Strategy).includes(def.strategy as Strategy) ? def.strategy as Strategy : Strategy.PUBLIC)
    : Strategy.PUBLIC;

  return cli({
    site: def.site as string,
    name: def.name as string,
    description: (def.description as string) || '',
    domain: def.domain as string | undefined,
    strategy,
    browser: def.browser as boolean | undefined,
    args,
    columns: def.columns as string[] | undefined,
    pipeline: def.pipeline as Record<string, unknown>[] | undefined,
    timeoutSeconds: def.timeoutSeconds as number | undefined,
  });
}
