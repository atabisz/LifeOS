#!/usr/bin/env bun
/**
 * LifeOS Payload JSON Gate
 *
 * Two files decide the shape of every install:
 *   LifeOS/install/settings.system.json  — the settings body (env, permissions, model, …)
 *   LifeOS/install/hooks/hooks.json      — the hook registrations, merged in on top
 *
 * `InstallSettings.ts` writes the first to `~/.claude/settings.json`; `InstallHooks.ts` merges the
 * second into it. A stray comma in either breaks every install of the payload. Nothing checked
 * them: the launch-parity smoke tests exercise the *generated* fixture, so they only notice a
 * malformed source file indirectly, through whatever the generator happened to do with it.
 *
 * This gate checks them directly, and parse-checks every other tracked JSON file in the repo so a
 * broken `package.json` / `tsconfig.json` / fixture can't ride along unnoticed.
 *
 * Checks, per target:
 *   PARSE     — the file exists and `JSON.parse` succeeds (error message names file + reason).
 *   SHAPE     — composition invariants that make the two files mergeable (see below).
 *   REPORT    — the shape actually observed is printed, so a silent drop (an event that lost all
 *               its hooks, a settings body that shed half its keys) is visible in the CI log
 *               instead of passing quietly.
 *
 * Composition invariants asserted on the two canonical files:
 *   - settings.system.json is a JSON object with at least one key, and carries NO `hooks` key —
 *     hooks.json owns that surface. Both writing `hooks` would make the merge order decide the
 *     result silently.
 *   - hooks.json has a top-level `hooks` object with at least one event, each event an array of
 *     matcher groups, each group's `hooks` an array.
 *   - every hook entry is CLASSIFIED: either `type:"command"` with a non-empty string `command`,
 *     or an HTTP hook (`type:"http"` or a `url`). An unclassified entry is a violation — that is
 *     how a typo'd `type` becomes a hook that is registered but never launches.
 *
 * A target listed here but missing from disk is a VIOLATION, not a skip. (Same lesson as
 * Tools/validate-protected.ts: the quiet ✅ for an absent file is the worst failure mode a
 * manifest-driven checker has.)
 *
 * The nested self-copy at LifeOS/install/skills/LifeOS/install/settings.system.json is
 * deliberately PARSE-ONLY. It has diverged from the canonical file (32 keys vs 31) and that
 * divergence is a separately tracked item; asserting the composition invariants against it here
 * would conflate two problems. It still must parse.
 *
 * Usage:
 *   bun Tools/validate-payload-json.ts              # check the payload
 *   bun Tools/validate-payload-json.ts --self-test  # prove the gate can go RED
 *   bun Tools/validate-payload-json.ts --quiet      # violations only, no shape report
 *
 * Exit: 0 clean · 1 one or more violations · 2 usage / harness error.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { tmpdir } from "os";

const REPO_ROOT = join(import.meta.dir, "..");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const RESET = "\x1b[0m";

/** The two files whose SHAPE is asserted, not just parsed. */
const SETTINGS_SYSTEM = "LifeOS/install/settings.system.json";
const HOOKS_JSON = "LifeOS/install/hooks/hooks.json";

interface Violation {
  file: string;
  message: string;
}

// ---- helpers ------------------------------------------------------------

/**
 * Strip `//` and slash-star comments and trailing commas — the JSONC superset TypeScript accepts in
 * `tsconfig.json`. String-aware: a `//` inside a JSON string value (a URL, a path) must survive, or
 * this "fix" would corrupt the very files it is meant to validate.
 */
export function stripJsonc(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    const next = raw[i + 1];
    if (inLine) {
      if (c === "\n") { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") { inBlock = false; i += 1; }
      continue;
    }
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && next === "/") { inLine = true; i += 1; continue; }
    if (c === "/" && next === "*") { inBlock = true; i += 1; continue; }
    out += c;
  }
  // Trailing commas, now that comments are gone and strings are the only quoted spans left.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** `tsconfig.json` is JSONC by specification — TypeScript accepts comments there, and 6 of the
 *  repo's tracked tsconfigs use them. Parsing those strictly would fail files that are correct. */
function isJsonc(absPath: string): boolean {
  return /(^|[\\/])tsconfig(\.[^\\/]+)?\.json$/i.test(absPath);
}

