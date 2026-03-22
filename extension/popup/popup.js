/**
 * LobsterCLI Extension — Popup Logic
 */

// ── State ──
let currentTab = null;
let aiConfig = null;
let interceptorActive = false;
let extractedContent = '';

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  // Load AI config
  const stored = await chrome.storage.local.get(['aiProvider', 'aiApiKey', 'aiModel', 'aiBaseURL']);
  if (stored.aiApiKey) {
    aiConfig = stored;
    showAiReady();
  }

  // Setup tabs
  setupTabs();

  // Setup buttons
  setupButtons();

  // Load page info
  loadPageInfo();

  // Load summary
  loadSummary();

  // Load forms
  loadForms();
});

// ── Tab Navigation ──
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    });
  });
}

// ── Buttons ──
function setupButtons() {
  // Settings
  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Extract buttons
  document.querySelectorAll('[data-extract]').forEach(btn => {
    btn.addEventListener('click', () => extractContent(btn.dataset.extract));
  });

  // Copy button
  document.getElementById('btn-copy-extract').addEventListener('click', () => {
    navigator.clipboard.writeText(extractedContent);
    document.getElementById('btn-copy-extract').textContent = 'Copied!';
    setTimeout(() => {
      document.getElementById('btn-copy-extract').textContent = 'Copy to Clipboard';
    }, 1500);
  });

  // Network
  document.getElementById('btn-start-intercept').addEventListener('click', startInterceptor);
  document.getElementById('btn-refresh-network').addEventListener('click', refreshNetwork);

  // AI
  document.getElementById('btn-setup-ai')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('btn-ai-ask')?.addEventListener('click', askAI);

  // Enter to submit AI
  document.getElementById('ai-prompt')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      askAI();
    }
  });
}

// ── Page Info ──
async function loadPageInfo() {
  try {
    const info = await sendToTab('getPageInfo');
    document.getElementById('page-title').textContent = info.title || currentTab.url;
    document.getElementById('page-meta').innerHTML = `
      <span class="tag">${info.wordCount.toLocaleString()} words</span>
      <span class="tag">${info.linkCount} links</span>
      <span class="tag">${info.imageCount} images</span>
      <span class="tag">${info.formCount} forms</span>
    `;
  } catch (err) {
    document.getElementById('page-title').textContent = currentTab?.title || 'Unknown';
  }
}

// ── Summary Tab ──
async function loadSummary() {
  const container = document.getElementById('summary-content');
  try {
    const summary = await sendToTab('getQuickSummary');
    if (!summary || summary.error) {
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

    // Title & Description
    if (summary.h1 || summary.title) {
      html += '<div class="summary-section"><h3>Title</h3>';
      html += `<p>${escapeHtml(summary.h1 || summary.title)}</p></div>`;
    }

    if (summary.description) {
      html += '<div class="summary-section"><h3>Description</h3>';
      html += `<p>${escapeHtml(summary.description)}</p></div>`;
    }

    // Main content preview
    if (summary.mainText) {
      html += '<div class="summary-section"><h3>Content Preview</h3>';
      html += `<p>${escapeHtml(summary.mainText.slice(0, 300))}${summary.mainText.length > 300 ? '...' : ''}</p></div>`;
    }

    // Page structure
    if (summary.headings && summary.headings.length > 0) {
      html += '<div class="summary-section"><h3>Page Structure</h3>';
      html += '<ul class="heading-list">';
      for (const h of summary.headings.slice(0, 12)) {
        html += `<li class="h${h.level}">${'#'.repeat(h.level)} ${escapeHtml(h.text)}</li>`;
      }
      html += '</ul></div>';
    }

    // Top links
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
    container.innerHTML = '<div class="empty-state"><div class="icon">&#x26A0;</div><p>Cannot analyze this page type</p></div>';
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
        result = await sendToTab('getMarkdown');
        break;
      case 'snapshot':
        result = await sendToTab('getSnapshot');
        break;
      case 'text':
        result = await chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          func: () => document.body.innerText,
        });
        result = result[0]?.result || '';
        break;
    }

    extractedContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    output.textContent = extractedContent.slice(0, 5000);
    if (extractedContent.length > 5000) {
      output.textContent += '\n\n... (truncated, full content copied)';
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
    const state = await sendToTab('getFormState');
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
    await sendToTab('installInterceptor');
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
    const requests = await sendToTab('getIntercepted');
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
      // Show path only for readability
      let displayUrl = req.url;
      try {
        const u = new URL(req.url);
        displayUrl = u.pathname + u.search;
      } catch {}
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
    // Get page markdown for context
    const markdown = await sendToTab('getMarkdown');
    const pageContent = typeof markdown === 'string' ? markdown.slice(0, 8000) : '';

    // Send to background for LLM call
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
function sendToTab(action, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(currentTab.id, { action, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function setStatus(text) {
  document.getElementById('status-text').textContent = text;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
