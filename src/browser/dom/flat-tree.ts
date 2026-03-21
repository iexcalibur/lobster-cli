/**
 * Script that runs inside the browser to extract a flat DOM tree
 * with indexed interactive elements — the format the AI agent uses.
 *
 * Based on Page Agent's DOM extraction approach.
 */
export const FLAT_TREE_SCRIPT = `
(() => {
  const INTERACTIVE_TAGS = new Set([
    'a', 'button', 'input', 'select', 'textarea', 'details', 'summary',
    'label', 'option', 'fieldset', 'legend',
  ]);

  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
    'listbox', 'menu', 'menuitem', 'tab', 'switch', 'slider',
    'searchbox', 'spinbutton', 'option', 'menuitemcheckbox', 'menuitemradio',
  ]);

  const ATTR_WHITELIST = [
    'type', 'role', 'aria-label', 'aria-expanded', 'aria-selected',
    'aria-checked', 'aria-disabled', 'placeholder', 'title', 'href',
    'value', 'name', 'alt', 'src',
  ];

  let highlightIndex = 0;
  const nodes = {};
  const selectorMap = {};

  function isVisible(el) {
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
  }

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) return true;
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (el.getAttribute('contenteditable') === 'true') return true;
    if (el.getAttribute('tabindex') !== null && parseInt(el.getAttribute('tabindex')) >= 0) return true;
    if (el.onclick || el.getAttribute('onclick')) return true;
    return false;
  }

  function getAttributes(el) {
    const attrs = {};
    for (const attr of ATTR_WHITELIST) {
      const val = el.getAttribute(attr);
      if (val !== null && val !== '') attrs[attr] = val;
    }
    return attrs;
  }

  function getScrollable(el) {
    const style = getComputedStyle(el);
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;
    const isScrollableY = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    const isScrollableX = (overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth;
    if (!isScrollableY && !isScrollableX) return null;
    return {
      left: el.scrollLeft,
      top: el.scrollTop,
      right: el.scrollWidth - el.clientWidth - el.scrollLeft,
      bottom: el.scrollHeight - el.clientHeight - el.scrollTop,
    };
  }

  function walk(el, parentId) {
    if (!el || el.nodeType === 8) return; // skip comments

    if (el.nodeType === 3) { // text node
      const text = el.textContent.trim();
      if (!text) return;
      const id = 'text_' + Math.random().toString(36).slice(2, 8);
      nodes[id] = { id, tagName: '#text', text, parentId };
      if (parentId && nodes[parentId]) {
        nodes[parentId].children = nodes[parentId].children || [];
        nodes[parentId].children.push(id);
      }
      return;
    }

    if (el.nodeType !== 1) return; // only elements

    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'svg', 'path'].includes(tag)) return;
    if (!isVisible(el)) return;

    const id = tag + '_' + Math.random().toString(36).slice(2, 8);
    const interactive = isInteractive(el);
    const node = {
      id,
      tagName: tag,
      attributes: getAttributes(el),
      parentId,
      children: [],
      isInteractive: interactive,
    };

    if (interactive) {
      node.highlightIndex = highlightIndex;
      selectorMap[highlightIndex] = id;
      highlightIndex++;
    }

    const scrollable = getScrollable(el);
    if (scrollable) node.scrollable = scrollable;

    const text = [];
    for (const child of el.childNodes) {
      if (child.nodeType === 3 && child.textContent.trim()) {
        text.push(child.textContent.trim());
      }
    }
    if (text.length > 0) node.text = text.join(' ').slice(0, 200);

    nodes[id] = node;

    if (parentId && nodes[parentId]) {
      nodes[parentId].children.push(id);
    }

    for (const child of el.children) {
      walk(child, id);
    }
  }

  const rootId = 'root';
  nodes[rootId] = { id: rootId, tagName: 'body', children: [], attributes: {} };
  for (const child of document.body.children) {
    walk(child, rootId);
  }

  return { rootId, map: nodes, selectorMap };
})()
`;

/**
 * Convert a FlatDomTree into the indexed text format that the LLM agent reads.
 * Example output:
 *   [0]<button type=submit>Search</>
 *   [1]<input type=text placeholder="Enter query" />
 */
export function flatTreeToString(tree: { rootId: string; map: Record<string, any> }): string {
  const lines: string[] = [];

  function walk(nodeId: string, depth: number) {
    const node = tree.map[nodeId];
    if (!node) return;

    const indent = '\t'.repeat(depth);

    if (node.tagName === '#text') {
      if (node.text) lines.push(`${indent}${node.text}`);
      return;
    }

    const attrs = node.attributes || {};
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => (v === '' ? k : `${k}="${v}"`))
      .join(' ');

    const prefix = node.highlightIndex !== undefined ? `[${node.highlightIndex}]` : '';
    const scrollInfo = node.scrollable
      ? ` |scroll: ${Math.round(node.scrollable.top)}px up, ${Math.round(node.scrollable.bottom)}px down|`
      : '';

    const text = node.text || '';
    const tag = node.tagName;

    if (prefix || text || node.children?.length > 0) {
      const opening = `${indent}${prefix}<${tag}${attrStr ? ' ' + attrStr : ''}${scrollInfo}>`;

      if (!node.children?.length || (node.children.length === 0 && text)) {
        lines.push(`${opening}${text}</>`);
      } else {
        lines.push(`${opening}${text}`);
        for (const childId of node.children || []) {
          walk(childId, depth + 1);
        }
      }
    } else {
      for (const childId of node.children || []) {
        walk(childId, depth);
      }
    }
  }

  walk(tree.rootId, 0);
  return lines.join('\n');
}
