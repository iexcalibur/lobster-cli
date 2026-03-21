import type { Adapter } from '../types/adapter.js';
import { Strategy } from '../types/adapter.js';

// Global registry — shared across module instances (critical for plugins)
const REGISTRY_KEY = '__lobster_registry__';
if (!(globalThis as any)[REGISTRY_KEY]) {
  (globalThis as any)[REGISTRY_KEY] = new Map<string, Adapter>();
}

function getRegistry(): Map<string, Adapter> {
  return (globalThis as any)[REGISTRY_KEY];
}

export function cli(def: Partial<Adapter> & { site: string; name: string }): Adapter {
  const adapter: Adapter = {
    site: def.site,
    name: def.name,
    description: def.description || `${def.site} ${def.name}`,
    domain: def.domain,
    strategy: def.strategy || Strategy.PUBLIC,
    browser: def.browser ?? (def.strategy !== Strategy.PUBLIC),
    args: def.args || [],
    columns: def.columns,
    func: def.func,
    pipeline: def.pipeline,
    timeoutSeconds: def.timeoutSeconds,
    navigateBefore: def.navigateBefore,
  };

  const fullName = `${adapter.site}/${adapter.name}`;
  getRegistry().set(fullName, adapter);
  return adapter;
}

export function getAdapter(site: string, name: string): Adapter | undefined {
  return getRegistry().get(`${site}/${name}`);
}

export function getAdapterBySite(site: string): Adapter[] {
  const adapters: Adapter[] = [];
  for (const [key, adapter] of getRegistry()) {
    if (key.startsWith(`${site}/`)) adapters.push(adapter);
  }
  return adapters;
}

export function getAdapterByDomain(domain: string): Adapter[] {
  const adapters: Adapter[] = [];
  for (const adapter of getRegistry().values()) {
    if (adapter.domain && domain.includes(adapter.domain)) adapters.push(adapter);
  }
  return adapters;
}

export function getAllAdapters(): Adapter[] {
  return [...getRegistry().values()];
}

export function getAllSites(): string[] {
  const sites = new Set<string>();
  for (const adapter of getRegistry().values()) {
    sites.add(adapter.site);
  }
  return [...sites].sort();
}

export { Strategy };
