/**
 * LobsterEngine — In-house lightweight HTML parser + content extractor.
 *
 * No Chrome, no external binary. Pure Node.js.
 * Fetches HTML via HTTP, parses into a DOM tree, extracts content
 * as markdown, text, links, or structured snapshot.
 *
 * Inspired by Lightpanda's approach but 100% our code.
 * Works for server-rendered pages. For JS-heavy SPAs, use Chrome engine.
 */

// ── HTML Node types ──

export interface HtmlNode {
  type: 'element' | 'text' | 'comment';
  tag?: string;
  attributes?: Record<string, string>;
  children?: HtmlNode[];
  text?: string;
  selfClosing?: boolean;
}

// ── HTML Parser ──

const SELF_CLOSING = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const RAWTEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

/**
 * Parse HTML string into a tree of HtmlNodes.
 * Handles: tags, attributes, self-closing, rawtext, comments, entities.
 */
export function parseHtml(html: string): HtmlNode[] {
  const root: HtmlNode[] = [];
  const stack: { node: HtmlNode; children: HtmlNode[] }[] = [{ node: { type: 'element', tag: 'root', children: root }, children: root }];
  let pos = 0;

  function current() { return stack[stack.length - 1]; }

  function addText(text: string) {
    if (!text) return;
    const decoded = decodeEntities(text);
    if (decoded.trim() || decoded.includes('\n')) {
      current().children.push({ type: 'text', text: decoded });
    }
  }

  while (pos < html.length) {
    const nextTag = html.indexOf('<', pos);

    if (nextTag === -1) {
      addText(html.slice(pos));
      break;
    }

    if (nextTag > pos) {
      addText(html.slice(pos, nextTag));
    }

    // Comment
    if (html.startsWith('<!--', nextTag)) {
      const endComment = html.indexOf('-->', nextTag + 4);
      pos = endComment === -1 ? html.length : endComment + 3;
      continue;
    }

    // Doctype
    if (html.startsWith('<!', nextTag) || html.startsWith('<?', nextTag)) {
      const endDoctype = html.indexOf('>', nextTag);
      pos = endDoctype === -1 ? html.length : endDoctype + 1;
      continue;
    }

    // Closing tag
    if (html[nextTag + 1] === '/') {
      const endClose = html.indexOf('>', nextTag);
      if (endClose === -1) { pos = html.length; break; }
      const closeTag = html.slice(nextTag + 2, endClose).trim().toLowerCase();
      pos = endClose + 1;

      // Pop stack until we find matching tag
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].node.tag === closeTag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    // Opening tag
    const tagEnd = html.indexOf('>', nextTag);
    if (tagEnd === -1) { pos = html.length; break; }

    const tagContent = html.slice(nextTag + 1, tagEnd);
    const selfClose = tagContent.endsWith('/');
    const cleanContent = selfClose ? tagContent.slice(0, -1).trim() : tagContent.trim();

    // Parse tag name and attributes
    const spaceIdx = cleanContent.search(/[\s/]/);
    const tagName = (spaceIdx === -1 ? cleanContent : cleanContent.slice(0, spaceIdx)).toLowerCase();
    const attrStr = spaceIdx === -1 ? '' : cleanContent.slice(spaceIdx);

    if (!tagName || tagName.startsWith('!')) {
      pos = tagEnd + 1;
      continue;
    }

    const attributes = parseAttributes(attrStr);
    const isSelfClosing = selfClose || SELF_CLOSING.has(tagName);

    const node: HtmlNode = {
      type: 'element',
      tag: tagName,
      attributes,
      children: isSelfClosing ? undefined : [],
      selfClosing: isSelfClosing,
    };

    current().children.push(node);
    pos = tagEnd + 1;

    if (isSelfClosing) continue;

    // Raw text tags (script, style) — consume until closing tag
    if (RAWTEXT_TAGS.has(tagName)) {
      const endRaw = html.toLowerCase().indexOf(`</${tagName}`, pos);
      if (endRaw !== -1) {
        const rawText = html.slice(pos, endRaw);
        if (rawText.trim()) {
          node.children!.push({ type: 'text', text: rawText });
        }
        pos = html.indexOf('>', endRaw) + 1;
      }
      continue;
    }

    // Push onto stack for children
    stack.push({ node, children: node.children! });

    // Auto-close certain tags
    if (tagName === 'p' || tagName === 'li' || tagName === 'td' || tagName === 'th' || tagName === 'dt' || tagName === 'dd') {
      // Check if parent is same tag — auto-close
      if (stack.length >= 3 && stack[stack.length - 2].node.tag === tagName) {
        stack.splice(stack.length - 2, 1);
      }
    }
  }

  return root;
}

