/**
 * DOCX-to-Markdown converter using mammoth.
 * mammoth converts DOCX → HTML → we convert to Markdown.
 */

export interface DocxResult {
  markdown: string;
  title: string;
}

export async function convertDocx(buffer: Buffer): Promise<DocxResult> {
  const mammoth = await import('mammoth');

  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value;

  // Convert HTML to Markdown
  const { convertHtml } = await import('./html.js');
  const mdResult = convertHtml(html);

  return {
    markdown: mdResult.markdown,
    title: mdResult.title || 'Document',
  };
}
