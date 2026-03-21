import yaml from 'js-yaml';
import type { ExploreResult } from './explore.js';

export function synthesizeAdapter(result: ExploreResult, goal?: string): string {
  const topEndpoints = result.endpoints.slice(0, 3);
  if (topEndpoints.length === 0) {
    return `# No API endpoints discovered for ${result.site}\n# Try using: lobster agent "your task" --url https://${result.domain}`;
  }

  const endpoint = topEndpoints[0];
  const adapter = {
    site: result.site,
    name: goal || 'data',
    description: `Fetch data from ${result.domain}`,
    domain: result.domain,
    strategy: result.strategy,
    browser: result.strategy !== 'public',
    args: {
      limit: { type: 'int', default: 20 },
    },
    pipeline: [
      { fetch: endpoint.url },
      { limit: '${{ args.limit }}' },
    ],
    columns: ['title', 'url'],
  };

  return yaml.dump(adapter, { indent: 2 });
}
