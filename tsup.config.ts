import { defineConfig } from 'tsup';

export default defineConfig([
  // CLI binary (lobster command)
  {
    entry: { 'index': 'src/index.ts' },
    format: ['esm'],
    target: 'node20',
    outDir: 'dist',
    clean: true,
    splitting: false,
    sourcemap: true,
    dts: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  // Library exports (for importing in other projects)
  {
    entry: {
      'lib': 'src/lib.ts',
      'brain/index': 'src/brain/index.ts',
      'llm/index': 'src/llm/index.ts',
      'llm/client': 'src/llm/client.ts',
      'llm/openai-client': 'src/llm/openai-client.ts',
      'browser/index': 'src/browser/index.ts',
      'browser/page-adapter': 'src/browser/page-adapter.ts',
      'browser/manager': 'src/browser/manager.ts',
      'domain-guard': 'src/domain-guard.ts',
      'browser/dom/index': 'src/browser/dom/index.ts',
      'browser/dom/compact-snapshot': 'src/browser/dom/compact-snapshot.ts',
      'browser/profiles': 'src/browser/profiles.ts',
      'browser/chrome-attach': 'src/browser/chrome-attach.ts',
      'browser/stealth': 'src/browser/stealth.ts',
      'browser/semantic-find': 'src/browser/semantic-find.ts',
      'agent/index': 'src/agent/index.ts',
      'agent/core': 'src/agent/core.ts',
      'history/index': 'src/history/index.ts',
      'pipeline/index': 'src/pipeline/index.ts',
      'router/index': 'src/router/index.ts',
      'router/decision': 'src/router/decision.ts',
      'discover/index': 'src/discover/index.ts',
      'config/index': 'src/config/index.ts',
      'config/schema': 'src/config/schema.ts',
      'cascade/index': 'src/cascade/index.ts',
      'output/index': 'src/output/index.ts',
      'types/index': 'src/types/index.ts',
      'doc/index': 'src/doc/index.ts',
    },
    format: ['esm'],
    target: 'node20',
    outDir: 'dist',
    clean: false,  // Don't clean — CLI build already ran
    splitting: false,
    sourcemap: true,
    dts: false,  // TODO: fix DOM type errors in page-adapter.ts for DTS generation
  },
]);
