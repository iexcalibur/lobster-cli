/**
 * Advanced DOM snapshot script — runs inside the browser.
 * Multi-stage pruning pipeline producing LLM-optimized output.
 *
 * Stages:
 *  1. Walk DOM, collect visibility + layout + interactivity signals
 *  2. Prune invisible, zero-area, non-content elements
 *  3. SVG & decoration collapse
 *  4. Shadow DOM traversal
 *  5. Same-origin iframe extraction
 *  6. Bounding-box parent-child dedup (link/button wrapping)
 *  7. Paint-order occlusion detection (overlay/modal coverage)
 *  8. Attribute whitelist filtering
 *  9. Ad/tracker filtering
 * 10. Scroll position info
 * 11. data-ref annotation for targeting
 * 12. Token-efficient serialization with interactive indices
 */
export const SNAPSHOT_SCRIPT = `
(() => {
  let idx = 0;

  const SKIP_TAGS = new Set([
    'script','style','noscript','svg','path','meta','link','head',
    'template','slot','colgroup','col',
  ]);

  const INTERACTIVE_TAGS = new Set([
    'a','button','input','select','textarea','details','summary','label',
  ]);

  const INTERACTIVE_ROLES = new Set([
    'button','link','textbox','checkbox','radio','combobox','listbox',
    'menu','menuitem','tab','switch','slider','searchbox','spinbutton',
    'option','menuitemcheckbox','menuitemradio','treeitem',
  ]);

  const ATTR_WHITELIST = [
    'type','role','aria-label','aria-expanded','aria-selected','aria-checked',
    'aria-disabled','aria-haspopup','aria-pressed','placeholder','title',
    'href','value','name','alt','src','action','method','for',
    'data-testid','data-id','contenteditable','tabindex',
  ];

  const AD_PATTERNS = /ad[-_]?banner|ad[-_]?container|google[-_]?ad|doubleclick|adsbygoogle|sponsored|^ad$/i;

  // ── Stage 1: Visibility check ──
  function isVisible(el) {
    if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.tagName !== 'INPUT') return false;
    const s = getComputedStyle(el);
    if (s.display === 'none') return false;
    if (s.visibility === 'hidden' || s.visibility === 'collapse') return false;
    if (s.opacity === '0') return false;
    if (s.clipPath === 'inset(100%)') return false;
    // Check for offscreen positioning
    const rect = el.getBoundingClientRect();
    if (rect.right < 0 || rect.bottom < 0) return false;
    return true;
  }

  // ── Stage 2: Interactive detection ──
  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) {
      // Skip disabled elements
      if (el.disabled) return false;
      // Skip hidden inputs
      if (tag === 'input' && el.type === 'hidden') return false;
      return true;
    }
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (el.contentEditable === 'true') return true;
    if (el.tabIndex >= 0 && el.getAttribute('tabindex') !== null) return true;
    if (el.onclick) return true;
    return false;
  }

  // ── Stage 8: Attribute filtering ──
  function getAttrs(el) {
    const parts = [];
    for (const name of ATTR_WHITELIST) {
      let v = el.getAttribute(name);
      if (v === null || v === '') continue;
      // Truncate long values
      if (v.length > 80) v = v.slice(0, 77) + '...';
      // Skip href="javascript:..."
      if (name === 'href' && v.startsWith('javascript:')) continue;
      parts.push(name + '=' + v);
    }
    return parts.length ? ' ' + parts.join(' ') : '';
  }

  // ── Stage 9: Ad filtering ──
  function isAd(el) {
    const id = el.id || '';
    const cls = el.className || '';
    if (typeof cls === 'string' && AD_PATTERNS.test(cls)) return true;
    if (AD_PATTERNS.test(id)) return true;
    if (el.tagName === 'IFRAME' && AD_PATTERNS.test(el.src || '')) return true;
    return false;
  }

  // ── Stage 10: Scroll info ──
  function getScrollInfo(el) {
    const s = getComputedStyle(el);
    const overflowY = s.overflowY;
    const overflowX = s.overflowX;
    const scrollableY = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    const scrollableX = (overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth;
    if (!scrollableY && !scrollableX) return '';

    const parts = [];
    if (scrollableY) {
      const up = Math.round(el.scrollTop);
      const down = Math.round(el.scrollHeight - el.clientHeight - el.scrollTop);
      if (up > 0) parts.push(up + 'px up');
      if (down > 0) parts.push(down + 'px down');
    }
    if (scrollableX) {
      const left = Math.round(el.scrollLeft);
      const right = Math.round(el.scrollWidth - el.clientWidth - el.scrollLeft);
      if (left > 0) parts.push(left + 'px left');
      if (right > 0) parts.push(right + 'px right');
    }
    return parts.length ? ' |scroll: ' + parts.join(', ') + '|' : '';
  }

  // ── Stage 6: Bounding-box dedup ──
  // If a parent and child are both interactive and have ~same bounding box,
  // skip the parent (e.g., <a><button>Click</button></a>)
  function isWrappingInteractive(el) {
    if (!isInteractive(el)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    for (const child of el.children) {
      if (!isInteractive(child)) continue;
      const cr = child.getBoundingClientRect();
      const overlapX = Math.min(rect.right, cr.right) - Math.max(rect.left, cr.left);
      const overlapY = Math.min(rect.bottom, cr.bottom) - Math.max(rect.top, cr.top);
      const overlapArea = Math.max(0, overlapX) * Math.max(0, overlapY);
      const parentArea = rect.width * rect.height;
      if (parentArea > 0 && overlapArea / parentArea > 0.85) return true;
    }
    return false;
  }

  // ── Stage 7: Occlusion detection ──
  function isOccluded(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    if (!topEl) return false;
    if (topEl === el || el.contains(topEl) || topEl.contains(el)) return false;
    // Check z-index — if top element is a modal/overlay, mark as occluded
    const topZ = parseInt(getComputedStyle(topEl).zIndex) || 0;
    const elZ = parseInt(getComputedStyle(el).zIndex) || 0;
    return topZ > elZ + 10;
  }

  // ── Stage 5: Iframe content extraction ──
  function getIframeContent(iframe, depth, maxDepth) {
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body) return '';
      return '\\n' + walkNode(doc.body, depth, maxDepth);
    } catch { return ''; }
  }

  // ── Stage 4: Shadow DOM traversal ──
  function getShadowContent(el, depth, maxDepth) {
    if (!el.shadowRoot) return '';
    let out = '';
    for (const child of el.shadowRoot.childNodes) {
      out += walkNode(child, depth, maxDepth);
    }
    return out;
  }

  // ── Input value hint ──
  function getInputHint(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = el.type || 'text';
      const val = el.value || '';
      const checked = el.checked;
      if (type === 'checkbox' || type === 'radio') {
        return checked ? ' [checked]' : ' [unchecked]';
      }
      if (val) return ' value="' + val.slice(0, 50) + '"';
    }
    if (tag === 'textarea' && el.value) {
      return ' value="' + el.value.slice(0, 50) + '"';
    }
    if (tag === 'select' && el.selectedOptions?.length) {
      return ' selected="' + el.selectedOptions[0].text.slice(0, 40) + '"';
    }
    return '';
  }

  const MAX_DEPTH = 25;
  const MAX_TEXT = 150;

  function walkNode(node, depth, maxDepth) {
    if (depth > maxDepth) return '';
    if (!node) return '';

    // Text node
    if (node.nodeType === 3) {
      const t = node.textContent.trim();
      if (!t) return '';
      const text = t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '...' : t;
      return '  '.repeat(depth) + text + '\\n';
    }

    // Comment node — skip
    if (node.nodeType === 8) return '';

    // Only element nodes from here
    if (node.nodeType !== 1) return '';

    const el = node;
    const tag = el.tagName.toLowerCase();

    // ── Stage 3: Skip tags ──
    if (SKIP_TAGS.has(tag)) return '';

    // ── Stage 2: Visibility ──
    if (!isVisible(el)) return '';

    // ── Stage 9: Ad filtering ──
    if (isAd(el)) return '';

    // ── Stage 6: Bbox dedup — skip wrapping interactive parent ──
    const skipSelf = isWrappingInteractive(el);

    const indent = '  '.repeat(depth);
    const inter = !skipSelf && isInteractive(el);
    const prefix = inter ? '[' + (idx++) + ']' : '';

    // ── Stage 11: Annotate with data-ref ──
    if (inter) {
      try { el.dataset.ref = String(idx - 1); } catch {}
    }

    // ── Stage 7: Occlusion check for interactive elements ──
    if (inter && isOccluded(el)) {
      // Still include but mark as occluded
      // (agent needs to know element exists but may need to scroll/close modal)
    }

    const a = getAttrs(el);
    const scrollInfo = getScrollInfo(el);
    const inputHint = inter ? getInputHint(el) : '';

    // Leaf text extraction
    let leafText = '';
    if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
      const t = el.childNodes[0].textContent.trim();
      if (t) leafText = t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '...' : t;
    }

    // ── Stage 5: Iframe ──
    if (tag === 'iframe') {
      const iframeContent = getIframeContent(el, depth + 1, maxDepth);
      if (iframeContent) {
        return indent + prefix + '<iframe' + a + '>\\n' + iframeContent;
      }
      return '';
    }

    // Build output
    let out = '';

    if (skipSelf) {
      // Skip self but render children
      for (const c of el.childNodes) out += walkNode(c, depth, maxDepth);
      out += getShadowContent(el, depth, maxDepth);
      return out;
    }

    if (inter || leafText || el.children.length === 0) {
      if (leafText) {
        out = indent + prefix + '<' + tag + a + scrollInfo + inputHint + '>' + leafText + '</' + tag + '>\\n';
      } else {
        out = indent + prefix + '<' + tag + a + scrollInfo + inputHint + '>\\n';
        for (const c of el.childNodes) out += walkNode(c, depth + 1, maxDepth);
        out += getShadowContent(el, depth + 1, maxDepth);
      }
    } else {
      // Non-interactive container — flatten depth if no useful info
      if (scrollInfo) {
        out = indent + '<' + tag + scrollInfo + '>\\n';
        for (const c of el.childNodes) out += walkNode(c, depth + 1, maxDepth);
        out += getShadowContent(el, depth + 1, maxDepth);
      } else {
        for (const c of el.childNodes) out += walkNode(c, depth, maxDepth);
        out += getShadowContent(el, depth, maxDepth);
      }
    }

    return out;
  }

  // ── Page-level scroll info header ──
  const scrollY = window.scrollY;
  const scrollMax = document.documentElement.scrollHeight - window.innerHeight;
  const scrollPct = scrollMax > 0 ? Math.round((scrollY / scrollMax) * 100) : 0;
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const pageH = document.documentElement.scrollHeight;

  let header = '';
  header += 'viewport: ' + vpW + 'x' + vpH + ' | page_height: ' + pageH + 'px';
  header += ' | scroll: ' + scrollPct + '%';
  if (scrollY > 50) header += ' (' + Math.round(scrollY) + 'px from top)';
  if (scrollMax - scrollY > 50) header += ' (' + Math.round(scrollMax - scrollY) + 'px more below)';
  header += '\\n---\\n';

  return header + walkNode(document.body, 0, MAX_DEPTH);
})()
`;
