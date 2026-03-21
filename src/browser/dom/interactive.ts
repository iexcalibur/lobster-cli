/**
 * Interactive element classification — identifies what's clickable/editable.
 * Based on Lightpanda's InteractivityType approach.
 */
export const INTERACTIVE_ELEMENTS_SCRIPT = `
(() => {
  const results = [];

  function classify(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    const types = [];

    // Native interactive
    if (['a', 'button', 'input', 'select', 'textarea', 'details', 'summary'].includes(tag)) {
      types.push('native');
    }

    // ARIA role interactive
    if (role && ['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'tab', 'switch', 'menuitem', 'slider'].includes(role)) {
      types.push('aria');
    }

    // Contenteditable
    if (el.contentEditable === 'true') types.push('contenteditable');

    // Focusable
    if (el.tabIndex >= 0 && el.getAttribute('tabindex') !== null) types.push('focusable');

    // Has click listener (approximate)
    if (el.onclick) types.push('listener');

    return types;
  }

  let idx = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  while (node = walker.nextNode()) {
    const types = classify(node);
    if (types.length === 0) continue;

    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const rect = node.getBoundingClientRect();
    results.push({
      index: idx++,
      tag: node.tagName.toLowerCase(),
      role: node.getAttribute('role') || '',
      text: (node.textContent || '').trim().slice(0, 100),
      types,
      ariaLabel: node.getAttribute('aria-label') || '',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  }

  return results;
})()
`;
