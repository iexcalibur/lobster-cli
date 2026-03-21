export function renderMarkdown(data: unknown, columns?: string[]): string {
  if (!Array.isArray(data) || data.length === 0) {
    return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  }

  const cols = columns || Object.keys(data[0]);
  const lines: string[] = [];

  lines.push('| ' + cols.join(' | ') + ' |');
  lines.push('| ' + cols.map(() => '---').join(' | ') + ' |');

  for (const row of data) {
    const vals = cols.map((col) => {
      const val = row[col];
      if (val === null || val === undefined) return '';
      return String(val).replace(/\|/g, '\\|');
    });
    lines.push('| ' + vals.join(' | ') + ' |');
  }

  return lines.join('\n');
}
