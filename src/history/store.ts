/**
 * Run history store — persists agent runs as append-only JSONL.
 *
 * One file per run in ~/.lobster/runs/<run-id>.jsonl:
 *   {"record_type":"run_start", ...meta}
 *   {"record_type":"event", "index":0, ...HistoricalEvent}
 *   {"record_type":"run_end", "ended_at":..., "success":..., "result":...}
 *
 * Events are appended as they happen, so a crashed run keeps every
 * completed step. Persistence failures never break a run — the recorder
 * warns once and disables itself, and none of its methods throw.
 */
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { HistoricalEvent } from '../types/agent.js';
import { log } from '../utils/logger.js';

export const RUN_SCHEMA = 'lobster-run-v1';

export interface RunMeta {
  task: string;
  url?: string;
  provider?: string;
  model?: string;
  profile?: string;
}

export interface RunStartRecord extends RunMeta {
  record_type: 'run_start';
  schema: string;
  run_id: string;
  started_at: string;
}

export interface RunEndRecord {
  record_type: 'run_end';
  ended_at: string;
  success: boolean;
  result: string;
  steps: number;
}

export interface RunSummary {
  runId: string;
  file: string;
  task: string;
  url?: string;
  provider?: string;
  model?: string;
  startedAt: string;
  endedAt?: string;
  success?: boolean;
  result?: string;
  steps: number;
  events: HistoricalEvent[];
}

/** Ambiguous prefix result from resolveRun — the prefix matched several runs. */
export interface AmbiguousRuns {
  ambiguous: string[];
}

export function getRunsDir(customDir?: string): string {
  return customDir || join(homedir(), '.lobster', 'runs');
}

function generateRunId(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  return `run-${stamp}-${randomBytes(2).toString('hex')}`;
}

export class RunRecorder {
  readonly runId: string = '';
  readonly file: string = '';
  private written = 0;
  private stepsWritten = 0;
  private disabled = false;
  private ended = false;

  constructor(meta: RunMeta, options?: { dir?: string }) {
    try {
      const dir = getRunsDir(options?.dir);
      mkdirSync(dir, { recursive: true });

      // 'wx' fails on an existing file, so an id collision retries
      // instead of interleaving two runs into one file.
      for (let attempt = 0; ; attempt++) {
        const runId = generateRunId();
        const file = join(dir, `${runId}.jsonl`);
        const start: RunStartRecord = {
          record_type: 'run_start',
          schema: RUN_SCHEMA,
          run_id: runId,
          started_at: new Date().toISOString(),
          task: meta.task,
          url: meta.url,
          provider: meta.provider,
          model: meta.model,
          profile: meta.profile || undefined,
        };
        try {
          writeFileSync(file, JSON.stringify(start) + '\n', { encoding: 'utf-8', flag: 'wx' });
          this.runId = runId;
          this.file = file;
          break;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'EEXIST' && attempt < 3) continue;
          throw err;
        }
      }
    } catch (err) {
      this.disabled = true;
      log.warn(`Run history disabled: ${err}`);
    }
  }

  /** Append any events beyond what has already been written. Never throws. */
  sync(history: HistoricalEvent[]): void {
    if (this.disabled || this.ended || !Array.isArray(history)) return;
    try {
      let lines = '';
      let steps = 0;
      for (let i = this.written; i < history.length; i++) {
        lines += JSON.stringify({ record_type: 'event', index: i, ...history[i] }) + '\n';
        if (history[i]?.type === 'step') steps++;
      }
      if (lines) {
        appendFileSync(this.file, lines, 'utf-8');
        this.written = history.length;
        this.stepsWritten += steps;
      }
    } catch (err) {
      this.disabled = true;
      log.warn(`Run history disabled mid-run: ${err}`);
    }
  }

  /** Write the run_end record. Never throws — result may be any value. */
  finish(outcome: { success: boolean; result: unknown; history?: HistoricalEvent[] }): void {
    if (this.disabled || this.ended) return;
    try {
      if (outcome.history) this.sync(outcome.history);
      this.ended = true;
      let resultText: string;
      if (typeof outcome.result === 'string') resultText = outcome.result;
      else {
        try { resultText = JSON.stringify(outcome.result) ?? ''; } catch { resultText = String(outcome.result); }
      }
      const end: RunEndRecord = {
        record_type: 'run_end',
        ended_at: new Date().toISOString(),
        success: !!outcome.success,
        result: resultText.slice(0, 2000),
        steps: this.stepsWritten,
      };
      appendFileSync(this.file, JSON.stringify(end) + '\n', 'utf-8');
    } catch {
      this.ended = true;
    }
  }
}

function parseRunFile(file: string): RunSummary | null {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return null;
  }

  let start: RunStartRecord | null = null;
  let end: RunEndRecord | null = null;
  const events: HistoricalEvent[] = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // tolerate a torn final line from a crashed run
    }
    if (record.record_type === 'run_start') start = record as unknown as RunStartRecord;
    else if (record.record_type === 'run_end') end = record as unknown as RunEndRecord;
    else if (record.record_type === 'event') {
      const { record_type: _rt, index: _i, ...event } = record;
      events.push(event as unknown as HistoricalEvent);
    }
  }

  // Skip structurally invalid files the same way unreadable ones are skipped
  if (!start || typeof start.run_id !== 'string' || typeof start.started_at !== 'string' || typeof start.task !== 'string') {
    return null;
  }

  return {
    runId: start.run_id,
    file,
    task: start.task,
    url: start.url,
    provider: start.provider,
    model: start.model,
    startedAt: start.started_at,
    endedAt: end?.ended_at,
    success: end?.success,
    result: end?.result,
    steps: events.filter((e) => e.type === 'step').length,
    events,
  };
}

/** All runs, newest first. Tolerates junk files and a missing/unreadable dir. */
export function listRuns(dir?: string): RunSummary[] {
  const runsDir = getRunsDir(dir);
  let entries;
  try {
    entries = readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const runs: RunSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const summary = parseRunFile(join(runsDir, entry.name));
    if (summary) runs.push(summary);
  }
  return runs.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}

/**
 * Resolve "last"/"latest", a full run id, or an unambiguous id prefix.
 * A prefix matching several runs returns { ambiguous: [...ids] } so the
 * caller can report candidates instead of silently picking one.
 */
export function resolveRun(idOrPrefix: string, dir?: string): RunSummary | AmbiguousRuns | null {
  if (!idOrPrefix) return null;
  const runs = listRuns(dir);
  if (runs.length === 0) return null;
  if (idOrPrefix === 'last' || idOrPrefix === 'latest') return runs[0];

  const exact = runs.find((r) => r.runId === idOrPrefix);
  if (exact) return exact;

  const matches = runs.filter((r) => r.runId.startsWith(idOrPrefix));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return { ambiguous: matches.map((m) => m.runId) };
  return null;
}

/** Delete all persisted runs. Returns how many files were removed. */
export function clearRuns(dir?: string): number {
  const runsDir = getRunsDir(dir);
  let entries;
  try {
    entries = readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    try {
      rmSync(join(runsDir, entry.name), { force: true });
      removed++;
    } catch {}
  }
  return removed;
}
