/**
 * Persistent Profiles — store Chrome user data dirs so cookies,
 * auth, and extensions survive across sessions.
 *
 * Inspired by PinchTab's profile management, built from scratch.
 *
 * Storage: ~/.lobster/profiles/<name>/
 * Metadata: ~/.lobster/profiles/<name>/.lobster-meta.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../config/index.js';
import { log } from '../utils/logger.js';

export interface ProfileMeta {
  name: string;
  createdAt: string;
  lastUsed: string;
  sizeMB?: number;
}

const PROFILES_DIR = () => join(getConfigDir(), 'profiles');
const META_FILE = '.lobster-meta.json';

// Name validation: safe across Windows/Mac/Linux, no path traversal
const VALID_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const RESERVED_NAMES = new Set([
  'default', 'system', 'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

// Directories to delete on cache reset (keep cookies, extensions, local storage)
const CACHE_DIRS = [
  'Cache', 'Code Cache', 'GPUCache', 'GrShaderCache', 'ShaderCache',
  'Service Worker', 'Sessions', 'Session Storage', 'blob_storage',
];

function ensureProfilesDir(): void {
  const dir = PROFILES_DIR();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function validateName(name: string): void {
  if (!VALID_NAME.test(name)) {
    throw new Error(`Invalid profile name "${name}". Use only letters, numbers, hyphens, underscores (max 64 chars).`);
  }
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    throw new Error(`"${name}" is a reserved name. Choose a different profile name.`);
  }
}

function getProfileDir(name: string): string {
  return join(PROFILES_DIR(), name);
}

function readMeta(profileDir: string): ProfileMeta | null {
  const metaPath = join(profileDir, META_FILE);
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeMeta(profileDir: string, meta: ProfileMeta): void {
  writeFileSync(join(profileDir, META_FILE), JSON.stringify(meta, null, 2));
}

function getDirSizeMB(dirPath: string): number {
  let total = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isFile()) {
        total += statSync(fullPath).size;
      } else if (entry.isDirectory() && entry.name !== '.lobster-meta.json') {
        total += getDirSizeMB(fullPath) * 1024 * 1024; // recursive returns MB
      }
    }
  } catch {}
  return Math.round((total / (1024 * 1024)) * 10) / 10;
}

/**
 * Create a new profile.
 */
export function createProfile(name: string): ProfileMeta {
  validateName(name);
  ensureProfilesDir();

  const dir = getProfileDir(name);
  if (existsSync(dir)) {
    throw new Error(`Profile "${name}" already exists.`);
  }

  mkdirSync(dir, { recursive: true });

  const meta: ProfileMeta = {
    name,
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
  };

  writeMeta(dir, meta);
  log.success(`Profile "${name}" created at ${dir}`);
  return meta;
}

/**
 * List all profiles.
 */
export function listProfiles(): ProfileMeta[] {
  ensureProfilesDir();
  const dir = PROFILES_DIR();
  const profiles: ProfileMeta[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const profileDir = join(dir, entry.name);
      const meta = readMeta(profileDir);
      if (meta) {
        meta.sizeMB = getDirSizeMB(profileDir);
        profiles.push(meta);
      } else {
        // Directory exists but no meta — create meta
        profiles.push({
          name: entry.name,
          createdAt: 'unknown',
          lastUsed: 'unknown',
          sizeMB: getDirSizeMB(profileDir),
        });
      }
    }
  } catch {}

  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Remove a profile and all its data.
 */
export function removeProfile(name: string): void {
  const dir = getProfileDir(name);
  if (!existsSync(dir)) {
    throw new Error(`Profile "${name}" does not exist.`);
  }

  rmSync(dir, { recursive: true, force: true });
  log.success(`Profile "${name}" deleted.`);
}

/**
 * Get the Chrome user data directory for a profile.
 * Updates lastUsed timestamp.
 */
export function getProfileDataDir(name: string): string {
  validateName(name);
  const dir = getProfileDir(name);

  if (!existsSync(dir)) {
    // Auto-create if doesn't exist
    createProfile(name);
  } else {
    // Update lastUsed
    const meta = readMeta(dir) || { name, createdAt: 'unknown', lastUsed: '' };
    meta.lastUsed = new Date().toISOString();
    writeMeta(dir, meta);
  }

  return dir;
}

/**
 * Reset cache directories but keep cookies, extensions, and local storage.
 */
export function resetProfileCache(name: string): void {
  const dir = getProfileDir(name);
  if (!existsSync(dir)) {
    throw new Error(`Profile "${name}" does not exist.`);
  }

  let cleaned = 0;
  for (const cacheDir of CACHE_DIRS) {
    // Check both root and Default/ subdirectory
    for (const base of [dir, join(dir, 'Default')]) {
      const target = join(base, cacheDir);
      if (existsSync(target)) {
        rmSync(target, { recursive: true, force: true });
        cleaned++;
      }
    }
  }

  log.success(`Profile "${name}" cache reset (${cleaned} directories cleaned).`);
}
