/**
 * XLSX/XLS-to-Markdown converter using SheetJS.
 * Converts each sheet to a markdown table.
 */

export interface XlsxResult {
  markdown: string;
  title: string;
  sheets: number;
}

export async function convertXlsx(buffer: Buffer): Promise<XlsxResult> {
  const XLSX = await import('xlsx');

  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetNames = workbook.SheetNames;
  const mdParts: string[] = [];

  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;

    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown as unknown[][];
    if (!data || data.length === 0) continue;

    mdParts.push(`## ${name}`);
    mdParts.push('');

    // First row as header
    const headers = (data[0] || []).map(h => String(h ?? ''));
    if (headers.length === 0) continue;

    mdParts.push('| ' + headers.join(' | ') + ' |');
    mdParts.push('| ' + headers.map(() => '---').join(' | ') + ' |');

    // Data rows
    for (let r = 1; r < data.length; r++) {
      const row = (data[r] || []).map(cell => String(cell ?? ''));
      // Pad row to header length
      while (row.length < headers.length) row.push('');
      mdParts.push('| ' + row.join(' | ') + ' |');
    }

    mdParts.push('');
  }

  return {
    markdown: mdParts.join('\n').trim(),
    title: sheetNames[0] || 'Spreadsheet',
    sheets: sheetNames.length,
  };
}
