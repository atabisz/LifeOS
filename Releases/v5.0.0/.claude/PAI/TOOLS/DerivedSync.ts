#!/usr/bin/env bun
/**
 * DerivedSync.ts - Detect manual USER source edits and regenerate derived PAI artifacts.
 *
 * No-op runs are intentionally silent because filesystem watchers can fire often.
 */

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { homedir } from "os";

type SpawnReadable = ReadableStream<Uint8Array> | null;
type SpawnProcess = {
  stdout: SpawnReadable;
  stderr: SpawnReadable;
  exited: Promise<number>;
  kill: (signal?: string) => void;
};
type SpawnOptions = {
  stdout?: "pipe" | "ignore" | "inherit";
  stderr?: "pipe" | "ignore" | "inherit";
};

declare const Bun: {
  spawn: (cmd: string[], opts?: SpawnOptions) => SpawnProcess;
};

type StateFile = {
  fileHashes: Record<string, string>;
  lastRun: string;
};

type ActionKind = "telos-summary" | "pai-state";

type PlannedAction = {
  kind: ActionKind;
  cmd: string[];
  timeoutMs: number;
  triggeredBy: string[];
};

type ActionLog = {
  cmd: string;
  exit: number | null;
  ms: number;
};

type ActionResult = {
  log: ActionLog;
  ok: boolean;
  error?: string;
};

type JsonLogLine = {
  ts: string;
  changed: string[];
  actions: ActionLog[];
  dryRun: boolean;
  error?: string;
};

type RunSummary = {
  changed: string[];
  actions: ActionLog[];
  dryRun: boolean;
  ts: string;
};

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
const PAI_DIR = process.env.PAI_DIR || join(HOME, ".claude", "PAI");
const USER_DIR = join(PAI_DIR, "USER");
const TOOLS_DIR = join(PAI_DIR, "TOOLS");
const STATE_DIR = join(PAI_DIR, "MEMORY", "STATE");
const OBSERVABILITY_DIR = join(PAI_DIR, "MEMORY", "OBSERVABILITY");
const STATE_PATH = join(STATE_DIR, "derived-sync.json");
const LOCK_PATH = join(STATE_DIR, "derived-sync.lock");
const LOG_PATH = join(OBSERVABILITY_DIR, "derived-sync.jsonl");
const LOCK_STALE_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 30 * 1000;

// The TELOS/*.md files GenerateTelosSummary.ts actually reads to build
// PRINCIPAL_TELOS.md. Editing any of them must regenerate the summary. (This
// tree has no unified TELOS.md — the summary is assembled from these per-file
// sources, so keying the trigger on TELOS.md alone would never fire.)
const TELOS_SUMMARY_SOURCES = [
  "MISSION.md", "GOALS.md", "PROBLEMS.md", "STRATEGIES.md", "NARRATIVES.md",
  "CHALLENGES.md", "WRONG.md", "TRAUMAS.md", "MODELS.md",
] as const;

function usage(): string {
  return [
    "DerivedSync.ts",
    "  --dry-run  Print detected changes and planned actions, then exit without writes",
    "  --status   Print state-file age, watched-file count, and last run summary",
    "  --force    Treat every watched source as changed",
    "  --help     Print this help text",
  ].join("\n");
}

function sourcePath(...parts: string[]): string {
  return join(USER_DIR, ...parts);
}

function existingFile(path: string): string[] {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return [];
}

function existingMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const stat = statSync(dir);
  if (!stat.isDirectory()) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(dir, name))
    .filter((path) => {
      const stat = statSync(path);
      return stat.isFile();
    });
}

function isUnder(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(".." + sep);
}

function watchedSourceFiles(): string[] {
  const files = [
    ...existingFile(sourcePath("TELOS", "TELOS.md")),
    ...existingMarkdownFiles(sourcePath("TELOS", "IDEAL_STATE")),
    ...existingMarkdownFiles(sourcePath("TELOS", "CURRENT_STATE")),
    ...existingFile(sourcePath("TELOS", "METRICS.md")),
    // TELOS-summary source set — every file GenerateTelosSummary.ts reads, so an
    // edit to any of them regenerates PRINCIPAL_TELOS.md (see TELOS_SUMMARY_SOURCES).
    ...TELOS_SUMMARY_SOURCES.flatMap((name) => existingFile(sourcePath("TELOS", name))),
    ...existingFile(sourcePath("PRINCIPAL_IDENTITY.md")),
    ...existingFile(sourcePath("DA_IDENTITY.md")),
    ...existingFile(sourcePath("PROJECTS.md")),
    ...existingFile(sourcePath("CONTACTS.md")),
    ...existingFile(sourcePath("DEFINITIONS.md")),
  ];

  const unique = new Set<string>();
  files.forEach((file) => {
    if (!isUnder(file, sourcePath("Backups")) && !isUnder(file, sourcePath("Archive"))) {
      unique.add(file);
    }
  });

  // Loop prevention invariant: derived outputs are never in this structural watch list.
  unique.delete(join(USER_DIR, "TELOS", "PRINCIPAL_TELOS.md"));
  unique.delete(join(USER_DIR, "TELOS", "LIFEOS_STATE.json"));
  const sorted: string[] = [];
  unique.forEach((path) => sorted.push(path));
  return sorted.sort();
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function currentHashes(paths: string[]): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const path of paths) {
    hashes[path] = sha256(path);
  }
  return hashes;
}

