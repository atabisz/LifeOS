#!/usr/bin/env bun
/**
 * DocIntegrity.hook.ts — Check cross-refs if system docs/hooks were modified
 *
 * PURPOSE:
 * Runs deterministic + inference-powered doc integrity checks when system
 * files (hooks, PAI docs, skills, components) were modified during the session.
 * Self-gating: returns instantly when no system files changed.
 *
 * Counts, timestamps, and semantic drift are auto-fixed by the handler. Broken
 * cross-references it can DETECT but not auto-fix (a renamed hook, a dead doc
 * link) are surfaced back to the model via `hookSpecificOutput.additionalContext`
 * so they get corrected this turn instead of scrolling past in stderr. (R3)
 *
 * TRIGGER: Stop
 *
 * SYNC (NOT async): `additionalContext` on a Stop hook is only honored when the
 * hook runs synchronously — async Stop-hook stdout is fire-and-forget and
 * ignored by the harness. The settings.json entry MUST NOT set `async: true`.
 *
 * LOOP GUARD: the harness provides no `stop_hook_active` input field, so this
 * hook must self-guard. It writes a marker keyed on session_id + a hash of the
 * current drift set; if the same drift was already injected this session it
 * stays silent (exit 0, no context). A given drift-set is therefore injected at
 * most once — the turn converges even if the model doesn't fix the drift.
 *
 * NEEDS TRANSCRIPT: Yes (to detect which files were modified via tool_use entries)
 *
 * HANDLER: handlers/DocCrossRefIntegrity.ts
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { readHookInput, parseTranscriptFromInput } from './lib/hook-io';
import { handleDocCrossRefIntegrity } from './handlers/DocCrossRefIntegrity';
import { handleRebuildArchSummary } from './handlers/RebuildArchSummary';
import { getClaudeDir } from './lib/paths';
import type { DriftItem } from './handlers/DocCrossRefIntegrity';

const TAG = '[DocIntegrity]';

/** Stable signature of a drift set — order-independent. */
function driftSignature(drift: DriftItem[]): string {
  return drift
    .map(d => `${d.doc}|${d.pattern}|${d.reference}`)
    .sort()
    .join('\n');
}

/**
 * Loop guard. Returns true if this exact (session, drift-set) was already
 * injected. Records it as a side effect so the next identical call is silent.
 * Fail-open on any IO error (better to risk one extra inject than to crash the
 * Stop hook), but the marker write is what makes repeats converge.
 */
function alreadyInjected(sessionId: string, signature: string): boolean {
  try {
    const dir = join(getClaudeDir(), 'PAI', 'MEMORY', 'STATE');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const marker = join(dir, '.docintegrity-injected.json');

    let seen: Record<string, string> = {};
    if (existsSync(marker)) {
      try { seen = JSON.parse(readFileSync(marker, 'utf-8')); } catch { seen = {}; }
    }

    if (seen[sessionId] === signature) return true;

    seen[sessionId] = signature;
    writeFileSync(marker, JSON.stringify(seen));
    return false;
  } catch (err) {
    console.error(`${TAG} loop-guard IO error (continuing):`, err);
    return false;
  }
}

async function main() {
  const input = await readHookInput();
  if (!input) { process.exit(0); }

  const parsed = await parseTranscriptFromInput(input);

  let drift: DriftItem[] = [];
  try {
    drift = await handleDocCrossRefIntegrity(parsed, input);
  } catch (err) {
    console.error(`${TAG} Cross-ref handler failed:`, err);
  }

  try {
    await handleRebuildArchSummary();
  } catch (err) {
    console.error(`${TAG} Arch-summary handler failed:`, err);
  }

  // Surface un-auto-fixable drift to the model — once per (session, drift-set).
  if (drift.length > 0) {
    const signature = driftSignature(drift);
    if (!alreadyInjected(input.session_id, signature)) {
      const lines = drift.map(d => `  - ${d.doc}: ${d.issue}`).join('\n');
      const context =
        `Documentation cross-reference drift was detected and could NOT be auto-fixed ` +
        `(counts and timestamps were corrected automatically; these broken references need a real edit):\n${lines}\n` +
        `Fix each broken reference, or confirm the doc should change, before ending the turn.`;
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'Stop',
          additionalContext: context,
        },
      }));
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`${TAG} Fatal:`, err);
  process.exit(0);
});
