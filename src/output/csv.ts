export function renderCsv(data: unknown, columns?: string[]): string {
  if (!Array.isArray(data) || data.length === 0) {
    return typeof data === 'string' ? data : JSON.stringify(data);
  }

  const cols = columns || Object.keys(data[0]);
  const lines: string[] = [cols.join(',')];

  for (const row of data) {
    const vals = cols.map((col) => {
      const val = row[col];
      if (val === null || val === undefined) return '';
      const str = String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` : str;
    });
    lines.push(vals.join(','));
  }

  return lines.join('\n');
}
