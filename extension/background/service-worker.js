/**
 * LobsterCLI Extension — Background Service Worker
 *
 * Handles LLM API calls (OpenAI, Anthropic, Gemini, Ollama),
 * screenshot capture, and config storage.
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
    defaultModel: 'gemini-2.5-flash',
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
    return true;
  }

  if (message.action === 'captureScreenshot') {
    handleCaptureScreenshot(message).then(sendResponse);
    return true;
  }

  if (message.action === 'testConnection') {
    handleTestConnection(message).then(sendResponse);
    return true;
  }
});

/**
 * Capture a screenshot of the active tab
 */
async function handleCaptureScreenshot({ tabId }) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'jpeg',
      quality: 80,
    });
    // Return base64 without the data:image/jpeg;base64, prefix
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    return { screenshot: base64, dataUrl };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Handle AI question about the page (with optional screenshot)
 */
async function handleAskAI({ prompt, pageContent, pageUrl, pageTitle, screenshot }) {
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

${pageContent ? `Page content (extracted as markdown):\n---\n${pageContent}\n---` : ''}

Answer the user's question about this page. Be concise and direct. If the information isn't on the page, say so.`;

    let answer;
    if (provider === 'anthropic') {
      answer = await callAnthropic(baseURL, apiKey, model, systemPrompt, prompt, screenshot);
    } else {
      answer = await callOpenAICompatible(baseURL, apiKey, model, systemPrompt, prompt, screenshot, provider);
    }

    return { answer };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * OpenAI-compatible API call with vision support (OpenAI, Gemini, Ollama)
 */
async function callOpenAICompatible(baseURL, apiKey, model, systemPrompt, userPrompt, screenshot, provider) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  // Build user message content — text + optional image
  const userContent = [];

  if (screenshot) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${screenshot}`,
      },
    });
    userContent.push({
      type: 'text',
      text: userPrompt,
    });
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    screenshot
      ? { role: 'user', content: userContent }
      : { role: 'user', content: userPrompt },
  ];

  const resp = await fetch(`${baseURL}/chat/completions`, {
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
 * Anthropic Messages API call with vision support
 */
async function callAnthropic(baseURL, apiKey, model, systemPrompt, userPrompt, screenshot) {
  // Build user message content
  const userContent = [];

  if (screenshot) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: screenshot,
      },
    });
  }

  userContent.push({
    type: 'text',
    text: userPrompt,
  });

  const resp = await fetch(`${baseURL}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
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
    let answer;
    if (provider === 'anthropic') {
      answer = await callAnthropic(baseURL, apiKey, model, '', 'Say "connected" in one word.', null);
    } else {
      answer = await callOpenAICompatible(baseURL, apiKey, model, '', 'Say "connected" in one word.', null, provider);
    }
    return { success: true, response: answer };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
