#!/usr/bin/env bun
/**
 * PAI Hook Launch-Parity Smoke Test  (Windows support plan — Step 2)  [LIVE, self-contained]
 *
 * Proves that every hook registered in a settings.json can actually be LAUNCHED
 * by the OS the way Claude Code launches it — the one thing the installer's own
 * `validate.ts` does NOT check (it uses `spawnSync(process.execPath, [hookPath])`,
 * which bypasses the settings.json command STRING and so can report green on a
 * machine where the real launch fails).
 *
 * The real launcher, established empirically on the live Windows box (2026-07-01):
 * Claude Code launches Windows hooks through a POSIX shell (Git Bash `sh`) that
 * EXPANDS `$HOME`, e.g. `"$HOME/.bun/bin/bun.exe" "$HOME/.claude/hooks/X.hook.ts"`.
 * `cmd.exe /c` does NOT expand `$HOME` — using it would produce a FALSE RED. So
 * this tool spawns via `sh -c`, correct on Windows (Git Bash), macOS, and Linux.
 *
 * SELF-CONTAINED variant for the live ~/.claude tree: the installer engine here
 * predates Step 1's normalization surface, so the per-OS normalizer + allowlist
 * collector are INLINED (behavior-faithful to
 * Releases/v5.0.0/.claude/PAI/PAI-Install/engine/actions.ts). This file imports
 * nothing from PAI-Install/engine. The repo copy (Tools/smoke-hook-launch.ts)
 * imports those from the release engine instead; keep the two in step by hand
 * until Step 4 regenerates the release from a canonical source.
 *
 * Verdicts, per hook:
 *   FIRED       — launched via `sh -c`, exited 0.
 *   RAN         — launched (interpreter + script found), exited nonzero/timeout.
 *                 Launch parity holds; behavior is out of scope here.
 *   LAUNCH-FAIL — the OS could not launch: a not-found/exec message in output,
 *                 or the resolved script file does not exist on disk.
 *   SKIPPED     — no launch surface: HTTP hook, or an entry the installer drops
 *                 on this OS (normalize returned null, e.g. a .sh hook, no bash).
 *
 * Exit code: nonzero iff >=1 LAUNCH-FAIL.
 *
 * Usage:
 *   bun PAI/TOOLS/smoke-hook-launch.ts                 # default: ~/.claude/settings.json
 *   bun PAI/TOOLS/smoke-hook-launch.ts --live          # explicit ~/.claude/settings.json
 *   bun PAI/TOOLS/smoke-hook-launch.ts --settings <path>
 *   bun PAI/TOOLS/smoke-hook-launch.ts --events UserPromptSubmit,PreToolUse
 *   bun PAI/TOOLS/smoke-hook-launch.ts --timeout 8000
 *   bun PAI/TOOLS/smoke-hook-launch.ts --self-test     # prove it can go RED
 */

import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname, basename } from "path";

// ─── Inlined normalizer surface (faithful to PAI-Install/engine/actions.ts) ──

type Platform = "darwin" | "linux" | "win32";
interface HookCommandToken { value: string; start: number }

/** Quote-aware tokenizer — identical semantics to actions.ts tokenizeCommand. */
function tokenizeCommand(command: string): HookCommandToken[] {
  const tokens: HookCommandToken[] = [];
  let index = 0;
  while (index < command.length) {
    while (index < command.length && /\s/.test(command[index])) index += 1;
    if (index >= command.length) break;
    const start = index;
    let inQuotes = false;
    while (index < command.length) {
      const char = command[index];
      if (char === '"') { inQuotes = !inQuotes; index += 1; continue; }
      if (!inQuotes && /\s/.test(char)) break;
      index += 1;
    }
    const raw = command.slice(start, index);
    const quoted = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
    tokens.push({ value: quoted ? raw.slice(1, -1) : raw, start });
  }
  return tokens;
}

function getCommandTokenBasename(tokenValue: string): string {
  return basename(tokenValue.replace(/\\/g, "/"));
}