/** Read + parse, or return the reason it failed. Never throws. */
function parseFile(absPath: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (!existsSync(absPath)) return { ok: false, reason: "file is missing from disk" };
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf-8");
  } catch (e) {
    return { ok: false, reason: `unreadable: ${(e as Error).message}` };
  }
  const jsonc = isJsonc(absPath);
  try {
    return { ok: true, value: JSON.parse(jsonc ? stripJsonc(raw) : raw) };
  } catch (e) {
    return { ok: false, reason: `invalid ${jsonc ? "JSONC" : "JSON"}: ${(e as Error).message}` };
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Every tracked *.json path, via `git ls-files`. No shell: a quoted glob passed through cmd.exe
 *  on Windows is taken LITERALLY, git matches nothing, and the gate reports "0 files checked, 0
 *  failures" — a green it never earned. Args array + pathspec, and an empty result is an ERROR. */
function trackedJsonFiles(): { ok: true; files: string[] } | { ok: false; reason: string } {
  const res = spawnSync("git", ["-C", REPO_ROOT, "ls-files", "--", "*.json"], {
    encoding: "utf-8",
    shell: false,
  });
  if (res.error) return { ok: false, reason: `git ls-files failed to launch: ${res.error.message}` };
  if (res.status !== 0) return { ok: false, reason: `git ls-files exited ${res.status}: ${(res.stderr || "").trim()}` };
  const files = (res.stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => !f.includes("node_modules/"));
  if (files.length === 0) return { ok: false, reason: "git ls-files returned no *.json paths — enumeration is broken, not clean" };
  return { ok: true, files };
}

// ---- shape checks -------------------------------------------------------

/** settings.system.json: object, non-empty, and MUST NOT carry `hooks` (hooks.json owns it). */
export function checkSettingsSystemShape(value: unknown): { violations: string[]; report: string } {
  const violations: string[] = [];
  if (!isPlainObject(value)) {
    return { violations: ["top level is not a JSON object"], report: "(unusable)" };
  }
  const keys = Object.keys(value);
  if (keys.length === 0) violations.push("top-level object is empty — a settings body with no keys installs nothing");
  if ("hooks" in value) {
    violations.push("carries a `hooks` key — hooks.json owns that surface; both writing it makes the merge order decide the result silently");
  }
  return { violations, report: `${keys.length} top-level keys, hooks key: ${"hooks" in value ? "PRESENT (violation)" : "absent (correct)"}` };
}

/** hooks.json: top-level `hooks` object; every entry classified as command or http. */
export function checkHooksJsonShape(value: unknown): { violations: string[]; report: string } {
  const violations: string[] = [];
  if (!isPlainObject(value)) {
    return { violations: ["top level is not a JSON object"], report: "(unusable)" };
  }
  const hooks = value.hooks;
  if (!isPlainObject(hooks)) {
    return { violations: ["missing a top-level `hooks` object"], report: "(unusable)" };
  }
  const events = Object.keys(hooks);
  if (events.length === 0) violations.push("`hooks` has no events — nothing would be registered");

  let command = 0;
  let http = 0;
  let entries = 0;
  const perEvent: string[] = [];

  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      violations.push(`event \`${event}\` is not an array of matcher groups`);
      continue;
    }
    let n = 0;
    for (const [gi, group] of groups.entries()) {
      if (!isPlainObject(group)) {
        violations.push(`event \`${event}\` group ${gi} is not an object`);
        continue;
      }
      const list = group.hooks;
      if (!Array.isArray(list)) {
        violations.push(`event \`${event}\` group ${gi} has no \`hooks\` array`);
        continue;
      }
      for (const [hi, entry] of list.entries()) {
        n += 1;
        entries += 1;
        const where = `event \`${event}\` group ${gi} hook ${hi}`;
        if (!isPlainObject(entry)) {
          violations.push(`${where} is not an object`);
          continue;
        }
        if (entry.type === "command") {
          if (typeof entry.command !== "string" || entry.command.trim() === "") {
            violations.push(`${where} is type:"command" but its \`command\` is not a non-empty string`);
          } else {
            command += 1;
          }
        } else if (entry.type === "http" || typeof entry.url === "string") {
          http += 1;
        } else {
          // A typo'd `type` here yields a hook that is registered but never launches.
          violations.push(`${where} is unclassified — neither type:"command" nor an http hook (type=${JSON.stringify(entry.type)})`);
        }
      }
    }
    if (n === 0) violations.push(`event \`${event}\` registers zero hooks`);
    perEvent.push(`${event}:${n}`);
  }

  return {
    violations,
    report: `${events.length} events, ${entries} entries (${command} command, ${http} http) — ${perEvent.join(" ")}`,
  };
}

