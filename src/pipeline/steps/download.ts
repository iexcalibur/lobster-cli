/**
 * Pipeline step: download — files, videos, documents.
 *
 * Features:
 * - HTTP download with concurrency control
 * - yt-dlp integration for video platforms
 * - Browser cookie forwarding (Netscape format)
 * - Document extraction (HTML/Markdown/JSON)
 * - Progress tracking
 * - Skip-existing support
 * - Filename templating
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { PipelineContext } from '../../types/pipeline.js';
import { renderTemplate } from '../template.js';
import { registerStep } from '../registry.js';

interface DownloadParams {
  url?: string;
  dir?: string;
  filename?: string;
  concurrency?: number;
  skip_existing?: boolean;
  timeout?: number;
  // yt-dlp options
  video?: boolean;
  format?: string;
  // Document extraction
  content?: 'html' | 'markdown' | 'json' | 'text';
  metadata?: Record<string, unknown>;
}

interface DownloadResult {
  url: string;
  file: string;
  success: boolean;
  size?: number;
  error?: string;
  content?: string;
}

class DownloadProgressTracker {
  private total: number;
  private completed = 0;
  private failed = 0;
  private totalBytes = 0;

  constructor(total: number) { this.total = total; }

  success(bytes: number) {
    this.completed++;
    this.totalBytes += bytes;
  }

  fail() {
    this.completed++;
    this.failed++;
  }

  summary(): string {
    return `Downloaded ${this.completed - this.failed}/${this.total} files (${formatBytes(this.totalBytes)})${this.failed > 0 ? `, ${this.failed} failed` : ''}`;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Export browser cookies in Netscape format for yt-dlp.
 */
async function exportCookiesNetscape(ctx: PipelineContext, domain: string): Promise<string | null> {
  if (!ctx.page) return null;
  try {
    const cookies = await ctx.page.getCookies({ domain });
    if (cookies.length === 0) return null;

    const lines = ['# Netscape HTTP Cookie File'];
    for (const c of cookies) {
      const httpOnly = c.httpOnly ? 'TRUE' : 'FALSE';
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const expires = c.expires ? Math.floor(c.expires) : 0;
      lines.push(`${c.domain || domain}\tTRUE\t${c.path || '/'}\t${secure}\t${expires}\t${c.name}\t${c.value}`);
    }

    const tmpFile = join(tmpdir(), `lobster-cookies-${Date.now()}.txt`);
    writeFileSync(tmpFile, lines.join('\n'));
    return tmpFile;
  } catch {
    return null;
  }
}

/**
 * Check if yt-dlp is available.
 */
