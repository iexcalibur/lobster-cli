/**
 * Interactive setup wizard for LobsterCLI.
 *
 * Guides users through provider selection, API key entry, model choice,
 * and validates the configuration with a test API call.
 */

import { createInterface } from 'node:readline';
import { saveConfig } from './config/index.js';
import { LLM_PROVIDERS, type LLMProvider } from './config/schema.js';

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function print(msg: string): void {
  console.log(msg);
}

function printBanner(): void {
  print('');
  print('  🦞 LobsterCLI Setup');
  print('  ───────────────────');
  print('');
  print('  Most features work without an API key:');
  print('    lobster fetch <url>     — fetch & extract content');
  print('    lobster run <url>       — run adapters/pipelines');
  print('    lobster explore <url>   — discover site APIs');
  print('');
  print('  AI agent mode (optional) needs an LLM provider:');
  print('    lobster agent "find pricing on example.com"');
  print('');
}

function printProviders(): void {
  const providers = Object.entries(LLM_PROVIDERS);
  print('  Available providers:');
  print('');
  providers.forEach(([key, p], i) => {
    const freeTag = key === 'ollama' ? ' (free, runs locally)' : '';
    print(`    ${i + 1}. ${p.name}${freeTag}`);
  });
  print(`    ${providers.length + 1}. Skip — I'll set it up later`);
  print('');
}

async function selectProvider(): Promise<LLMProvider | null> {
  const keys = Object.keys(LLM_PROVIDERS) as LLMProvider[];

  printProviders();
  const choice = await ask(`  Choose provider [1-${keys.length + 1}]: `);
  const num = parseInt(choice);

  if (isNaN(num) || num < 1 || num > keys.length + 1) {
    print('  Invalid choice. Skipping AI setup.');
    return null;
  }

  if (num === keys.length + 1) return null;

  return keys[num - 1];
}

async function getApiKey(provider: LLMProvider): Promise<string> {
  const p = LLM_PROVIDERS[provider];

  if (provider === 'ollama') {
    print(`\n  Ollama runs locally — no API key needed.`);
    print(`  Make sure Ollama is running: ollama serve`);
    return '';
  }

  print(`\n  Get your ${p.name} API key from:`);
  print(`  ${p.keyEnvHint}`);
  print('');

  const key = await ask('  API Key: ');

  if (!key) {
    print('  No key entered. You can set it later:');
    print(`    lobster config set llm.apiKey <your-key>`);
    print(`    # or: export LOBSTER_API_KEY=<your-key>`);
    return '';
  }

  return key;
}

async function selectModel(provider: LLMProvider): Promise<string> {
  const p = LLM_PROVIDERS[provider];

  print(`\n  Available models for ${p.name}:`);
  p.models.forEach((m, i) => {
    const defaultTag = m === p.defaultModel ? ' (recommended)' : '';
    print(`    ${i + 1}. ${m}${defaultTag}`);
  });
  print('');

  const choice = await ask(`  Choose model [1-${p.models.length}] (Enter for ${p.defaultModel}): `);

  if (!choice) return p.defaultModel;

  const num = parseInt(choice);
  if (isNaN(num) || num < 1 || num > p.models.length) {
    print(`  Invalid choice. Using ${p.defaultModel}`);
    return p.defaultModel;
  }

  return p.models[num - 1];
}

async function validateKey(provider: LLMProvider, apiKey: string, model: string): Promise<boolean> {
  if (!apiKey || provider === 'ollama') return true;

  print('\n  Validating API key...');

  const p = LLM_PROVIDERS[provider];

  try {
    if (provider === 'anthropic') {
      // Anthropic uses Messages API
      const resp = await fetch(`${p.baseURL}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      if (resp.ok) {
        print('  ✓ API key is valid!');
        return true;
      }

      if (resp.status === 401) {
        print('  ✗ Invalid API key. Check your key and try again.');
        return false;
      }

      // Other errors (rate limit, etc.) mean the key itself is valid
      print('  ✓ API key accepted (non-auth response)');
      return true;
    } else {
      // OpenAI-compatible (OpenAI, Gemini, Ollama)
      const resp = await fetch(`${p.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
        }),
      });

      if (resp.ok) {
        print('  ✓ API key is valid!');
        return true;
      }

      if (resp.status === 401) {
        print('  ✗ Invalid API key. Check your key and try again.');
        return false;
      }

      // 400/404 might mean wrong model but key is valid
      print('  ✓ API key accepted');
      return true;
    }
  } catch (err) {
    print(`  ⚠ Could not validate (network error). Saving anyway.`);
    return true;
  }
}

export async function runSetup(): Promise<void> {
  printBanner();

  const provider = await selectProvider();

  if (!provider) {
    print('\n  Setup complete! AI agent mode skipped.');
    print('  You can still use: lobster fetch, lobster run, lobster explore');
    print('  To add AI later: lobster setup\n');
    rl.close();
    return;
  }

  const p = LLM_PROVIDERS[provider];
  const apiKey = await getApiKey(provider);
  const model = await selectModel(provider);

  // Validate
  if (apiKey) {
    const valid = await validateKey(provider, apiKey, model);
    if (!valid) {
      const retry = await ask('  Save anyway? [y/N]: ');
      if (retry.toLowerCase() !== 'y') {
        print('\n  Setup cancelled. Run lobster setup to try again.\n');
        rl.close();
        return;
      }
    }
  }

  // Save config
  saveConfig({
    llm: {
      provider,
      baseURL: p.baseURL,
      model,
      apiKey,
      temperature: 0.1,
      maxRetries: 3,
    },
  });

  print('\n  ✓ Configuration saved to ~/.lobster/config.yaml');
  print('');
  print('  What you can do now:');
  print('  ─────────────────────');
  print('  lobster fetch <url>             — extract content (no AI needed)');
  print('  lobster run <url>               — run site adapters');
  print('  lobster explore <url>           — discover site APIs');
  if (apiKey || provider === 'ollama') {
    print(`  lobster agent "your task"       — AI agent (${p.name} / ${model})`);
  }
  print('');
  print('  To change settings later:');
  print('    lobster config set llm.apiKey <new-key>');
  print('    lobster config set llm.model <model-name>');
  print('    lobster config show');
  print('');

  rl.close();
}