// Script extensions the installer treats as launchable, plus .mjs/.cjs so a
// missing such hook is prechecked (not silently credited as RAN).
const SCRIPT_EXTENSIONS = [".hook.ts", ".ts", ".mts", ".cts", ".mjs", ".cjs", ".js", ".sh"];
function isScriptTokenValue(v: string): boolean {
  const lower = v.toLowerCase();
  return SCRIPT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function getWindowsBunInterpreter(bunPath?: string): string {
  if (!bunPath) return '"$HOME/.bun/bin/bun.exe"';
  const normalizedDir = dirname(bunPath).replace(/\\/g, "/").toLowerCase();
  if (normalizedDir.endsWith("/.bun/bin")) return '"$HOME/.bun/bin/bun.exe"';
  return `"${bunPath}"`;
}

function getCommandInterpreter(scriptTokenValue: string): "bash" | "bun" {
  const s = scriptTokenValue.toLowerCase();
  if (s.endsWith(".sh")) return "bash";
  return "bun";
}

/** Per-OS interpreter rewrite — faithful to actions.ts normalizeHookCommand. */
function normalizeHookCommand(
  command: string,
  opts: { platform: Platform; bunPath?: string; bashPath?: string | null; allowlist: Set<string> }
): string | null {
  const tokens = tokenizeCommand(command);
  const scriptToken = tokens.find((t) => opts.allowlist.has(getCommandTokenBasename(t.value)));
  if (!scriptToken) return command;
  const suffix = command.slice(scriptToken.start);
  const interpreter = getCommandInterpreter(scriptToken.value);
  if (opts.platform === "win32") {
    if (interpreter === "bash") {
      if (!opts.bashPath) return null;
      return `bash ${suffix}`;
    }
    return `${getWindowsBunInterpreter(opts.bunPath)} ${suffix}`;
  }
  if (scriptToken.start === 0) return command;
  return suffix;
}

/** Basename of the last script-extension token in a command (quote-aware). */
function getCommandBasename(command: string): string | null {
  const tokens = tokenizeCommand(command);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (isScriptTokenValue(tokens[i].value)) return getCommandTokenBasename(tokens[i].value);
  }
  return null;
}

/** Collect PAI-owned hook + statusLine script basenames — faithful to actions.ts. */
function collectHookAllowlist(settings: any): Set<string> {
  const allowlist = new Set<string>();
  const hooks = settings?.hooks;
  if (hooks && typeof hooks === "object") {
    for (const groups of Object.values(hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups as any[]) {
        for (const h of group?.hooks ?? []) {
          if (typeof h?.command === "string") {
            const b = getCommandBasename(h.command);
            if (b) allowlist.add(b);
          }
        }
      }
    }
  }
  if (typeof settings?.statusLine?.command === "string") {
    const b = getCommandBasename(settings.statusLine.command);
    if (b) allowlist.add(b);
  }
  return allowlist;
}

// ─── Smoke test ──────────────────────────────────────────────────────────

type Verdict = "FIRED" | "RAN" | "LAUNCH-FAIL" | "SKIPPED";
interface HookResult { event: string; label: string; verdict: Verdict; detail: string }

function parseArgs(argv: string[]) {
  const args = { live: false, selfTest: false, settings: "", events: [] as string[], timeout: 8000 };
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

function resolveBunPath(): string { return process.execPath; }

function resolveBashPath(): string | null {
  const probe = spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf-8", timeout: 4000 });
  const out = (probe.stdout || "").trim();
  return probe.status === 0 && out ? out : null;
}

function expandHome(s: string): string {
  return s.replace(/\$\{HOME\}/g, homedir()).replace(/\$HOME/g, homedir());
}

function resolveSettingsPath(args: ReturnType<typeof parseArgs>): string {
  if (args.settings) return args.settings;
  // Default AND --live both mean the live installed settings.json.
  return join(homedir(), ".claude", "settings.json");
}

interface CommandHook { event: string; command: string }

function enumerateHooks(settings: any, eventFilter: string[]): { commands: CommandHook[]; httpCount: number } {
  const commands: CommandHook[] = [];
  let httpCount = 0;
  const wanted = (ev: string) => eventFilter.length === 0 || eventFilter.includes(ev);
  const hooks = settings?.hooks ?? {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups) || !wanted(event)) continue;
    for (const group of groups as any[]) {
      for (const h of group?.hooks ?? []) {
        if (h?.type === "command" && typeof h.command === "string") commands.push({ event, command: h.command });
        else if (h?.type === "http" || h?.url) httpCount += 1;
      }
    }
  }
  if (settings?.statusLine?.command && wanted("statusLine")) {
    commands.push({ event: "statusLine", command: String(settings.statusLine.command) });
  }
  return { commands, httpCount };
}

function payloadForEvent(event: string): string {
  const base: Record<string, unknown> = { session_id: "pai-smoke-hook-launch", hook_event_name: event, cwd: process.cwd() };
  switch (event) {
    case "PreToolUse": Object.assign(base, { tool_name: "Bash", tool_input: { command: "echo pai-smoke" } }); break;
    case "PostToolUse": Object.assign(base, { tool_name: "Bash", tool_input: { command: "echo pai-smoke" }, tool_response: { stdout: "pai-smoke" } }); break;
    case "UserPromptSubmit": Object.assign(base, { prompt: "pai smoke launch test" }); break;
    case "SessionStart": Object.assign(base, { source: "startup" }); break;
    default: break;
  }
  return JSON.stringify(base);
}

