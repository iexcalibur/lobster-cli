/**
 * LobsterCLI Extension — Popup Logic
 *
 * Uses chrome.scripting.executeScript for ALL page interaction.
 * This bypasses CSP restrictions that block content script injection.
 */

// ── State ──
let currentTab = null;
let aiConfig = null;
let interceptorActive = false;
let extractedContent = '';

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  // Check if we can access this tab
  if (!currentTab?.url || currentTab.url.startsWith('chrome://') || currentTab.url.startsWith('chrome-extension://')) {
    document.getElementById('page-title').textContent = 'Cannot analyze browser pages';
    document.getElementById('summary-content').innerHTML = '<div class="empty-state"><div class="icon">&#x1F512;</div><p>Extensions cannot access browser internal pages.<br>Navigate to a website to use LobsterCLI.</p></div>';
    return;
  }

  // Load AI config
  const stored = await chrome.storage.local.get(['aiProvider', 'aiApiKey', 'aiModel', 'aiBaseURL']);
  if (stored.aiApiKey || stored.aiProvider === 'ollama') {
    aiConfig = stored;
    showAiReady();
  }

  setupTabs();
  setupButtons();
  loadPageInfo();
  loadSummary();
});

// ── Execute script in page context (bypasses CSP) ──
async function execInPage(func, args = []) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func,
      args,
    });
    return results?.[0]?.result;
  } catch (err) {
    console.error('execInPage failed:', err);
    return null;
  }
}

// ── Tab Navigation ──
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panelId = 'panel-' + tab.dataset.tab;
      document.getElementById(panelId).classList.add('active');

      // Lazy load forms tab
      if (tab.dataset.tab === 'forms') loadForms();
    });
  });
}

// ── Buttons ──
function setupButtons() {
  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.querySelectorAll('[data-extract]').forEach(btn => {
    btn.addEventListener('click', () => extractContent(btn.dataset.extract));
  });

  document.getElementById('btn-copy-extract').addEventListener('click', () => {
    navigator.clipboard.writeText(extractedContent);
    const btn = document.getElementById('btn-copy-extract');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy to Clipboard'; }, 1500);
  });

  document.getElementById('btn-start-intercept').addEventListener('click', startInterceptor);
  document.getElementById('btn-refresh-network').addEventListener('click', refreshNetwork);

  document.getElementById('btn-setup-ai')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('btn-ai-ask')?.addEventListener('click', askAI);

  document.getElementById('ai-prompt')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) askAI();
  });
}

// ── Page Info ──
async function loadPageInfo() {
  try {
    const info = await execInPage(() => {
      return {
        url: location.href,
        title: document.title,
        wordCount: document.body?.innerText?.split(/\s+/).filter(Boolean).length || 0,
        linkCount: document.querySelectorAll('a[href]').length,
        imageCount: document.querySelectorAll('img').length,
        formCount: document.forms.length,
      };
    });

    if (info) {
      document.getElementById('page-title').textContent = info.title || currentTab.url;
      document.getElementById('page-meta').innerHTML = `
        <span class="tag">${info.wordCount.toLocaleString()} words</span>
        <span class="tag">${info.linkCount} links</span>
        <span class="tag">${info.imageCount} images</span>
        <span class="tag">${info.formCount} forms</span>
      `;
    } else {
      document.getElementById('page-title').textContent = currentTab?.title || 'Unknown';
    }
  } catch (err) {
    document.getElementById('page-title').textContent = currentTab?.title || 'Unknown';
  }
}

