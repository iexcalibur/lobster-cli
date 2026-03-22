/**
 * Brain — Intent classifier for LobsterCLI.
 *
 * Analyzes a user's question and decides what data sources are needed
 * to answer it. Uses a cheap/fast LLM call for classification,
 * with heuristic fallback when no LLM is available.
 *
 * Works in both CLI and extension contexts.
 */

export interface BrainDecision {
  /** Needs to SEE the page (images, layout, colors, visual content) */
  screenshot: boolean;
  /** Needs page text content (articles, paragraphs, written content) */
  markdown: boolean;
  /** Asking about forms, inputs, fields */
  forms: boolean;
  /** Asking about API calls, network requests */
  network: boolean;
  /** Brief description of what the user wants */
  intent: string;
  /** How the decision was made */
  source: 'llm' | 'heuristic';
}

const CLASSIFIER_PROMPT = `You are an intent classifier for a web automation tool. Given a user's question about a webpage, decide what data sources are needed to answer it.

Respond ONLY with a JSON object:
{
  "screenshot": true/false,
  "markdown": true/false,
  "forms": true/false,
  "network": true/false,
  "intent": "brief 5-word description"
}

Rules:
- screenshot=true ONLY when the answer requires SEEING the page (images, visual layout, colors, charts, what something looks like)
- markdown=true for ANY question about text content, meaning, topics, summaries
- forms=true ONLY when specifically asking about form fields or inputs
- network=true ONLY when asking about APIs, requests, or data fetching
- Most questions need only markdown=true`;

/**
 * Classify intent using LLM (requires a callable LLM function)
 */
export async function classifyIntent(
  prompt: string,
  pageTitle: string,
  llmCall?: (systemPrompt: string, userPrompt: string) => Promise<string>,
): Promise<BrainDecision> {
  // If we have an LLM function, use it
  if (llmCall) {
    try {
      const systemPrompt = CLASSIFIER_PROMPT + `\nCurrent page: "${pageTitle}"`;
      const response = await llmCall(systemPrompt, prompt);

      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          screenshot: !!parsed.screenshot,
          markdown: parsed.markdown !== false,
          forms: !!parsed.forms,
          network: !!parsed.network,
          intent: parsed.intent || '',
          source: 'llm',
        };
      }
    } catch {
      // Fall through to heuristic
    }
  }

  return heuristicClassify(prompt);
}

/**
 * Heuristic classification — no LLM needed, instant, free.
 */
export function heuristicClassify(prompt: string): BrainDecision {
  const lower = prompt.toLowerCase();

  const screenshot = /look|see|visual|image|screenshot|screen|what('s| is) (on|showing|displayed|visible)|describe.*layout|picture|colour|color|design|ui |logo|icon|chart|graph|photo|video|banner|appear/i.test(lower);

  const forms = /form|input|field|submit|login|sign.?in|password|checkbox|dropdown|select|textarea|search.?box|fill/i.test(lower);

  const network = /api|network|request|fetch|xhr|endpoint|call.*server|data.*load/i.test(lower);

  return {
    screenshot,
    markdown: true,
    forms,
    network,
    intent: 'heuristic classification',
    source: 'heuristic',
  };
}