function parseAttributes(str: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w[\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

// ── Content Extractors ──

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'head', 'template', 'iframe']);
const BLOCK_TAGS = new Set(['div', 'p', 'section', 'article', 'main', 'aside', 'blockquote', 'pre', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'figure', 'figcaption', 'details', 'summary', 'dl', 'dt', 'dd', 'header', 'footer', 'nav', 'form']);
const HEADING_LEVELS: Record<string, string> = { h1: '#', h2: '##', h3: '###', h4: '####', h5: '#####', h6: '######' };

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'details', 'summary']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'tab', 'switch', 'menuitem']);

/**
 * Extract plain text from parsed HTML.
 */
export function extractText(nodes: HtmlNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += node.text;
      continue;
    }
    if (node.type !== 'element' || !node.tag) continue;
    if (SKIP_TAGS.has(node.tag)) continue;

    const inner = node.children ? extractText(node.children) : '';
    if (BLOCK_TAGS.has(node.tag)) {
      out += '\n' + inner.trim() + '\n';
    } else {
      out += inner;
    }
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Extract Markdown from parsed HTML.
 */
export function extractMarkdown(nodes: HtmlNode[], baseUrl?: string): string {
  let listDepth = 0;
  let olCounter: number[] = [];

  function resolveUrl(href: string): string {
    if (!href || href.startsWith('javascript:') || href.startsWith('#')) return href;
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) return href;
    if (baseUrl) {
      try { return new URL(href, baseUrl).href; } catch {}
    }
    return href;
  }

  function walk(nodes: HtmlNode[]): string {
    let out = '';
    for (const node of nodes) {
      if (node.type === 'text') {
        out += node.text?.replace(/\s+/g, ' ') || '';
        continue;
      }
      if (node.type !== 'element' || !node.tag) continue;
      if (SKIP_TAGS.has(node.tag)) continue;

      const tag = node.tag;
      const children = node.children || [];
      const inner = walk(children).trim();

      // Headings
      if (HEADING_LEVELS[tag]) {
        out += `\n\n${HEADING_LEVELS[tag]} ${inner}\n\n`;
        continue;
      }

      switch (tag) {
        case 'p': out += `\n\n${inner}\n\n`; break;
        case 'br': out += '\n'; break;
        case 'hr': out += '\n\n---\n\n'; break;
        case 'strong': case 'b': if (inner) out += `**${inner}**`; break;
        case 'em': case 'i': if (inner) out += `*${inner}*`; break;
        case 's': case 'del': case 'strike': if (inner) out += `~~${inner}~~`; break;
        case 'code': if (inner) out += `\`${inner}\``; break;
        case 'pre': {
          const lang = children.find(c => c.tag === 'code')?.attributes?.class?.match(/language-(\w+)/)?.[1] || '';
          out += `\n\n\`\`\`${lang}\n${inner}\n\`\`\`\n\n`;
          break;
        }
        case 'a': {
          const href = resolveUrl(node.attributes?.href || '');
          const text = inner || node.attributes?.['aria-label'] || node.attributes?.title || '';
          if (!text) break;
          if (!href || href === '#' || href.startsWith('javascript:')) { out += text; break; }
          out += `[${text}](${href})`;
          break;
        }
        case 'img': {
          const alt = node.attributes?.alt || '';
          const src = resolveUrl(node.attributes?.src || '');
          if (src) out += `![${alt}](${src})`;
          break;
        }
        case 'ul': listDepth++; olCounter.push(0); out += '\n' + walk(children); listDepth--; olCounter.pop(); break;
        case 'ol': listDepth++; olCounter.push(0); out += '\n' + walk(children); listDepth--; olCounter.pop(); break;
        case 'li': {
          const indent = '  '.repeat(Math.max(0, listDepth - 1));
          const isOrdered = olCounter.length > 0 && olCounter[olCounter.length - 1] >= 0;
          if (isOrdered && olCounter.length > 0) olCounter[olCounter.length - 1]++;
          const counter = isOrdered && olCounter.length > 0 ? olCounter[olCounter.length - 1] : 0;
          const bullet = isOrdered ? `${counter}. ` : '- ';
          out += `${indent}${bullet}${inner}\n`;
          break;
        }
        case 'blockquote': {
          if (inner) out += '\n\n' + inner.split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
          break;
        }
        case 'table': {
          // Collect rows
          const rows = collectTableRows(children);
          if (rows.length > 0) {
            out += '\n\n';
            for (let i = 0; i < rows.length; i++) {
              out += '| ' + rows[i].join(' | ') + ' |\n';
              if (i === 0) out += '| ' + rows[i].map(() => '---').join(' | ') + ' |\n';
            }
            out += '\n';
          }
          break;
        }
        case 'dt': out += `\n**${inner}**\n`; break;
        case 'dd': out += `: ${inner}\n`; break;
        case 'figcaption': out += `\n*${inner}*\n`; break;
        case 'summary': out += `**${inner}**\n\n`; break;
        default:
          if (BLOCK_TAGS.has(tag)) {
            out += '\n' + walk(children) + '\n';
          } else {
            out += walk(children);
          }
      }
    }
    return out;
  }

  function collectTableRows(nodes: HtmlNode[]): string[][] {
    const rows: string[][] = [];
    for (const node of nodes) {
      if (node.tag === 'tr') {
        const cells: string[] = [];
        for (const cell of node.children || []) {
          if (cell.tag === 'td' || cell.tag === 'th') {
            cells.push(walk(cell.children || []).trim().replace(/\|/g, '\\|').replace(/\n/g, ' '));
          }
        }
        if (cells.length > 0) rows.push(cells);
      } else if (node.tag === 'thead' || node.tag === 'tbody' || node.tag === 'tfoot') {
        rows.push(...collectTableRows(node.children || []));
      }
    }
    return rows;
  }

  const raw = walk(nodes);
  return raw.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Extract a snapshot with interactive element indices.
 */
