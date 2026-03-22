/**
 * PDF-to-Markdown converter with heuristic layout detection.
 *
 * Instead of ML models (like Marker's Surya), we use:
 * - Font size analysis → heading detection
 * - Spacing patterns → paragraph separation
 * - Column alignment → table detection
 * - Repeated text → header/footer removal
 * - Bullet/number patterns → list detection
 * - Sentence continuation → cross-page merging
 */

export interface PdfConvertOptions {
  /** Max pages to process (0 = all) */
  maxPages?: number;
  /** Remove detected headers/footers */
  removeHeadersFooters?: boolean;
  /** Merge text across pages */
  crossPageMerge?: boolean;
}

interface PdfPage {
  pageNum: number;
  text: string;
  lines: string[];
}

interface PdfParseResult {
  numpages: number;
  info: Record<string, unknown>;
  text: string;
}

export interface PdfResult {
  markdown: string;
  title: string;
  metadata: Record<string, unknown>;
  pages: number;
}

/**
 * Main PDF conversion pipeline.
 */
export async function convertPdf(
  buffer: Buffer,
  options?: PdfConvertOptions,
): Promise<PdfResult> {
  // Step 1: Extract raw text from PDF
  const mod = await import('pdf-parse');
  const parseFn = (mod as any).PDFParse || (mod as any).default || mod;

  // Convert Buffer to Uint8Array (pdf-parse/pdfjs requires it)
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let parsed: PdfParseResult;
  if (typeof parseFn === 'function' && /^class\s/.test(parseFn.toString())) {
    const instance = new parseFn(uint8);
    parsed = await instance.getText();
    if (!parsed || !parsed.text) {
      // Fallback: try loading differently
      parsed = { numpages: 1, info: {}, text: '' };
      // Try page-by-page extraction via pdfjs-dist
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs' as any);
        const doc = await pdfjs.getDocument({ data: uint8 }).promise;
        const pageTexts: string[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          try {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map((item: any) => item.str).join(' ');
            pageTexts.push(pageText);
          } catch { /* skip page */ }
        }
        parsed.text = pageTexts.join('\f');
        parsed.numpages = doc.numPages;
      } catch { /* pdfjs fallback failed */ }
    }
  } else {
    parsed = await parseFn(uint8 as any);
  }

  const info = parsed.info || {};
  const totalPages = parsed.numpages || 1;
  const maxPages = options?.maxPages || 0;

  // Step 2: Split text into pages (pdf-parse uses form-feed \f)
  let pageTexts = parsed.text.split(/\f/).filter(Boolean);
  if (pageTexts.length === 0) pageTexts = [parsed.text];

  // Apply max pages limit
  if (maxPages > 0 && pageTexts.length > maxPages) {
    pageTexts = pageTexts.slice(0, maxPages);
  }

  // Step 3: Build page objects with line analysis
  const pages: PdfPage[] = pageTexts.map((text, i) => ({
    pageNum: i + 1,
    text: text.trim(),
    lines: text.split('\n').map(l => l.trimEnd()),
  }));

  // Step 4: Detect and remove headers/footers
  if (options?.removeHeadersFooters !== false && pages.length >= 3) {
    removeHeadersFooters(pages);
  }

  // Step 5: Convert each page to markdown
  const mdPages = pages.map(page => pageToMarkdown(page));

  // Step 6: Cross-page text merging
  let markdown: string;
  if (options?.crossPageMerge !== false) {
    markdown = mergePages(mdPages);
  } else {
    markdown = mdPages.join('\n\n---\n\n');
  }

  // Step 7: Detect title from metadata or first heading
  let title = (info.Title as string) || '';
  if (!title) {
    const firstHeading = markdown.match(/^#\s+(.+)$/m);
    if (firstHeading) title = firstHeading[1];
  }

  // Step 8: Final cleanup
  markdown = finalCleanup(markdown, title, info);

  return {
    markdown,
    title: title || 'untitled',
    metadata: {
      author: info.Author || '',
      creator: info.Creator || '',
      producer: info.Producer || '',
      creationDate: info.CreationDate || '',
      pages: totalPages,
    },
    pages: totalPages,
  };
}

/**
 * Detect repeated text at top/bottom of pages (headers/footers).
 */