// ---- main check ---------------------------------------------------------

function runChecks(quiet: boolean): number {
  const violations: Violation[] = [];
  const reports: string[] = [];

  // 1. The two canonical surfaces: parse + shape.
  const targets: { file: string; check: (v: unknown) => { violations: string[]; report: string } }[] = [
    { file: SETTINGS_SYSTEM, check: checkSettingsSystemShape },
    { file: HOOKS_JSON, check: checkHooksJsonShape },
  ];

  for (const { file, check } of targets) {
    const parsed = parseFile(join(REPO_ROOT, file));
    if (!parsed.ok) {
      violations.push({ file, message: parsed.reason });
      continue;
    }
    const { violations: shapeViolations, report } = check(parsed.value);
    for (const m of shapeViolations) violations.push({ file, message: m });
    reports.push(`${file}\n    ${report}`);
  }

  // 2. Every other tracked JSON: parse only. Includes the nested settings.system.json self-copy,
  //    which has diverged from the canonical file — parse is all this gate claims for it.
  const tracked = trackedJsonFiles();
  if (!tracked.ok) {
    console.error(`${RED}❌ enumeration error: ${tracked.reason}${RESET}`);
    return 2;
  }
  let parseOnly = 0;
  for (const file of tracked.files) {
    if (file === SETTINGS_SYSTEM || file === HOOKS_JSON) continue;
    const parsed = parseFile(join(REPO_ROOT, file));
    parseOnly += 1;
    if (!parsed.ok) violations.push({ file, message: parsed.reason });
  }

  if (!quiet) {
    console.log(`\n${BLUE}🔧 LifeOS Payload JSON Gate${RESET}\n`);
    console.log("=".repeat(60));
    console.log(`\n${YELLOW}Shape-checked (${targets.length}):${RESET}`);
    for (const r of reports) console.log(`  ${r}`);
    console.log(`\n${YELLOW}Parse-checked (${parseOnly} further tracked JSON files)${RESET}`);
    console.log("\n" + "=".repeat(60));
  }

  if (violations.length > 0) {
    console.log(`\n${RED}🚫 PAYLOAD JSON GATE FAILED — ${violations.length} violation(s)${RESET}\n`);
    for (const v of violations) {
      console.log(`${RED}❌${RESET} ${v.file}`);
      console.log(`   ${RED}→${RESET} ${v.message}`);
    }
    console.log(`\n${YELLOW}These files decide the shape of every install. Fix before pushing.${RESET}\n`);
    return 1;
  }

  console.log(`\n${GREEN}✅ Payload JSON valid — ${targets.length} shape-checked, ${parseOnly} parse-checked.${RESET}\n`);
  return 0;
}

// ---- self-test ----------------------------------------------------------

/**
 * Prove the gate can go RED. A gate that cannot fail is theatre — this is the same antecedent
 * proof `Tools/smoke-hook-launch.ts --self-test` provides for launch parity.
 *
 * Each case is a deliberate breakage that MUST be detected. Exit 0 means every one was caught.
 */
