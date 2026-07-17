/**
 * Export persisted runs as ctx-history-jsonl-v1 — the public import format
 * of ctx (https://github.com/ctxrs/ctx), a local search CLI over past
 * agent sessions.
 *
 *   lobster history export | ctx import --format ctx-history-jsonl-v1 --path -
 *
 * Mapping:
 *   run                → session
 *   history event      → event   (step / observation / error)
 *   page navigation    → file_touch with the URL as the path, so
 *                        `ctx search --file <url>` recalls prior work on a site
 */
import { hostname } from 'node:os';
import type { AgentStepEvent, ObservationEvent, AgentErrorEvent } from '../types/agent.js';
import { getRunsDir, type RunSummary } from './store.js';

const CTX_SCHEMA = 'ctx-history-jsonl-v1';
const PROVIDER_KEY = 'lobster';

function sourceId(): string {
  // provider_key charset rules (and its 128-byte cap) also make a safe source id
  const host = hostname().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 64);
  return host || 'lobster-local';
}

/** Serialize runs to ctx-history-jsonl-v1. Returns JSONL text. */
export interface CtxExportOptions {
  dir?: string;
  /** Override the emitted source_id (ctx plugin mode passes CTX_HISTORY_SOURCE_ID). */
  sourceId?: string;
  /** Incremental checkpoint to emit as source.cursor.after (ISO started_at high-water mark). */
  cursorAfter?: string;
}

export function exportRunsToCtxJsonl(runs: RunSummary[], options?: CtxExportOptions): string {
  const src = options?.sourceId || sourceId();
  const lines: string[] = [];

  lines.push(JSON.stringify({
    record_type: 'manifest',
    schema_version: CTX_SCHEMA,
    metadata: { exporter: 'lobster-cli' },
  }));

  lines.push(JSON.stringify({
    record_type: 'source',
    source_id: src,
    provider_key: PROVIDER_KEY,
    source_format: 'lobster-run-v1',
    raw_source_path: getRunsDir(options?.dir),
    cursor: options?.cursorAfter ? {
      after: {
        stream: `${PROVIDER_KEY}:${src}`,
        cursor: options.cursorAfter,
        observed_at: new Date().toISOString(),
      },
    } : undefined,
  }));

  for (const run of runs) {
    lines.push(JSON.stringify({
      record_type: 'session',
      source_id: src,
      session_id: run.runId,
      started_at: run.startedAt,
      ended_at: run.endedAt,
      agent_type: 'primary',
      is_primary: true,
      status: run.success === undefined ? 'interrupted' : run.success ? 'completed' : 'failed',
      metadata: {
        kind: 'browser-agent',
        task: run.task,
        url: run.url,
        provider: run.provider,
        model: run.model,
        result: run.result,
      },
    }));

    let touchIndex = 0;
    let lastUrl = '';
    const touch = (url: string, occurredAt: string, eventIndex?: number) => {
      if (!url || url === lastUrl || url === 'about:blank') return;
      lastUrl = url;
      lines.push(JSON.stringify({
        record_type: 'file_touch',
        source_id: src,
        session_id: run.runId,
        touch_index: touchIndex++,
        event_index: eventIndex,
        path: url,
        confidence: 'high',
        occurred_at: occurredAt,
        metadata: { kind: 'page_visit' },
      }));
    };

    if (run.url) touch(run.url, run.startedAt);

    // ctx EventType is a closed enum, and ctx only makes message/summary/
    // tool_call events lexically searchable — via known payload keys
    // (text, command, tool, arguments_preview, status). So the mapping puts
    // every meaningful string in a searchable slot: the task as a user
    // message, each step as a tool_call whose `text` carries goal + action +
    // output, observations/errors as system messages, and the run outcome
    // as a summary. Extra keys (action, reflection, url) ride along for
    // fidelity — ctx ignores keys it does not know.
    let eventIndex = 0;
    const emit = (event_type: string, role: string, occurredAt: string, payload: unknown, preview: string): number => {
      const index = eventIndex++;
      lines.push(JSON.stringify({
        record_type: 'event',
        source_id: src,
        session_id: run.runId,
        event_index: index,
        occurred_at: occurredAt,
        event_type,
        role,
        payload,
        preview: preview.slice(0, 200),
      }));
      return index;
    };

    emit('message', 'user', run.startedAt, { text: run.task, url: run.url }, run.task);

    for (const event of run.events) {
      const occurredAt = event.occurredAt || run.startedAt;
      if (event.type === 'step') {
        const s = event as AgentStepEvent;
        const name = s.action?.name || 'action';
        const goal = s.reflection?.next_goal || '';
        const output = String(s.output ?? '').slice(0, 300);
        let argsPreview = '';
        try { argsPreview = JSON.stringify(s.action?.args ?? {}).slice(0, 120); } catch {}
        const text = `${goal ? goal + ' — ' : ''}${name}(${argsPreview}) → ${output}`;
        const callIndex = emit('tool_call', 'assistant', occurredAt, {
          tool: name,
          arguments_preview: argsPreview,
          text,
          action: s.action,
          reflection: s.reflection,
          url: s.url,
          duration: s.duration,
        }, text);
        touch(s.url || '', occurredAt, callIndex);
      } else if (event.type === 'observation') {
        const msg = String((event as ObservationEvent).message ?? '');
        emit('message', 'system', occurredAt, { text: msg }, msg);
      } else {
        const err = event as AgentErrorEvent;
        const msg = `Agent error at step ${err.step}: ${String(err.error ?? '')}`;
        emit('message', 'system', occurredAt, { text: msg }, msg);
      }
    }

    if (run.endedAt !== undefined || run.success !== undefined) {
      const outcome = `${run.success ? 'Success' : 'Failed'}: ${String(run.result ?? '')}`.slice(0, 2000);
      emit('summary', 'assistant', run.endedAt || run.startedAt, { text: outcome }, outcome);
    }
  }

  return lines.join('\n') + '\n';
}