// ── Summary Tab ──
async function loadSummary() {
  const container = document.getElementById('summary-content');

  try {
    const summary = await execInPage(() => {
      const title = document.title || '';
      const description = document.querySelector('meta[name="description"]')?.content ||
        document.querySelector('meta[property="og:description"]')?.content || '';
      const h1 = document.querySelector('h1')?.textContent?.trim() || '';

      // Headings
      const headings = [];
      document.querySelectorAll('h1, h2, h3').forEach((h) => {
        const text = h.textContent.trim();
        if (text && text.length < 200) {
          headings.push({ level: parseInt(h.tagName[1]), text: text.slice(0, 100) });
        }
      });

      // Main content
      let mainText = '';
      const article = document.querySelector('article') ||
        document.querySelector('[role="main"]') ||
        document.querySelector('main') ||
        document.querySelector('.content') ||
        document.querySelector('#content');

      if (article) {
        mainText = article.innerText?.trim()?.slice(0, 1000) || '';
      } else {
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
        if (text && text.length > 2 && text.length < 100 && !text.includes('\n')) {
          links.push({ text, href: a.href });
        }
      });

      // Page type detection
      let pageType = 'webpage';
      if (document.querySelector('article, .post, .blog-post')) pageType = 'article';
      else if (document.querySelector('.product, [itemtype*="Product"]')) pageType = 'product';
      else if (document.querySelector('form[action*="search"], input[type="search"]')) pageType = 'search';
      else if (document.forms.length > 2) pageType = 'form-heavy';
      else if (links.length > 50) pageType = 'directory/listing';

      const wordCount = document.body?.innerText?.split(/\s+/).filter(Boolean).length || 0;

      // Framework detection
      let framework = 'unknown';
      try {
        if (document.querySelector('#__next') || document.querySelector('script[src*="_next"]')) framework = 'Next.js';
        else if (document.querySelector('[data-reactroot]') || document.querySelector('#root')) framework = 'React';
        else if (document.querySelector('[ng-version]')) framework = 'Angular';
        else if (document.querySelector('#app[data-v-app]')) framework = 'Vue';
      } catch {}

      return {
        title, h1, description, pageType, wordCount, framework,
        headings: headings.slice(0, 15),
        mainText: mainText.slice(0, 500),
        linkCount: links.length,
        imageCount: document.querySelectorAll('img').length,
        formCount: document.forms.length,
        topLinks: links.slice(0, 10),
      };
    });

    if (!summary) {
      container.innerHTML = '<div class="empty-state"><div class="icon">&#x26A0;</div><p>Could not analyze this page</p></div>';
      return;
    }

    let html = '';

    // Badges
    html += '<div class="summary-badges">';
    html += `<span class="badge badge-red">${summary.pageType}</span>`;
    if (summary.framework !== 'unknown') {
      html += `<span class="badge badge-purple">${summary.framework}</span>`;
    }
    html += `<span class="badge badge-blue">${summary.wordCount.toLocaleString()} words</span>`;
    html += '</div>';

    if (summary.h1 || summary.title) {
      html += '<div class="summary-section"><h3>Title</h3>';
      html += `<p>${escapeHtml(summary.h1 || summary.title)}</p></div>`;
    }

    if (summary.description) {
      html += '<div class="summary-section"><h3>Description</h3>';
      html += `<p>${escapeHtml(summary.description)}</p></div>`;
    }

    if (summary.mainText) {
      html += '<div class="summary-section"><h3>Content Preview</h3>';
      html += `<p>${escapeHtml(summary.mainText.slice(0, 300))}${summary.mainText.length > 300 ? '...' : ''}</p></div>`;
    }

    if (summary.headings && summary.headings.length > 0) {
      html += '<div class="summary-section"><h3>Page Structure</h3>';
      html += '<ul class="heading-list">';
      for (const h of summary.headings.slice(0, 12)) {
        html += `<li class="h${h.level}">${'#'.repeat(h.level)} ${escapeHtml(h.text)}</li>`;
      }
      html += '</ul></div>';
    }

    if (summary.topLinks && summary.topLinks.length > 0) {
      html += '<div class="summary-section"><h3>Key Links</h3>';
      html += '<ul class="link-list">';
      for (const link of summary.topLinks.slice(0, 8)) {
        html += `<li><a href="${escapeHtml(link.href)}" title="${escapeHtml(link.href)}">${escapeHtml(link.text)}</a></li>`;
      }
      html += '</ul></div>';
    }

    container.innerHTML = html;
    setStatus('Page analyzed');
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="icon">&#x26A0;</div><p>Cannot analyze this page</p></div>';
  }
}

// ── Extract Tab ──
async function extractContent(type) {
  const output = document.getElementById('extract-output');
  const copyBtn = document.getElementById('btn-copy-extract');
  output.textContent = 'Extracting...';
  copyBtn.style.display = 'none';
  setStatus('Extracting ' + type + '...');

  try {
    let result;
    switch (type) {
      case 'markdown':
        // Inject and run the markdown script directly
        result = await chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          files: ['shared/markdown.js'],
        });
        result = await execInPage(() => lobsterMarkdown());
        break;

      case 'snapshot':
        result = await chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          files: ['shared/snapshot.js'],
        });
        result = await execInPage(() => lobsterSnapshot());
        break;

      case 'text':
        result = await execInPage(() => document.body.innerText);
        break;
    }

    extractedContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    output.textContent = extractedContent.slice(0, 5000);
    if (extractedContent.length > 5000) {
      output.textContent += '\n\n... (truncated, full content in clipboard when copied)';
    }
    copyBtn.style.display = 'block';
    setStatus(type + ' extracted (' + extractedContent.length + ' chars)');
  } catch (err) {
    output.textContent = 'Error: ' + err.message;
    setStatus('Extraction failed');
  }
}