export function extractSnapshot(nodes: HtmlNode[]): string {
  let idx = 0;
  const ATTR_WHITELIST = ['type', 'role', 'aria-label', 'placeholder', 'href', 'value', 'name', 'alt'];

  function isInteractive(node: HtmlNode): boolean {
    if (!node.tag) return false;
    if (INTERACTIVE_TAGS.has(node.tag)) return true;
    const role = node.attributes?.role;
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (node.attributes?.contenteditable === 'true') return true;
    if (node.attributes?.tabindex && parseInt(node.attributes.tabindex) >= 0) return true;
    return false;
  }

  function getAttrs(node: HtmlNode): string {
    const parts: string[] = [];
    for (const name of ATTR_WHITELIST) {
      const v = node.attributes?.[name];
      if (v) parts.push(`${name}=${v.slice(0, 60)}`);
    }
    return parts.length ? ' ' + parts.join(' ') : '';
  }

  function walk(nodes: HtmlNode[], depth: number): string {
    let out = '';
    for (const node of nodes) {
      if (node.type === 'text') {
        const t = node.text?.trim();
        if (t) out += '  '.repeat(depth) + t.slice(0, 150) + '\n';
        continue;
      }
      if (node.type !== 'element' || !node.tag) continue;
      if (SKIP_TAGS.has(node.tag)) continue;

      const indent = '  '.repeat(depth);
      const inter = isInteractive(node);
      const prefix = inter ? `[${idx++}]` : '';
      const attrs = getAttrs(node);

      // Leaf text
      const leafText = node.children?.length === 1 && node.children[0].type === 'text'
        ? (node.children[0].text?.trim().slice(0, 150) || '') : '';

      if (inter || leafText || !node.children?.length) {
        if (leafText) {
          out += `${indent}${prefix}<${node.tag}${attrs}>${leafText}</${node.tag}>\n`;
        } else {
          out += `${indent}${prefix}<${node.tag}${attrs}>\n`;
          if (node.children) out += walk(node.children, depth + 1);
        }
      } else {
        if (node.children) out += walk(node.children, depth);
      }
    }
    return out;
  }

  return walk(nodes, 0);
}

