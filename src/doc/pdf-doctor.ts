/**
 * PDF Doctor — Detects issues in extracted PDF text and fixes them
 * using targeted browser screenshots + AI vision.
 *
 * Flow:
 * 1. Scan extracted markdown for known issue patterns
 * 2. For each issue, determine what screenshot to take
 * 3. Open PDF in browser, navigate to the problem area
 * 4. Screenshot JUST that section
 * 5. Ask AI a focused question about the screenshot
 * 6. Patch the markdown with the AI's answer
 *
 * This keeps 95% of extraction free (text-only) and only uses
 * AI for the 5% that's ambiguous.
 */

export interface PdfIssue {
  type: 'authors' | 'false-heading' | 'table' | 'figure-caption' | 'title';
  description: string;
  /** Page number to screenshot (1-indexed) */
  page: number;
  /** Region of page to focus on: top, middle, bottom, full */
  region: 'top' | 'middle' | 'bottom' | 'full';
  /** The problematic text in the markdown */
  problemText: string;
  /** AI prompt to resolve this issue */
  aiPrompt: string;
}

export interface PdfPatch {
  /** Original text to find and replace */
  find: string;
  /** Replacement text */
  replace: string;
}

export interface DoctorResult {
  issues: PdfIssue[];
  patches: PdfPatch[];
  /** Whether AI was needed */
  usedAI: boolean;
}

/**
 * Scan extracted markdown and first-page lines for issues.
 * Returns detected issues that need screenshot + AI resolution.
 */
export function detectIssues(
  markdown: string,
  firstPageLines: string[],
  detectedTitle: string,
  detectedAuthors: string,
): PdfIssue[] {
  const issues: PdfIssue[] = [];

  // ── Issue 1: Author area ambiguity ──
  // Trigger: We detected 0 or 1 authors but the first page has
  // multiple short capitalized lines (likely multiple authors)
  const authorCount = detectedAuthors ? detectedAuthors.split(',').length : 0;
  const shortCapLines = firstPageLines
    .slice(0, 20) // Only check first 20 lines
    .filter(l => {
      const t = l.trim();
      return t.length > 0 && t.length < 40 &&
        /^[A-Z][a-z]+/.test(t) &&
        !/^(Abstract|Introduction|Conclusion)/i.test(t);
    });

  // If we see 3+ short capitalized lines but only detected 0-1 authors,
  // there's likely an author parsing issue
  if (shortCapLines.length >= 3 && authorCount <= 1) {
    issues.push({
      type: 'authors',
      description: `Found ${shortCapLines.length} potential author/affiliation lines but only detected ${authorCount} author(s)`,
      page: 1,
      region: 'top',
      problemText: shortCapLines.join('\n'),
      aiPrompt: 'Look at the top of this academic paper. List ALL author names (first and last name only, no affiliations, no asterisks). Return them as a comma-separated list. Example format: "John Smith, Jane Doe, Bob Wilson"',
    });
  }

  // ── Issue 2: False headings from author/affiliation fragments ──
  // Trigger: Markdown has ## headings that are single short words
  // near the top, and they don't match known section headings
  const falseHeadingPattern = /^(#{2,3})\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)$/gm;
  let match;
  const knownHeadings = new Set([
    'abstract', 'introduction', 'conclusion', 'discussion', 'results',
    'methods', 'methodology', 'background', 'references', 'bibliography',
    'appendix', 'summary', 'overview', 'acknowledgments', 'acknowledgements',
    'experiments', 'evaluation', 'limitations', 'ethics', 'contributions',
    'related work', 'future work', 'preface', 'contents',
  ]);

  const falseHeadings: string[] = [];
  while ((match = falseHeadingPattern.exec(markdown)) !== null) {
    const headingText = match[2].toLowerCase();
    // Only flag headings in the first 2000 chars (near the top of document)
    if (match.index < 2000 && !knownHeadings.has(headingText)) {
      // Check if it looks like a name or affiliation
      if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)?$/.test(match[2]) && match[2].length < 30) {
        falseHeadings.push(match[0]);
      }
    }
  }

  if (falseHeadings.length > 0) {
    issues.push({
      type: 'false-heading',
      description: `Found ${falseHeadings.length} suspicious headings near document start that look like names/affiliations`,
      page: 1,
      region: 'top',
      problemText: falseHeadings.join('\n'),
      aiPrompt: 'Look at the top of this academic paper. I found these lines that might be incorrectly identified as section headings: ' +
        falseHeadings.map(h => `"${h.replace(/^#+\s*/, '')}"`).join(', ') +
        '. For each one, tell me if it is: (a) an actual section heading, (b) an author name, (c) an affiliation/university name, or (d) something else. Return as JSON array like: [{"text":"Mats","type":"other"},{"text":"ETH Zurich","type":"affiliation"}]',
    });
  }

  // ── Issue 3: Title uncertainty ──
  // Trigger: No title in PDF metadata AND our detected title
  // is suspiciously long or contains author names
  if (detectedTitle && detectedTitle.length > 100) {
    issues.push({
      type: 'title',
      description: 'Detected title is very long — might include author names',
      page: 1,
      region: 'top',
      problemText: detectedTitle,
      aiPrompt: 'Look at the top of this academic paper. What is the exact paper title? Return ONLY the title text, nothing else.',
    });
  }

  return issues;
}

/**
 * Take targeted screenshots and resolve issues with AI.
 *
 * This function:
 * 1. Opens the PDF URL in a headless browser
 * 2. Navigates to the specific page
 * 3. Scrolls to the right region
 * 4. Takes a screenshot
 * 5. Sends to AI with a focused question
 * 6. Returns patches to apply to the markdown
 */