// ── Forms Tab ──
async function loadForms() {
  const container = document.getElementById('forms-content');

  try {
    // Inject and run form-state script directly
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ['shared/form-state.js'],
    });
    const state = await execInPage(() => lobsterFormState());

    if (!state) {
      container.innerHTML = '<div class="empty-state"><div class="icon">&#x1F4CB;</div><p>No forms detected</p></div>';
      return;
    }

    const allForms = [...(state.forms || [])];
    const orphans = state.orphanFields || [];

    if (allForms.length === 0 && orphans.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">&#x1F4CB;</div><p>No forms or input fields on this page</p></div>';
      return;
    }

    let html = '';

    for (const form of allForms) {
      html += '<div class="form-card">';
      html += `<h4><span class="badge badge-blue">${form.method}</span> ${escapeHtml(form.name || form.id || 'Unnamed Form')}</h4>`;
      if (form.action) html += `<div style="font-size:10px;color:var(--text-dim);margin-bottom:6px">${escapeHtml(form.action)}</div>`;

      for (const field of form.fields) {
        html += '<div class="form-field">';
        html += `<span class="field-type">${field.type}</span>`;
        html += `<span class="field-label">${escapeHtml(field.label || field.name || 'unnamed')}</span>`;
        if (field.value && field.value !== '' && field.value !== false) {
          html += `<span class="field-value">${escapeHtml(String(field.value))}</span>`;
        }
        if (field.required) html += '<span class="field-required">required</span>';
        html += '</div>';
      }
      html += '</div>';
    }

    if (orphans.length > 0) {
      html += '<div class="form-card">';
      html += '<h4><span class="badge badge-yellow">Orphan</span> Standalone Fields</h4>';
      for (const field of orphans) {
        html += '<div class="form-field">';
        html += `<span class="field-type">${field.type}</span>`;
        html += `<span class="field-label">${escapeHtml(field.label || field.name || 'unnamed')}</span>`;
        if (field.value && field.value !== '' && field.value !== false) {
          html += `<span class="field-value">${escapeHtml(String(field.value))}</span>`;
        }
        html += '</div>';
      }
      html += '</div>';
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="icon">&#x26A0;</div><p>Could not scan forms</p></div>';
  }
}

// ── Network Tab ──
async function startInterceptor() {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ['shared/interceptor.js'],
    });
    await execInPage(() => lobsterInstallInterceptor());

    interceptorActive = true;
    document.getElementById('btn-start-intercept').textContent = 'Monitoring...';
    document.getElementById('btn-start-intercept').disabled = true;
    document.getElementById('btn-refresh-network').disabled = false;
    document.getElementById('network-content').innerHTML = '<div class="placeholder">Interceptor active. Browse the page, then click Refresh.</div>';
    setStatus('Network monitoring started');
  } catch (err) {
    document.getElementById('network-content').innerHTML = '<div class="placeholder">Error: ' + err.message + '</div>';
  }
}

async function refreshNetwork() {
  const container = document.getElementById('network-content');
  try {
    const requests = await execInPage(() => {
      const store = window.__lobster_interceptor__;
      if (!store) return [];
      const reqs = [...store.requests];
      store.requests = [];
      return reqs;
    });

    if (!requests || requests.length === 0) {
      container.innerHTML = '<div class="placeholder">No API calls captured yet. Navigate or interact with the page.</div>';
      return;
    }

    let html = '';
    for (const req of requests) {
      const statusClass = req.status >= 200 && req.status < 400 ? 'ok' : 'err';
      html += '<div class="network-entry">';
      html += `<span class="status ${statusClass}">${req.status}</span>`;
      html += `<span class="method ${req.method}">${req.method}</span>`;
      let displayUrl = req.url;
      try { const u = new URL(req.url); displayUrl = u.pathname + u.search; } catch {}
      html += `<span class="url">${escapeHtml(displayUrl)}</span>`;
      html += '</div>';
    }

    container.innerHTML = html;
    setStatus(requests.length + ' API calls captured');
  } catch (err) {
    container.innerHTML = '<div class="placeholder">Error fetching requests</div>';
  }
}

// ── AI Tab ──
function showAiReady() {
  document.getElementById('ai-no-key').style.display = 'none';
  document.getElementById('ai-ready').style.display = 'block';
  const provider = aiConfig.aiProvider || 'openai';
  const model = aiConfig.aiModel || '';
  document.getElementById('ai-provider-badge').textContent = `${provider} / ${model}`;
}

async function askAI() {
  const prompt = document.getElementById('ai-prompt').value.trim();
  if (!prompt) return;

  const output = document.getElementById('ai-output');
  const btn = document.getElementById('btn-ai-ask');
  output.style.display = 'block';
  output.textContent = 'Thinking...';
  btn.disabled = true;
  setStatus('Asking AI...');

  try {
    // Get page text for context (using direct exec, not content script)
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ['shared/markdown.js'],
    });
    const markdown = await execInPage(() => {
      try { return lobsterMarkdown(); }
      catch { return document.body.innerText?.slice(0, 8000) || ''; }
    });
    const pageContent = typeof markdown === 'string' ? markdown.slice(0, 8000) : '';

    const response = await chrome.runtime.sendMessage({
      action: 'askAI',
      prompt,
      pageContent,
      pageUrl: currentTab.url,
      pageTitle: currentTab.title,
    });

    if (response.error) {
      output.textContent = 'Error: ' + response.error;
    } else {
      output.textContent = response.answer;
    }
    setStatus('AI responded');
  } catch (err) {
    output.textContent = 'Error: ' + err.message;
    setStatus('AI error');
  }

  btn.disabled = false;
}

// ── Helpers ──
function setStatus(text) {
  document.getElementById('status-text').textContent = text;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
