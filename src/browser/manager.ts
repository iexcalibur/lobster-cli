import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { log } from '../utils/logger.js';
import { getProfileDataDir } from './profiles.js';
import { resolveAttachTarget } from './chrome-attach.js';
import { injectStealth, STEALTH_ARGS } from './stealth.js';

export interface BrowserManagerConfig {
  executablePath?: string;
  headless?: boolean;
  cdpEndpoint?: string;
  connectTimeout?: number;
  profile?: string;
  attach?: boolean | string;
  stealth?: boolean;
}

export class BrowserManager {
  private browser: Browser | null = null;
  private config: BrowserManagerConfig;
  private isAttached = false;

  constructor(config: BrowserManagerConfig = {}) {
    this.config = config;
  }

  async connect(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;

    // Priority 1: Attach to running Chrome
    if (this.config.attach) {
      const wsEndpoint = await resolveAttachTarget(this.config.attach);
      log.info(`Attaching to Chrome: ${wsEndpoint}`);
      this.browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
      this.isAttached = true;
      return this.browser;
    }

    // Priority 2: Connect to CDP endpoint
    if (this.config.cdpEndpoint) {
      log.debug(`Connecting to CDP endpoint: ${this.config.cdpEndpoint}`);
      this.browser = await puppeteer.connect({
        browserWSEndpoint: this.config.cdpEndpoint,
      });
      this.isAttached = true;
      return this.browser;
    }

    // Priority 3: Launch new Chrome
    const executablePath = this.config.executablePath || findChrome();
    if (!executablePath) {
      throw new Error(
        'Chrome/Chromium not found. Set LOBSTER_BROWSER_PATH or config browser.executablePath'
      );
    }

    // Build launch args
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ];

    // Stealth args
    if (this.config.stealth) {
      args.push(...STEALTH_ARGS);
    }

    // Profile — set user data directory
    let userDataDir: string | undefined;
    if (this.config.profile) {
      userDataDir = getProfileDataDir(this.config.profile);
      log.info(`Using profile "${this.config.profile}" → ${userDataDir}`);
    }

    log.debug(`Launching Chrome: ${executablePath}`);
    this.browser = await puppeteer.launch({
      executablePath,
      headless: this.config.headless ?? true,
      userDataDir,
      args,
    });

    this.isAttached = false;
    return this.browser;
  }

  async newPage(): Promise<Page> {
    const browser = await this.connect();
    const page = await browser.newPage();

    // Inject stealth scripts before any navigation
    if (this.config.stealth) {
      await injectStealth(page);
      log.debug('Stealth mode enabled');
    }

    return page;
  }

  async close(): Promise<void> {
    if (this.browser) {
      if (this.isAttached) {
        // Don't close user's browser — just disconnect
        this.browser.disconnect();
        log.debug('Disconnected from Chrome (attached mode)');
      } else {
        await this.browser.close().catch(() => {});
      }
      this.browser = null;
    }
  }
}

function findChrome(): string | undefined {
  const paths =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        ]
      : process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium',
          ];

  return paths.find((p) => existsSync(p));
}
