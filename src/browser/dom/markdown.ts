/**
 * DOM-to-Markdown converter — runs inside the browser.
 *
 * Full-featured conversion based on Lightpanda's markdown.zig:
 * - Table support with header separator rows
 * - URL resolution (relative → absolute)
 * - Nested ordered/unordered lists with proper indentation
 * - Character escaping for Markdown special chars
 * - Strikethrough, code blocks, blockquotes
 * - Smart anchor handling (inline vs block)
 * - Whitespace collapsing
 */
export const MARKDOWN_SCRIPT = `
(() => {
  const SKIP = new Set(['script','style','noscript','svg','head','template']);
  const baseUrl = location.href;

  // Resolve relative URLs to absolute
  function resolveUrl(href) {
    if (!href || href.startsWith('javascript:') || href.startsWith('#')) return href;
    try { return new URL(href, baseUrl).href; } catch { return href; }
  }

  // Escape Markdown special chars in text
  function escapeText(text) {
    return text
      .replace(/\\\\/g, '\\\\\\\\')
      .replace(/([*_~\`\\[\\]|])/g, '\\\\$1');
  }

  // State tracking
  let listDepth = 0;
  let orderedCounters = [];
  let inPre = false;
  let inTable = false;

  function listIndent() { return '  '.repeat(listDepth); }

  function walk(el) {
    if (!el) return '';

    // Text node
    if (el.nodeType === 3) {
      const text = el.textContent || '';
      if (inPre) return text;
      // Collapse whitespace
      const collapsed = text.replace(/\\s+/g, ' ');
      return collapsed === ' ' && !el.previousSibling && !el.nextSibling ? '' : collapsed;
    }

    if (el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) return '';

    // Visibility check
    try {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return '';
    } catch {}

    // Get children content
    function childContent() {
      let out = '';
      for (const c of el.childNodes) out += walk(c);
      return out;
    }

    switch (tag) {
      // ── Headings ──
      case 'h1': return '\\n\\n# ' + childContent().trim() + '\\n\\n';
      case 'h2': return '\\n\\n## ' + childContent().trim() + '\\n\\n';
      case 'h3': return '\\n\\n### ' + childContent().trim() + '\\n\\n';
      case 'h4': return '\\n\\n#### ' + childContent().trim() + '\\n\\n';
      case 'h5': return '\\n\\n##### ' + childContent().trim() + '\\n\\n';
      case 'h6': return '\\n\\n###### ' + childContent().trim() + '\\n\\n';

      // ── Block elements ──
      case 'p': return '\\n\\n' + childContent().trim() + '\\n\\n';
      case 'br': return '\\n';
      case 'hr': return '\\n\\n---\\n\\n';

      // ── Inline formatting ──
      case 'strong': case 'b': {
        const inner = childContent().trim();
        return inner ? '**' + inner + '**' : '';
      }
      case 'em': case 'i': {
        const inner = childContent().trim();
        return inner ? '*' + inner + '*' : '';
      }
      case 's': case 'del': case 'strike': {
        const inner = childContent().trim();
        return inner ? '~~' + inner + '~~' : '';
      }
      case 'code': {
        if (inPre) return childContent();
        const inner = childContent();
        return inner ? '\\x60' + inner + '\\x60' : '';
      }

      // ── Code blocks ──
      case 'pre': {
        inPre = true;
        const inner = childContent();
        inPre = false;
        const lang = el.querySelector('code')?.className?.match(/language-(\\w+)/)?.[1] || '';
        return '\\n\\n\\x60\\x60\\x60' + lang + '\\n' + inner.trim() + '\\n\\x60\\x60\\x60\\n\\n';
      }

      // ── Links ──
      case 'a': {
        const href = resolveUrl(el.getAttribute('href') || '');
        const inner = childContent().trim();
        const name = inner || el.getAttribute('aria-label') || el.getAttribute('title') || '';
        if (!name) return '';
        if (!href || href === '#' || href.startsWith('javascript:')) return name;
        return '[' + name + '](' + href + ')';
      }

      // ── Images ──
      case 'img': {
        const alt = el.getAttribute('alt') || '';
        const src = resolveUrl(el.getAttribute('src') || '');
        return src ? '![' + alt + '](' + src + ')' : '';
      }

      // ── Lists ──
      case 'ul': {
        listDepth++;
        orderedCounters.push(0);
        const inner = childContent();
        listDepth--;
        orderedCounters.pop();
        return '\\n' + inner;
      }
      case 'ol': {
        listDepth++;
        orderedCounters.push(0);
        const inner = childContent();
        listDepth--;
        orderedCounters.pop();
        return '\\n' + inner;
      }
      case 'li': {
        const parent = el.parentElement?.tagName?.toLowerCase();
        const isOrdered = parent === 'ol';
        const inner = childContent().trim();
        if (!inner) return '';
        if (isOrdered) {
          const counter = orderedCounters.length > 0
            ? ++orderedCounters[orderedCounters.length - 1] : 1;
          return listIndent() + counter + '. ' + inner + '\\n';
        }
        return listIndent() + '- ' + inner + '\\n';
      }

      // ── Blockquote ──
      case 'blockquote': {
        const inner = childContent().trim();
        if (!inner) return '';
        return '\\n\\n' + inner.split('\\n').map(line => '> ' + line).join('\\n') + '\\n\\n';
      }

      // ── Tables ──
      case 'table': {
        inTable = true;
        let out = '\\n\\n';
        const rows = el.querySelectorAll('tr');
        let headerDone = false;

        for (let i = 0; i < rows.length; i++) {
          const cells = rows[i].querySelectorAll('th, td');
          const isHeader = rows[i].querySelector('th') !== null;
          const cellTexts = [];
          for (const cell of cells) {
            let cellText = '';
            for (const c of cell.childNodes) cellText += walk(c);
            cellTexts.push(cellText.trim().replace(/\\|/g, '\\\\|').replace(/\\n/g, ' '));
          }

          out += '| ' + cellTexts.join(' | ') + ' |\\n';

          if (isHeader && !headerDone) {
            out += '| ' + cellTexts.map(() => '---').join(' | ') + ' |\\n';
            headerDone = true;
          }

          // First data row without headers — synthesize separator
          if (i === 0 && !isHeader && !headerDone) {
            out += '| ' + cellTexts.map(() => '---').join(' | ') + ' |\\n';
            headerDone = true;
          }
        }

        inTable = false;
        return out + '\\n';
      }
      case 'thead': case 'tbody': case 'tfoot':
        return childContent();
      case 'tr': case 'td': case 'th':
        // Handled by table walker above; fallback for orphaned elements
        return childContent();

      // ── Definition lists ──
      case 'dl': return '\\n\\n' + childContent() + '\\n\\n';
      case 'dt': return '\\n**' + childContent().trim() + '**\\n';
      case 'dd': return ': ' + childContent().trim() + '\\n';

      // ── Figure ──
      case 'figure': return '\\n\\n' + childContent().trim() + '\\n\\n';
      case 'figcaption': return '\\n*' + childContent().trim() + '*\\n';

      // ── Details/Summary ──
      case 'details': return '\\n\\n' + childContent() + '\\n\\n';
      case 'summary': return '**' + childContent().trim() + '**\\n\\n';

      // ── Generic blocks ──
      case 'div': case 'section': case 'article': case 'main': case 'aside':
      case 'header': case 'footer': case 'nav':
        return '\\n' + childContent() + '\\n';

      case 'span': case 'small': case 'sub': case 'sup': case 'abbr':
      case 'time': case 'mark': case 'cite': case 'q':
        return childContent();

      default:
        return childContent();
    }
  }

  const raw = walk(document.body);
  // Clean up: collapse 3+ newlines to 2, trim
  return raw.replace(/\\n{3,}/g, '\\n\\n').replace(/^\\n+|\\n+$/g, '').trim();
})()
`;