function removeHeadersFooters(pages: PdfPage[]): void {
  if (pages.length < 3) return;

  // Check first 3 lines and last 3 lines across all pages
  const topCandidates: Map<string, number> = new Map();
  const bottomCandidates: Map<string, number> = new Map();

  for (const page of pages) {
    const lines = page.lines.filter(l => l.trim().length > 0);
    if (lines.length < 4) continue;

    // Top lines (potential headers)
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      // Normalize: remove page numbers, dates
      const normalized = lines[i].trim()
        .replace(/\d+/g, 'N')
        .replace(/\s+/g, ' ');
      if (normalized.length > 3) {
        topCandidates.set(normalized, (topCandidates.get(normalized) || 0) + 1);
      }
    }

    // Bottom lines (potential footers)
    for (let i = Math.max(0, lines.length - 3); i < lines.length; i++) {
      const normalized = lines[i].trim()
        .replace(/\d+/g, 'N')
        .replace(/\s+/g, ' ');
      if (normalized.length > 3) {
        bottomCandidates.set(normalized, (bottomCandidates.get(normalized) || 0) + 1);
      }
    }
  }

  const threshold = Math.floor(pages.length * 0.5); // Appears on 50%+ of pages

  // Find headers/footers that appear on most pages
  const headerPatterns = new Set<string>();
  const footerPatterns = new Set<string>();

  for (const [pattern, count] of topCandidates) {
    if (count >= threshold) headerPatterns.add(pattern);
  }
  for (const [pattern, count] of bottomCandidates) {
    if (count >= threshold) footerPatterns.add(pattern);
  }

  // Remove matching lines from pages
  for (const page of pages) {
    page.lines = page.lines.filter(line => {
      const normalized = line.trim()
        .replace(/\d+/g, 'N')
        .replace(/\s+/g, ' ');
      return !headerPatterns.has(normalized) && !footerPatterns.has(normalized);
    });
    page.text = page.lines.join('\n');
  }
}

/**
 * Convert a single page's text to markdown using heuristics.
 */
function pageToMarkdown(page: PdfPage): string {
  const lines = page.lines;
  if (lines.length === 0) return '';

  // Analyze line properties
  const lineLengths = lines.filter(l => l.trim().length > 0).map(l => l.trim().length);
  const avgLength = lineLengths.reduce((a, b) => a + b, 0) / (lineLengths.length || 1);

  const mdLines: string[] = [];
  let inCodeBlock = false;
  let inTable = false;
  let paragraphBuffer: string[] = [];

  function flushParagraph() {
    if (paragraphBuffer.length > 0) {
      mdLines.push(paragraphBuffer.join(' '));
      mdLines.push('');
      paragraphBuffer = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const nextLine = i + 1 < lines.length ? lines[i + 1]?.trim() : '';

    // Skip empty lines
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    // ── Code block detection ──
    if (trimmed.startsWith('```')) {
      flushParagraph();
      inCodeBlock = !inCodeBlock;
      mdLines.push(trimmed);
      continue;
    }
    if (inCodeBlock) {
      mdLines.push(line); // Preserve indentation in code
      continue;
    }

    // ── Table detection (lines with multiple | or tab-separated columns) ──
    if (trimmed.includes('|') && trimmed.split('|').length >= 3) {
      flushParagraph();
      mdLines.push(trimmed);
      // Check if next line is a separator
      if (nextLine && /^[\s|:-]+$/.test(nextLine)) {
        mdLines.push(nextLine);
        i++; // Skip separator
      } else if (!inTable) {
        // First table row — add separator
        const cols = trimmed.split('|').length;
        mdLines.push('|' + ' --- |'.repeat(cols - 2).slice(0, -1) + '|');
      }
      inTable = true;
      continue;
    }
    if (inTable && !trimmed.includes('|')) {
      inTable = false;
    }

    // ── Heading detection (heuristic) ──
    // Pattern 1: Numbered sections "1. Introduction", "2.1 Methods"
    const numberedHeading = trimmed.match(/^(\d+\.?\d*\.?\d*)\s+([A-Z][A-Za-z\s:&,()-]+)$/);
    if (numberedHeading && trimmed.length < 80 && trimmed.length < avgLength * 0.7) {
      flushParagraph();
      const depth = numberedHeading[1].split('.').filter(Boolean).length;
      const prefix = depth <= 1 ? '##' : depth === 2 ? '###' : '####';
      mdLines.push(`${prefix} ${trimmed}`);
      mdLines.push('');
      continue;
    }

    // Pattern 2: ALL CAPS short lines
    if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 60
        && /^[A-Z\s:&,()-]+$/.test(trimmed)) {
      flushParagraph();
      mdLines.push(`## ${trimmed.charAt(0) + trimmed.slice(1).toLowerCase()}`);
      mdLines.push('');
      continue;
    }

    // Pattern 3: Known academic/document headings
    const knownHeadings = /^(Abstract|Introduction|Conclusion|Discussion|Results|Methods|Methodology|Background|Related Work|Acknowledgments|Acknowledgements|References|Bibliography|Appendix|Summary|Overview|Preface|Contents|Table of Contents)/i;
    if (knownHeadings.test(trimmed) && trimmed.length < 50) {
      flushParagraph();
      mdLines.push(`## ${trimmed}`);
      mdLines.push('');
      continue;
    }

    // Pattern 4: Short line followed by longer text (likely a heading)
    if (trimmed.length < 60 && trimmed.length < avgLength * 0.5
        && !trimmed.endsWith('.') && !trimmed.endsWith(',')
        && !trimmed.endsWith(':') && nextLine && nextLine.length > trimmed.length * 1.5
        && /^[A-Z]/.test(trimmed)) {
      flushParagraph();
      mdLines.push(`### ${trimmed}`);
      mdLines.push('');
      continue;
    }

    // ── List detection ──
    // Bullet lists
    if (/^[-•∙◦▪▸►]\s/.test(trimmed)) {
      flushParagraph();
      mdLines.push(`- ${trimmed.replace(/^[-•∙◦▪▸►]\s*/, '')}`);
      continue;
    }
    // Numbered lists
    if (/^\d+[.)]\s/.test(trimmed) && trimmed.length < avgLength * 1.2) {
      flushParagraph();
      const match = trimmed.match(/^(\d+)[.)]\s*(.*)/);
      if (match) {
        mdLines.push(`${match[1]}. ${match[2]}`);
        continue;
      }
    }
    // Letter lists
    if (/^[a-z][.)]\s/i.test(trimmed)) {
      flushParagraph();
      mdLines.push(`- ${trimmed.replace(/^[a-z][.)]\s*/i, '')}`);
      continue;
    }

    // ── Blockquote detection ──
    if (/^\s{4,}/.test(line) && trimmed.length > 20) {
      flushParagraph();
      mdLines.push(`> ${trimmed}`);
      continue;
    }

    // ── Reference detection (in References section) ──
    if (/^\[\d+\]/.test(trimmed)) {
      flushParagraph();
      mdLines.push(`- ${trimmed}`);
      continue;
    }

    // ── URL detection ──
    if (/^https?:\/\//.test(trimmed)) {
      flushParagraph();
      mdLines.push(`<${trimmed}>`);
      mdLines.push('');
      continue;
    }

    // ── Regular text — accumulate into paragraph ──
    // Handle hyphenated word breaks at line ends
    if (trimmed.endsWith('-') && nextLine && /^[a-z]/.test(nextLine)) {
      paragraphBuffer.push(trimmed.slice(0, -1));
    } else {
      paragraphBuffer.push(trimmed);
    }
  }

  flushParagraph();

  return mdLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Merge pages with cross-page text continuation.
 */
