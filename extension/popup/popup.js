/**
 * LobsterCLI Extension — Chat UI
 */

let currentTab = null;
let aiConfig = null;
let chatStarted = false;
let interceptorActive = false;

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  // Load AI config
  const stored = await chrome.storage.local.get(['aiProvider', 'aiApiKey', 'aiModel', 'aiBaseURL']);
  if (stored.aiApiKey || stored.aiProvider === 'ollama') {
    aiConfig = stored;
  }

  // Page context bar
  if (currentTab?.title) {
    document.getElementById('context-text').textContent = currentTab.title;
  }

  // Cannot access browser pages
  if (!currentTab?.url || currentTab.url.startsWith('chrome://') || currentTab.url.startsWith('chrome-extension://')) {
    document.getElementById('context-text').textContent = 'Cannot access browser pages';
    disableSuggestions();
  }

  setupListeners();
});

function setupListeners() {
  // Settings
  document.getElementById('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

  // New chat
  document.getElementById('btn-new-chat').addEventListener('click', resetChat);

  // Send button
  document.getElementById('btn-send').addEventListener('click', handleSend);

  // Enter to send (Shift+Enter for newline)
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Auto-resize textarea
  document.getElementById('chat-input').addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
  });

  // Suggestion chips
  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => handleAction(chip.dataset.action));
  });

  // Context close
  document.getElementById('context-close').addEventListener('click', () => {
    document.getElementById('context-bar').style.display = 'none';
  });
}

function disableSuggestions() {
  document.querySelectorAll('.suggestion-chip').forEach(c => c.disabled = true);
}

// ── Chat Management ──
function resetChat() {
  chatStarted = false;
  const chatArea = document.getElementById('chat-area');
  chatArea.innerHTML = '';

  // Re-add welcome
  const welcome = document.createElement('div');
  welcome.className = 'welcome';
  welcome.id = 'welcome';
  welcome.innerHTML = `
    <div class="welcome-greeting">Hello!</div>
    <div class="welcome-sub">How can I help you today?</div>
    <div class="suggestions" id="suggestions">
      <button class="suggestion-chip" data-action="summary">Summarize this page</button>
      <button class="suggestion-chip" data-action="extract">Extract as Markdown</button>
      <button class="suggestion-chip" data-action="forms">Detect all forms</button>
      <button class="suggestion-chip" data-action="links">Show key links</button>
      <button class="suggestion-chip" data-action="network">Monitor API calls</button>
      <button class="suggestion-chip" data-action="snapshot">DOM snapshot</button>
    </div>
  `;
  chatArea.appendChild(welcome);

  // Re-bind chips
  welcome.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => handleAction(chip.dataset.action));
  });

  document.getElementById('chat-input').value = '';
  document.getElementById('chat-input').style.height = 'auto';
}

function startChat() {
  if (chatStarted) return;
  chatStarted = true;
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();
}

function addUserMessage(text) {
  startChat();
  const chatArea = document.getElementById('chat-area');
  const msg = document.createElement('div');
  msg.className = 'message message-user';
  msg.innerHTML = `<div class="msg-bubble">${escapeHtml(text)}</div>`;
  chatArea.appendChild(msg);
  scrollToBottom();
}

function addBotMessage(html, actions = []) {
  const chatArea = document.getElementById('chat-area');

  // Remove typing indicator if present
  const typing = chatArea.querySelector('.typing-indicator');
  if (typing) typing.parentElement.remove();

  const msg = document.createElement('div');
  msg.className = 'message message-bot';

  let actionsHtml = '';
  if (actions.length > 0) {
    actionsHtml = '<div class="msg-actions">' +
      actions.map(a => `<button class="msg-action-btn" data-copy="${a.copy || ''}" data-action="${a.action || ''}">${a.label}</button>`).join('') +
      '</div>';
  }

  msg.innerHTML = `
    <div class="msg-header"><span class="bot-icon">&#x1F99E;</span> LobsterCLI</div>
    <div class="msg-bubble">${html}${actionsHtml}</div>
  `;

  chatArea.appendChild(msg);

  // Bind action buttons
  msg.querySelectorAll('.msg-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.copy) {
        navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = btn.textContent; }, 1500);
      }
      if (btn.dataset.action) handleAction(btn.dataset.action);
    });
  });

  scrollToBottom();
}

