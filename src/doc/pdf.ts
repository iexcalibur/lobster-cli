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
 * - First-line analysis → title detection when metadata is empty
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
      parsed = { numpages: 1, info: {}, text: '' };
      // Fallback: page-by-page extraction via pdfjs-dist
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

  // Step 2: Split text into pages
  // pdf-parse uses form-feed \f, but sometimes pages are separated by
  // patterns like "-- N of M --" or "arXiv:..." or just double-newlines
  let pageTexts = splitIntoPages(parsed.text, totalPages);

  // Apply max pages limit
  if (maxPages > 0 && pageTexts.length > maxPages) {
    pageTexts = pageTexts.slice(0, maxPages);
  }

  const actualPageCount = Math.max(pageTexts.length, totalPages);

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

  // Step 7: Fix hyphenation breaks (e.g., "scal able" → "scalable")
  markdown = fixHyphenation(markdown);

  // Step 8: Detect title — try metadata first, then first line heuristic
  let title = (info.Title as string) || '';
  if (!title) {
    title = detectTitleFromText(markdown);
  }

  // Step 9: Detect authors from the first few lines
  const authors = detectAuthors(pages[0]?.lines || []);

  // Step 10: Final cleanup
  markdown = finalCleanup(markdown, title, authors, info);

  return {
    markdown,
    title: title || 'untitled',
    metadata: {
      author: authors || (info.Author as string) || '',
      creator: info.Creator || '',
      producer: info.Producer || '',
      creationDate: info.CreationDate || '',
      pages: actualPageCount,
    },
    pages: actualPageCount,
  };
}

/**
 * Split raw text into pages using multiple strategies.
 */
function splitIntoPages(text: string, expectedPages: number): string[] {
  // Strategy 1: form-feed character
  const ffPages = text.split(/\f/).filter(s => s.trim().length > 0);
  if (ffPages.length > 1 && ffPages.length >= expectedPages * 0.5) {
    return ffPages;
  }

  // Strategy 2: page marker patterns like "-- 1 of 24 --" or "Page N"
  const pageMarker = /(?:^|\n)\s*(?:--|—)\s*\d+\s+of\s+\d+\s*(?:--|—)\s*(?:\n|$)/g;
  const markerSplit = text.split(pageMarker).filter(s => s.trim().length > 0);
  if (markerSplit.length > 1 && markerSplit.length >= expectedPages * 0.3) {
    return markerSplit;
  }

  // Strategy 3: arXiv page markers
  const arxivMarker = /(?:^|\n)arXiv:\d+\.\d+v\d+\s+\[[\w.]+\]\s+\d+\s+\w+\s+\d+\s*(?:\n|$)/g;
  const arxivSplit = text.split(arxivMarker).filter(s => s.trim().length > 0);
  if (arxivSplit.length > 1) {
    return arxivSplit;
  }

  // Strategy 4: Large gaps in text (3+ blank lines) when we expect many pages
  if (expectedPages > 5) {
    const gapSplit = text.split(/\n{4,}/).filter(s => s.trim().length > 0);
    if (gapSplit.length >= expectedPages * 0.3) {
      return gapSplit;
    }
  }

  // Fallback: single page
  return [text];
}

/**
 * Detect title from first non-empty lines of the document.
 * Academic papers typically have the title as the first substantial text.
 */
function detectTitleFromText(markdown: string): string {
  const lines = markdown.split('\n').filter(l => l.trim().length > 0);

  for (const line of lines.slice(0, 10)) {
    const trimmed = line.trim().replace(/^#+\s*/, ''); // Remove markdown heading prefix

    // Skip very short lines (likely labels/badges)
    if (trimmed.length < 10) continue;

    // Skip lines that look like author names (contain university/affiliation words)
    if (/\b(university|institute|dept|department|lab|ETH|MIT|Stanford|Google|Anthropic|OpenAI)\b/i.test(trimmed) &&
        trimmed.length < 60) continue;

    // Skip lines that are just names (all capitalized words, short)
    if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+){1,5}\*?$/.test(trimmed)) continue;

    // This looks like a title: substantial text, not too long
    if (trimmed.length >= 10 && trimmed.length < 200) {
      // Clean up: remove trailing author markers like "Simon Lermen*"
      const cleanTitle = trimmed
        .replace(/\s+[A-Z][a-z]+\s+[A-Z][a-z]+\*?\s*$/, '') // Remove trailing "FirstName LastName*"
        .replace(/\*$/, '')
        .trim();

      if (cleanTitle.length >= 10) return cleanTitle;
      return trimmed;
    }
  }

  return '';
}

/**
 * Detect authors from the first page's lines.
 * Authors typically appear right after the title, before the abstract.
 */