function hasYtDlp(): boolean {
  try {
    execSync('yt-dlp --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Download a video using yt-dlp.
 */
function downloadWithYtDlp(url: string, dir: string, opts: {
  format?: string;
  cookieFile?: string | null;
  filename?: string;
}): DownloadResult {
  const args = ['yt-dlp', '-o', join(dir, opts.filename || '%(title)s.%(ext)s')];

  if (opts.format) args.push('-f', opts.format);
  if (opts.cookieFile) args.push('--cookies', opts.cookieFile);
  args.push('--no-warnings', '--no-progress', url);

  try {
    execSync(args.join(' '), { stdio: 'pipe', timeout: 300000 });
    return { url, file: dir, success: true };
  } catch (err: any) {
    return { url, file: '', success: false, error: err.message?.slice(0, 200) };
  }
}

/**
 * Concurrent download worker pool.
 */
async function downloadPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<DownloadResult>,
): Promise<DownloadResult[]> {
  const results: DownloadResult[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

registerStep('download', async (ctx: PipelineContext, params: unknown): Promise<unknown> => {
  const p = params as DownloadParams;
  const dir = renderTemplate(p.dir || './downloads', { args: ctx.args, data: ctx.data }) as string;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const concurrency = p.concurrency || 3;
  const skipExisting = p.skip_existing ?? false;
  const timeout = (p.timeout || 60) * 1000;

  // Collect URLs
  const items: { url: string; item?: unknown; index: number }[] = [];
  if (p.url) {
    items.push({
      url: renderTemplate(p.url, { args: ctx.args, data: ctx.data }) as string,
      index: 0,
    });
  } else if (Array.isArray(ctx.data)) {
    for (let i = 0; i < (ctx.data as unknown[]).length; i++) {
      const item = (ctx.data as unknown[])[i];
      const url = typeof item === 'string'
        ? item
        : (item as Record<string, unknown>).url as string;
      if (url) items.push({ url, item, index: i });
    }
  }

  if (items.length === 0) return [];

  const tracker = new DownloadProgressTracker(items.length);

  // ── Video download path (yt-dlp) ──
  if (p.video) {
    if (!hasYtDlp()) {
      throw new Error('yt-dlp not found. Install: brew install yt-dlp (mac) or pip install yt-dlp');
    }

    const cookieFile = await exportCookiesNetscape(ctx, new URL(items[0].url).hostname);

    const results = await downloadPool(items, Math.min(concurrency, 2), async (entry) => {
      const result = downloadWithYtDlp(entry.url, dir, {
        format: p.format,
        cookieFile,
        filename: p.filename
          ? renderTemplate(p.filename, { args: ctx.args, item: entry.item, data: ctx.data, index: entry.index }) as string
          : undefined,
      });
      if (result.success) tracker.success(0);
      else tracker.fail();
      return result;
    });

    // Clean up cookie file
    if (cookieFile) try { require('fs').unlinkSync(cookieFile); } catch {}

    if (ctx.debug) console.log(tracker.summary());
    return results;
  }

  // ── Document extraction path ──
  if (p.content) {
    const results = await downloadPool(items, concurrency, async (entry) => {
      try {
        const resp = await fetch(entry.url, {
          signal: AbortSignal.timeout(timeout),
        });
        if (!resp.ok) return { url: entry.url, file: '', success: false, error: `HTTP ${resp.status}` };

        let content: string;
        const html = await resp.text();

        if (p.content === 'html') {
          content = html;
        } else if (p.content === 'text') {
          // Strip tags
          content = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        } else if (p.content === 'json') {
          try { content = JSON.stringify(JSON.parse(html), null, 2); } catch { content = html; }
        } else {
          // markdown — basic conversion
          content = html
            .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n## $1\n')
            .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')
            .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
            .replace(/<[^>]+>/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        }

        // Save to file
        const filename = p.filename
          ? renderTemplate(p.filename, { args: ctx.args, item: entry.item, data: ctx.data, index: entry.index }) as string
          : basename(new URL(entry.url).pathname).replace(/\.[^.]+$/, '') + (p.content === 'json' ? '.json' : '.md');
        const filepath = join(dir, filename);

        // Prepend metadata if provided
        if (p.metadata) {
          const meta = renderTemplate(p.metadata, { args: ctx.args, item: entry.item, data: ctx.data, index: entry.index }) as Record<string, unknown>;
          const header = Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n');
          content = `---\n${header}\n---\n\n${content}`;
        }

        writeFileSync(filepath, content, 'utf-8');
        tracker.success(Buffer.byteLength(content));
        return { url: entry.url, file: filepath, success: true, size: Buffer.byteLength(content), content: content.slice(0, 200) };
      } catch (err: any) {
        tracker.fail();
        return { url: entry.url, file: '', success: false, error: err.message };
      }
    });

    if (ctx.debug) console.log(tracker.summary());
    return results;
  }

  // ── Standard HTTP download path ──
  const results = await downloadPool(items, concurrency, async (entry) => {
    try {
      const filename = p.filename
        ? renderTemplate(p.filename, { args: ctx.args, item: entry.item, data: ctx.data, index: entry.index }) as string
        : decodeURIComponent(basename(new URL(entry.url).pathname)) || `download-${entry.index}`;
      const filepath = join(dir, filename);

      if (skipExisting && existsSync(filepath)) {
        tracker.success(0);
        return { url: entry.url, file: filepath, success: true, size: 0 };
      }

      const resp = await fetch(entry.url, {
        signal: AbortSignal.timeout(timeout),
      });
      if (!resp.ok) {
        tracker.fail();
        return { url: entry.url, file: '', success: false, error: `HTTP ${resp.status}` };
      }

      const buffer = Buffer.from(await resp.arrayBuffer());
      writeFileSync(filepath, buffer);
      tracker.success(buffer.length);
      return { url: entry.url, file: filepath, success: true, size: buffer.length };
    } catch (err: any) {
      tracker.fail();
      return { url: entry.url, file: '', success: false, error: err.message };
    }
  });

  if (ctx.debug) console.log(tracker.summary());
  return results;
});
