#!/usr/bin/env bun
/**
 * PAI Hook Launch-Parity Smoke Test  (Windows support plan — Step 2)
 *
 * Proves that every hook registered in a settings.json can actually be LAUNCHED
 * by the OS the way Claude Code launches it — the one thing the installer's own
 * `validate.ts` does NOT check.
 *
 * The false green it replaces: `validate.ts` smoke-tests hooks with
 * `spawnSync(process.execPath, [hookPath])` — it hands the SCRIPT PATH straight
 * to the bun binary, bypassing the settings.json command STRING entirely. That
 * always succeeds, even on a machine where the real command string (interpreter
 * prefix, `$HOME` expansion, exec-bit/shebang) fails to launch. This tool tests
 * the command STRING through the REAL launcher instead.
 *
 * The real launcher, established empirically on the live Windows box (2026-07-01):
 * Claude Code launches Windows hooks through a POSIX shell (Git Bash `sh`) that
 * EXPANDS `$HOME`, e.g. `"$HOME/.bun/bin/bun.exe" "$HOME/.claude/hooks/X.hook.ts"`.
 * `cmd.exe /c` does NOT expand `$HOME` — using it would produce a FALSE RED (the
 * mirror of validate.ts's false green). So this tool spawns via `sh -c`, which is
 * correct on Windows (Git Bash), macOS, and Linux alike.
 *
 * To test the EXACT string the installer writes, it imports the installer's own
 * `normalizeHookCommand` / `collectHookAllowlist` rather than reimplementing the
 * per-OS interpreter rewrite.
 *
 * Verdicts, per hook:
 *   FIRED       — launched via `sh -c`, exited 0.
 *   RAN         — launched (interpreter + script both found), exited nonzero or
 *                 timed out. Launch parity holds; behavior is out of scope here.
 *   LAUNCH-FAIL — the OS could not launch the command string: interpreter not
 *                 found (exit 127 / "No such file" / "not recognized"), or the
 *                 resolved script file does not exist on disk.
 *   SKIPPED     — no launch surface: HTTP hook (type:http), or an entry the
 *                 installer drops on this OS (normalize returned null, e.g. a
 *                 .sh hook with no bash on Windows).
 *
 * Exit code: nonzero iff >=1 LAUNCH-FAIL. Otherwise 0.
 *
 * Usage:
 *   bun Tools/smoke-hook-launch.ts                 # default release settings.json
 *   bun Tools/smoke-hook-launch.ts --live          # ~/.claude/settings.json (the installed tree)
 *   bun Tools/smoke-hook-launch.ts --settings <path>
 *   bun Tools/smoke-hook-launch.ts --events UserPromptSubmit,PreToolUse   # only these events
 *   bun Tools/smoke-hook-launch.ts --timeout 8000  # per-hook launch timeout (ms)
 *   bun Tools/smoke-hook-launch.ts --self-test     # prove the tool can go RED (synthetic broken hook)
 */

import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname, basename } from "path";

import {
  normalizeHookCommand,
  collectHookAllowlist,
} from "../Releases/v5.0.0/.claude/PAI/PAI-Install/engine/actions";

type Verdict = "FIRED" | "RAN" | "LAUNCH-FAIL" | "SKIPPED";

interface HookResult {
  event: string;
  label: string; // script basename, or a synthetic label
  verdict: Verdict;
  detail: string;
}

type Platform = "darwin" | "linux" | "win32";

// ---- args ---------------------------------------------------------------

function parseArgs(argv: string[]) {
  const args = {
    live: false,
    selfTest: false,
    settings: "",
    events: [] as string[],
    timeout: 8000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--live") args.live = true;
    else if (a === "--self-test") args.selfTest = true;
    else if (a === "--settings") args.settings = argv[++i] ?? "";
    else if (a === "--events") args.events = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--timeout") args.timeout = Number(argv[++i] ?? "8000") || 8000;
  }
  return args;
}

// ---- environment resolution --------------------------------------------

