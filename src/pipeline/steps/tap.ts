/**
 * Pipeline step: tap — Vue store action bridge.
 *
 * Calls a Pinia/Vuex store action inside the browser and intercepts
 * the resulting network request to capture the response.
 *
 * This is the most powerful data extraction method for Vue apps — it
 * triggers the app's own data fetching logic and captures the result.
 *
 * Usage in YAML pipeline:
 *   - tap:
 *       store: searchStore
 *       action: fetchResults
 *       capture: /api/search
 *       args:
 *         - ${{ args.query }}
 *         - page: 1
 *       timeout: 5
 *       select: data.items
 */

import type { PipelineContext } from '../../types/pipeline.js';
import { renderTemplate } from '../template.js';
import { registerStep } from '../registry.js';

interface TapParams {
  store: string;
  action: string;
  capture: string;
  args?: unknown[];
  timeout?: number;
  select?: string;
}

registerStep('tap', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  if (!ctx.page) throw new Error('Browser page required for tap step');

  const p = renderTemplate(params, { args: ctx.args, data: ctx.data }) as TapParams;
  const storeName = p.store;
  const actionName = p.action;
  const capturePattern = p.capture;
  const actionArgs = p.args || [];
  const timeoutSec = p.timeout || 5;
  const selectPath = p.select;

  // Build a self-contained JS block that:
  // 1. Patches fetch/XHR to intercept matching responses
  // 2. Finds the Pinia/Vuex store
  // 3. Calls the action with provided args
  // 4. Waits for the intercepted response
  // 5. Restores original fetch/XHR
  const result = await ctx.page.evaluate<unknown>(`
    (async () => {
      let captured = null;
      let captureResolve;
      const capturePromise = new Promise(r => { captureResolve = r; });
      const capturePattern = ${JSON.stringify(capturePattern)};
      const timeoutMs = ${timeoutSec * 1000};

      // 1. Patch fetch
      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        const resp = await origFetch.apply(this, args);
        try {
          const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
          if (url.includes(capturePattern) && !captured) {
            captured = await resp.clone().json();
            captureResolve();
          }
        } catch {}
        return resp;
      };

      // 2. Patch XHR
      const origSend = XMLHttpRequest.prototype.send;
      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__tapUrl = url;
        return origOpen.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
          if (this.__tapUrl?.includes(capturePattern) && !captured) {
            try {
              captured = JSON.parse(this.responseText);
              captureResolve();
            } catch {}
          }
        });
        return origSend.apply(this, args);
      };

      try {
        // 3. Find the store
        const app = document.querySelector('#app');
        let store = null;

        // Try Pinia via __vue_app__
        if (app?.__vue_app__) {
          const pinia = app.__vue_app__.config?.globalProperties?.$pinia;
          if (pinia?._s) {
            store = pinia._s.get(${JSON.stringify(storeName)});
          }
          // Try Vuex
          if (!store) {
            const vuex = app.__vue_app__.config?.globalProperties?.$store;
            if (vuex) store = vuex;
          }
        }

        // Fallback: global pinia
        if (!store && window.__pinia?._s) {
          store = window.__pinia._s.get(${JSON.stringify(storeName)});
        }

        if (!store) {
          return { error: 'Store not found: ' + ${JSON.stringify(storeName)} };
        }

        // 4. Call the action
        const actionFn = store[${JSON.stringify(actionName)}];
        if (typeof actionFn !== 'function') {
          return { error: 'Action not found: ' + ${JSON.stringify(actionName)} };
        }

        await actionFn.apply(store, ${JSON.stringify(actionArgs)});

        // 5. Wait for capture
        if (!captured) {
          await Promise.race([
            capturePromise,
            new Promise(r => setTimeout(r, timeoutMs)),
          ]);
        }
      } finally {
        // 6. Restore originals
        window.fetch = origFetch;
        XMLHttpRequest.prototype.send = origSend;
        XMLHttpRequest.prototype.open = origOpen;
      }

      return captured;
    })()
  `);

  if (!result) return null;
  if ((result as any)?.error) {
    throw new Error((result as any).error);
  }

  // Apply select path if specified (e.g., "data.items")
  if (selectPath) {
    let current: unknown = result;
    for (const part of selectPath.split('.')) {
      if (current === null || current === undefined) return null;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  return result;
});
