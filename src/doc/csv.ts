/**
 * CSV/TSV-to-Markdown table converter.
 * Pure TypeScript, no external dependencies.
 */

export interface CsvResult {
  markdown: string;
  title: string;
}

/**
 * Parse CSV string respecting quoted fields.
 */
function parseCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export function convertCsv(content: string, source?: string): CsvResult {
  // Detect delimiter
  const firstLine = content.split('\n')[0] || '';
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = tabCount > commaCount ? '\t' : ',';

  const lines = content.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) {
    return { markdown: '*Empty file*', title: 'CSV' };
  }

  const mdLines: string[] = [];

  // Parse header
  const headers = parseCsvLine(lines[0], delimiter);
  mdLines.push('| ' + headers.join(' | ') + ' |');
  mdLines.push('| ' + headers.map(() => '---').join(' | ') + ' |');

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i], delimiter);
    // Pad to header length
    while (fields.length < headers.length) fields.push('');
    // Escape pipes in cell values
    const escaped = fields.map(f => f.replace(/\|/g, '\\|'));
    mdLines.push('| ' + escaped.join(' | ') + ' |');
  }

  const title = source ? source.split('/').pop()?.replace(/\.[^.]+$/, '') || 'CSV' : 'CSV';

  return {
    markdown: mdLines.join('\n'),
    title,
  };
}
