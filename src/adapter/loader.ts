import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadYamlAdapter } from './yaml-loader.js';
import { log } from '../utils/logger.js';

export function loadAdaptersFromDir(dir: string): number {
  if (!existsSync(dir)) return 0;

  let count = 0;
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Recurse into subdirectories (site folders)
      count += loadAdaptersFromDir(fullPath);
    } else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
      try {
        loadYamlAdapter(fullPath);
        count++;
      } catch (err) {
        log.warn(`Failed to load adapter ${fullPath}: ${err}`);
      }
    } else if (entry.endsWith('.ts') || entry.endsWith('.js')) {
      // TS/JS adapters loaded via dynamic import in execution phase
      // Just count them here
      count++;
    }
  }

  return count;
}

export async function loadTsAdapter(filePath: string): Promise<void> {
  try {
    await import(`file://${filePath}`);
  } catch (err) {
    throw new Error(`Failed to load adapter ${filePath}: ${err}`);
  }
}
