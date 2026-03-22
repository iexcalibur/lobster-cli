/**
 * Compact Snapshot — token-efficient DOM snapshot (~800 tokens).
 *
 * Only emits interactive elements + landmark section headers.
 * Format: [0] button "Sign In" (one line per element)
 *
 * Inspired by PinchTab's token-counting approach, built from scratch.
 */

export const COMPACT_SNAPSHOT_SCRIPT = `
(() => {
  const TOKEN_BUDGET = 800;
  const CHARS_PER_TOKEN = 4;

  const INTERACTIVE_TAGS = new Set([
    'a','button','input','select','textarea','details','summary','label',
  ]);
  const INTERACTIVE_ROLES = new Set([
    'button','link','textbox','checkbox','radio','combobox','listbox',
    'menu','menuitem','tab','switch','slider','searchbox','spinbutton',
    'option','menuitemcheckbox','menuitemradio','treeitem',
  ]);
  const LANDMARK_TAGS = new Map([
    ['nav', 'Navigation'],
    ['main', 'Main Content'],
    ['header', 'Header'],
    ['footer', 'Footer'],
    ['aside', 'Sidebar'],
    ['form', 'Form'],
  ]);
  const LANDMARK_ROLES = new Map([
    ['navigation', 'Navigation'],
    ['main', 'Main Content'],
    ['banner', 'Header'],
    ['contentinfo', 'Footer'],
    ['complementary', 'Sidebar'],
    ['search', 'Search'],
    ['dialog', 'Dialog'],
  ]);

  function isVisible(el) {
    if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.tagName !== 'INPUT') return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) {
      if (el.disabled) return false;
      if (tag === 'input' && el.type === 'hidden') return false;
      return true;
    }
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (el.contentEditable === 'true') return true;
    if (el.tabIndex >= 0 && el.getAttribute('tabindex') !== null) return true;
    return false;
  }

  function getRole(el) {
    const role = el.getAttribute('role');
    if (role) return role;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'input') return el.type || 'text';
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'label') return 'label';
    return tag;
  }

  function getName(el) {
    return (
      el.getAttribute('aria-label') ||
      el.getAttribute('alt') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button') ? el.value : '') ||
      (el.id ? document.querySelector('label[for="' + el.id + '"]')?.textContent?.trim() : '') ||
      (el.children.length <= 2 ? el.textContent?.trim() : '') ||
      ''
    ).slice(0, 60);
  }

  function getValue(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = el.type || 'text';
      if (type === 'checkbox' || type === 'radio') return el.checked ? 'checked' : 'unchecked';
      if (type === 'password') return el.value ? '****' : '';
      return el.value ? el.value.slice(0, 30) : '';
    }
    if (tag === 'textarea') return el.value ? el.value.slice(0, 30) : '';
    if (tag === 'select' && el.selectedOptions?.length) return el.selectedOptions[0].text.slice(0, 30);
    return '';
  }

  // Collect elements
  let idx = 0;
  let charsUsed = 0;
  const lines = [];
  let lastLandmark = '';

  // Page header
  const scrollY = window.scrollY;
  const scrollMax = document.documentElement.scrollHeight - window.innerHeight;
  const scrollPct = scrollMax > 0 ? Math.round((scrollY / scrollMax) * 100) : 0;
  const header = 'url: ' + location.href + ' | scroll: ' + scrollPct + '%';
  lines.push(header);
  charsUsed += header.length;

  // Walk DOM
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (!isVisible(node)) continue;

    const tag = node.tagName.toLowerCase();
    if (['script','style','noscript','svg','path','meta','link','head','template'].includes(tag)) continue;

    // Check for landmark
    const role = node.getAttribute('role');
    const landmark = LANDMARK_TAGS.get(tag) || (role ? LANDMARK_ROLES.get(role) : null);
    if (landmark && landmark !== lastLandmark) {
      const sectionLine = '--- ' + landmark + ' ---';
      if (charsUsed + sectionLine.length > TOKEN_BUDGET * CHARS_PER_TOKEN) break;
      lines.push(sectionLine);
      charsUsed += sectionLine.length;
      lastLandmark = landmark;
    }

    // Only emit interactive elements
    if (!isInteractive(node)) continue;

    const elRole = getRole(node);
    const name = getName(node);
    const value = getValue(node);

    // Build compact line
    let line = '[' + idx + '] ' + elRole;
    if (name) line += ' "' + name.replace(/"/g, "'") + '"';
    if (value) line += ' val="' + value.replace(/"/g, "'") + '"';

    // Check token budget
    if (charsUsed + line.length > TOKEN_BUDGET * CHARS_PER_TOKEN) {
      lines.push('... (' + (document.querySelectorAll('a,button,input,select,textarea,[role]').length - idx) + ' more elements)');
      break;
    }

    // Annotate element with ref for clicking
    try { node.dataset.ref = String(idx); } catch {}

    lines.push(line);
    charsUsed += line.length;
    idx++;
  }

  return lines.join('\\n');
})()
`;

/**
 * Build compact snapshot script with custom token budget.
 */
export function buildCompactSnapshotScript(tokenBudget: number = 800): string {
  return COMPACT_SNAPSHOT_SCRIPT.replace('const TOKEN_BUDGET = 800;', `const TOKEN_BUDGET = ${tokenBudget};`);
}