function showTyping() {
  startChat();
  const chatArea = document.getElementById('chat-area');
  const msg = document.createElement('div');
  msg.className = 'message message-bot';
  msg.innerHTML = `
    <div class="msg-header"><span class="bot-icon">&#x1F99E;</span> LobsterCLI</div>
    <div class="typing-indicator"><span></span><span></span><span></span></div>
  `;
  chatArea.appendChild(msg);
  scrollToBottom();
}

function scrollToBottom() {
  const chatArea = document.getElementById('chat-area');
  chatArea.scrollTop = chatArea.scrollHeight;
}

// ── Send Message ──
async function handleSend() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = 'auto';

  addUserMessage(text);
  showTyping();

  // Check if it's a command or AI question
  const lower = text.toLowerCase();

  if (lower.includes('summar') || lower.includes('what is this page') || lower.includes('about this page')) {
    await handleAction('summary');
  } else if (lower.includes('markdown') || lower.includes('extract')) {
    await handleAction('extract');
  } else if (lower.includes('form') || lower.includes('input field')) {
    await handleAction('forms');
  } else if (lower.includes('link')) {
    await handleAction('links');
  } else if (lower.includes('network') || lower.includes('api call') || lower.includes('monitor')) {
    await handleAction('network');
  } else if (lower.includes('snapshot') || lower.includes('dom')) {
    await handleAction('snapshot');
  } else {
    // AI question
    await handleAIQuestion(text);
  }
}

// ── Actions ──
async function handleAction(action) {
  if (!chatStarted) {
    startChat();
    // Add a contextual user message for chip clicks
    const labels = {
      summary: 'Summarize this page',
      extract: 'Extract as Markdown',
      forms: 'Detect all forms',
      links: 'Show key links',
      network: 'Monitor API calls',
      snapshot: 'DOM snapshot',
    };
    addUserMessage(labels[action] || action);
    showTyping();
  }

  switch (action) {
    case 'summary': return await doSummary();
    case 'extract': return await doExtract();
    case 'forms': return await doForms();
    case 'links': return await doLinks();
    case 'network': return await doNetwork();
    case 'snapshot': return await doSnapshot();
  }
}

async function doSummary() {
  try {
    const summary = await execInPage(() => {
      const title = document.title || '';
      const description = document.querySelector('meta[name="description"]')?.content ||
        document.querySelector('meta[property="og:description"]')?.content || '';
      const h1 = document.querySelector('h1')?.textContent?.trim() || '';

      const headings = [];
      document.querySelectorAll('h1, h2, h3').forEach(h => {
        const text = h.textContent.trim();
        if (text && text.length < 200) headings.push({ level: parseInt(h.tagName[1]), text: text.slice(0, 100) });
      });

      let mainText = '';
      const article = document.querySelector('article') || document.querySelector('[role="main"]') ||
        document.querySelector('main') || document.querySelector('.content') || document.querySelector('#content');
      if (article) {
        mainText = article.innerText?.trim()?.slice(0, 1000) || '';
      } else {
        let maxLen = 0;
        document.querySelectorAll('div, section').forEach(el => {
          const text = el.innerText?.trim() || '';
          if (text.length > maxLen && text.length < 50000) { maxLen = text.length; mainText = text.slice(0, 1000); }
        });
      }

      let pageType = 'webpage';
      if (document.querySelector('article, .post, .blog-post')) pageType = 'article';
      else if (document.querySelector('.product, [itemtype*="Product"]')) pageType = 'product';
      else if (document.querySelector('form[action*="search"], input[type="search"]')) pageType = 'search';
      else if (document.forms.length > 2) pageType = 'form-heavy';

      const wordCount = document.body?.innerText?.split(/\s+/).filter(Boolean).length || 0;

      let framework = '';
      try {
        if (document.querySelector('#__next, script[src*="_next"]')) framework = 'Next.js';
        else if (document.querySelector('[data-reactroot], #root')) framework = 'React';
        else if (document.querySelector('[ng-version]')) framework = 'Angular';
        else if (document.querySelector('#app[data-v-app]')) framework = 'Vue';
      } catch {}

      return { title, h1, description, pageType, wordCount, framework,
        headings: headings.slice(0, 12), mainText: mainText.slice(0, 400),
        linkCount: document.querySelectorAll('a[href]').length,
        imageCount: document.querySelectorAll('img').length,
        formCount: document.forms.length };
    });

    if (!summary) { addBotMessage('Could not analyze this page.'); return; }

    let html = '<div class="badge-row">';
    html += `<span class="badge badge-red">${summary.pageType}</span>`;
    if (summary.framework) html += `<span class="badge badge-purple">${summary.framework}</span>`;
    html += `<span class="badge badge-blue">${summary.wordCount.toLocaleString()} words</span>`;
    html += `<span class="badge badge-green">${summary.linkCount} links</span>`;
    html += '</div>';

    if (summary.h1 || summary.title) {
      html += `<h3>Title</h3><p>${escapeHtml(summary.h1 || summary.title)}</p>`;
    }
    if (summary.description) {
      html += `<h3>Description</h3><p>${escapeHtml(summary.description)}</p>`;
    }
    if (summary.mainText) {
      html += `<h3>Content Preview</h3><p>${escapeHtml(summary.mainText)}${summary.mainText.length >= 400 ? '...' : ''}</p>`;
    }
    if (summary.headings?.length > 0) {
      html += '<h3>Structure</h3><ul>';
      for (const h of summary.headings) {
        html += `<li>${'#'.repeat(h.level)} ${escapeHtml(h.text)}</li>`;
      }
      html += '</ul>';
    }

    addBotMessage(html);
  } catch (err) {
    addBotMessage('Error analyzing page: ' + escapeHtml(err.message));
  }
}

