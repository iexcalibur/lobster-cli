import Table from 'cli-table3';

export function renderTable(data: unknown, columns?: string[]): string {
  if (!Array.isArray(data) || data.length === 0) {
    return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  }

  const cols = columns || Object.keys(data[0]);
  const table = new Table({
    head: cols,
    style: { head: ['cyan'] },
    wordWrap: true,
  });

  for (const row of data) {
    table.push(cols.map((col) => {
      const val = row[col];
      if (val === null || val === undefined) return '';
      return String(val);
    }));
  }

  return table.toString();
}
