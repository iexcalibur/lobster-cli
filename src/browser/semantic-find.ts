/**
 * Semantic Element Finding — match elements by natural language.
 *
 * Uses Jaccard similarity with synonym expansion, role boost,
 * and prefix matching. Zero external dependencies — runs in Node.
 *
 * Inspired by PinchTab's hybrid lexical+embedding matcher, built from scratch.
 */

export interface FindMatch {
  ref: number;
  score: number;
  text: string;
  role: string;
  tag: string;
}

export interface FindOptions {
  maxResults?: number;   // default 5
  minScore?: number;     // default 0.3
}

interface InteractiveElement {
  index: number;
  tag: string;
  role: string;
  text: string;
  types: string[];
  ariaLabel: string;
}

// ── Synonym table ──
const SYNONYMS: Record<string, string[]> = {
  btn: ['button'],
  button: ['btn', 'submit', 'click'],
  submit: ['go', 'send', 'ok', 'confirm', 'done', 'button'],
  search: ['find', 'lookup', 'query', 'filter'],
  login: ['signin', 'sign-in', 'log-in', 'authenticate'],
  signup: ['register', 'create-account', 'sign-up', 'join'],
  logout: ['signout', 'sign-out', 'log-out'],
  close: ['dismiss', 'x', 'cancel', 'exit'],
  menu: ['nav', 'navigation', 'hamburger', 'sidebar'],
  nav: ['navigation', 'menu', 'navbar'],
  input: ['field', 'textbox', 'text', 'entry'],
  email: ['mail', 'e-mail'],
  password: ['pass', 'pwd', 'secret'],
  next: ['continue', 'forward', 'proceed'],
  back: ['previous', 'return', 'go-back'],
  save: ['store', 'keep', 'persist'],
  delete: ['remove', 'trash', 'discard', 'destroy'],
  edit: ['modify', 'change', 'update'],
  add: ['create', 'new', 'plus', 'insert'],
  settings: ['preferences', 'config', 'options', 'gear'],
  profile: ['account', 'user', 'avatar'],
  home: ['main', 'dashboard', 'start'],
  link: ['anchor', 'href', 'url'],
  select: ['dropdown', 'combo', 'picker', 'choose'],
  checkbox: ['check', 'toggle', 'tick'],
  upload: ['attach', 'file', 'browse'],
  download: ['save', 'export'],
};

// ── Role keywords that boost score ──
const ROLE_KEYWORDS = new Set([
  'button', 'link', 'input', 'textbox', 'checkbox', 'radio',
  'select', 'dropdown', 'tab', 'menu', 'menuitem', 'switch',
  'slider', 'combobox', 'searchbox', 'option',
]);

/**
 * Tokenize a string into lowercase words.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length > 0);
}

/**
 * Expand tokens with synonyms.
 */
function expandSynonyms(tokens: string[]): Set<string> {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    const syns = SYNONYMS[token];
    if (syns) {
      for (const syn of syns) expanded.add(syn);
    }
  }
  return expanded;
}

/**
 * Build frequency map.
 */
function freqMap(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of tokens) {
    map.set(t, (map.get(t) || 0) + 1);
  }
  return map;
}

/**
 * Jaccard similarity with frequency weighting.
 */
function jaccardScore(queryTokens: string[], descTokens: string[]): number {
  const qFreq = freqMap(queryTokens);
  const dFreq = freqMap(descTokens);

  let intersection = 0;
  let union = 0;

  const allTokens = new Set([...qFreq.keys(), ...dFreq.keys()]);
  for (const token of allTokens) {
    const qCount = qFreq.get(token) || 0;
    const dCount = dFreq.get(token) || 0;
    intersection += Math.min(qCount, dCount);
    union += Math.max(qCount, dCount);
  }

  return union === 0 ? 0 : intersection / union;
}

/**
 * Prefix matching score — handles abbreviations.
 * "btn" matches "button" partially.
 */
function prefixScore(queryTokens: string[], descTokens: string[]): number {
  if (queryTokens.length === 0 || descTokens.length === 0) return 0;

  let matches = 0;
  for (const qt of queryTokens) {
    if (qt.length < 3) continue;
    for (const dt of descTokens) {
      if (dt.startsWith(qt) || qt.startsWith(dt)) {
        matches += 0.5;
        break;
      }
    }
  }

  return Math.min(matches / queryTokens.length, 0.3);
}

/**
 * Role keyword boost — if query mentions a role and element matches.
 */
function roleBoost(queryTokens: string[], elementRole: string): number {
  const roleLower = elementRole.toLowerCase();
  for (const qt of queryTokens) {
    if (ROLE_KEYWORDS.has(qt) && roleLower.includes(qt)) {
      return 0.2;
    }
  }
  return 0;
}

/**
 * Score a single element against the query.
 */
function scoreElement(
  queryTokens: string[],
  queryExpanded: Set<string>,
  element: InteractiveElement,
): number {
  // Build description from all element text sources
  const descParts = [
    element.text,
    element.role,
    element.tag,
    element.ariaLabel,
  ].filter(Boolean);
  const descText = descParts.join(' ');
  const descTokens = tokenize(descText);

  if (descTokens.length === 0) return 0;

  // Expand description tokens too
  const descExpanded = expandSynonyms(descTokens);

  // 1. Jaccard similarity on expanded token sets
  const expandedQueryTokens = [...queryExpanded];
  const expandedDescTokens = [...descExpanded];
  const jaccard = jaccardScore(expandedQueryTokens, expandedDescTokens);

  // 2. Prefix matching
  const prefix = prefixScore(queryTokens, descTokens);

  // 3. Role keyword boost
  const role = roleBoost(queryTokens, element.role || element.tag);

  // 4. Exact substring match bonus
  const queryStr = queryTokens.join(' ');
  const descStr = descTokens.join(' ');
  const exactBonus = descStr.includes(queryStr) ? 0.3 : 0;

  return Math.min(jaccard + prefix + role + exactBonus, 1.0);
}

/**
 * Find elements matching a natural language query.
 *
 * @param elements - Interactive elements from INTERACTIVE_ELEMENTS_SCRIPT
 * @param query - Natural language description (e.g., "login button")
 * @param options - maxResults (default 5), minScore (default 0.3)
 */
export function semanticFind(
  elements: InteractiveElement[],
  query: string,
  options?: FindOptions,
): FindMatch[] {
  const maxResults = options?.maxResults ?? 5;
  const minScore = options?.minScore ?? 0.3;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const queryExpanded = expandSynonyms(queryTokens);

  const scored: FindMatch[] = [];

  for (const el of elements) {
    const score = scoreElement(queryTokens, queryExpanded, el);
    if (score >= minScore) {
      scored.push({
        ref: el.index,
        score: Math.round(score * 100) / 100,
        text: (el.text || el.ariaLabel || '').slice(0, 60),
        role: el.role || el.tag,
        tag: el.tag,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}
