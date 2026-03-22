/**
 * PDF extraction module — downloads and converts PDFs to structured text/markdown.
 *
 * Works for both CLI and extension:
 * - CLI: lobster fetch https://arxiv.org/pdf/2602.16800
 * - Extension: detects PDF URL, extracts text before sending to LLM
 *
 * Handles:
 * - Remote PDFs (HTTP/HTTPS URLs)
 * - Local PDF files (file paths)
 * - All pages (no page limit)
 * - Text extraction with page boundaries
 * - Markdown conversion (headings, paragraphs, lists)
 * - Metadata extraction (title, author, pages, creation date)
 */

import { readFileSync } from 'node:fs';

// Dynamic import for pdf-parse (CommonJS module)
let pdfParseFn: ((buffer: Buffer) => Promise<{
  numpages: number;
  numrender: number;
  info: Record<string, unknown>;
  metadata: unknown;
  text: string;
  version: string;
}>) | null = null;

async function getPdfParser() {
  if (!pdfParseFn) {
    const mod = await import('pdf-parse');
    const PDFParseClass = (mod as any).PDFParse;
    if (PDFParseClass && typeof PDFParseClass === 'function') {
      // It's a class — wrap it so caller can use it as a function
      pdfParseFn = async (buffer: Buffer) => {
        const parser = new PDFParseClass(buffer);
        return parser.parse ? await parser.parse() : parser;
      };
    } else {
      pdfParseFn = (mod as any).default || mod;
    }
  }
  return pdfParseFn!;
}

export interface PdfMetadata {
  title: string;
  author: string;
  pages: number;
  creator: string;
  producer: string;
  creationDate: string;
}

export interface PdfExtractResult {
  metadata: PdfMetadata;
  text: string;
  markdown: string;
  pages: string[];
  wordCount: number;
  charCount: number;
}

/**
 * Detect if a URL or path points to a PDF.
 */
