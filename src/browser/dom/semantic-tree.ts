/**
 * Semantic tree — W3C accessible name algorithm, XPath, listener detection.
 *
 * Based on Lightpanda's SemanticTree.zig approach:
 * - Accessible name: aria-labelledby → aria-label → alt → title → placeholder → text content
 * - XPath generation for element location
 * - Interactive classification: native, aria, contenteditable, listener, focusable
 * - Disabled state with fieldset inheritance
 * - Input value, option, checked state extraction
 */
export const SEMANTIC_TREE_SCRIPT = `
(() => {
  const SKIP = new Set(['script','style','noscript','svg','head','meta','link','template']);

  const ROLE_MAP = {
    a: 'link', button: 'button', input: 'textbox', select: 'combobox',
    textarea: 'textbox', h1: 'heading', h2: 'heading', h3: 'heading',
    h4: 'heading', h5: 'heading', h6: 'heading', nav: 'navigation',
    main: 'main', header: 'banner', footer: 'contentinfo', aside: 'complementary',
    form: 'form', table: 'table', img: 'img', ul: 'list', ol: 'list', li: 'listitem',
    section: 'region', article: 'article', dialog: 'dialog', details: 'group',
    summary: 'button', progress: 'progressbar', meter: 'meter', output: 'status',
    label: 'label', legend: 'legend', fieldset: 'group', option: 'option',
    tr: 'row', td: 'cell', th: 'columnheader', caption: 'caption',
  };

  const INTERACTIVE_ROLES = new Set([
    'button','link','textbox','checkbox','radio','combobox','listbox',
    'menu','menuitem','tab','switch','slider','searchbox','spinbutton',
    'option','menuitemcheckbox','menuitemradio','treeitem',
  ]);

  // ── W3C Accessible Name Algorithm (simplified) ──
  function getAccessibleName(el) {
    // 1. aria-labelledby (highest priority)
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ids = labelledBy.split(/\\s+/);
      const parts = ids.map(id => {
        const ref = document.getElementById(id);
        return ref ? ref.textContent.trim() : '';
      }).filter(Boolean);
      if (parts.length > 0) return parts.join(' ').slice(0, 120);
    }

    // 2. aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.slice(0, 120);

    // 3. alt (for images)
    const alt = el.getAttribute('alt');
    if (alt) return alt.slice(0, 120);

    // 4. title
    const title = el.getAttribute('title');
    if (title) return title.slice(0, 120);

    // 5. placeholder (for inputs)
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.slice(0, 120);

    // 6. value (for buttons)
    if (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button')) {
      const val = el.getAttribute('value');
      if (val) return val.slice(0, 120);
    }

    // 7. Associated label
    if (el.id) {
      const label = document.querySelector('label[for="' + el.id + '"]');
      if (label) return label.textContent.trim().slice(0, 120);
    }

    // 8. Direct text content (only for leaf-ish elements)
    if (el.children.length <= 2) {
      const text = el.textContent.trim();
      if (text && text.length < 120) return text;
    }

    return '';
  }

  // ── XPath generation ──
  function getXPath(el) {
    const parts = [];
    let current = el;
    while (current && current.nodeType === 1) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      const tag = current.tagName.toLowerCase();
      parts.unshift(tag + '[' + index + ']');
      current = current.parentElement;
    }
    return '/' + parts.join('/');
  }

  // ── Interactivity classification ──
  function classifyInteractivity(el) {
    const types = [];
    const tag = el.tagName.toLowerCase();

    // Native
    if (['a','button','input','select','textarea','details','summary'].includes(tag)) {
      if (tag === 'a' && !el.href) {} // anchor without href is not interactive
      else if (tag === 'input' && el.type === 'hidden') {} // hidden inputs
      else types.push('native');
    }

    // ARIA role
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) types.push('aria');

    // Contenteditable
    if (el.contentEditable === 'true') types.push('contenteditable');

    // Focusable
    if (el.tabIndex >= 0 && el.getAttribute('tabindex') !== null) types.push('focusable');

    // Event listeners (check onclick and common inline handlers)
    if (el.onclick || el.onmousedown || el.onkeydown || el.onkeypress ||
        el.getAttribute('onclick') || el.getAttribute('onmousedown')) {
      types.push('listener');
    }

    return types;
  }

  // ── Disabled state with fieldset inheritance ──
  function isDisabled(el) {
    if (el.disabled) return true;
    // Check fieldset disabled inheritance
    let parent = el.parentElement;
    while (parent) {
      if (parent.tagName === 'FIELDSET' && parent.disabled) {
        // Exception: elements inside the first legend child are NOT disabled
        const firstLegend = parent.querySelector(':scope > legend');
        if (firstLegend && firstLegend.contains(el)) return false;
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }

  // ── Walk the DOM ──
  function walk(el, depth, maxDepth) {
    if (!el || depth > maxDepth) return '';

    if (el.nodeType === 3) {
      const t = el.textContent.trim();
      return t ? '  '.repeat(depth) + 'text "' + t.slice(0, 100) + '"\\n' : '';
    }

    if (el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) return '';

    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return '';

    const indent = '  '.repeat(depth);
    const role = el.getAttribute('role') || ROLE_MAP[tag] || '';
    const name = getAccessibleName(el);
    const interTypes = classifyInteractivity(el);
    const interactive = interTypes.length > 0;
    const disabled = interactive && isDisabled(el);

    let line = indent;
    line += role || tag;

    if (name) line += ' "' + name.slice(0, 80) + '"';

    if (interactive) {
      line += ' [' + interTypes.join(',') + ']';
      if (disabled) line += ' {disabled}';
      line += ' xpath=' + getXPath(el);
    }

    // Input state
    if (tag === 'input') {
      const type = el.type || 'text';
      line += ' type=' + type;
      if (type === 'checkbox' || type === 'radio') {
        line += el.checked ? ' [checked]' : ' [unchecked]';
      } else if (el.value) {
        line += ' value="' + el.value.slice(0, 50) + '"';
      }
    }
    if (tag === 'textarea' && el.value) {
      line += ' value="' + el.value.slice(0, 50) + '"';
    }
    if (tag === 'select') {
      const opts = Array.from(el.options || []).map(o => ({
        text: o.text.slice(0, 30),
        value: o.value,
        selected: o.selected,
      }));
      const selected = opts.find(o => o.selected);
      if (selected) line += ' selected="' + selected.text + '"';
      if (opts.length <= 10) {
        line += ' options=[' + opts.map(o => o.text).join('|') + ']';
      }
    }

    line += '\\n';

    let out = line;
    for (const c of el.childNodes) {
      out += walk(c, depth + 1, maxDepth);
    }

    // Shadow DOM
    if (el.shadowRoot) {
      for (const c of el.shadowRoot.childNodes) {
        out += walk(c, depth + 1, maxDepth);
      }
    }

    return out;
  }

  return walk(document.body, 0, 20);
})()
`;
