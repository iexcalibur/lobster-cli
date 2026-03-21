import yaml from 'js-yaml';
import type { ExploreResult } from './explore.js';

/**
 * Generate adapter YAML from explore results.
 * Uses field role mapping to auto-detect column names.
 */
export function synthesizeAdapter(result: ExploreResult, goal?: string): string {
  const topEndpoints = result.endpoints.filter((e) => e.score > 0).slice(0, 3);
  if (topEndpoints.length === 0) {
    return `# No API endpoints discovered for ${result.site}\n# Try using: lobster agent "your task" --url https://${result.domain}`;
  }

  const endpoint = topEndpoints[0];

  // Infer command name from goal or endpoint URL
  let name = goal || 'data';
  if (!goal) {
    const path = new URL(endpoint.url).pathname.toLowerCase();
    if (/search|query/.test(path)) name = 'search';
    else if (/hot|trending|popular/.test(path)) name = 'hot';
    else if (/feed|timeline|home/.test(path)) name = 'feed';
    else if (/top|best|rank/.test(path)) name = 'top';
  }

  // Build args from query params
  const args: Record<string, unknown> = {
    limit: { type: 'int', default: 20 },
  };
  for (const param of endpoint.queryParams) {
    if (/search|keyword|query|q/.test(param)) {
      args[param] = { required: true, positional: true, help: 'Search query' };
    } else if (/page|offset|cursor/.test(param)) {
      args[param] = { type: 'int', default: 1 };
    } else if (/limit|count|num|size/.test(param)) {
      // Already have limit
    }
  }

  // Build columns from field roles
  const columns: string[] = [];
  const mapTemplate: Record<string, string> = {};

  for (const [field, role] of Object.entries(endpoint.fieldRoles)) {
    if (['title', 'url', 'author', 'score', 'time', 'description'].includes(role)) {
      columns.push(role);
      mapTemplate[role] = `\${{ item.${field} }}`;
    }
  }

  // Fallback columns if no roles detected
  if (columns.length === 0) {
    for (const field of endpoint.fields.slice(0, 5)) {
      columns.push(field);
      mapTemplate[field] = `\${{ item.${field} }}`;
    }
  }

  // Build pipeline
  const pipeline: Record<string, unknown>[] = [];

  if (result.strategy === 'public' && !endpoint.authIndicators.length) {
    pipeline.push({ fetch: endpoint.url });
  } else {
    // Browser-based fetch with credentials
    pipeline.push({ navigate: `https://${result.domain}` });
    pipeline.push({
      evaluate: `(async () => { const r = await fetch(${JSON.stringify(endpoint.url)}, {credentials:'include'}); return r.json(); })()`,
    });
  }

  // Add select step if items are nested
  if (endpoint.hasItems && endpoint.itemCount > 0) {
    // Try to find the array path — check common patterns
    for (const path of ['data', 'results', 'items', 'list', 'data.items', 'data.list']) {
      pipeline.push({ select: path });
      break;
    }
  }

  if (Object.keys(mapTemplate).length > 0) {
    pipeline.push({ map: mapTemplate });
  }

  pipeline.push({ limit: '${{ args.limit }}' });

  const adapter = {
    site: result.site,
    name,
    description: `${name} from ${result.domain}`,
    domain: result.domain,
    strategy: result.strategy,
    browser: result.strategy !== 'public',
    args,
    pipeline,
    columns: columns.length > 0 ? columns : undefined,
  };

  return yaml.dump(adapter, { indent: 2, lineWidth: 120 });
}
