import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { log } from '../utils/logger.js';

export interface BrowserManagerConfig {
  executablePath?: string;
  headless?: boolean;
  cdpEndpoint?: string;
  connectTimeout?: number;
}

export class BrowserManager {
  private browser: Browser | null = null;
  private config: BrowserManagerConfig;

  constructor(config: BrowserManagerConfig = {}) {
    this.config = config;
  }

  async connect(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;

    if (this.config.cdpEndpoint) {
      log.debug(`Connecting to CDP endpoint: ${this.config.cdpEndpoint}`);
      this.browser = await puppeteer.connect({
        browserWSEndpoint: this.config.cdpEndpoint,
      });
      return this.browser;
    }

    const executablePath = this.config.executablePath || findChrome();
    if (!executablePath) {
      throw new Error(
        'Chrome/Chromium not found. Set LOBSTER_BROWSER_PATH or config browser.executablePath'
      );
    }

    log.debug(`Launching Chrome: ${executablePath}`);
    this.browser = await puppeteer.launch({
      executablePath,
      headless: this.config.headless ?? true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    return this.browser;
  }

  async newPage(): Promise<Page> {
    const browser = await this.connect();
    return browser.newPage();
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
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
