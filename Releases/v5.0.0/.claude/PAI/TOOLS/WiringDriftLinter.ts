#!/usr/bin/env bun
/**
 * WiringDriftLinter — standing settings.json ↔ hooks/ drift check.
 *
 * The portable PAI install shipped hook files without wiring them in
 * settings.json. Drift was being rediscovered by hand, one pair at a time —
 * a pattern flagged THREE times in algorithm-reflections.jsonl (L3-Q2/Q3,
 * L4-Q3). This tool turns that recurring hunt into one command.
 *
 * It lists `hooks/*.hook.ts`, extracts the hooks actually wired in
 * settings.json, and reports the orphans grouped by a known disposition
 * (seeded from the 2026-06-02 orphan-hook-sweep findings). An orphan with NO
 * recorded disposition is "undeclared drift" — the only condition that makes
 * this tool exit non-zero, so it's safe to run in CI as a gate.
 *
 * READ-ONLY: never writes settings.json, never wires or modifies a hook.
 *
 * Usage:  bun ~/.claude/PAI/TOOLS/WiringDriftLinter.ts
 * Exit:   0 = every orphan is declared; 1 = undeclared drift; 2 = setup error.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CLAUDE_DIR = join(homedir(), '.claude');
const HOOKS_DIR = join(CLAUDE_DIR, 'hooks');
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');

type Disposition =
  | 'wire-candidate'   // safe + useful, not yet wired — surface for a wiring decision
  | 'superseded'       // replaced by another wired hook
  | 'platform-no-op'   // doesn't apply on this OS (e.g. kitty-terminal on Windows)
  | 'unsafe'           // known to misbehave; needs a source fix before wiring
  | 'defer'            // semantics unclear or rarely fires
  | 'needs-user-decision'; // session-breaking risk — never auto-wire, ask each cycle

/**
 * Known dispositions for orphaned hooks, seeded from the orphan-hook-sweep ISA
 * (MEMORY/WORK/orphan-hook-sweep/ISA.md) and the wire-isasync-docintegrity work.
 * Keys are hook filenames (without path). Anything on disk + unwired + NOT here
 * is reported as undeclared drift.
 */
const DISPOSITIONS: Record<string, { disposition: Disposition; note: string }> = {
  'VoiceCompletion.hook.ts':        { disposition: 'defer',               note: 'HELD — double-announce risk vs Algorithm inline voice; needs dedup marker first' },
  'SessionAutoName.hook.ts':        { disposition: 'superseded',          note: 'replaced by PromptProcessing' },
  'UpdateTabTitle.hook.ts':         { disposition: 'superseded',          note: 'replaced by PromptProcessing' },
  'RatingCapture.hook.ts':          { disposition: 'superseded',          note: 'replaced by SatisfactionCapture' },
  'KittyEnvPersist.hook.ts':        { disposition: 'platform-no-op',      note: 'kitty terminal — N/A on Windows' },
  'SetQuestionTab.hook.ts':         { disposition: 'platform-no-op',      note: 'kitty terminal — N/A on Windows' },
  'ResponseTabReset.hook.ts':       { disposition: 'platform-no-op',      note: 'kitty terminal — N/A on Windows' },
  'FileChanged.hook.ts':            { disposition: 'unsafe',              note: 'EXIT 1 reading /dev/stdin on Windows — needs source fix (may be unblocked by CC v2.1.161)' },
  'FormatEnforcer.hook.ts':         { disposition: 'unsafe',              note: 'output-modifier — architecture-breaking' },
  'RestoreContext.hook.ts':         { disposition: 'defer',               note: 'semantics unclear / rarely fires' },
  'ElicitationHandler.hook.ts':     { disposition: 'defer',               note: 'semantics unclear / rarely fires' },
  'InstructionsLoadedHandler.hook.ts': { disposition: 'defer',            note: 'semantics unclear / rarely fires' },
  'ConfigAudit.hook.ts':            { disposition: 'defer',               note: 'semantics unclear / rarely fires' },
  'StopFailureHandler.hook.ts':     { disposition: 'defer',               note: 'semantics unclear / rarely fires' },
  'AgentExecutionGuard.hook.ts':    { disposition: 'defer',               note: 'semantics unclear / rarely fires' },
  'TeammateIdle.hook.ts':           { disposition: 'defer',               note: 'semantics unclear / rarely fires' },
  'ContainmentGuard.hook.ts':       { disposition: 'needs-user-decision', note: 'exit-2 blocking guard — session-breaking risk' },
  'TaskGovernance.hook.ts':         { disposition: 'needs-user-decision', note: 'exit-2 blocking guard — session-breaking risk' },
  'SkillGuard.hook.ts':             { disposition: 'needs-user-decision', note: 'advisory blocker — session-breaking risk' },
};

const GROUP_ORDER: Disposition[] = [
  'wire-candidate', 'needs-user-decision', 'unsafe', 'superseded', 'platform-no-op', 'defer',
];

function fail(msg: string): never {
  console.error(`✗ WiringDriftLinter: ${msg}`);
  process.exit(2);
}

/** Pull every wired hook filename out of settings.json by scanning command strings. */
function wiredHookFilenames(settingsRaw: string): Set<string> {
  let settings: unknown;
  try {
    settings = JSON.parse(settingsRaw);
  } catch (e) {
    fail(`settings.json is not valid JSON: ${(e as Error).message}`);
  }
  const wired = new Set<string>();
  // A hook is "wired" if its filename appears in any command string under hooks.*
  const text = JSON.stringify(settings);
  for (const m of text.matchAll(/([A-Za-z0-9_]+\.hook\.ts)/g)) {
    wired.add(m[1]);
  }
  return wired;
}

function main(): void {
  if (!existsSync(HOOKS_DIR)) fail(`hooks dir not found: ${HOOKS_DIR}`);
  if (!existsSync(SETTINGS_PATH)) fail(`settings.json not found: ${SETTINGS_PATH}`);

  const onDisk = readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.hook.ts')).sort();
  const wired = wiredHookFilenames(readFileSync(SETTINGS_PATH, 'utf-8'));

  const orphans = onDisk.filter((f) => !wired.has(f));
  const wiredCount = onDisk.length - orphans.length;

  // Group orphans by disposition; collect undeclared.
  const grouped: Record<string, string[]> = {};
  const undeclared: string[] = [];
  for (const o of orphans) {
    const d = DISPOSITIONS[o];
    if (!d) { undeclared.push(o); continue; }
    (grouped[d.disposition] ??= []).push(o);
  }

  // ── Report ──
  console.log('━━━ Hook Wiring Drift ━━━');
  console.log(`  on disk: ${onDisk.length}  |  wired: ${wiredCount}  |  orphaned: ${orphans.length}`);
  console.log('');

  for (const group of GROUP_ORDER) {
    const items = grouped[group];
    if (!items?.length) continue;
    console.log(`  [${group}] (${items.length})`);
    for (const f of items) console.log(`    • ${f} — ${DISPOSITIONS[f].note}`);
    console.log('');
  }

  if (undeclared.length) {
    console.log(`  ⚠️  UNDECLARED DRIFT (${undeclared.length}) — on disk, unwired, no recorded disposition:`);
    for (const f of undeclared) console.log(`    • ${f}`);
    console.log('');
    console.log('  → Triage each: add to DISPOSITIONS in WiringDriftLinter.ts, or wire it in settings.json.');
    process.exit(1);
  }

  console.log('  ✓ No undeclared drift — every orphan has a recorded disposition.');
  process.exit(0);
}

main();
