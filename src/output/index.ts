import type { OutputFormat } from '../types/router.js';
import { renderTable } from './table.js';
import { renderJson } from './json.js';
import { renderMarkdown } from './markdown.js';
import { renderCsv } from './csv.js';
import { renderYaml } from './yaml.js';

export function render(data: unknown, format: OutputFormat, columns?: string[]): string {
  switch (format) {
    case 'table': return renderTable(data, columns);
    case 'json': return renderJson(data);
    case 'markdown': return renderMarkdown(data, columns);
    case 'csv': return renderCsv(data, columns);
    case 'yaml': return renderYaml(data);
    default: return renderJson(data);
  }
}
