/**
 * LobsterDoc — In-house document-to-markdown engine.
 *
 * Converts PDF, DOCX, XLSX, PPTX, EPUB, HTML, CSV, JSON, and images
 * to structured Markdown. Zero Python, zero external binaries.
 *
 * Inspired by Marker's pipeline but built entirely in TypeScript
 * using heuristic-based layout detection instead of ML models.
 */

import { extname } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

import { convertPdf, type PdfConvertOptions } from './pdf.js';
import { convertDocx } from './docx.js';
import { convertXlsx } from './xlsx.js';
import { convertPptx } from './pptx.js';
import { convertEpub } from './epub.js';
import { convertHtml } from './html.js';
import { convertCsv } from './csv.js';
import { convertJson } from './json.js';

export interface DocResult {
  /** Original file path or URL */
  source: string;
  /** Detected file format */
  format: string;
  /** Converted markdown content */
  markdown: string;
  /** Document title (if detected) */
  title: string;
  /** Document metadata */
  metadata: Record<string, unknown>;
  /** Number of pages (for PDFs) or sections */
  pages: number;
  /** Word count of output */
  wordCount: number;
  /** Conversion duration in ms */
  duration: number;
}

export interface ConvertOptions {
  /** Force a specific format (skip detection) */
  format?: string;
  /** Include images as base64 in markdown */
  embedImages?: boolean;
  /** Max pages to process (for PDFs) */
  maxPages?: number;
  /** PDF-specific options */
  pdf?: PdfConvertOptions;
}

const FORMAT_MAP: Record<string, string> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.doc': 'docx',
  '.xlsx': 'xlsx',
  '.xls': 'xlsx',
  '.pptx': 'pptx',
  '.ppt': 'pptx',
  '.epub': 'epub',
  '.html': 'html',
  '.htm': 'html',
  '.csv': 'csv',
  '.tsv': 'csv',
  '.json': 'json',
  '.jsonl': 'json',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.svg': 'image',
  '.tiff': 'image',
  '.bmp': 'image',
};

/**
 * Detect format from file path, URL, or content-type.
 */
function detectFormat(source: string, contentType?: string): string {
  // Check content-type header
  if (contentType) {
    if (contentType.includes('pdf')) return 'pdf';
    if (contentType.includes('wordprocessingml') || contentType.includes('msword')) return 'docx';
    if (contentType.includes('spreadsheetml') || contentType.includes('ms-excel')) return 'xlsx';
    if (contentType.includes('presentationml') || contentType.includes('ms-powerpoint')) return 'pptx';
    if (contentType.includes('epub')) return 'epub';
    if (contentType.includes('html')) return 'html';
    if (contentType.includes('csv')) return 'csv';
    if (contentType.includes('json')) return 'json';
    if (contentType.includes('image/')) return 'image';
  }

  // Check file extension
  const ext = extname(source).toLowerCase();
  if (FORMAT_MAP[ext]) return FORMAT_MAP[ext];

  // Check URL patterns
  if (/\/pdf\//.test(source) || /arxiv\.org\/pdf/.test(source)) return 'pdf';

  return 'unknown';
}

/**
 * Download a remote file and return the buffer.
 */
async function downloadFile(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'LobsterCLI/0.2 (+https://github.com/iexcalibur/lobster-cli)',
      'Accept': '*/*',
    },
    redirect: 'follow',
  });

  if (!resp.ok) {
    throw new Error(`Failed to download: ${resp.status} ${resp.statusText}`);
  }

  const contentType = resp.headers.get('content-type') || '';
  const arrayBuffer = await resp.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

/**
 * Main entry point — convert any supported document to Markdown.
 */
export async function convertDocument(
  source: string,
  options?: ConvertOptions,
): Promise<DocResult> {
  const start = Date.now();
  let buffer: Buffer;
  let format: string;

  // Handle remote URLs
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const downloaded = await downloadFile(source);
    buffer = downloaded.buffer;
    format = options?.format || detectFormat(source, downloaded.contentType);
  } else {
    // Local file
    if (!existsSync(source)) {
      throw new Error(`File not found: ${source}`);
    }
    buffer = readFileSync(source);
    format = options?.format || detectFormat(source);
  }

  if (format === 'unknown') {
    throw new Error(`Unsupported file format: ${source}`);
  }

  let markdown: string;
  let title = '';
  let metadata: Record<string, unknown> = {};
  let pages = 1;

  switch (format) {
    case 'pdf': {
      const result = await convertPdf(buffer, options?.pdf);
      markdown = result.markdown;
      title = result.title;
      metadata = result.metadata;
      pages = result.pages;
      break;
    }
    case 'docx': {
      const result = await convertDocx(buffer);
      markdown = result.markdown;
      title = result.title;
      break;
    }
    case 'xlsx': {
      const result = await convertXlsx(buffer);
      markdown = result.markdown;
      title = result.title;
      pages = result.sheets;
      break;
    }
    case 'pptx': {
      const result = await convertPptx(buffer);
      markdown = result.markdown;
      title = result.title;
      pages = result.slides;
      break;
    }
    case 'epub': {
      const result = await convertEpub(buffer);
      markdown = result.markdown;
      title = result.title;
      break;
    }
    case 'html': {
      const result = convertHtml(buffer.toString('utf-8'));
      markdown = result.markdown;
      title = result.title;
      break;
    }
    case 'csv': {
      const result = convertCsv(buffer.toString('utf-8'), source);
      markdown = result.markdown;
      title = result.title;
      break;
    }
    case 'json': {
      const result = convertJson(buffer.toString('utf-8'));
      markdown = result.markdown;
      title = result.title;
      break;
    }
    case 'image': {
      markdown = `![Image](${source})\n\n*Image file — OCR not available in current build.*`;
      title = source.split('/').pop() || 'image';
      break;
    }
    default:
      throw new Error(`Unsupported format: ${format}`);
  }

  const wordCount = markdown.split(/\s+/).filter(Boolean).length;

  return {
    source,
    format,
    markdown,
    title,
    metadata,
    pages,
    wordCount,
    duration: Date.now() - start,
  };
}

// Re-export all converters
export { convertPdf, type PdfConvertOptions } from './pdf.js';
export { convertDocx } from './docx.js';
export { convertXlsx } from './xlsx.js';
export { convertPptx } from './pptx.js';
export { convertEpub } from './epub.js';
export { convertHtml } from './html.js';
export { convertCsv } from './csv.js';
export { convertJson } from './json.js';