/** The bun interpreter path. Under `bun`, process.execPath IS the bun binary. */
function resolveBunPath(): string {
  return process.execPath;
}

/** Whether bash resolves on this machine — controls whether .sh hooks are kept on win32. */
function resolveBashPath(): string | null {
  const probe = spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf-8", timeout: 4000 });
  const out = (probe.stdout || "").trim();
  return probe.status === 0 && out ? out : null;
}

/** Expand $HOME / ${HOME} the way the launching POSIX shell would, for the on-disk existence check.
 *  MUST prefer process.env.HOME: the `sh -c` launcher (below) expands $HOME from the environment,
 *  and CI stages the release under a scratch `HOME=$SCRATCH`. os.homedir() reads USERPROFILE on
 *  Windows (e.g. C:\Users\runneradmin), NOT $HOME — using it makes the static precheck look in a
 *  different directory than where the hooks are staged, producing false "script not found"
 *  LAUNCH-FAILs. Fall back to USERPROFILE then homedir() only when HOME is unset (portable chain).
 *
 *  HOME-unset is made LOUD, not silent: a POSIX shell with HOME unset expands `$HOME` to the
 *  EMPTY string, not to USERPROFILE — so if this tool silently fell back to USERPROFILE while the
 *  `sh -c` launcher used empty, the precheck and the launcher would diverge again (the exact
 *  false-green class the process.env.HOME fix closed). We warn once so that divergence can never
 *  be silent for a release-integrity harness. */
let warnedHomeUnset = false;
function homeDir(): string {
  if (process.env.HOME) return process.env.HOME;
  if (!warnedHomeUnset) {
    warnedHomeUnset = true;
    console.warn(
      "WARNING: $HOME is unset. The `sh -c` launcher expands $HOME to empty here, but this " +
      "precheck falls back to USERPROFILE/homedir — results may diverge from the real launcher. " +
      "Set HOME to match your launch environment for a faithful smoke test.",
    );
  }
  return process.env.USERPROFILE ?? homedir();
}
function expandHome(s: string): string {
  return s.replace(/\$\{HOME\}/g, homeDir()).replace(/\$HOME/g, homeDir());
}

// ---- settings enumeration ----------------------------------------------

function resolveSettingsPath(args: ReturnType<typeof parseArgs>): string {
  if (args.settings) return args.settings;
  // Use homeDir() (env $HOME first), NOT homedir(): --live must read settings from the SAME home
  // the precheck resolves hook script paths against, else on a box where $HOME != USERPROFILE the
  // two diverge — settings from one home, hook-existence checks against another (Cato finding).
  if (args.live) return join(homeDir(), ".claude", "settings.json");
  // Default: the release snapshot this tool ships alongside.
  return join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "Releases", "v5.0.0", ".claude", "settings.json");
}

interface CommandHook {
  event: string;
  command: string;
}

/** Every type:command hook across all events, plus statusLine.command. HTTP hooks are returned separately. */
function enumerateHooks(settings: any, eventFilter: string[]): { commands: CommandHook[]; httpCount: number } {
  const commands: CommandHook[] = [];
  let httpCount = 0;
  const wanted = (ev: string) => eventFilter.length === 0 || eventFilter.includes(ev);

  const hooks = settings?.hooks ?? {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups) || !wanted(event)) continue;
    for (const group of groups as any[]) {
      for (const h of group?.hooks ?? []) {
        if (h?.type === "command" && typeof h.command === "string") {
          commands.push({ event, command: h.command });
        } else if (h?.type === "http" || h?.url) {
          httpCount += 1;
        }
      }
    }
  }

  if (settings?.statusLine?.command && wanted("statusLine")) {
    commands.push({ event: "statusLine", command: String(settings.statusLine.command) });
  }
  return { commands, httpCount };
}

// ---- synthetic payloads -------------------------------------------------

