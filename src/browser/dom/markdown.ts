/**
 * DOM-to-Markdown script — runs inside the browser.
 * Converts page content to clean Markdown.
 */
export const MARKDOWN_SCRIPT = `
(() => {
  const SKIP = new Set(['script', 'style', 'noscript', 'svg', 'head', 'nav', 'footer', 'header']);
  const BLOCK = new Set(['div', 'p', 'section', 'article', 'main', 'aside', 'blockquote', 'pre', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'figure', 'figcaption', 'details', 'summary', 'dl', 'dt', 'dd']);

  function walk(el) {
    if (!el) return '';
    if (el.nodeType === 3) return el.textContent || '';
    if (el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) return '';

    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return '';

    let inner = '';
    for (const c of el.childNodes) inner += walk(c);
    inner = inner.trim();
    if (!inner && !['br', 'hr', 'img'].includes(tag)) return '';

    switch (tag) {
      case 'h1': return '\\n# ' + inner + '\\n';
      case 'h2': return '\\n## ' + inner + '\\n';
      case 'h3': return '\\n### ' + inner + '\\n';
      case 'h4': return '\\n#### ' + inner + '\\n';
      case 'h5': return '\\n##### ' + inner + '\\n';
      case 'h6': return '\\n###### ' + inner + '\\n';
      case 'p': return '\\n' + inner + '\\n';
      case 'br': return '\\n';
      case 'hr': return '\\n---\\n';
      case 'strong': case 'b': return '**' + inner + '**';
      case 'em': case 'i': return '*' + inner + '*';
      case 'code': return '\\x60' + inner + '\\x60';
      case 'pre': return '\\n\\x60\\x60\\x60\\n' + inner + '\\n\\x60\\x60\\x60\\n';
      case 'a': {
        const href = el.getAttribute('href') || '';
        return '[' + inner + '](' + href + ')';
      }
      case 'img': {
        const alt = el.getAttribute('alt') || '';
        const src = el.getAttribute('src') || '';
        return '![' + alt + '](' + src + ')';
      }
      case 'li': return '- ' + inner + '\\n';
      case 'blockquote': return '\\n> ' + inner.replace(/\\n/g, '\\n> ') + '\\n';
      case 'td': case 'th': return inner + ' | ';
      case 'tr': return '| ' + inner + '\\n';
      default: return BLOCK.has(tag) ? '\\n' + inner + '\\n' : inner;
    }
  }

  const raw = walk(document.body);
  // Clean up excessive newlines
  return raw.replace(/\\n{3,}/g, '\\n\\n').trim();
})()
`;