export async function resolveIssuesWithAI(
  pdfUrl: string,
  issues: PdfIssue[],
  options: {
    getBrowser: () => Promise<{ page: any; close: () => Promise<void> }>;
    callAI: (prompt: string, screenshot: string) => Promise<string>;
  },
): Promise<PdfPatch[]> {
  if (issues.length === 0) return [];

  const patches: PdfPatch[] = [];
  let browserInstance: { page: any; close: () => Promise<void> } | null = null;

  try {
    // Open browser and navigate to PDF
    browserInstance = await options.getBrowser();
    const page = browserInstance.page;

    await page.goto(pdfUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForTimeout(2000); // Let PDF render

    // Group issues by page to minimize navigation
    const issuesByPage = new Map<number, PdfIssue[]>();
    for (const issue of issues) {
      const pageIssues = issuesByPage.get(issue.page) || [];
      pageIssues.push(issue);
      issuesByPage.set(issue.page, pageIssues);
    }

    for (const [pageNum, pageIssues] of issuesByPage) {
      // Navigate to the right page in the PDF viewer
      if (pageNum > 1) {
        // Chrome's PDF viewer uses #page=N
        await page.goto(`${pdfUrl}#page=${pageNum}`, { waitUntil: 'networkidle0' });
        await page.waitForTimeout(1000);
      }

      for (const issue of pageIssues) {
        // Scroll to the right region
        if (issue.region === 'top') {
          await page.evaluate('window.scrollTo(0, 0)');
        } else if (issue.region === 'middle') {
          await page.evaluate('window.scrollTo(0, document.body.scrollHeight / 2)');
        } else if (issue.region === 'bottom') {
          await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        }

        await page.waitForTimeout(500);

        // Take screenshot
        const screenshotBuffer = await page.screenshot({
          type: 'jpeg',
          quality: 80,
          clip: issue.region === 'top'
            ? { x: 0, y: 0, width: 800, height: 400 } // Just top portion
            : undefined,
        });

        const base64 = screenshotBuffer.toString('base64');

        // Ask AI to resolve the issue
        try {
          const aiResponse = await options.callAI(issue.aiPrompt, base64);
          const issuePatch = interpretAIResponse(issue, aiResponse);
          if (issuePatch) patches.push(...issuePatch);
        } catch (err) {
          // AI call failed — skip this issue, keep original text
          console.error(`AI resolution failed for ${issue.type}: ${(err as Error).message}`);
        }
      }
    }
  } finally {
    if (browserInstance) {
      await browserInstance.close().catch(() => {});
    }
  }

  return patches;
}

/**
 * Interpret AI response and generate patches.
 */
function interpretAIResponse(issue: PdfIssue, aiResponse: string): PdfPatch[] | null {
  const patches: PdfPatch[] = [];

  switch (issue.type) {
    case 'authors': {
      // AI should return comma-separated author names
      const cleanResponse = aiResponse.trim()
        .replace(/^["']|["']$/g, '') // Remove quotes
        .replace(/\n/g, ', '); // Newlines to commas

      if (cleanResponse.length > 5 && cleanResponse.includes(',')) {
        // Replace the authors line in the markdown
        patches.push({
          find: /\*\*Authors:\*\*\s*.+/.source,
          replace: `**Authors:** ${cleanResponse}`,
        });
      }
      break;
    }

    case 'false-heading': {
      // AI should return JSON array classifying each heading
      try {
        // Extract JSON from response
        const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const classifications = JSON.parse(jsonMatch[0]) as { text: string; type: string }[];
          for (const item of classifications) {
            if (item.type !== 'heading' && item.type !== 'section') {
              // Remove this false heading from markdown
              const escapedText = item.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              patches.push({
                find: `## ${escapedText}`,
                replace: '', // Remove entirely
              });
              patches.push({
                find: `### ${escapedText}`,
                replace: '', // Remove entirely
              });
            }
          }
        }
      } catch {
        // JSON parse failed — try line-by-line interpretation
        const lines = aiResponse.split('\n');
        for (const line of lines) {
          if (/\b(name|author|affiliation|university|other)\b/i.test(line) &&
              !/\b(heading|section)\b/i.test(line)) {
            // Find which heading text this refers to
            const textMatch = line.match(/"([^"]+)"/);
            if (textMatch) {
              patches.push({
                find: `## ${textMatch[1]}`,
                replace: '',
              });
              patches.push({
                find: `### ${textMatch[1]}`,
                replace: '',
              });
            }
          }
        }
      }
      break;
    }

    case 'title': {
      const cleanTitle = aiResponse.trim()
        .replace(/^["']|["']$/g, '')
        .replace(/\n/g, ' ')
        .trim();

      if (cleanTitle.length > 5 && cleanTitle.length < 200) {
        patches.push({
          find: `# ${issue.problemText}`,
          replace: `# ${cleanTitle}`,
        });
      }
      break;
    }
  }

  return patches.length > 0 ? patches : null;
}

/**
 * Apply patches to markdown.
 */
export function applyPatches(markdown: string, patches: PdfPatch[]): string {
  let result = markdown;

  for (const patch of patches) {
    if (patch.find.includes('*') || patch.find.includes('[')) {
      // Regex pattern
      try {
        result = result.replace(new RegExp(patch.find, 'gm'), patch.replace);
      } catch {
        // Invalid regex — try literal replacement
        result = result.replace(patch.find, patch.replace);
      }
    } else {
      // Literal string replacement
      result = result.replaceAll(patch.find, patch.replace);
    }
  }

  // Clean up empty lines left by removed headings
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}
