import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { getConfigDir } from '../config/index.js';
import { loadAdaptersFromDir } from '../adapter/loader.js';
import { log } from '../utils/logger.js';

const PLUGINS_DIR = join(getConfigDir(), 'plugins');

function ensurePluginsDir(): void {
  if (!existsSync(PLUGINS_DIR)) mkdirSync(PLUGINS_DIR, { recursive: true });
}

export function installPlugin(source: string): void {
  ensurePluginsDir();

  // Parse source: github:user/repo or https://github.com/user/repo
  let gitUrl = source;
  if (source.startsWith('github:')) {
    gitUrl = `https://github.com/${source.slice(7)}.git`;
  } else if (source.startsWith('https://github.com/') && !source.endsWith('.git')) {
    gitUrl = source + '.git';
  }

  const name = gitUrl.split('/').pop()?.replace('.git', '') || 'plugin';
  const dest = join(PLUGINS_DIR, name);

  if (existsSync(dest)) {
    log.warn(`Plugin "${name}" already installed. Uninstall first.`);
    return;
  }

  log.info(`Installing plugin: ${name}`);
  execSync(`git clone --depth 1 ${gitUrl} ${dest}`, { stdio: 'inherit' });

  // Install dependencies if package.json exists
  if (existsSync(join(dest, 'package.json'))) {
    log.info('Installing plugin dependencies...');
    execSync('npm install --omit=dev', { cwd: dest, stdio: 'inherit' });
  }

  // Load adapters
  const count = loadAdaptersFromDir(dest);
  log.success(`Plugin "${name}" installed with ${count} adapter(s)`);
}

export function uninstallPlugin(name: string): void {
  const dest = join(PLUGINS_DIR, name);
  if (!existsSync(dest)) {
    log.error(`Plugin "${name}" not found`);
    return;
  }
  rmSync(dest, { recursive: true, force: true });
  log.success(`Plugin "${name}" uninstalled`);
}

export function listPlugins(): { name: string; path: string }[] {
  ensurePluginsDir();
  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, path: join(PLUGINS_DIR, e.name) }));
}
