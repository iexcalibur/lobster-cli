import type { Page } from 'puppeteer-core';
import type { WaitCondition } from '../types/page.js';

export async function waitForCondition(
  page: Page,
  condition: WaitCondition,
  timeout: number = 30000
): Promise<void> {
  switch (condition) {
    case 'load':
      await page.waitForNavigation({ waitUntil: 'load', timeout }).catch(() => {});
      break;
    case 'domcontentloaded':
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout }).catch(() => {});
      break;
    case 'networkidle0':
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout }).catch(() => {});
      break;
    case 'networkidle2':
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout }).catch(() => {});
      break;
  }
}
