import type { Page } from 'puppeteer-core';
import type {
  IPage, WaitCondition, Cookie, NetworkEntry, TabInfo,
  SnapshotOptions, SemanticTreeOptions, FlatDomTree,
} from '../types/page.js';
import { FLAT_TREE_SCRIPT, flatTreeToString } from './dom/flat-tree.js';
import { SNAPSHOT_SCRIPT } from './dom/snapshot.js';
import { SEMANTIC_TREE_SCRIPT } from './dom/semantic-tree.js';
import { MARKDOWN_SCRIPT } from './dom/markdown.js';
import { buildInterceptorScript, GET_INTERCEPTED_SCRIPT } from './interceptor.js';

export class PuppeteerPage implements IPage {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get raw(): Page { return this.page; }

  async goto(url: string, options?: { waitUntil?: WaitCondition; timeout?: number }): Promise<void> {
    await this.page.goto(url, {
      waitUntil: (options?.waitUntil as any) || 'networkidle2',
      timeout: options?.timeout || 30000,
    });
  }

  async goBack(): Promise<void> {
    await this.page.goBack({ waitUntil: 'networkidle2' });
  }

  async url(): Promise<string> {
    return this.page.url();
  }

  async title(): Promise<string> {
    return this.page.title();
  }

  async evaluate<T = unknown>(js: string): Promise<T> {
    return this.page.evaluate(js) as Promise<T>;
  }

  async snapshot(_opts?: SnapshotOptions): Promise<string> {
    return this.page.evaluate(SNAPSHOT_SCRIPT) as Promise<string>;
  }

  async semanticTree(_opts?: SemanticTreeOptions): Promise<string> {
    return this.page.evaluate(SEMANTIC_TREE_SCRIPT) as Promise<string>;
  }

  async flatTree(): Promise<FlatDomTree> {
    const raw = await this.page.evaluate(FLAT_TREE_SCRIPT);
    return raw as FlatDomTree;
  }

  async markdown(): Promise<string> {
    return this.page.evaluate(MARKDOWN_SCRIPT) as Promise<string>;
  }