function detectAuthors(lines: string[]): string {
  const authors: string[] = [];
  let foundTitle = false;
  let foundAbstract = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip until we pass the title (first long line)
    if (!foundTitle && trimmed.length > 20) {
      foundTitle = true;
      continue;
    }

    // Stop at abstract
    if (/^abstract/i.test(trimmed)) {
      foundAbstract = true;
      break;
    }

    if (!foundTitle) continue;

    // Author patterns: "Name Name*" or "Name Name" followed by affiliation
    // Names are typically Title Case words
    const namePattern = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\*?$/;
    const match = trimmed.match(namePattern);
    if (match) {
      authors.push(match[1]);
      continue;
    }

    // Multi-author line: "Simon Lermen, Daniel Paleka, Joshua Swanson"
    if (/^[A-Z][a-z]+\s+[A-Z][a-z]+[,*]/.test(trimmed)) {
      const names = trimmed.split(/[,;]/)
        .map(n => n.trim().replace(/\*$/, ''))
        .filter(n => /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(n));
      if (names.length >= 2) {
        authors.push(...names);
        continue;
      }
    }

    // Stop collecting after we've found authors and hit non-name text
    if (authors.length > 0 && !namePattern.test(trimmed) &&
        !/^(ETH|MIT|Stanford|Google|Anthropic|OpenAI|University|Department|Institute)/i.test(trimmed)) {
      break;
    }
  }

  return authors.length > 0 ? authors.join(', ') : '';
}

/**
 * Fix broken hyphenation from PDF line breaks.
 * "scal able" → "scalable", "deanonymiza tion" → "deanonymization"
 */
function fixHyphenation(text: string): string {
  // Pattern: word fragment + space + lowercase continuation that forms a real word
  // Be conservative — only fix obvious cases
  return text
    // Fix "word- nextword" that was a hyphenated break (already handled in paragraph merge)
    // Fix "word (space) nextword" where the space is from a column/line break mid-word
    .replace(/(\w{3,})\s(able|tion|ment|ness|ing|ence|ance|ous|ive|ity|ful|less|ward|ship|dom|ism|ist|ure|ual|ial|ble|cal|ary|ory|ally|ically)\b/g, (match, prefix, suffix) => {
      // Only merge if the prefix doesn't end with a common word ending
      if (/(?:the|and|for|are|but|not|you|all|can|had|her|was|one|our|out|has|his|how|its|let|may|new|now|old|see|two|way|who|any|few|got|him|man|own|say|she|too|use)\s/i.test(prefix + ' ')) {
        return match; // Don't merge — these are separate words
      }
      return prefix + suffix;
    })
    // Fix explicit "scal able" type patterns where column break split a word
    .replace(/\b([a-z]{2,})\s([a-z]{2,})\b/g, (match, a, b) => {
      // Common broken suffixes from PDF column splits
      const knownSufixes = ['able', 'tion', 'sion', 'ment', 'ness', 'ence', 'ance', 'ized', 'izing', 'ated', 'ating'];
      if (knownSufixes.includes(b)) return a + b;
      return match;
    });
}

/**
 * Detect repeated text at top/bottom of pages (headers/footers).
 */
