/**
 * Stealth Mode — anti-bot detection scripts.
 *
 * Injected via page.evaluateOnNewDocument() so it runs before
 * any page JavaScript, on every navigation.
 *
 * Inspired by PinchTab's 3-tier stealth system, built from scratch.
 * This is a comprehensive single-tier implementation covering the
 * most critical detection vectors.
 */

import type { Page } from 'puppeteer-core';

/**
 * Comprehensive stealth script that evades common bot detection.
 */
export const STEALTH_SCRIPT = `
(() => {
  // ── 1. navigator.webdriver removal ──
  // Most important: this is the #1 detection vector
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });

  // Also delete from prototype
  delete Object.getPrototypeOf(navigator).webdriver;

  // ── 2. CDP marker removal ──
  // Chrome DevTools Protocol injects cdc_* properties on window
  for (const key of Object.keys(window)) {
    if (/^cdc_|^__webdriver|^__selenium|^__driver/.test(key)) {
      try { delete window[key]; } catch {}
    }
  }

  // ── 3. Chrome runtime spoofing ──
  // Real Chrome has window.chrome with runtime, loadTimes, csi
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: function() {},
      sendMessage: function() {},
      onMessage: { addListener: function() {} },
      id: undefined,
    };
  }
  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = function() {
      return {
        commitLoadTime: Date.now() / 1000 - 0.5,
        connectionInfo: 'h2',
        finishDocumentLoadTime: Date.now() / 1000 - 0.1,
        finishLoadTime: Date.now() / 1000 - 0.05,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000 - 0.3,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: Date.now() / 1000 - 1,
        startLoadTime: Date.now() / 1000 - 0.8,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      };
    };
  }
  if (!window.chrome.csi) {
    window.chrome.csi = function() {
      return {
        onloadT: Date.now(),
        startE: Date.now() - 500,
        pageT: 500,
        tran: 15,
      };
    };
  }

  // ── 4. Plugin array spoofing ──
  // Headless Chrome reports empty plugins; real Chrome has at least 2
  const fakePlugins = [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2 },
  ];

  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const arr = fakePlugins.map(p => {
        const plugin = { ...p, item: (i) => plugin, namedItem: (n) => plugin };
        return plugin;
      });
      arr.item = (i) => arr[i];
      arr.namedItem = (n) => arr.find(p => p.name === n);
      arr.refresh = () => {};
      return arr;
    },
  });

  // ── 5. Languages ──
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  });
  Object.defineProperty(navigator, 'language', {
    get: () => 'en-US',
  });

  // ── 6. Platform consistency ──
  // Ensure platform matches user agent
  const platform = navigator.userAgent.includes('Mac') ? 'MacIntel' :
                   navigator.userAgent.includes('Win') ? 'Win32' :
                   navigator.userAgent.includes('Linux') ? 'Linux x86_64' : navigator.platform;
  Object.defineProperty(navigator, 'platform', { get: () => platform });

  // ── 7. Hardware concurrency & device memory ──
  // Headless often reports unusual values
  if (navigator.hardwareConcurrency < 2) {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  }
  if (!navigator.deviceMemory || navigator.deviceMemory < 2) {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  }

  // ── 8. WebGL vendor/renderer spoofing ──
  // Headless reports "Google SwiftShader" which is a dead giveaway
  const origGetParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    // UNMASKED_VENDOR_WEBGL
    if (param === 0x9245) return 'Intel Inc.';
    // UNMASKED_RENDERER_WEBGL
    if (param === 0x9246) return 'Intel Iris OpenGL Engine';
    return origGetParameter.call(this, param);
  };

  // Also for WebGL2
  if (typeof WebGL2RenderingContext !== 'undefined') {
    const origGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(param) {
      if (param === 0x9245) return 'Intel Inc.';
      if (param === 0x9246) return 'Intel Iris OpenGL Engine';
      return origGetParameter2.call(this, param);
    };
  }

  // ── 9. Canvas fingerprint noise ──
  // Adds subtle deterministic noise to canvas output based on domain
  const seed = location.hostname.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(type) {
    const ctx = this.getContext('2d');
    if (ctx && this.width > 0 && this.height > 0) {
      try {
        const imageData = ctx.getImageData(0, 0, 1, 1);
        // Flip a single pixel with seeded noise
        imageData.data[0] = (imageData.data[0] + seed) % 256;
        ctx.putImageData(imageData, 0, 0);
      } catch {}
    }
    return origToDataURL.apply(this, arguments);
  };

  // ── 10. Permissions API ──
  // Headless returns 'denied' for notifications; real Chrome returns 'prompt'
  const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
  if (origQuery) {
    navigator.permissions.query = function(descriptor) {
      if (descriptor.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission || 'prompt', onchange: null });
      }
      return origQuery(descriptor);
    };
  }

  // ── 11. Notification constructor ──
  if (!window.Notification) {
    window.Notification = function() {};
    window.Notification.permission = 'default';
    window.Notification.requestPermission = () => Promise.resolve('default');
  }

  // ── 12. Connection type ──
  if (navigator.connection) {
    Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
  }
})()
`;

/**
 * Inject stealth script into a Puppeteer page.
 * Must be called before first navigation for full effectiveness.
 */
export async function injectStealth(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(STEALTH_SCRIPT);
}

/**
 * Chrome launch args for stealth mode.
 */
export const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-infobars',
  '--window-size=1920,1080',
];
