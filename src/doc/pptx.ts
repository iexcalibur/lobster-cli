/**
 * PPTX-to-Markdown converter.
 * PPTX files are ZIP archives containing XML files.
 * We parse the XML directly to extract slide text and structure.
 */

import AdmZip from 'adm-zip';

export interface PptxResult {
  markdown: string;
  title: string;
  slides: number;
}

/**
 * Extract text content from PPTX XML body.
 */
function extractTextFromXml(xml: string): string[] {
  const texts: string[] = [];

  // Extract all <a:t> text elements
  const matches = xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g);
  let currentLine = '';

  for (const match of matches) {
    const text = match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    currentLine += text;
  }

  if (currentLine.trim()) {
    texts.push(currentLine.trim());
  }

  return texts;
}

/**
 * Parse PPTX slide XML for structured content.
 */
function parseSlide(xml: string, slideNum: number): string {
  const lines: string[] = [];
  lines.push(`## Slide ${slideNum}`);
  lines.push('');

  // Extract text from paragraphs <a:p>
  const paragraphs = xml.split(/<a:p\b/);

  for (const para of paragraphs.slice(1)) {
    const endIdx = para.indexOf('</a:p>');
    const paraXml = endIdx >= 0 ? para.slice(0, endIdx) : para;

    // Check if it's a title/heading (look for font size or placeholder type)
    const isTitle = /ph type="title"/i.test(paraXml) ||
                    /ph type="ctrTitle"/i.test(paraXml) ||
                    /ph type="subTitle"/i.test(paraXml);

    // Extract text runs
    const textRuns: string[] = [];
    const runMatches = paraXml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g);
    for (const m of runMatches) {
      const text = m[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      if (text.trim()) textRuns.push(text);
    }

    const fullText = textRuns.join('').trim();
    if (!fullText) continue;

    // Check for bullet/list markers
    const hasBullet = /<a:buChar/.test(paraXml) || /<a:buAutoNum/.test(paraXml);

    if (isTitle) {
      lines.push(`### ${fullText}`);
      lines.push('');
    } else if (hasBullet) {
      lines.push(`- ${fullText}`);
    } else {
      lines.push(fullText);
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

export async function convertPptx(buffer: Buffer): Promise<PptxResult> {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  // Find slide files (ppt/slides/slide1.xml, slide2.xml, etc.)
  const slideEntries = entries
    .filter(e => /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
    .sort((a, b) => {
      const numA = parseInt(a.entryName.match(/slide(\d+)/)?.[1] || '0');
      const numB = parseInt(b.entryName.match(/slide(\d+)/)?.[1] || '0');
      return numA - numB;
    });

  const mdParts: string[] = [];

  // Try to get presentation title from app.xml or core.xml
  let title = 'Presentation';
  const coreEntry = entries.find(e => e.entryName.includes('core.xml'));
  if (coreEntry) {
    const coreXml = coreEntry.getData().toString('utf-8');
    const titleMatch = coreXml.match(/<dc:title>([\s\S]*?)<\/dc:title>/);
    if (titleMatch) title = titleMatch[1].trim();
  }

  mdParts.push(`# ${title}`);
  mdParts.push('');

  for (let i = 0; i < slideEntries.length; i++) {
    const entry = slideEntries[i];
    const xml = entry.getData().toString('utf-8');
    const slideMarkdown = parseSlide(xml, i + 1);
    if (slideMarkdown) {
      mdParts.push(slideMarkdown);
      mdParts.push('');
      mdParts.push('---');
      mdParts.push('');
    }
  }

  return {
    markdown: mdParts.join('\n').trim(),
    title,
    slides: slideEntries.length,
  };
}