function payloadForEvent(event: string): string {
  const base: Record<string, unknown> = {
    session_id: "pai-smoke-hook-launch",
    hook_event_name: event,
    cwd: process.cwd(),
  };
  switch (event) {
    case "PreToolUse":
      Object.assign(base, { tool_name: "Bash", tool_input: { command: "echo pai-smoke" } });
      break;
    case "PostToolUse":
      Object.assign(base, { tool_name: "Bash", tool_input: { command: "echo pai-smoke" }, tool_response: { stdout: "pai-smoke" } });
      break;
    case "UserPromptSubmit":
      Object.assign(base, { prompt: "pai smoke launch test" });
      break;
    case "SessionStart":
      Object.assign(base, { source: "startup" });
      break;
    default:
      break;
  }
  return JSON.stringify(base);
}

// ---- launch classification ---------------------------------------------

const LAUNCH_FAIL_PATTERNS = [
  /command not found/i,
  /No such file or directory/i,
  /is not recognized as an internal or external command/i,
  /: not found/i,
  /cannot execute/i,
];

/** Tokenize a command respecting double-quoted spans, matching the installer's tokenizer semantics.
 *  A naive `.split(/\s+/)` fragments quoted paths that contain spaces → false LAUNCH-FAIL. */
function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (!inQuotes && /\s/.test(ch)) {
      if (cur) { tokens.push(cur); cur = ""; }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

// Script extensions the installer treats as launchable (mirrors actions.ts SCRIPT_EXTENSIONS
// plus .mjs/.cjs). Omitting .mjs/.cjs here would skip the on-disk precheck for such a hook and
// let a missing-file hook slip to RAN instead of LAUNCH-FAIL — a false green.
const SCRIPT_EXT_RX = /\.(hook\.ts|ts|mts|cts|mjs|cjs|js|sh)$/i;

function scriptTokenOf(command: string): string | null {
  // Last token that looks like a script path (quote-aware).
  const tokens = tokenizeCommand(command);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (SCRIPT_EXT_RX.test(tokens[i])) return tokens[i];
  }
  return null;
}

function launchOne(event: string, normalized: string, timeout: number): { verdict: Verdict; detail: string } {
  // Static pre-check: does the resolved script file exist on disk?
  const token = scriptTokenOf(normalized);
  if (token) {
    const resolved = expandHome(token);
    if (!existsSync(resolved)) {
      return { verdict: "LAUNCH-FAIL", detail: `script not found on disk: ${resolved}` };
    }
  }

  // Dynamic: launch through the REAL launcher — a POSIX shell that expands $HOME.
  const res = spawnSync("sh", ["-c", normalized], {
    input: payloadForEvent(event),
    encoding: "utf-8",
    timeout,
    env: { ...process.env },
  });

  // Scan stdout+stderr together — a hook that logs a not-found message to stdout must not be
  // credited as launched (defense-in-depth for the fail-closed / not-found detection).
  const stderr = (res.stderr || "").toString();
  const stdout = (res.stdout || "").toString();
  const output = `${stderr}\n${stdout}`;

  if (res.error && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    return { verdict: "RAN", detail: `launched; timed out at ${timeout}ms (launch parity holds)` };
  }
  if (res.error) {
    return { verdict: "LAUNCH-FAIL", detail: `spawn error: ${(res.error as Error).message}` };
  }
  // Shell-level launch failure = a not-found/exec message in output. Bare exit 126/127/2 WITHOUT
  // such a message means the launched hook chose that code itself → RAN, not LAUNCH-FAIL. The
  // real unlaunchable case (interpreter or script missing) is already caught by the on-disk
  // precheck above and produces a "No such file"/"not found" message here regardless.
  if (LAUNCH_FAIL_PATTERNS.some((rx) => rx.test(output))) {
    return { verdict: "LAUNCH-FAIL", detail: `interpreter/command not launchable: ${output.trim().slice(0, 120) || `exit ${res.status}`}` };
  }
  if (res.status === 0) {
    return { verdict: "FIRED", detail: "launched via sh -c; exited 0" };
  }
  return { verdict: "RAN", detail: `launched; exited ${res.status}${stderr.trim() ? ` (${stderr.trim().slice(0, 80)})` : ""}` };
}