export function isPdfUrl(urlOrPath: string): boolean {
  const lower = urlOrPath.toLowerCase();

  // Direct .pdf extension
  if (lower.endsWith('.pdf')) return true;

  // Common PDF URL patterns
  if (/\/pdf\//.test(lower)) return true;

  // arXiv pattern: /abs/ can have PDF link, /pdf/ is always PDF
  if (/arxiv\.org\/pdf\//.test(lower)) return true;

  // Content-disposition or query params
  if (/[?&]format=pdf/i.test(lower)) return true;
  if (/[?&]type=pdf/i.test(lower)) return true;

  return false;
}

/**
 * Detect PDF from HTTP response headers.
 */
export function isPdfResponse(contentType: string): boolean {
  return contentType.includes('application/pdf');
}

/**
 * Download a PDF from a URL and return the buffer.
 */
async function downloadPdf(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/pdf,*/*',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Failed to download PDF: ${response.status} ${response.statusText}`);
  }

  // Verify it's actually a PDF
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('pdf') && !isPdfUrl(url)) {
    // Might still be a PDF — check magic bytes after download
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Read a local PDF file.
 */
function readLocalPdf(filePath: string): Buffer {
  return readFileSync(filePath);
}

/**
 * Convert raw extracted text into clean Markdown.
 *
 * Strategy:
 * 1. Split into lines
 * 2. Detect headings (short lines, all caps, or numbered sections)
 * 3. Detect lists (lines starting with -, •, *, numbered)
 * 4. Detect references section
 * 5. Merge paragraph lines
 * 6. Clean up whitespace
 */
function textToMarkdown(text: string, metadata: PdfMetadata): string {
  const lines = text.split('\n');
  const mdLines: string[] = [];

  // Add title
  if (metadata.title && metadata.title !== 'untitled') {
    mdLines.push(`# ${metadata.title}`);
    mdLines.push('');
    if (metadata.author) {
      mdLines.push(`**Authors:** ${metadata.author}`);
      mdLines.push('');
    }
    mdLines.push('---');
    mdLines.push('');
  }

  let inReferences = false;
  let prevWasBlank = false;
  let paragraphBuffer: string[] = [];

  function flushParagraph() {
    if (paragraphBuffer.length > 0) {
      mdLines.push(paragraphBuffer.join(' '));
      mdLines.push('');
      paragraphBuffer = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) {
      if (!prevWasBlank) {
        flushParagraph();
      }
      prevWasBlank = true;
      continue;
    }
    prevWasBlank = false;

    // Detect section headings
    // Pattern 1: Numbered sections like "1. Introduction", "2.1 Methods"
    const numberedHeading = line.match(/^(\d+\.?\d*\.?\d*)\s+([A-Z][A-Za-z\s:&-]+)$/);
    if (numberedHeading && line.length < 80) {
      flushParagraph();
      const depth = numberedHeading[1].split('.').filter(Boolean).length;
      const prefix = depth <= 1 ? '##' : depth === 2 ? '###' : '####';
      mdLines.push(`${prefix} ${line}`);
      mdLines.push('');
      continue;
    }

    // Pattern 2: ALL CAPS headings
    if (line === line.toUpperCase() && line.length > 3 && line.length < 60 && /^[A-Z\s:&-]+$/.test(line)) {
      flushParagraph();
      mdLines.push(`## ${line.charAt(0) + line.slice(1).toLowerCase()}`);
      mdLines.push('');
      continue;
    }

    // Pattern 3: "Abstract" or other known headings
    const knownHeadings = /^(Abstract|Introduction|Conclusion|Discussion|Results|Methods|Methodology|Background|Related Work|Acknowledgments|Acknowledgements|References|Bibliography|Appendix)/i;
    if (knownHeadings.test(line) && line.length < 40) {
      flushParagraph();
      if (/^(References|Bibliography)/i.test(line)) {
        inReferences = true;
      }
      mdLines.push(`## ${line}`);
      mdLines.push('');
      continue;
    }

    // Detect list items
    if (/^[-•∙◦▪]/.test(line)) {
      flushParagraph();
      mdLines.push(`- ${line.replace(/^[-•∙◦▪]\s*/, '')}`);
      continue;
    }

    // Detect numbered list items (but not section headings)
    if (/^\(\d+\)|^[a-z]\)/.test(line)) {
      flushParagraph();
      mdLines.push(`- ${line}`);
      continue;
    }

    // References section — format each reference
    if (inReferences && /^\[?\d+\]?\.?\s/.test(line)) {
      flushParagraph();
      mdLines.push(`- ${line}`);
      continue;
    }

    // Regular text — add to paragraph buffer
    // If line ends with hyphen (word break), join without space
    if (line.endsWith('-') && i + 1 < lines.length) {
      paragraphBuffer.push(line.slice(0, -1));
    } else {
      paragraphBuffer.push(line);
    }
  }

  flushParagraph();

  return mdLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Extract text and metadata from a PDF buffer.
 */
async function extractFromBuffer(buffer: Buffer): Promise<PdfExtractResult> {
  const parse = await getPdfParser();
  const result = await parse(buffer);

  const info = result.info || {};

  const metadata: PdfMetadata = {
    title: (info.Title as string) || 'untitled',
    author: (info.Author as string) || '',
    pages: result.numpages,
    creator: (info.Creator as string) || '',
    producer: (info.Producer as string) || '',
    creationDate: (info.CreationDate as string) || '',
  };

  const text = result.text || '';

  // Split by page markers if available, otherwise split evenly
  // pdf-parse separates pages with form-feed or double newlines
  const pageTexts = text.split(/\f/).filter(Boolean);
  const pages = pageTexts.length === result.numpages
    ? pageTexts
    : [text]; // Couldn't split by pages reliably

  const markdown = textToMarkdown(text, metadata);

  const words = text.split(/\s+/).filter(Boolean);

  return {
    metadata,
    text,
    markdown,
    pages: pages.map(p => p.trim()),
    wordCount: words.length,
    charCount: text.length,
  };
}

/**
 * Main entry point — extract from URL or file path.
 */
export async function extractPdf(urlOrPath: string): Promise<PdfExtractResult> {
  let buffer: Buffer;

  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
    buffer = await downloadPdf(urlOrPath);
  } else {
    buffer = readLocalPdf(urlOrPath);
  }

  // Verify PDF magic bytes
  if (buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
    throw new Error('Not a valid PDF file (invalid magic bytes)');
  }

  return extractFromBuffer(buffer);
}

/**
 * Quick check + extract — for use in fetch command.
 * Returns null if not a PDF, or the extract result if it is.
 */
export async function tryExtractPdf(url: string): Promise<PdfExtractResult | null> {
  // First check URL pattern
  if (isPdfUrl(url)) {
    return extractPdf(url);
  }

  // If URL doesn't look like PDF, do a HEAD request to check content-type
  try {
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const contentType = head.headers.get('content-type') || '';
    if (isPdfResponse(contentType)) {
      return extractPdf(url);
    }
  } catch {
    // HEAD failed, not a PDF
  }

  return null;
}
