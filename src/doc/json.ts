/**
 * JSON-to-Markdown converter.
 * Renders JSON as structured markdown with headings, tables, and code blocks.
 */

export interface JsonResult {
  markdown: string;
  title: string;
}

/**
 * Convert a value to markdown recursively.
 */
function valueToMarkdown(value: unknown, depth: number = 0): string {
  if (value === null || value === undefined) return '*null*';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  const prefix = '#'.repeat(Math.min(depth + 2, 6));

  // Array of objects → table
  if (Array.isArray(value)) {
    if (value.length === 0) return '*empty array*';

    // Check if array of flat objects (tabular data)
    if (value.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) {
      const allKeys = new Set<string>();
      for (const item of value) {
        for (const key of Object.keys(item as Record<string, unknown>)) {
          allKeys.add(key);
        }
      }
      const keys = [...allKeys];

      // Only render as table if reasonable number of columns
      if (keys.length > 0 && keys.length <= 15) {
        const lines: string[] = [];
        lines.push('| ' + keys.join(' | ') + ' |');
        lines.push('| ' + keys.map(() => '---').join(' | ') + ' |');

        for (const item of value.slice(0, 100)) { // Limit to 100 rows
          const row = keys.map(k => {
            const v = (item as Record<string, unknown>)[k];
            if (v === null || v === undefined) return '';
            if (typeof v === 'object') return JSON.stringify(v).slice(0, 50);
            return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
          });
          lines.push('| ' + row.join(' | ') + ' |');
        }

        if (value.length > 100) {
          lines.push('');
          lines.push(`*...and ${value.length - 100} more rows*`);
        }

        return lines.join('\n');
      }
    }

    // Array of primitives → bullet list
    if (value.every(item => typeof item !== 'object')) {
      return value.map(item => `- ${String(item)}`).join('\n');
    }

    // Complex array → numbered items
    const parts: string[] = [];
    for (let i = 0; i < Math.min(value.length, 50); i++) {
      parts.push(`${prefix} Item ${i + 1}`);
      parts.push('');
      parts.push(valueToMarkdown(value[i], depth + 1));
      parts.push('');
    }
    if (value.length > 50) {
      parts.push(`*...and ${value.length - 50} more items*`);
    }
    return parts.join('\n');
  }

  // Object → key-value pairs
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    const parts: string[] = [];

    // Simple flat object → key-value list
    const allSimple = keys.every(k => {
      const v = obj[k];
      return typeof v !== 'object' || v === null;
    });

    if (allSimple) {
      for (const key of keys) {
        parts.push(`- **${key}:** ${String(obj[key] ?? '*null*')}`);
      }
      return parts.join('\n');
    }

    // Complex object → sections
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === 'object' && v !== null) {
        parts.push(`${prefix} ${key}`);
        parts.push('');
        parts.push(valueToMarkdown(v, depth + 1));
        parts.push('');
      } else {
        parts.push(`- **${key}:** ${String(v ?? '*null*')}`);
      }
    }
    return parts.join('\n');
  }

  return String(value);
}

export function convertJson(content: string): JsonResult {
  let parsed: unknown;

  // Try JSON
  try {
    parsed = JSON.parse(content);
  } catch {
    // Try JSONL (newline-delimited JSON)
    const lines = content.split('\n').filter(l => l.trim());
    const items: unknown[] = [];
    for (const line of lines) {
      try {
        items.push(JSON.parse(line));
      } catch { /* skip invalid lines */ }
    }
    if (items.length > 0) {
      parsed = items;
    } else {
      return {
        markdown: '```json\n' + content.slice(0, 5000) + '\n```',
        title: 'JSON',
      };
    }
  }

  const markdown = valueToMarkdown(parsed);

  // Try to extract a title from the data
  let title = 'JSON Data';
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    title = String(obj.title || obj.name || obj.id || 'JSON Data');
  }

  return { markdown, title };
}
