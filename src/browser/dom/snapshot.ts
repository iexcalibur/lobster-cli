/**
 * DOM snapshot script — runs inside the browser.
 * Produces a pruned accessibility-oriented snapshot with interactive element indices.
 */
export const SNAPSHOT_SCRIPT = `
(() => {
  let idx = 0;
  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'path', 'meta', 'link', 'head']);
  const INTERACTIVE = new Set(['a', 'button', 'input', 'select', 'textarea', 'details', 'summary']);
  const INTERACTIVE_ROLES = new Set(['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'tab', 'switch', 'menuitem']);

  function isVisible(el) {
    if (!el.offsetParent && el.tagName !== 'BODY' && el.tagName !== 'HTML') return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE.has(tag)) return true;
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (el.contentEditable === 'true') return true;
    if (el.tabIndex >= 0 && el.getAttribute('tabindex') !== null) return true;
    return false;
  }

  function attrs(el) {
    const a = [];
    for (const name of ['type', 'role', 'aria-label', 'placeholder', 'href', 'value', 'name']) {
      const v = el.getAttribute(name);
      if (v) a.push(name + '=' + v);
    }
    return a.length ? ' ' + a.join(' ') : '';
  }

  function walk(el, depth) {
    if (!el || el.nodeType === 8) return '';
    if (el.nodeType === 3) {
      const t = el.textContent.trim();
      return t ? '  '.repeat(depth) + t + '\\n' : '';
    }
    if (el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return '';
    if (!isVisible(el)) return '';

    const indent = '  '.repeat(depth);
    const inter = isInteractive(el);
    const prefix = inter ? '[' + (idx++) + ']' : '';
    const a = attrs(el);
    const text = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
      ? el.childNodes[0].textContent.trim().slice(0, 150) : '';

    let out = '';
    if (inter || text || el.children.length === 0) {
      if (text) {
        out = indent + prefix + '<' + tag + a + '>' + text + '</' + tag + '>\\n';
      } else {
        out = indent + prefix + '<' + tag + a + '>\\n';
        for (const c of el.childNodes) out += walk(c, depth + 1);
        // Only include closing if we opened
      }
    } else {
      for (const c of el.childNodes) out += walk(c, depth);
    }

    if (inter && el.dataset) el.dataset.ref = String(idx - 1);

    return out;
  }

  return walk(document.body, 0);
})()
`;