// ---- self-test ----------------------------------------------------------

/** Antecedent proof (ISC-16): a deliberately broken command string MUST yield LAUNCH-FAIL. */
function runSelfTest(): number {
  const broken = "\"$HOME/.bun/bin/does-not-exist-bun.exe\" $HOME/.claude/hooks/NoSuchHook.hook.ts";
  const { verdict, detail } = launchOne("PreToolUse", broken, 5000);
  const ok = verdict === "LAUNCH-FAIL";
  console.log(`SELF-TEST: broken command → ${verdict} (${detail})`);
  console.log(ok ? "SELF-TEST PASS: the tool can go RED." : "SELF-TEST FAIL: broken command did not fail.");
  return ok ? 0 : 1;
}

// ---- main ---------------------------------------------------------------

function main(): number {
  const args = parseArgs(process.argv.slice(2));

  if (args.selfTest) return runSelfTest();

  const platform = process.platform as Platform;
  const settingsPath = resolveSettingsPath(args);
  if (!existsSync(settingsPath)) {
    console.error(`settings.json not found: ${settingsPath}`);
    return 2;
  }

  let settings: any;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch (e) {
    console.error(`settings.json is not valid JSON: ${(e as Error).message}`);
    return 2;
  }

  const allowlist = collectHookAllowlist(settings);
  const bunPath = resolveBunPath();
  const bashPath = resolveBashPath();
  const { commands, httpCount } = enumerateHooks(settings, args.events);

  console.log(`PAI hook launch-parity smoke test`);
  console.log(`  settings : ${settingsPath}`);
  console.log(`  platform : ${platform}  |  launcher: sh -c  |  bun: ${bunPath}  |  bash: ${bashPath ?? "(none)"}`);
  console.log(`  hooks    : ${commands.length} command, ${httpCount} http (skipped)\n`);

  const results: HookResult[] = [];

  for (let i = 0; i < httpCount; i += 1) {
    // http hooks have no local launch surface — counted, reported once in summary.
  }

  for (const { event, command } of commands) {
    const normalized = normalizeHookCommand(command, { platform, bunPath, bashPath, allowlist });
    if (normalized === null) {
      results.push({ event, label: scriptTokenOf(command) ? basename(expandHome(scriptTokenOf(command)!)) : "(dropped)", verdict: "SKIPPED", detail: "installer drops this hook on this OS (no interpreter available)" });
      continue;
    }
    const token = scriptTokenOf(normalized);
    const label = token ? basename(expandHome(token)) : "(inline)";
    const { verdict, detail } = launchOne(event, normalized, args.timeout);
    results.push({ event, label, verdict, detail });
  }

  // ---- report ----------------------------------------------------------
  const pad = (s: string, n: number) => s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
  console.log(pad("EVENT", 18) + pad("HOOK", 34) + "VERDICT");
  console.log("-".repeat(70));
  for (const r of results) {
    console.log(pad(r.event, 18) + pad(r.label, 34) + r.verdict);
    if (r.verdict === "LAUNCH-FAIL") console.log(`  └─ ${r.detail}`);
  }

  const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  const fired = count("FIRED");
  const ran = count("RAN");
  const failed = count("LAUNCH-FAIL");
  const skipped = count("SKIPPED");

  console.log("\n" + "-".repeat(70));
  console.log(`SUMMARY: ${fired} FIRED, ${ran} RAN, ${failed} LAUNCH-FAIL, ${skipped} SKIPPED  (+${httpCount} http)`);
  if (failed > 0) {
    console.log(`RESULT: FAIL — ${failed} hook(s) could not be launched on ${platform}.`);
    return 1;
  }
  console.log(`RESULT: PASS — every launchable hook fired or ran on ${platform}.`);
  return 0;
}

process.exit(main());
