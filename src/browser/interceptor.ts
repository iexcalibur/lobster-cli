/**
 * Network interceptor script — patches fetch and XHR to capture responses.
 * Based on OpenCLI's interception approach.
 */
export function buildInterceptorScript(pattern: string): string {
  return `
(() => {
  if (window.__lobster_interceptor__) return;
  window.__lobster_interceptor__ = { requests: [] };
  const store = window.__lobster_interceptor__;
  const pattern = ${JSON.stringify(pattern)};

  // Patch fetch
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const resp = await origFetch.apply(this, args);
    if (url.includes(pattern)) {
      const clone = resp.clone();
      try {
        const body = await clone.json();
        store.requests.push({ url, method: 'GET', status: resp.status, body, timestamp: Date.now() });
      } catch {}
    }
    return resp;
  };

  // Patch XHR
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__url = url;
    this.__method = method;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      if (this.__url && this.__url.includes(pattern)) {
        try {
          const body = JSON.parse(this.responseText);
          store.requests.push({ url: this.__url, method: this.__method, status: this.status, body, timestamp: Date.now() });
        } catch {}
      }
    });
    return origSend.apply(this, args);
  };
})()
`;
}

export const GET_INTERCEPTED_SCRIPT = `
(() => {
  const store = window.__lobster_interceptor__;
  if (!store) return [];
  const reqs = [...store.requests];
  store.requests = [];
  return reqs;
})()
`;
