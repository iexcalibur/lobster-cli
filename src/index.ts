import { loadAdaptersFromDir } from './adapter/loader.js';
import { getConfigDir } from './config/index.js';
import { createCLI } from './cli.js';

// Import pipeline steps (registers them)
import './pipeline/index.js';

// Import built-in adapters (self-register via cli())
import './adapters/index.js';

async function main() {
  // Load user adapters (YAML files from ~/.lobster/adapters/)
  const userDir = getConfigDir() + '/adapters';
  loadAdaptersFromDir(userDir);

  // Load plugin adapters
  const pluginDir = getConfigDir() + '/plugins';
  loadAdaptersFromDir(pluginDir);

  // Create and run CLI
  const program = createCLI();
  program.parse(process.argv);
}

main().catch((err) => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
