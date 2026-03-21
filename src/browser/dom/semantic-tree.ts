/**
 * Semantic tree script — runs inside the browser.
 * Extracts accessibility roles, names, and interactive classification.
 */
export const SEMANTIC_TREE_SCRIPT = `
(() => {
  const SKIP = new Set(['script', 'style', 'noscript', 'svg', 'head', 'meta', 'link']);
  const ROLE_MAP = {
    a: 'link', button: 'button', input: 'textbox', select: 'combobox',
    textarea: 'textbox', h1: 'heading', h2: 'heading', h3: 'heading',
    h4: 'heading', h5: 'heading', h6: 'heading', nav: 'navigation',
    main: 'main', header: 'banner', footer: 'contentinfo', aside: 'complementary',
    form: 'form', table: 'table', img: 'img', ul: 'list', ol: 'list', li: 'listitem',
  };

  function getRole(el) {
    return el.getAttribute('role') || ROLE_MAP[el.tagName.toLowerCase()] || '';
  }

  function getName(el) {
    return el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || '';
  }

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    return ['a', 'button', 'input', 'select', 'textarea'].includes(tag) ||
      el.getAttribute('role') === 'button' ||
      el.getAttribute('role') === 'link' ||
      el.contentEditable === 'true' ||
      (el.tabIndex >= 0 && el.getAttribute('tabindex') !== null);
  }

  function walk(el, depth, maxDepth) {
    if (!el || depth > maxDepth) return '';
    if (el.nodeType === 3) {
      const t = el.textContent.trim();
      return t ? '  '.repeat(depth) + 'text: "' + t.slice(0, 100) + '"\\n' : '';
    }
    if (el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) return '';

    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return '';

    const role = getRole(el);
    const name = getName(el);
    const interactive = isInteractive(el);
    const indent = '  '.repeat(depth);

    let line = indent;
    if (role) line += role;
    else line += tag;
    if (name) line += ' "' + name.slice(0, 80) + '"';
    if (interactive) line += ' [interactive]';
    if (el.tagName === 'INPUT') {
      const type = el.getAttribute('type') || 'text';
      const val = el.value || '';
      line += ' type=' + type;
      if (val) line += ' value="' + val.slice(0, 50) + '"';
    }
    line += '\\n';

    let out = line;
    for (const c of el.childNodes) {
      out += walk(c, depth + 1, maxDepth);
    }
    return out;
  }

  return walk(document.body, 0, 15);
})()
`;
