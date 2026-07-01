#!/usr/bin/env bun
/**
 * FormatEnforcer.hook.ts — MessageDisplay event tracer (v1: trace-only)
 *
 * TRIGGER: MessageDisplay (Claude Code v2.1.x+)
 *   Fires while assistant message text is displayed. Hooks can inspect or
 *   transform `hookSpecificOutput.displayContent`.
 *
 * v1 SCOPE — passthrough trace only:
 *   - Read MessageDisplay event from stdin
 *   - Log a compact summary to MEMORY/OBSERVABILITY/message-display.jsonl
 *   - Emit empty stdout (no transformation, no `hookSpecificOutput`)
 *   - Exit 0 on any error (never block display)
 *
 * v2 (future) WILL enforce:
 *   - Algorithm-mode SUMMARY block presence (last visible line is `🗣️ {DA}: …`)
 *   - NATIVE-mode banner integrity
 *   - Secret redaction in tool-result echoes
 *
 * Build it cautiously — this hook runs on every assistant message. A bug here
 * degrades all output. v1 is intentionally trace-only so we can verify the
 * Claude Code event surface (field names, payload shape, latency) before
 * adding any transformation logic.
 *
 * REFERENCE: PAI/DOCUMENTATION/Hooks/HookSystem.md (event table)
 */

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { paiPath } from './lib/paths';
import { getISOTimestamp } from './lib/time';

const OBS_DIR = paiPath('MEMORY', 'OBSERVABILITY');
const LOG_FILE = join(OBS_DIR, 'message-display.jsonl');

interface MessageDisplayInput {
  session_id?: string;
  hook_event_name?: string;
  turn_id?: string;
  message_id?: string;
  index?: number;
  final?: boolean;
  // The displayed message text. Verified against the live event surface
  // (2026-06-17): content arrives in top-level `delta`, NOT the
  // `hookSpecificOutput.displayContent` field the early docs implied.
  delta?: string;
  // Forward-compatibility: capture any unexpected top-level fields too.
  [key: string]: unknown;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data), 2000);
    process.stdin.on('data', (c) => { data += c.toString(); });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(data); });
  });
}

function summarize(content: string | undefined): {
  length: number;
  last_line: string | null;
  has_summary_block: boolean;
  has_native_banner: boolean;
  has_voice_line: boolean;
} {
  if (!content) {
    return { length: 0, last_line: null, has_summary_block: false, has_native_banner: false, has_voice_line: false };
  }
  const lines = content.split(/\r?\n/);
  const nonBlank = lines.filter(l => l.trim().length > 0);
  const last_line = nonBlank.length > 0 ? nonBlank[nonBlank.length - 1] : null;
  return {
    length: content.length,
    last_line: last_line ? last_line.slice(0, 200) : null,
    has_summary_block: content.includes('━━━ 📃 SUMMARY ━━━'),
    has_native_banner: content.includes('PAI | NATIVE MODE'),
    has_voice_line: /^🗣️ /m.test(content) || /\n🗣️ /.test(content),
  };
}

async function main() {
  try {
    const raw = await readStdin();
    if (!raw.trim()) {
      // No input — nothing to log, nothing to transform.
      process.exit(0);
    }

    let payload: MessageDisplayInput;
    try {
      payload = JSON.parse(raw);
    } catch {
      // Malformed JSON — log nothing, fail open.
      process.exit(0);
    }

    if (!existsSync(OBS_DIR)) mkdirSync(OBS_DIR, { recursive: true });

    // Only log finalized messages — streaming deltas (final !== true) would
    // log partial fragments on every chunk. One entry per displayed message.
    if (payload.final !== true) process.exit(0);

    const summary = summarize(payload.delta);
    const entry = {
      timestamp: getISOTimestamp(),
      session_id: payload.session_id ?? null,
      event: payload.hook_event_name ?? 'MessageDisplay',
      message_id: payload.message_id ?? null,
      summary,
    };

    appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');

    // v1: passthrough — emit nothing. Claude Code displays the original content.
    process.exit(0);
  } catch {
    // Any unexpected error: fail open, never block display.
    process.exit(0);
  }
}

main();