async function doExtract() {
  try {
    await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['shared/markdown.js'] });
    const md = await execInPage(() => lobsterMarkdown());
    const preview = typeof md === 'string' ? md.slice(0, 2000) : '';
    addBotMessage(
      `<h3>Markdown extracted (${md?.length || 0} chars)</h3><div class="code-block">${escapeHtml(preview)}${md?.length > 2000 ? '\n\n... (click Copy for full content)' : ''}</div>`,
      [{ label: 'Copy full Markdown', copy: md }]
    );
  } catch (err) {
    addBotMessage('Error extracting markdown: ' + escapeHtml(err.message));
  }
}

async function doSnapshot() {
  try {
    await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['shared/snapshot.js'] });
    const snap = await execInPage(() => lobsterSnapshot());
    const preview = typeof snap === 'string' ? snap.slice(0, 2000) : '';
    addBotMessage(
      `<h3>DOM Snapshot (${snap?.length || 0} chars)</h3><div class="code-block">${escapeHtml(preview)}${snap?.length > 2000 ? '\n\n... (click Copy for full snapshot)' : ''}</div>`,
      [{ label: 'Copy full snapshot', copy: snap }]
    );
  } catch (err) {
    addBotMessage('Error taking snapshot: ' + escapeHtml(err.message));
  }
}

async function doForms() {
  try {
    await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['shared/form-state.js'] });
    const state = await execInPage(() => lobsterFormState());

    if (!state || (state.forms.length === 0 && state.orphanFields.length === 0)) {
      addBotMessage('No forms or input fields found on this page.');
      return;
    }

    let html = `<h3>${state.forms.length} form(s) found</h3>`;

    for (const form of state.forms) {
      html += '<div class="form-card">';
      html += `<h4><span class="badge badge-blue">${form.method}</span> ${escapeHtml(form.name || form.id || 'Unnamed Form')}</h4>`;
      for (const field of form.fields) {
        html += '<div class="form-field">';
        html += `<span class="field-type">${field.type}</span>`;
        html += `<span class="field-label">${escapeHtml(field.label || field.name || 'unnamed')}</span>`;
        if (field.value && field.value !== '' && field.value !== false) html += `<span class="field-value">${escapeHtml(String(field.value))}</span>`;
        if (field.required) html += '<span class="field-required">req</span>';
        html += '</div>';
      }
      html += '</div>';
    }

    if (state.orphanFields.length > 0) {
      html += `<div class="form-card"><h4><span class="badge badge-purple">Orphan</span> ${state.orphanFields.length} standalone fields</h4>`;
      for (const f of state.orphanFields) {
        html += `<div class="form-field"><span class="field-type">${f.type}</span><span class="field-label">${escapeHtml(f.label || f.name || '')}</span></div>`;
      }
      html += '</div>';
    }

    addBotMessage(html);
  } catch (err) {
    addBotMessage('Error scanning forms: ' + escapeHtml(err.message));
  }
}

