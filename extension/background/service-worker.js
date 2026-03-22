/**
 * LobsterCLI Extension — Background Service Worker
 *
 * Handles LLM API calls (OpenAI, Anthropic, Gemini, Ollama)
 * and config storage.
 */

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
  },
  anthropic: {
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
  },
  gemini: {
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    keyParam: true, // Gemini can also use ?key= query param
  },
  ollama: {
    name: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
  },
};

// ── Open side panel when extension icon is clicked ──
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Listen for messages from side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'askAI') {
    handleAskAI(message).then(sendResponse);
    return true; // async response
  }

  if (message.action === 'testConnection') {
    handleTestConnection(message).then(sendResponse);
    return true;
  }
});

/**
 * Handle AI question about the page
 */
async function handleAskAI({ prompt, pageContent, pageUrl, pageTitle }) {
  try {
    const config = await chrome.storage.local.get(['aiProvider', 'aiApiKey', 'aiModel', 'aiBaseURL']);

    if (!config.aiApiKey && config.aiProvider !== 'ollama') {
      return { error: 'No API key configured. Open extension settings to add one.' };
    }

    const provider = config.aiProvider || 'openai';
    const model = config.aiModel || PROVIDERS[provider]?.defaultModel || 'gpt-4o';
    const baseURL = config.aiBaseURL || PROVIDERS[provider]?.baseURL;
    const apiKey = config.aiApiKey || '';

    const systemPrompt = `You are LobsterCLI, a helpful web page analysis assistant. You analyze web pages and answer questions about their content.

Current page: ${pageTitle}
URL: ${pageUrl}

Page content (extracted as markdown):
---
${pageContent}
---

Answer the user's question about this page. Be concise and direct. If the information isn't on the page, say so.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ];

    let answer;
    if (provider === 'anthropic') {
      answer = await callAnthropic(baseURL, apiKey, model, messages);
    } else {
      answer = await callOpenAICompatible(baseURL, apiKey, model, messages, provider);
    }

    return { answer };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * OpenAI-compatible API call (works for OpenAI, Gemini, Ollama)
 */
async function callOpenAICompatible(baseURL, apiKey, model, messages, provider) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const url = `${baseURL}/chat/completions`;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`API error (${resp.status}): ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || 'No response from AI';
}

/**
 * Anthropic Messages API call
 */
async function callAnthropic(baseURL, apiKey, model, messages) {
  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const userMessages = messages.filter(m => m.role !== 'system');

  const resp = await fetch(`${baseURL}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system: systemMsg,
      messages: userMessages,
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic API error (${resp.status}): ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.content?.[0]?.text || 'No response from AI';
}

/**
 * Test API connection
 */
async function handleTestConnection({ provider, apiKey, model, baseURL }) {
  try {
    const messages = [
      { role: 'user', content: 'Say "connected" in one word.' },
    ];

    let answer;
    if (provider === 'anthropic') {
      answer = await callAnthropic(baseURL, apiKey, model, messages);
    } else {
      answer = await callOpenAICompatible(baseURL, apiKey, model, messages, provider);
    }

    return { success: true, response: answer };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