/**
 * Extract links from parsed HTML.
 */
export function extractLinks(nodes: HtmlNode[], baseUrl?: string): { text: string; href: string }[] {
  const links: { text: string; href: string }[] = [];

  function walk(nodes: HtmlNode[]) {
    for (const node of nodes) {
      if (node.type === 'element' && node.tag === 'a' && node.attributes?.href) {
        let href = node.attributes.href;
        if (baseUrl && !href.startsWith('http')) {
          try { href = new URL(href, baseUrl).href; } catch {}
        }
        const text = extractText(node.children || []).trim();
        if (text && href && !href.startsWith('javascript:')) {
          links.push({ text: text.slice(0, 200), href });
        }
      }
      if (node.children) walk(node.children);
    }
  }

  walk(nodes);
  return links;
}

// ── Main fetch function (replaces Lightpanda binary) ──

export interface LobsterFetchResult {
  url: string;
  finalUrl: string;
  status: number;
  title: string;
  content: string;
  links?: { text: string; href: string }[];
  duration: number;
}

/**
 * Fetch a URL and extract content — no Chrome, no external binary.
 * Uses our in-house HTML parser.
 */
export async function lobsterFetch(
  url: string,
  options?: {
    dump?: 'markdown' | 'text' | 'snapshot' | 'html' | 'links';
    timeout?: number;
    headers?: Record<string, string>;
    followRedirects?: boolean;
  },
): Promise<LobsterFetchResult> {
  const timeout = options?.timeout || 30000;
  const dump = options?.dump || 'markdown';

  const start = Date.now();

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'LobsterCLI/0.1 (+https://github.com/iexcalibur/lobster-cli)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      ...(options?.headers || {}),
    },
    redirect: options?.followRedirects !== false ? 'follow' : 'manual',
    signal: AbortSignal.timeout(timeout),
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }

  const html = await resp.text();
  const duration = Date.now() - start;
  const finalUrl = resp.url || url;

  // Parse
  const nodes = parseHtml(html);

  // Extract title
  let title = '';
  function findTitle(nodes: HtmlNode[]): void {
    for (const node of nodes) {
      if (node.tag === 'title' && node.children?.[0]?.text) {
        title = node.children[0].text.trim();
        return;
      }
      if (node.children) findTitle(node.children);
    }
  }
  findTitle(nodes);

  // Extract content based on dump format
  let content: string;
  let links: { text: string; href: string }[] | undefined;

  switch (dump) {
    case 'markdown':
      content = extractMarkdown(nodes, finalUrl);
      break;
    case 'text':
      content = extractText(nodes);
      break;
    case 'snapshot':
      content = extractSnapshot(nodes);
      break;
    case 'html':
      content = html;
      break;
    case 'links':
      links = extractLinks(nodes, finalUrl);
      content = links.map((l, i) => `${i + 1}. [${l.text}](${l.href})`).join('\n');
      break;
    default:
      content = extractMarkdown(nodes, finalUrl);
  }

  return { url, finalUrl, status: resp.status, title, content, links, duration };
}

// Keep these exports for backward compatibility
export function isLightpandaAvailable(): boolean { return true; } // Our engine is always available
export function getInstallInstructions(): string { return 'Built-in — no installation needed'; }