function readState(): StateFile | null {
  if (!existsSync(STATE_PATH)) return null;
  const raw = readFileSync(STATE_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Partial<StateFile>;
  if (!parsed.fileHashes || typeof parsed.lastRun !== "string") {
    throw new Error(`invalid state file at ${STATE_PATH}`);
  }
  return { fileHashes: parsed.fileHashes, lastRun: parsed.lastRun };
}

function writeState(state: StateFile): void {
  mkdirSync(STATE_DIR, { recursive: true });
  // Atomic write: a SessionStart-hook timeout-kill (SIGTERM) or an overlapping
  // run must never leave a half-written state file the next run would fail to
  // JSON.parse. Write to a pid-scoped temp then rename (atomic on same volume).
  const tmp = `${STATE_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  renameSync(tmp, STATE_PATH);
}

function changedFiles(state: StateFile | null, hashes: Record<string, string>, force: boolean): string[] {
  const paths = Object.keys(hashes).sort();
  if (force) return paths;
  if (!state) return paths;
  return paths.filter((path) => state.fileHashes[path] !== hashes[path]);
}

const TELOS_SUMMARY_PATHS = new Set<string>([
  sourcePath("TELOS", "TELOS.md"),
  ...TELOS_SUMMARY_SOURCES.map((name) => sourcePath("TELOS", name)),
]);

function isTelosSource(path: string): boolean {
  return TELOS_SUMMARY_PATHS.has(path);
}

function isStateSource(path: string): boolean {
  return isUnder(path, join(USER_DIR, "TELOS", "IDEAL_STATE")) ||
         isUnder(path, join(USER_DIR, "TELOS", "CURRENT_STATE"));
}

function plannedActions(changed: string[]): PlannedAction[] {
  const actions: PlannedAction[] = [];
  const telosSources = changed.filter(isTelosSource);
  const stateSources = changed.filter(isStateSource);

  if (telosSources.length > 0) {
    actions.push({
      kind: "telos-summary",
      cmd: ["bun", join(TOOLS_DIR, "GenerateTelosSummary.ts")],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      triggeredBy: telosSources,
    });
  }

  if (stateSources.length > 0) {
    actions.push({
      kind: "pai-state",
      cmd: ["bun", join(TOOLS_DIR, "UpdatePaiState.ts")],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      triggeredBy: stateSources,
    });
  }

  return actions;
}

function shellCommand(cmd: string[]): string {
  return cmd.map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" ");
}

async function streamText(stream: SpawnReadable): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function runAction(action: PlannedAction): Promise<ActionResult> {
  const started = Date.now();
  // Propagate our resolved HOME to children: under Windows Pulse autostart the
  // ambient HOME is unset, and a child that only reads process.env.HOME (no
  // USERPROFILE/homedir fallback) would resolve the wrong tree. Passing HOME
  // explicitly hardens every action regardless of the child's own resolution.
  const proc = Bun.spawn(action.cmd, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
  }, action.timeoutMs);

  const stdoutPromise = streamText(proc.stdout);
  const stderrPromise = streamText(proc.stderr);
  const exit = await proc.exited;
  clearTimeout(timer);

  const stdout = await stdoutPromise;
  const stderr = await stderrPromise;
  const ms = Date.now() - started;
  const log = { cmd: shellCommand(action.cmd), exit, ms };
  if (timedOut) {
    const detail = stderr.trim() || stdout.trim() || "no child output";
    return { log, ok: false, error: `timeout after ${action.timeoutMs}ms for ${shellCommand(action.cmd)}: ${detail}` };
  }
  if (exit !== 0) {
    const detail = stderr.trim() || stdout.trim() || "no child output";
    return { log, ok: false, error: `exit ${exit} for ${shellCommand(action.cmd)} after ${ms}ms: ${detail}` };
  }
  return { log, ok: true };
}

function appendLog(line: JsonLogLine): void {
  mkdirSync(OBSERVABILITY_DIR, { recursive: true });
  appendFileSync(LOG_PATH, JSON.stringify(line) + "\n");
}

function acquireLock(): boolean {
  mkdirSync(STATE_DIR, { recursive: true });
  try {
    writeFileSync(LOCK_PATH, `${process.pid}\n${new Date().toISOString()}\n`, { flag: "wx" });
    return true;
  } catch (err) {
    if (!existsSync(LOCK_PATH)) return false;
    const ageMs = Date.now() - statSync(LOCK_PATH).mtimeMs;
    if (ageMs <= LOCK_STALE_MS) return false;
    rmSync(LOCK_PATH, { force: true });
    writeFileSync(LOCK_PATH, `${process.pid}\n${new Date().toISOString()}\n`, { flag: "wx" });
    return true;
  }
}

function releaseLock(): void {
  rmSync(LOCK_PATH, { force: true });
}

function printDryRun(changed: string[], actions: PlannedAction[]): void {
  console.log(`changed: ${changed.length}`);
  for (const path of changed) {
    console.log(`  ${path}`);
  }
  console.log(`planned actions: ${actions.length}`);
  for (const action of actions) {
    console.log(`  ${shellCommand(action.cmd)}`);
  }
}

function newestLogLine(): RunSummary | null {
  if (!existsSync(LOG_PATH)) return null;
  const lines = readFileSync(LOG_PATH, "utf-8").trim().split("\n").filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return null;
  return JSON.parse(last) as RunSummary;
}

function printStatus(): void {
  const state = readState();
  const watched = watchedSourceFiles();
  if (!state) {
    console.log(`state: missing at ${STATE_PATH}`);
  } else {
    const ageMs = Date.now() - Date.parse(state.lastRun);
    console.log(`state: ${STATE_PATH}`);
    console.log(`state age ms: ${Number.isFinite(ageMs) ? ageMs : "unknown"}`);
    console.log(`last run: ${state.lastRun}`);
  }
  console.log(`watched files: ${watched.length}`);
  const summary = newestLogLine();
  if (summary) {
    console.log(`last log: ${summary.ts} changed=${summary.changed.length} actions=${summary.actions.length} dryRun=${summary.dryRun}`);
  } else {
    console.log("last log: none");
  }
}

async function runSync(dryRun: boolean, force: boolean): Promise<number> {
  const state = readState();
  const watched = watchedSourceFiles();
  const hashes = currentHashes(watched);
  const changed = changedFiles(state, hashes, force);
  const actions = plannedActions(changed);

  if (dryRun) {
    printDryRun(changed, actions);
    return 0;
  }

  if (changed.length === 0) return 0;

  const actionLogs: ActionLog[] = [];
  const failedActionSources = new Set<string>();
  let hadFailure = false;

  for (const action of actions) {
    try {
      const result = await runAction(action);
      actionLogs.push(result.log);
      if (!result.ok) {
        hadFailure = true;
        for (const source of action.triggeredBy) {
          failedActionSources.add(source);
        }
        console.error(`[DerivedSync] action failed: ${result.error ?? "unknown action failure"}`);
      }
    } catch (err) {
      hadFailure = true;
      for (const source of action.triggeredBy) {
        failedActionSources.add(source);
      }
      const ms = 0;
      actionLogs.push({ cmd: shellCommand(action.cmd), exit: null, ms });
      console.error(`[DerivedSync] action failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const previousHashes = state?.fileHashes ?? {};
  const nextHashes: Record<string, string> = {};
  for (const path of watched) {
    if (failedActionSources.has(path)) {
      if (previousHashes[path]) nextHashes[path] = previousHashes[path];
    } else {
      nextHashes[path] = hashes[path];
    }
  }

  const lastRun = new Date().toISOString();
  writeState({ fileHashes: nextHashes, lastRun });
  appendLog({ ts: lastRun, changed, actions: actionLogs, dryRun: false });
  return hadFailure ? 1 : 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const allowed = new Set(["--dry-run", "--status", "--force", "--help"]);
  for (const arg of args) {
    if (!allowed.has(arg)) {
      console.error(usage());
      process.exit(2);
    }
  }

  if (args.includes("--help")) {
    console.log(usage());
    return;
  }

  if (args.includes("--status")) {
    printStatus();
    return;
  }

  if (!acquireLock()) return;
  let exitCode = 0;
  try {
    exitCode = await runSync(args.includes("--dry-run"), args.includes("--force"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendLog({ ts: new Date().toISOString(), changed: [], actions: [], dryRun: args.includes("--dry-run"), error: message });
    console.error(`[DerivedSync] Fatal: ${message}`);
    exitCode = 1;
  } finally {
    releaseLock();
  }
  process.exit(exitCode);
}

main();