const LAUNCH_FAIL_PATTERNS = [
  /command not found/i,
  /No such file or directory/i,
  /is not recognized as an internal or external command/i,
  /: not found/i,
  /cannot execute/i,
];

const SCRIPT_EXT_RX = /\.(hook\.ts|ts|mts|cts|mjs|cjs|js|sh)$/i;
function scriptTokenOf(command: string): string | null {
  const tokens = tokenizeCommand(command);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (SCRIPT_EXT_RX.test(tokens[i].value)) return tokens[i].value;
  }
  return null;
}

function launchOne(event: string, normalized: string, timeout: number): { verdict: Verdict; detail: string } {
  const token = scriptTokenOf(normalized);
  if (token) {
    const resolved = expandHome(token);
    if (!existsSync(resolved)) return { verdict: "LAUNCH-FAIL", detail: `script not found on disk: ${resolved}` };
  }
  const res = spawnSync("sh", ["-c", normalized], { input: payloadForEvent(event), encoding: "utf-8", timeout, env: { ...process.env } });
  const stderr = (res.stderr || "").toString();
  const stdout = (res.stdout || "").toString();
  const output = `${stderr}\n${stdout}`;
  if (res.error && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT") return { verdict: "RAN", detail: `launched; timed out at ${timeout}ms (launch parity holds)` };
  if (res.error) return { verdict: "LAUNCH-FAIL", detail: `spawn error: ${(res.error as Error).message}` };
  if (LAUNCH_FAIL_PATTERNS.some((rx) => rx.test(output))) return { verdict: "LAUNCH-FAIL", detail: `interpreter/command not launchable: ${output.trim().slice(0, 120) || `exit ${res.status}`}` };
  if (res.status === 0) return { verdict: "FIRED", detail: "launched via sh -c; exited 0" };
  return { verdict: "RAN", detail: `launched; exited ${res.status}${stderr.trim() ? ` (${stderr.trim().slice(0, 80)})` : ""}` };
}

function runSelfTest(): number {
  const broken = '"$HOME/.bun/bin/does-not-exist-bun.exe" $HOME/.claude/hooks/NoSuchHook.hook.ts';
  const { verdict, detail } = launchOne("PreToolUse", broken, 5000);
  const ok = verdict === "LAUNCH-FAIL";
  console.log(`SELF-TEST: broken command → ${verdict} (${detail})`);
  console.log(ok ? "SELF-TEST PASS: the tool can go RED." : "SELF-TEST FAIL: broken command did not fail.");
  return ok ? 0 : 1;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return runSelfTest();

  const platform = process.platform as Platform;
  const settingsPath = resolveSettingsPath(args);
  if (!existsSync(settingsPath)) { console.error(`settings.json not found: ${settingsPath}`); return 2; }

  let settings: any;
  try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")); }
  catch (e) { console.error(`settings.json is not valid JSON: ${(e as Error).message}`); return 2; }

  const allowlist = collectHookAllowlist(settings);
  const bunPath = resolveBunPath();
  const bashPath = resolveBashPath();
  const { commands, httpCount } = enumerateHooks(settings, args.events);

  console.log(`PAI hook launch-parity smoke test  [live, self-contained]`);
  console.log(`  settings : ${settingsPath}`);
  console.log(`  platform : ${platform}  |  launcher: sh -c  |  bun: ${bunPath}  |  bash: ${bashPath ?? "(none)"}`);
  console.log(`  hooks    : ${commands.length} command, ${httpCount} http (skipped)\n`);

  const results: HookResult[] = [];
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

  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
  console.log(pad("EVENT", 18) + pad("HOOK", 34) + "VERDICT");
  console.log("-".repeat(70));
  for (const r of results) {
    console.log(pad(r.event, 18) + pad(r.label, 34) + r.verdict);
    if (r.verdict === "LAUNCH-FAIL") console.log(`  └─ ${r.detail}`);
  }

  const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  const fired = count("FIRED"), ran = count("RAN"), failed = count("LAUNCH-FAIL"), skipped = count("SKIPPED");
  console.log("\n" + "-".repeat(70));
  console.log(`SUMMARY: ${fired} FIRED, ${ran} RAN, ${failed} LAUNCH-FAIL, ${skipped} SKIPPED  (+${httpCount} http)`);
  if (failed > 0) { console.log(`RESULT: FAIL — ${failed} hook(s) could not be launched on ${platform}.`); return 1; }
  console.log(`RESULT: PASS — every launchable hook fired or ran on ${platform}.`);
  return 0;
}

process.exit(main());
