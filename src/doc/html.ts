/**
 * HTML-to-Markdown converter.
 * Reuses our in-house LobsterEngine HTML parser and markdown extractor.
 */

import { parseHtml, extractMarkdown, extractText } from '../browser/lightpanda.js';

export interface HtmlResult {
  markdown: string;
  title: string;
}

export function convertHtml(html: string): HtmlResult {
  const nodes = parseHtml(html);

  // Extract title
  let title = '';
  function findTitle(nodeList: any[]): void {
    for (const node of nodeList) {
      if (node.tag === 'title' && node.children?.[0]?.text) {
        title = node.children[0].text.trim();
        return;
      }
      if (node.children) findTitle(node.children);
    }
  }
  findTitle(nodes);

  // Extract markdown
  const markdown = extractMarkdown(nodes, '');

  return { markdown, title };
}