async function doLinks() {
  try {
    const links = await execInPage(() => {
      const results = [];
      document.querySelectorAll('a[href]').forEach(a => {
        const text = a.textContent?.trim();
        if (text && text.length > 2 && text.length < 100 && !text.includes('\n')) {
          results.push({ text, href: a.href });
        }
      });
      return results.slice(0, 20);
    });

    if (!links || links.length === 0) {
      addBotMessage('No meaningful links found on this page.');
      return;
    }

    let html = `<h3>${links.length} key links</h3><ul>`;
    for (const link of links) {
      html += `<li><a href="${escapeHtml(link.href)}" target="_blank">${escapeHtml(link.text)}</a></li>`;
    }
    html += '</ul>';

    addBotMessage(html);
  } catch (err) {
    addBotMessage('Error extracting links: ' + escapeHtml(err.message));
  }
}

async function doNetwork() {
  if (!interceptorActive) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['shared/interceptor.js'] });
      await execInPage(() => lobsterInstallInterceptor());
      interceptorActive = true;
      addBotMessage(
        'Network monitor activated! I\'m now intercepting all fetch/XHR calls on this page.<br><br>Browse around and interact with the page, then ask me <b>"show network"</b> to see captured API calls.',
      );
    } catch (err) {
      addBotMessage('Error starting network monitor: ' + escapeHtml(err.message));
    }
    return;
  }

  // Refresh captured requests
  const requests = await execInPage(() => {
    const store = window.__lobster_interceptor__;
    if (!store) return [];
    const reqs = [...store.requests];
    store.requests = [];
    return reqs;
  });

  if (!requests || requests.length === 0) {
    addBotMessage('No API calls captured yet. Interact with the page and try again.');
    return;
  }

  let html = `<h3>${requests.length} API calls captured</h3>`;
  for (const req of requests) {
    let displayUrl = req.url;
    try { const u = new URL(req.url); displayUrl = u.pathname + u.search; } catch {}
    html += `<div class="network-entry"><span class="method ${req.method}">${req.method}</span><span>${escapeHtml(displayUrl.slice(0, 80))}</span></div>`;
  }

  addBotMessage(html, [{ label: 'Copy as JSON', copy: JSON.stringify(requests, null, 2) }]);
}

async function handleAIQuestion(question) {
  if (!aiConfig) {
    addBotMessage(
      'AI features need an API key to work. You can configure one in the settings.<br><br>' +
      'Supports <b>OpenAI</b>, <b>Anthropic</b>, <b>Google Gemini</b> (free tier!), and <b>Ollama</b> (local, free).<br><br>' +
      'Meanwhile, try the built-in commands — they work without AI!',
    );
    return;
  }

  try {
    // Get page content
    await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['shared/markdown.js'] });
    const markdown = await execInPage(() => {
      try { return lobsterMarkdown(); }
      catch { return document.body?.innerText?.slice(0, 8000) || ''; }
    });
    const pageContent = typeof markdown === 'string' ? markdown.slice(0, 8000) : '';

    const response = await chrome.runtime.sendMessage({
      action: 'askAI',
      prompt: question,
      pageContent,
      pageUrl: currentTab.url,
      pageTitle: currentTab.title,
    });

    if (response.error) {
      addBotMessage('Error: ' + escapeHtml(response.error));
    } else {
      // Simple markdown-ish rendering
      const formatted = formatAIResponse(response.answer);
      addBotMessage(formatted);
    }
  } catch (err) {
    addBotMessage('Error: ' + escapeHtml(err.message));
  }
}

// ── Helpers ──
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

function formatAIResponse(text) {
  if (!text) return '';
  // Basic formatting: bold, code, line breaks
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/`(.*?)`/g, '<code style="background:var(--bg);padding:1px 5px;border-radius:3px;font-size:11px">$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
