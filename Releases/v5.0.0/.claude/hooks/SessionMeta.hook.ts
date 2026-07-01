#!/usr/bin/env bun
/**
 * SessionMeta.hook.ts — SessionStart hookSpecificOutput emitter (H7+H8)
 *
 * TRIGGER: SessionStart
 *
 * Emits JSON containing two SessionStart Decision Control fields:
 *   - reloadSkills: re-scans .claude/skills/ when a sentinel file says a new
 *     skill was installed in the prior session (PAIUpgrade / CreateSkill flag).
 *   - sessionTitle: derived from active ISA slug (most recent non-completed
 *     MEMORY/WORK/ entry), or PRINCIPAL.NAME, or PAI default.
 *
 * SAFE BY CONSTRUCTION:
 *   - Runs in parallel with LoadContext.hook.ts; does NOT modify it.
 *   - Stdout = single JSON object (Claude Code SessionStart hook contract).
 *   - Any error → exit 0 silently with no output (CC ignores empty stdout).
 *   - Sentinel file is consumed (deleted) after read — one-shot per session start.
 *
 * SENTINEL FILE: ~/.claude/PAI/MEMORY/STATE/reload-skills.flag
 *   Touch this file from any workflow (e.g. PAIUpgrade after installing a new
 *   skill) to trigger reloadSkills on the very next SessionStart.
 *
 * REFERENCE: PAI/DOCUMENTATION/Hooks/HookSystem.md (SessionStart Decision Control fields)
 */

import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { paiPath } from './lib/paths';

interface SessionStartOutput {
  hookSpecificOutput?: {
    hookEventName: 'SessionStart';
    reloadSkills?: boolean;
    sessionTitle?: string;
  };
}

const SENTINEL_FILE = paiPath('MEMORY', 'STATE', 'reload-skills.flag');
const WORK_DIR = paiPath('MEMORY', 'WORK');

function shouldReloadSkills(): boolean {
  if (!existsSync(SENTINEL_FILE)) return false;
  try {
    unlinkSync(SENTINEL_FILE); // one-shot consume
  } catch { /* if delete fails, leave it; CC will reload next session too */ }
  return true;
}

/**
 * A work session counts as completed when its ISA.md front-matter sets
 * `phase: complete`. Missing/unreadable ISA → treated as NOT completed
 * (in-flight work should still title the window).
 */
function isCompleted(dir: string): boolean {
  const isaPath = join(dir, 'ISA.md');
  if (!existsSync(isaPath)) return false;
  try {
    const head = readFileSync(isaPath, 'utf8').slice(0, 2000);
    return /^phase:\s*complete\s*$/im.test(head);
  } catch {
    return false;
  }
}

function deriveSessionTitle(): string | null {
  // Subagents don't need a title.
  const isSubagent =
    (process.env.CLAUDE_PROJECT_DIR || '').includes('/.claude/Agents/') ||
    process.env.CLAUDE_AGENT_TYPE !== undefined;
  if (isSubagent) return null;

  if (!existsSync(WORK_DIR)) return null;

  try {
    const dirs = readdirSync(WORK_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^\d{8}-\d{6}_/.test(d.name))
      .map(d => d.name)
      .sort()
      .reverse();

    // Find the most recent non-completed work session, take its slug.
    // A session is "completed" when its ISA.md front-matter declares
    // `phase: complete` — skip those so finished work never sticks as the
    // title for every subsequent session.
    for (const dir of dirs.slice(0, 10)) {
      const m = dir.match(/^\d{8}-\d{6}_(.+)$/);
      if (!m) continue;
      if (isCompleted(join(WORK_DIR, dir))) continue;
      const slug = m[1];
      // Truncate to 40 chars for terminal title friendliness.
      return slug.length > 40 ? slug.slice(0, 37) + '...' : slug;
    }
  } catch {
    // fall through to null
  }
  return null;
}

async function main() {
  try {
    const out: SessionStartOutput = {};
    const fields: SessionStartOutput['hookSpecificOutput'] = {
      hookEventName: 'SessionStart',
    };

    if (shouldReloadSkills()) fields.reloadSkills = true;
    const title = deriveSessionTitle();
    if (title) fields.sessionTitle = title;

    // Only emit when there's an actual decision-control field beyond the
    // required hookEventName, otherwise stay silent (no-op).
    if (Object.keys(fields).length > 1) {
      out.hookSpecificOutput = fields;
      process.stdout.write(JSON.stringify(out));
    }
    // Empty payload → no output → CC treats as no-op.
    process.exit(0);
  } catch {
    // Defensive: any error → silent exit, never break session startup.
    process.exit(0);
  }
}

main();