function runSelfTest(): number {
  const cases: { name: string; run: () => boolean }[] = [
    {
      name: "malformed JSON (trailing comma) is rejected by parseFile",
      run: () => {
        const dir = mkdtempSync(join(tmpdir(), "payload-json-selftest-"));
        try {
          const p = join(dir, "broken.json");
          writeFileSync(p, '{"a": 1,}');
          return parseFile(p).ok === false;
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: "missing file is rejected (not silently skipped)",
      run: () => parseFile(join(tmpdir(), "no-such-payload-file-xyz.json")).ok === false,
    },
    {
      name: "a tsconfig.json WITH comments parses (JSONC), and its values survive",
      run: () => {
        const dir = mkdtempSync(join(tmpdir(), "payload-json-selftest-"));
        try {
          const p = join(dir, "tsconfig.json");
          writeFileSync(p, '{\n  // leading comment\n  "compilerOptions": {\n    /* block */\n    "target": "esnext",\n  },\n}\n');
          const r = parseFile(p);
          return r.ok && (r.value as any)?.compilerOptions?.target === "esnext";
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: "a MALFORMED tsconfig.json is still rejected (JSONC is not a free pass)",
      run: () => {
        const dir = mkdtempSync(join(tmpdir(), "payload-json-selftest-"));
        try {
          const p = join(dir, "tsconfig.json");
          writeFileSync(p, '{ // comment\n  "compilerOptions": { "target" "esnext" } }');
          return parseFile(p).ok === false;
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: "stripJsonc preserves `//` INSIDE a string value (no silent corruption)",
      run: () => {
        const src = '{"url": "https://example.com/x", "note": "a /* not a comment */ b"}';
        const parsed = JSON.parse(stripJsonc(src));
        return parsed.url === "https://example.com/x" && parsed.note === "a /* not a comment */ b";
      },
    },
    {
      name: "a plain .json file with comments is STILL rejected (JSONC is tsconfig-only)",
      run: () => {
        const dir = mkdtempSync(join(tmpdir(), "payload-json-selftest-"));
        try {
          const p = join(dir, "settings.json");
          writeFileSync(p, '{ // nope\n "a": 1 }');
          return parseFile(p).ok === false;
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: "settings.system.json carrying a `hooks` key is a violation",
      run: () => checkSettingsSystemShape({ model: "x", hooks: {} }).violations.length > 0,
    },
    {
      name: "empty settings object is a violation",
      run: () => checkSettingsSystemShape({}).violations.length > 0,
    },
    {
      name: "a valid settings body passes",
      run: () => checkSettingsSystemShape({ model: "x", env: {} }).violations.length === 0,
    },
    {
      name: "hooks.json without a top-level `hooks` object is a violation",
      run: () => checkHooksJsonShape({ notHooks: {} }).violations.length > 0,
    },
    {
      name: 'a type:"command" entry with an empty command is a violation',
      run: () =>
        checkHooksJsonShape({ hooks: { Stop: [{ matcher: "*", hooks: [{ type: "command", command: "  " }] }] } })
          .violations.length > 0,
    },
    {
      name: "an unclassified entry (typo'd type) is a violation",
      run: () =>
        checkHooksJsonShape({ hooks: { Stop: [{ matcher: "*", hooks: [{ type: "commnad", command: "x" }] }] } })
          .violations.length > 0,
    },
    {
      name: "an event registering zero hooks is a violation",
      run: () => checkHooksJsonShape({ hooks: { Stop: [{ matcher: "*", hooks: [] }] } }).violations.length > 0,
    },
    {
      name: "a valid hooks body passes",
      run: () =>
        checkHooksJsonShape({
          hooks: {
            Stop: [{ matcher: "*", hooks: [{ type: "command", command: "bun x.ts" }, { type: "http", url: "http://localhost:1/x" }] }],
          },
        }).violations.length === 0,
    },
  ];

  let failed = 0;
  console.log(`\n${BLUE}SELF-TEST: can this gate go RED?${RESET}\n`);
  for (const c of cases) {
    let ok = false;
    try {
      ok = c.run();
    } catch (e) {
      ok = false;
      console.log(`  ${RED}threw${RESET}: ${(e as Error).message}`);
    }
    if (!ok) failed += 1;
    console.log(`  ${ok ? GREEN + "PASS" + RESET : RED + "FAIL" + RESET}  ${c.name}`);
  }
  console.log(
    failed === 0
      ? `\n${GREEN}SELF-TEST PASS: every deliberate breakage was detected (${cases.length} cases).${RESET}\n`
      : `\n${RED}SELF-TEST FAIL: ${failed}/${cases.length} breakages went undetected — this gate cannot be trusted.${RESET}\n`,
  );
  return failed === 0 ? 0 : 1;
}

// ---- entry -------------------------------------------------------------

function main(): number {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !["--self-test", "--quiet"].includes(a));
  if (unknown.length > 0) {
    console.error(`unknown argument(s): ${unknown.join(", ")}\nusage: bun Tools/validate-payload-json.ts [--self-test] [--quiet]`);
    return 2;
  }
  if (args.includes("--self-test")) return runSelfTest();
  return runChecks(args.includes("--quiet"));
}

process.exit(main());
