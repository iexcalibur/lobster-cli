import { ExecutionLevel } from '../types/router.js';
import type { RoutingDecision, ExecutionRequest } from '../types/router.js';
import { getAdapter, getAdapterByDomain } from '../adapter/registry.js';

export function makeRoutingDecision(request: ExecutionRequest): RoutingDecision {
  // 1. Explicit adapter match
  if (request.site && request.command) {
    const adapter = getAdapter(request.site, request.command);
    if (adapter) {
      return {
        level: ExecutionLevel.ADAPTER,
        reason: `Matched adapter: ${request.site}/${request.command}`,
        adapter,
      };
    }
  }

  // 2. URL-based adapter match
  if (request.url) {
    try {
      const domain = new URL(request.url).hostname;
      const adapters = getAdapterByDomain(domain);
      if (adapters.length > 0) {
        return {
          level: ExecutionLevel.ADAPTER,
          reason: `Found adapter for domain: ${domain}`,
          adapter: adapters[0],
        };
      }
    } catch {}
  }

  // 3. Simple HTTP check — URL-only request with no interaction task
  if (request.url && !request.task) {
    return {
      level: ExecutionLevel.HTTP,
      reason: 'Direct URL fetch (no task specified)',
    };
  }

  // 4. Simple fetch detection — URL looks like an API
  if (request.url) {
    const url = request.url;
    if (url.endsWith('.json') || url.includes('/api/') || url.includes('/v1/') || url.includes('/v2/')) {
      return {
        level: ExecutionLevel.HTTP,
        reason: 'URL appears to be an API endpoint',
      };
    }
  }

  // 5. Task requires interaction — use agent
  if (request.task) {
    const taskLower = request.task.toLowerCase();
    const interactionWords = ['click', 'scroll', 'fill', 'type', 'login', 'sign in', 'search', 'navigate', 'find', 'extract', 'get'];
    const needsInteraction = interactionWords.some((w) => taskLower.includes(w));

    if (needsInteraction || request.url) {
      return {
        level: ExecutionLevel.AGENT,
        reason: 'Task requires web interaction',
      };
    }
  }

  // Default: agent for anything unrecognized
  return {
    level: ExecutionLevel.AGENT,
    reason: 'Defaulting to AI agent for unrecognized task',
  };
}
