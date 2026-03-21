/**
 * Template expression engine for pipeline YAML.
 * Resolves ${{ expr }} expressions with context variables and filters.
 */

const EXPR_RE = /\$\{\{\s*(.*?)\s*\}\}/g;

interface RenderContext {
  args: Record<string, unknown>;
  item?: unknown;
  data?: unknown;
  index?: number;
}

export function renderTemplate(template: unknown, ctx: RenderContext): unknown {
  if (typeof template !== 'string') {
    if (typeof template === 'object' && template !== null) {
      if (Array.isArray(template)) return template.map((v) => renderTemplate(v, ctx));
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(template)) {
        result[k] = renderTemplate(v, ctx);
      }
      return result;
    }
    return template;
  }

  // Full expression: entire string is one expression — return raw value (not stringified)
  const fullMatch = template.match(/^\$\{\{\s*(.*?)\s*\}\}$/);
  if (fullMatch) {
    return evaluateExpression(fullMatch[1], ctx);
  }

  // Partial: interpolate into string
  return template.replace(EXPR_RE, (_, expr) => {
    const val = evaluateExpression(expr, ctx);
    return val === null || val === undefined ? '' : String(val);
  });
}

function evaluateExpression(expr: string, ctx: RenderContext): unknown {
  // Handle pipe filters: expr | filter(arg)
  const parts = expr.split(/\s*\|\s*/);
  let value = resolveValue(parts[0].trim(), ctx);

  for (let i = 1; i < parts.length; i++) {
    value = applyFilter(value, parts[i].trim());
  }

  return value;
}

function resolveValue(path: string, ctx: RenderContext): unknown {
  // Handle simple arithmetic: index + 1
  const arithMatch = path.match(/^(\w[\w.]*)\s*([+\-*])\s*(\d+)$/);
  if (arithMatch) {
    const base = Number(resolvePath(arithMatch[1], ctx));
    const op = arithMatch[2];
    const num = Number(arithMatch[3]);
    if (op === '+') return base + num;
    if (op === '-') return base - num;
    if (op === '*') return base * num;
  }

  // Handle logical OR: a || b
  const orMatch = path.match(/^(.+?)\s*\|\|\s*(.+)$/);
  if (orMatch) {
    const left = resolvePath(orMatch[1].trim(), ctx);
    if (left !== null && left !== undefined && left !== '' && left !== false) return left;
    // Right side: could be a string literal
    const right = orMatch[2].trim();
    if ((right.startsWith("'") && right.endsWith("'")) || (right.startsWith('"') && right.endsWith('"'))) {
      return right.slice(1, -1);
    }
    return resolvePath(right, ctx);
  }

  // String literal
  if ((path.startsWith("'") && path.endsWith("'")) || (path.startsWith('"') && path.endsWith('"'))) {
    return path.slice(1, -1);
  }

  // Number literal
  if (!isNaN(Number(path)) && path !== '') return Number(path);

  return resolvePath(path, ctx);
}

function resolvePath(path: string, ctx: RenderContext): unknown {
  // Resolve against context: args.*, item.*, data.*, index
  if (path === 'index') return ctx.index ?? 0;

  const parts = path.split('.');
  let root: unknown;

  if (parts[0] === 'args') {
    root = ctx.args;
    parts.shift();
  } else if (parts[0] === 'item') {
    root = ctx.item;
    parts.shift();
  } else if (parts[0] === 'data') {
    root = ctx.data;
    parts.shift();
  } else {
    // Try item first, then args, then data
    root = getNestedValue(ctx.item, parts);
    if (root !== undefined) return root;
    root = getNestedValue(ctx.args, parts);
    if (root !== undefined) return root;
    root = getNestedValue(ctx.data, parts);
    if (root !== undefined) return root;
    return undefined;
  }

  return getNestedValue(root, parts);
}

function getNestedValue(obj: unknown, parts: string[]): unknown {
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function applyFilter(value: unknown, filter: string): unknown {
  const match = filter.match(/^(\w+)(?:\((.+)\))?$/);
  if (!match) return value;

  const name = match[1];
  const arg = match[2]?.replace(/^['"]|['"]$/g, '');

  switch (name) {
    case 'default':
      return value === null || value === undefined || value === '' ? arg : value;
    case 'join':
      return Array.isArray(value) ? value.join(arg || ', ') : value;
    case 'upper':
      return typeof value === 'string' ? value.toUpperCase() : value;
    case 'lower':
      return typeof value === 'string' ? value.toLowerCase() : value;
    case 'trim':
      return typeof value === 'string' ? value.trim() : value;
    case 'truncate': {
      const len = parseInt(arg || '100');
      if (typeof value === 'string' && value.length > len) return value.slice(0, len) + '...';
      return value;
    }
    case 'replace': {
      if (typeof value !== 'string' || !arg) return value;
      const [from, to] = arg.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
      return value.replaceAll(from, to || '');
    }
    case 'keys':
      return typeof value === 'object' && value !== null ? Object.keys(value) : [];
    case 'length':
      return Array.isArray(value) ? value.length : typeof value === 'string' ? value.length : 0;
    case 'first':
      return Array.isArray(value) ? value[0] : value;
    case 'last':
      return Array.isArray(value) ? value[value.length - 1] : value;
    case 'json':
      return JSON.stringify(value);
    case 'slugify':
      return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : value;
    default:
      return value;
  }
}
