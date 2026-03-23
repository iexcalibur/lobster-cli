/**
 * Brain — Intent classifier for LobsterCLI.
 *
 * Analyzes a user's question and decides what data sources are needed
 * to answer it. Uses a cheap/fast LLM call for classification,
 * with heuristic fallback when no LLM is available.
 *
 * Works in both CLI and extension contexts.
 *
 * Three levels of customization:
 *   1. Use as-is: classifyIntent() with defaults
 *   2. Add rules: new Brain({ rules: [...] }) — merges with defaults
 *   3. Replace: new Brain({ classifierPrompt: '...', mode: 'replace' })
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
  source: 'llm' | 'heuristic' | 'custom-rule';
  /** Any extra fields from custom rules */
  [key: string]: unknown;
}

export interface BrainRule {
  /** Regex pattern to match against the user's question */
  pattern: RegExp;
  /** Fields to set when pattern matches — merges with default result */
  [key: string]: unknown;
}

export interface BrainContext {
  /** The user's question */
  prompt: string;
  /** Current page title */
  pageTitle?: string;
  /** Current page URL */
  pageUrl?: string;
}

export interface BrainConfig {
  /** Custom rules — checked before default classifier.
   *  Matching rules merge with (not replace) the default Brain's output.
   *  Set mode: 'replace' to skip the default Brain when a custom rule matches. */
  rules?: BrainRule[];

  /** Override the LLM classifier system prompt.
   *  If not set, uses the default classifier prompt. */
  classifierPrompt?: string;

  /** Post-process every decision. Runs after classification is complete.
   *  Use this as an escape hatch for logic that can't be expressed as regex rules. */
  onClassify?: (result: BrainDecision, ctx: BrainContext) => BrainDecision;

  /** 'merge' (default) — custom rules add to default Brain output.
   *  'replace' — when a custom rule matches, skip the default Brain entirely. */
  mode?: 'merge' | 'replace';
}

const DEFAULT_CLASSIFIER_PROMPT = `You are an intent classifier for a web automation tool. Given a user's question about a webpage, decide what data sources are needed to answer it.

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

/**
 * Configurable Brain class.
 *
 * Level 1: const brain = new Brain()  — uses defaults
 * Level 2: const brain = new Brain({ rules: [...] })  — adds custom rules
 * Level 3: const brain = new Brain({ classifierPrompt: '...', onClassify: fn })  — full control
 */
export class Brain {
  private rules: BrainRule[];
  private classifierPrompt: string;
  private onClassifyHook?: (result: BrainDecision, ctx: BrainContext) => BrainDecision;
  private mode: 'merge' | 'replace';

  constructor(config?: BrainConfig) {
    this.rules = config?.rules || [];
    this.classifierPrompt = config?.classifierPrompt || DEFAULT_CLASSIFIER_PROMPT;
    this.onClassifyHook = config?.onClassify;
    this.mode = config?.mode || 'merge';
  }

  /**
   * Classify a user's question.
   *
   * Flow:
   * 1. Check custom rules (regex match)
   * 2. If mode='replace' and a rule matched, use that result directly
   * 3. Otherwise run default classifier (LLM or heuristic)
   * 4. Merge custom rule result with default result (custom wins per-field)
   * 5. Run onClassify hook if set
   */
  async classify(
    prompt: string,
    pageTitle?: string,
    llmCall?: (systemPrompt: string, userPrompt: string) => Promise<string>,
  ): Promise<BrainDecision> {
    const ctx: BrainContext = { prompt, pageTitle, pageUrl: undefined };

    // Step 1: Check custom rules
    let customResult: Partial<BrainDecision> | null = null;

    for (const rule of this.rules) {
      if (rule.pattern.test(prompt)) {
        // Extract fields from rule (exclude 'pattern' key)
        const fields: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(rule)) {
          if (key !== 'pattern') fields[key] = val;
        }
        customResult = { ...(customResult || {}), ...fields, source: 'custom-rule' as const };
      }
    }

    // Step 2: If mode='replace' and a rule matched, return custom result directly
    if (this.mode === 'replace' && customResult) {
      const result: BrainDecision = {
        screenshot: false,
        markdown: false,
        forms: false,
        network: false,
        intent: 'custom rule match',
        source: 'custom-rule',
        ...customResult,
      };
      return this.applyHook(result, ctx);
    }

    // Step 3: Run default classifier (LLM or heuristic)
    let defaultResult: BrainDecision;

    if (llmCall) {
      try {
        const systemPrompt = this.classifierPrompt + `\nCurrent page: "${pageTitle || ''}"`;
        const response = await llmCall(systemPrompt, prompt);

        const jsonMatch = response.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          defaultResult = {
            screenshot: !!parsed.screenshot,
            markdown: parsed.markdown !== false,
            forms: !!parsed.forms,
            network: !!parsed.network,
            intent: parsed.intent || '',
            source: 'llm',
          };
        } else {
          defaultResult = heuristicClassify(prompt);
        }
      } catch {
        defaultResult = heuristicClassify(prompt);
      }
    } else {
      defaultResult = heuristicClassify(prompt);
    }

    // Step 4: Merge custom result with default (custom wins per-field)
    if (customResult) {
      const merged: BrainDecision = { ...defaultResult };
      for (const [key, val] of Object.entries(customResult)) {
        if (val !== undefined) {
          (merged as any)[key] = val;
        }
      }
      // Keep source as 'custom-rule' when custom rules contributed
      merged.source = 'custom-rule';
      return this.applyHook(merged, ctx);
    }

    return this.applyHook(defaultResult, ctx);
  }

  /**
   * Apply the onClassify hook if configured.
   */
  private applyHook(result: BrainDecision, ctx: BrainContext): BrainDecision {
    if (this.onClassifyHook) {
      return this.onClassifyHook(result, ctx);
    }
    return result;
  }

  /**
   * Add a rule dynamically at runtime.
   */
  addRule(rule: BrainRule): void {
    this.rules.push(rule);
  }

  /**
   * Remove all custom rules.
   */
  clearRules(): void {
    this.rules = [];
  }
}

/**
 * Standalone function — uses default Brain with no custom rules.
 * This is the original API, unchanged. Fully backwards compatible.
 */
export async function classifyIntent(
  prompt: string,
  pageTitle: string,
  llmCall?: (systemPrompt: string, userPrompt: string) => Promise<string>,
): Promise<BrainDecision> {
  const brain = new Brain();
  return brain.classify(prompt, pageTitle, llmCall);
}
