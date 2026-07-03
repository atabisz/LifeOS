#!/usr/bin/env bun
/**
 * VoiceQuestion.hook.ts — Speak aloud when Claude blocks for the user's input
 *
 * PURPOSE:
 * When Claude stops and waits for the user, the turn pauses on a tool-use —
 * which is NOT a Stop, so VoiceSummary.hook.ts (Stop) never fires. This hook
 * fills that gap for the two structured "stopped, come back" surfaces:
 *   - AskUserQuestion → speaks the pending question text.
 *   - ExitPlanMode    → announces a plan is ready for approval.
 * so the moment Claude needs a decision, the user hears it — screen or not.
 *
 * TRIGGER: PreToolUse (matcher: AskUserQuestion|ExitPlanMode)
 *
 * VOICE GATE: Main session only — subagents (CLAUDE_CODE_AGENT_TASK_ID set) stay silent.
 *
 * TIMING: Registered async:true in settings.json so a slow TTS round-trip
 * (Piper is ~5-10s) never delays the prompt from appearing.
 *
 * FAIL-SILENT: Any parse/network error still exits 0 — a voice hook must never
 * break or block the prompt.
 *
 * NOTE ON ExitPlanMode: its tool_input carries NO plan text (the tool reads the
 * plan from the plan file, per its schema), so we voice a fixed approval-ready
 * line rather than the plan body. A tool_input.plan fallback stays defensive
 * in case a future harness build provides one.
 */

const NOTIFY_URL = 'http://127.0.0.1:31337/notify'; // IPv4 explicit: localhost can resolve ::1 first on Windows
const MAIN_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel (daidentity.voices.main)

/**
 * Read stdin (the hook input JSON) with a short timeout. Returns '' on timeout.
 */
function readStdin(timeoutMs = 2000): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.on('data', (chunk) => { data += chunk.toString(); });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(data); });
  });
}

const PLAN_READY_MESSAGE = 'Claude has finished planning and is waiting for your approval to proceed.';

/**
 * Build the spoken line for whichever stop-surface fired. Branches on the
 * tool name so the proven AskUserQuestion path is untouched by the plan path.
 * Returns null if there is nothing speakable.
 */
function extractSpokenMessage(input: any): string | null {
  try {
    const tool = input?.tool_name;

    if (tool === 'ExitPlanMode') {
      // ExitPlanMode carries no plan text in tool_input (schema reads the plan
      // file). Voice a fixed line; fall back to a provided plan only if present.
      const plan = typeof input?.tool_input?.plan === 'string' ? input.tool_input.plan.trim() : '';
      return plan ? `Plan ready for approval. ${plan}` : PLAN_READY_MESSAGE;
    }

    // Default / AskUserQuestion: speak the first question (text, then header).
    const questions = input?.tool_input?.questions;
    if (!Array.isArray(questions) || questions.length === 0) return null;

    const q = questions[0];
    const text = typeof q?.question === 'string' ? q.question.trim() : '';
    const header = typeof q?.header === 'string' ? q.header.trim() : '';

    const body = text || header;
    if (!body) return null;

    // If there are multiple questions, say how many so the user knows to look.
    const prefix = questions.length > 1 ? `${questions.length} questions. First: ` : '';
    return `${prefix}${body}`;
  } catch {
    return null;
  }
}

/**
 * Voice gate: only the main interactive session speaks. Subagents spawned via
 * the Task tool have CLAUDE_CODE_AGENT_TASK_ID set.
 */
function isMainSession(): boolean {
  return !process.env.CLAUDE_CODE_AGENT_TASK_ID;
}

async function main() {
  if (!isMainSession()) process.exit(0);

  const raw = await readStdin();
  if (!raw.trim()) process.exit(0);

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.exit(0); // malformed payload — stay silent, never throw
  }

  const message = extractSpokenMessage(parsed);
  if (!message) process.exit(0);

  try {
    await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        voice_id: MAIN_VOICE_ID,
        voice_enabled: true,
      }),
      signal: AbortSignal.timeout(9000),
    });
  } catch (err) {
    console.error('[VoiceQuestion] Failed to send:', err);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[VoiceQuestion] Fatal:', err);
  process.exit(0);
});