function mergePages(pages: string[]): string {
  if (pages.length <= 1) return pages[0] || '';

  const merged: string[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i].trim();
    if (!page) continue;

    if (i > 0 && merged.length > 0) {
      const lastLine = merged[merged.length - 1];
      const firstLine = page.split('\n')[0] || '';

      // Check if the page break split a sentence
      const endsWithContinuation = lastLine && !lastLine.endsWith('.')
        && !lastLine.endsWith('!')
        && !lastLine.endsWith('?')
        && !lastLine.endsWith(':')
        && !lastLine.startsWith('#')
        && !lastLine.startsWith('-')
        && !lastLine.startsWith('|')
        && !lastLine.startsWith('>')
        && !lastLine.startsWith('```');

      const startsWithContinuation = firstLine && /^[a-z]/.test(firstLine)
        && !firstLine.startsWith('-')
        && !firstLine.startsWith('|');

      if (endsWithContinuation && startsWithContinuation) {
        // Merge the lines
        merged[merged.length - 1] = lastLine + ' ' + firstLine;
        const rest = page.split('\n').slice(1).join('\n').trim();
        if (rest) merged.push(rest);
        continue;
      }
    }

    merged.push(page);
  }

  return merged.join('\n\n');
}

/**
 * Final cleanup of the full markdown document.
 */
function finalCleanup(markdown: string, title: string, info: Record<string, unknown>): string {
  const lines: string[] = [];

  // Add document header
  if (title) {
    lines.push(`# ${title}`);
    lines.push('');
    if (info.Author) {
      lines.push(`**Author:** ${info.Author}`);
    }
    if (info.CreationDate) {
      const dateStr = String(info.CreationDate).replace(/^D:/, '');
      const year = dateStr.slice(0, 4);
      const month = dateStr.slice(4, 6);
      const day = dateStr.slice(6, 8);
      if (year && month && day) {
        lines.push(`**Date:** ${year}-${month}-${day}`);
      }
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push(markdown);

  return lines.join('\n')
    .replace(/\n{4,}/g, '\n\n\n') // Max 2 blank lines
    .replace(/[ \t]+\n/g, '\n') // Trailing whitespace
    .trim();
}
