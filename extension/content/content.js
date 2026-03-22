/**
 * LobsterCLI Extension — Content Script
 *
 * Injected into every page. Listens for messages from popup/background
 * and runs DOM extraction scripts in the page context.
 */

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  switch (action) {
    case 'getSnapshot':
      runInPage('lobsterSnapshot').then(sendResponse);
      return true;

    case 'getMarkdown':
      runInPage('lobsterMarkdown').then(sendResponse);
      return true;

    case 'getFormState':
      runInPage('lobsterFormState').then(sendResponse);
      return true;

    case 'getInteractive':
      runInPage('lobsterInteractive').then(sendResponse);
      return true;

    case 'installInterceptor':
      runInPage('lobsterInstallInterceptor').then(sendResponse);
      return true;

    case 'getIntercepted':
      runInPage('lobsterGetIntercepted').then(sendResponse);
      return true;

    case 'getPageInfo':
      sendResponse({
        url: location.href,
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content || '',
        favicon: document.querySelector('link[rel*="icon"]')?.href || '',
        lang: document.documentElement.lang || '',
        charset: document.characterSet || '',
        wordCount: document.body?.innerText?.split(/\s+/).filter(Boolean).length || 0,
        linkCount: document.querySelectorAll('a[href]').length,
        imageCount: document.querySelectorAll('img').length,
        formCount: document.forms.length,
        scriptCount: document.querySelectorAll('script').length,
      });
      return false;

    case 'getQuickSummary':
      // No-AI summary using heuristics
      const summary = generateQuickSummary();
      sendResponse(summary);
      return false;

    default:
      sendResponse({ error: 'Unknown action: ' + action });
      return false;
  }
});

/**
 * Run a function in the page context via script injection.
 */
async function runInPage(fnName) {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    const resultId = '__lobster_result_' + Date.now();

    script.textContent = `
      try {
        window['${resultId}'] = ${fnName}();
      } catch(e) {
        window['${resultId}'] = { error: e.message };
      }
    `;

    document.documentElement.appendChild(script);
    script.remove();

    // Read result
    const result = window[resultId];
    delete window[resultId];
    resolve(result);
  });
}

/**
 * Quick page summary without AI — pure heuristic extraction.
 */
function generateQuickSummary() {
  const title = document.title || '';

  // Meta description
  const description = document.querySelector('meta[name="description"]')?.content ||
    document.querySelector('meta[property="og:description"]')?.content || '';

  // Main heading
  const h1 = document.querySelector('h1')?.textContent?.trim() || '';

  // Collect all headings for structure
  const headings = [];
  document.querySelectorAll('h1, h2, h3').forEach((h) => {
    const text = h.textContent.trim();
    if (text && text.length < 200) {
      headings.push({ level: parseInt(h.tagName[1]), text: text.slice(0, 100) });
    }
  });

  // Main content extraction (find largest text block)
  let mainText = '';
  const article = document.querySelector('article') ||
    document.querySelector('[role="main"]') ||
    document.querySelector('main') ||
    document.querySelector('.content') ||
    document.querySelector('#content');

  if (article) {
    mainText = article.innerText?.trim()?.slice(0, 1000) || '';
  } else {
    // Fallback: find the element with most text
    const candidates = document.querySelectorAll('div, section');
    let maxLen = 0;
    for (const el of candidates) {
      const text = el.innerText?.trim() || '';
      if (text.length > maxLen && text.length < 50000) {
        maxLen = text.length;
        mainText = text.slice(0, 1000);
      }
    }
  }

  // Links
  const links = [];
  document.querySelectorAll('a[href]').forEach((a) => {
    const text = a.textContent?.trim();
    if (text && text.length > 2 && text.length < 100) {
      links.push({ text, href: a.href });
    }
  });

  // Images
  const images = [];
  document.querySelectorAll('img[src]').forEach((img) => {
    const alt = img.alt || '';
    const src = img.src;
    if (src && !src.startsWith('data:')) {
      images.push({ alt, src });
    }
  });

  // Detect page type
  let pageType = 'webpage';
  if (document.querySelector('article, .post, .blog-post')) pageType = 'article';
  else if (document.querySelector('.product, [itemtype*="Product"]')) pageType = 'product';
  else if (document.querySelector('form[action*="search"], input[type="search"]')) pageType = 'search';
  else if (document.forms.length > 2) pageType = 'form-heavy';
  else if (links.length > 50) pageType = 'directory/listing';

  // Word count
  const wordCount = document.body?.innerText?.split(/\s+/).filter(Boolean).length || 0;

  // Framework detection
  let framework = 'unknown';
  if (window.__NEXT_DATA__) framework = 'Next.js';
  else if (window.__NUXT__) framework = 'Nuxt';
  else if (document.querySelector('[data-reactroot], #__next')) framework = 'React';
  else if (document.querySelector('#app')?.__vue_app__) framework = 'Vue';
  else if (document.querySelector('[ng-version]')) framework = 'Angular';

  return {
    title,
    h1,
    description,
    pageType,
    wordCount,
    framework,
    headings: headings.slice(0, 15),
    mainText: mainText.slice(0, 500),
    linkCount: links.length,
    imageCount: images.length,
    formCount: document.forms.length,
    topLinks: links.slice(0, 10),
    topImages: images.slice(0, 5),
  };
}

// Inject shared scripts into the page
function injectSharedScripts() {
  const scripts = ['snapshot.js', 'markdown.js', 'form-state.js', 'interceptor.js'];
  for (const file of scripts) {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('shared/' + file);
    document.documentElement.appendChild(script);
    script.onload = () => script.remove();
  }
}

// Interactive elements — runs in content script context (doesn't need page injection)
function lobsterInteractive() {
  const results = [];
  let idx = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  while (node = walker.nextNode()) {
    const tag = node.tagName.toLowerCase();
    const role = node.getAttribute('role');
    const types = [];

    if (['a', 'button', 'input', 'select', 'textarea', 'details', 'summary'].includes(tag)) types.push('native');
    if (role && ['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'tab', 'switch', 'menuitem', 'slider'].includes(role)) types.push('aria');
    if (node.contentEditable === 'true') types.push('contenteditable');
    if (node.tabIndex >= 0 && node.getAttribute('tabindex') !== null) types.push('focusable');
    if (node.onclick) types.push('listener');

    if (types.length === 0) continue;

    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const rect = node.getBoundingClientRect();
    results.push({
      index: idx++,
      tag,
      role: role || '',
      text: (node.textContent || '').trim().slice(0, 100),
      types,
      ariaLabel: node.getAttribute('aria-label') || '',
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    });
  }
  return results;
}

// Auto-inject on load
injectSharedScripts();