function removeHeadersFooters(pages: PdfPage[]): void {
  if (pages.length < 3) return;

  const topCandidates: Map<string, number> = new Map();
  const bottomCandidates: Map<string, number> = new Map();

  for (const page of pages) {
    const lines = page.lines.filter(l => l.trim().length > 0);
    if (lines.length < 4) continue;

    // Top lines (potential headers)
    for (let i = 0; i < Math.min(3, lines.length); i++) {
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

  const threshold = Math.floor(pages.length * 0.5);

  const headerPatterns = new Set<string>();
  const footerPatterns = new Set<string>();

  for (const [pattern, count] of topCandidates) {
    if (count >= threshold) headerPatterns.add(pattern);
  }
  for (const [pattern, count] of bottomCandidates) {
    if (count >= threshold) footerPatterns.add(pattern);
  }

  // Also remove standalone page numbers and arXiv identifiers
  for (const page of pages) {
    page.lines = page.lines.filter(line => {
      const trimmed = line.trim();
      const normalized = trimmed
        .replace(/\d+/g, 'N')
        .replace(/\s+/g, ' ');

      // Remove matched headers/footers
      if (headerPatterns.has(normalized) || footerPatterns.has(normalized)) return false;

      // Remove standalone page numbers
      if (/^\d+$/.test(trimmed)) return false;

      // Remove "-- N of M --" page markers
      if (/^--\s*\d+\s+of\s+\d+\s*--$/.test(trimmed)) return false;

      // Remove arXiv identifiers
      if (/^arXiv:\d+\.\d+v\d+/.test(trimmed)) return false;

      return true;
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
  const nonEmptyLines = lines.filter(l => l.trim().length > 0);
  const lineLengths = nonEmptyLines.map(l => l.trim().length);
  const avgLength = lineLengths.reduce((a, b) => a + b, 0) / (lineLengths.length || 1);
  const medianLength = lineLengths.sort((a, b) => a - b)[Math.floor(lineLengths.length / 2)] || avgLength;

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
      mdLines.push(line);
      continue;
    }

    // ── Table detection ──
    if (trimmed.includes('|') && trimmed.split('|').length >= 3) {
      flushParagraph();
      mdLines.push(trimmed);
      if (nextLine && /^[\s|:-]+$/.test(nextLine)) {
        mdLines.push(nextLine);
        i++;
      } else if (!inTable) {
        const cols = trimmed.split('|').length;
        mdLines.push('|' + ' --- |'.repeat(cols - 2).slice(0, -1) + '|');
      }
      inTable = true;
      continue;
    }
    if (inTable && !trimmed.includes('|')) {
      inTable = false;
    }

    // ── Skip single-word "noise" lines that are just affiliations ──
    // Lines like "Mats", "ETH Zurich" alone on a line near the top of page 1
    if (page.pageNum === 1 && i < 15 && trimmed.length < 20 &&
        /^[A-Z][a-z]+(\s+[A-Z][a-z]+)?$/.test(trimmed) &&
        !isKnownHeading(trimmed)) {
      // This is likely an author name or affiliation fragment — don't make it a heading
      continue;
    }

    // ── Heading detection (heuristic) ──
    // Pattern 1: Numbered sections "1 Introduction", "2.1 Methods"
    const numberedHeading = trimmed.match(/^(\d+\.?\d*\.?\d*)\s+([A-Z][A-Za-z\s:&,()-]+)$/);
    if (numberedHeading && trimmed.length < 80 && trimmed.length < medianLength * 0.8) {
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
    if (isKnownHeading(trimmed) && trimmed.length < 50) {
      flushParagraph();
      mdLines.push(`## ${trimmed}`);
      mdLines.push('');
      continue;
    }

    // Pattern 4: Short line followed by longer text (likely a heading)
    // But NOT on page 1 near the top (those are authors/affiliations)
    if (trimmed.length < 60 && trimmed.length < medianLength * 0.4
        && !trimmed.endsWith('.') && !trimmed.endsWith(',')
        && !trimmed.endsWith(':') && !trimmed.endsWith(')')
        && nextLine && nextLine.length > trimmed.length * 2
        && /^[A-Z]/.test(trimmed)
        && !(page.pageNum === 1 && i < 15)) {
      flushParagraph();
      mdLines.push(`### ${trimmed}`);
      mdLines.push('');
      continue;
    }

    // ── List detection ──
    if (/^[-•∙◦▪▸►]\s/.test(trimmed)) {
      flushParagraph();
      mdLines.push(`- ${trimmed.replace(/^[-•∙◦▪▸►]\s*/, '')}`);
      continue;
    }
    if (/^\d+[.)]\s/.test(trimmed) && trimmed.length < medianLength * 1.2) {
      flushParagraph();
      const match = trimmed.match(/^(\d+)[.)]\s*(.*)/);
      if (match) {
        mdLines.push(`${match[1]}. ${match[2]}`);
        continue;
      }
    }
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

    // ── Reference detection ──
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
 * Check if a line is a known section heading.
 */
function isKnownHeading(text: string): boolean {
  return /^(Abstract|Introduction|Conclusion|Discussion|Results|Methods|Methodology|Background|Related Work|Acknowledgments|Acknowledgements|References|Bibliography|Appendix|Summary|Overview|Preface|Contents|Table of Contents|Experiments|Evaluation|Limitations|Ethics|Future Work|Contributions)/i.test(text);
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
function finalCleanup(markdown: string, title: string, authors: string, info: Record<string, unknown>): string {
  const lines: string[] = [];

  // Add document header
  if (title) {
    lines.push(`# ${title}`);
    lines.push('');

    // Authors
    const authorStr = authors || (info.Author as string) || '';
    if (authorStr) {
      lines.push(`**Authors:** ${authorStr}`);
    }

    // Date
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

  // Remove the title from the body if it appears at the start
  // (since we already added it as # heading)
  if (title) {
    const titleEscaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    markdown = markdown.replace(new RegExp(`^${titleEscaped}\\s*\\n`, 'i'), '');
    // Also remove if it was detected as a heading
    markdown = markdown.replace(new RegExp(`^#+\\s*${titleEscaped}\\s*\\n`, 'im'), '');
  }

  lines.push(markdown);

  return lines.join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