  async click(ref: string | number): Promise<void> {
    if (typeof ref === 'number') {
      await this.page.evaluate((idx) => {
        const el = document.querySelector('[data-ref="' + idx + '"]') as HTMLElement;
        if (!el) throw new Error('Element with index ' + idx + ' not found');

        // Blur previously focused element
        const prev = document.activeElement as HTMLElement | null;
        if (prev && prev !== el && prev !== document.body) {
          prev.blur();
          prev.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true }));
          prev.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, cancelable: true }));
        }

        // Scroll into view
        if (typeof (el as any).scrollIntoViewIfNeeded === 'function') {
          (el as any).scrollIntoViewIfNeeded();
        } else {
          el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
        }

        // Full mouse event sequence — required for React, analytics, custom handlers
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.focus();
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }, ref);
      // Wait for click processing (animations, state updates)
      await new Promise((r) => setTimeout(r, 200));
    } else {
      await this.page.click(ref);
    }
  }

  async typeText(ref: string | number, text: string): Promise<void> {
    if (typeof ref === 'number') {
      // First click the element (triggers full event sequence + focus)
      await this.click(ref);

      await this.page.evaluate((idx, txt) => {
        const el = document.querySelector('[data-ref="' + idx + '"]') as HTMLElement;
        if (!el) throw new Error('Element with index ' + idx + ' not found');

        const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
        const isContentEditable = el.isContentEditable;

        if (isContentEditable) {
          // ── Contenteditable: Plan A — synthetic InputEvents ──
          // Works for: React contenteditable, Quill
          // Clear existing content
          if (el.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true, cancelable: true, inputType: 'deleteContent',
          }))) {
            el.innerText = '';
            el.dispatchEvent(new InputEvent('input', {
              bubbles: true, inputType: 'deleteContent',
            }));
          }

          // Insert new text
          if (el.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true, cancelable: true, inputType: 'insertText', data: txt,
          }))) {
            el.innerText = txt;
            el.dispatchEvent(new InputEvent('input', {
              bubbles: true, inputType: 'insertText', data: txt,
            }));
          }

          // Verify Plan A worked
          const planAOk = el.innerText.trim() === txt.trim();

          if (!planAOk) {
            // ── Plan B — execCommand fallback ──
            // Works for: Slate.js, some rich-text editors
            el.focus();
            const doc = el.ownerDocument;
            const sel = (doc.defaultView || window).getSelection();
            const range = doc.createRange();
            range.selectNodeContents(el);
            sel?.removeAllRanges();
            sel?.addRange(range);
            doc.execCommand('delete', false);
            doc.execCommand('insertText', false, txt);
          }

          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.blur();

        } else if (isInput) {
          // ── Input/Textarea: use native value setter to bypass React/Vue ──
          const inputEl = el as HTMLInputElement | HTMLTextAreaElement;
          const proto = Object.getPrototypeOf(inputEl);
          const descriptor =
            Object.getOwnPropertyDescriptor(proto, 'value') ||
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');

          if (descriptor?.set) {
            descriptor.set.call(inputEl, txt);
          } else {
            inputEl.value = txt;
          }

          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          // Fallback: try setting value anyway
          (el as any).value = txt;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, ref, text);
    } else {
      // CSS selector path — click to focus, then use keyboard
      await this.page.click(ref, { count: 3 });
      await this.page.keyboard.type(text);
    }
  }

  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key as any);
  }

  async selectOption(ref: string | number, value: string): Promise<void> {
    const selector = typeof ref === 'number' ? '[data-ref="' + ref + '"]' : ref;
    await this.page.select(selector, value);
  }

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void> {
    const distance = amount || 500;
    const isVertical = direction === 'up' || direction === 'down';
    const positive = direction === 'down' || direction === 'right';
    const delta = positive ? distance : -distance;

    await this.page.evaluate((dy, dx, isVert) => {
      // Helper: check if element is a valid scroll container
      const canScroll = (el) => {
        if (!el) return false;
        const s = getComputedStyle(el);
        if (isVert) {
          return /(auto|scroll|overlay)/.test(s.overflowY) &&
            el.scrollHeight > el.clientHeight &&
            el.clientHeight >= window.innerHeight * 0.3;
        } else {
          return /(auto|scroll|overlay)/.test(s.overflowX) &&
            el.scrollWidth > el.clientWidth &&
            el.clientWidth >= window.innerWidth * 0.3;
        }
      };

      // Walk from active element up to find a scrollable container
      let el = document.activeElement;
      while (el && !canScroll(el) && el !== document.body) {
        el = el.parentElement;
      }

      // If no scrollable ancestor, search the DOM
      if (!canScroll(el)) {
        el = Array.from(document.querySelectorAll('*')).find(canScroll) || null;
      }

      const isPageLevel = !el || el === document.body ||
        el === document.documentElement || el === document.scrollingElement;

      if (isPageLevel) {
        // Page-level scroll
        if (isVert) {
          window.scrollBy(0, dy);
        } else {
          window.scrollBy(dx, 0);
        }
      } else {
        // Container scroll
        if (isVert) {
          el.scrollBy({ top: dy, behavior: 'smooth' });
        } else {
          el.scrollBy({ left: dx, behavior: 'smooth' });
        }
      }
    }, isVertical ? delta : 0, isVertical ? 0 : delta, isVertical);

    // Wait for smooth scroll to settle
    await new Promise((r) => setTimeout(r, 150));
  }

  async scrollToElement(ref: string | number): Promise<void> {
    const selector = typeof ref === 'number' ? '[data-ref="' + ref + '"]' : ref;
    await this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      if (typeof (el as any).scrollIntoViewIfNeeded === 'function') {
        (el as any).scrollIntoViewIfNeeded();
      } else {
        el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
      }
    }, selector);
  }

  async getCookies(opts?: { domain?: string }): Promise<Cookie[]> {
    const cookies = await this.page.cookies();
    const filtered = opts?.domain
      ? cookies.filter((c) => c.domain.includes(opts.domain!))
      : cookies;
    return filtered.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite as Cookie['sameSite'],
    }));
  }

  async wait(options: number | { text?: string; time?: number; timeout?: number }): Promise<void> {
    if (typeof options === 'number') {
      await new Promise((r) => setTimeout(r, options * 1000));
      return;
    }
    if (options.time) {
      await new Promise((r) => setTimeout(r, options.time! * 1000));
    }
    if (options.text) {
      await this.page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        { timeout: options.timeout || 30000 },
        options.text
      );
    }
  }

  async networkRequests(_includeStatic?: boolean): Promise<NetworkEntry[]> {
    // Note: basic implementation — for full network capture, CDP instrumentation needed
    return [];
  }

  async installInterceptor(pattern: string): Promise<void> {
    await this.page.evaluate(buildInterceptorScript(pattern));
  }

  async getInterceptedRequests(): Promise<unknown[]> {
    return this.page.evaluate(GET_INTERCEPTED_SCRIPT) as Promise<unknown[]>;
  }

  async screenshot(opts?: { format?: 'png' | 'jpeg'; fullPage?: boolean }): Promise<Buffer> {
    const result = await this.page.screenshot({
      type: opts?.format || 'png',
      fullPage: opts?.fullPage ?? false,
    });
    return Buffer.from(result);
  }

  async tabs(): Promise<TabInfo[]> {
    const browser = this.page.browser();
    const pages = await browser.pages();
    return pages.map((p, i) => ({
      id: i,
      url: p.url(),
      title: '',
      active: p === this.page,
    }));
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}
