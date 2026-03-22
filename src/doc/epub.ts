/**
 * EPUB-to-Markdown converter.
 * EPUB files are ZIP archives containing HTML chapters.
 * We extract each chapter's HTML and convert to Markdown.
 */

import AdmZip from 'adm-zip';

export interface EpubResult {
  markdown: string;
  title: string;
}

export async function convertEpub(buffer: Buffer): Promise<EpubResult> {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  // Find the content.opf (package file) to get reading order
  const opfEntry = entries.find(e =>
    e.entryName.endsWith('.opf') || e.entryName.includes('content.opf')
  );

  let title = 'eBook';
  const chapterHtmls: string[] = [];

  if (opfEntry) {
    const opfXml = opfEntry.getData().toString('utf-8');

    // Extract title
    const titleMatch = opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/);
    if (titleMatch) title = titleMatch[1].trim();

    // Extract spine items (reading order)
    const itemRefs = [...opfXml.matchAll(/itemref\s+idref="([^"]+)"/g)].map(m => m[1]);

    // Map item IDs to hrefs
    const itemMap: Record<string, string> = {};
    const itemMatches = opfXml.matchAll(/item\s+[^>]*id="([^"]+)"[^>]*href="([^"]+)"/g);
    for (const m of itemMatches) {
      itemMap[m[1]] = m[2];
    }

    // Get chapter files in order
    const basePath = opfEntry.entryName.replace(/[^/]*$/, '');
    for (const ref of itemRefs) {
      const href = itemMap[ref];
      if (!href) continue;
      const fullPath = basePath + href;
      const chapterEntry = entries.find(e => e.entryName === fullPath || e.entryName.endsWith(href));
      if (chapterEntry) {
        const html = chapterEntry.getData().toString('utf-8');
        chapterHtmls.push(html);
      }
    }
  }

  // Fallback: just find all HTML/XHTML files
  if (chapterHtmls.length === 0) {
    const htmlEntries = entries
      .filter(e => /\.(x?html?)$/i.test(e.entryName))
      .sort((a, b) => a.entryName.localeCompare(b.entryName));

    for (const entry of htmlEntries) {
      chapterHtmls.push(entry.getData().toString('utf-8'));
    }
  }

  // Convert each chapter HTML to markdown
  const { convertHtml } = await import('./html.js');
  const mdParts: string[] = [];

  mdParts.push(`# ${title}`);
  mdParts.push('');
  mdParts.push('---');
  mdParts.push('');

  for (const html of chapterHtmls) {
    const result = convertHtml(html);
    if (result.markdown.trim()) {
      mdParts.push(result.markdown);
      mdParts.push('');
    }
  }

  return {
    markdown: mdParts.join('\n').trim(),
    title,
  };
}
