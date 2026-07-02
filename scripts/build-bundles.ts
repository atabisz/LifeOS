#!/usr/bin/env bun
/**
 * build-bundles.ts — generate bundle-pack skill copies from their canonical standalone source.
 *
 * WHY: `Packs/Utilities/` and `Packs/Media/` are BUNDLE packs that re-carry copies of
 * standalone `Packs/<Skill>/src` skills. Those copies drift (a full 12-pair census on
 * 2026-07-02 found bidirectional drift — e.g. bundle `Browser` was a stale v3.3.0 Playwright
 * skill vs standalone v10.0.0 agent-browser). This tool makes the standalone the single
 * source of truth and projects it into the bundle, the same build-from-canonical pattern as
 * `build-release.ts`.
 *
 * WHAT IT DOES: for each shared mapping, OVERLAY-copies the standalone `src` tree into the
 * bundle location, skipping a denylist of dev/runtime artifacts. It is an overlay, NOT a
 * destructive mirror: it never deletes a file that exists only in the bundle (e.g. the
 * runtime `PAIUpgrade/State/` dir), so bundle-only content survives. The bundle-only trio
 * (Cloudflare/Documents/Parser) has no standalone source and is never a target.
 *
 * MODES:
 *   (default)     DRY-RUN — prints the CREATE/UPDATE plan, writes nothing.
 *   --apply       Write the changes.
 *   --check       Exit nonzero if any bundle file differs from its generated form (drift guard).
 *   --only <sub>  Restrict to one mapping key (e.g. Browser, Art).
 *   --self-test   Prove the tool can go RED: synthesizes drift in a temp tree and asserts detection.
 *   --help
 */

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  lstatSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";

const REPO_ROOT = path.resolve(import.meta.dir, "..");

// Fail-closed guard: refuse to read/write through a symlink or Windows junction in
// any existing destination path component. `writeFileSync` follows links and would
// truncate the link TARGET — potentially outside the bundle tree. The bundle trees
// are plain committed source (verified link-free), so this only fires on tampering;
// it mirrors the realpath-containment defense in build-release.ts.
function assertNoSymlinkInPath(target: string): void {
  const { root } = path.parse(target);
  let cur = root;
  for (const part of target.slice(root.length).split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    if (existsSync(cur) && lstatSync(cur).isSymbolicLink()) {
      throw new Error(`Refusing symlinked bundle path: ${cur}`);
    }
  }
}

// ── The 12 shared mappings: standalone src → bundle location ──────────────────
// Bundle-only sub-skills (Cloudflare, Documents, Parser) are deliberately ABSENT:
// they have no standalone source, so the bundle is their only home and they must
// never be a copy target.
type Mapping = { key: string; standalone: string; bundle: string };
const MAPPINGS: Mapping[] = [
  // Utilities bundle
  { key: "Aphorisms", standalone: "Packs/Aphorisms/src", bundle: "Packs/Utilities/src/Aphorisms" },
  { key: "AudioEditor", standalone: "Packs/AudioEditor/src", bundle: "Packs/Utilities/src/AudioEditor" },
  { key: "Browser", standalone: "Packs/Browser/src", bundle: "Packs/Utilities/src/Browser" },
  { key: "CreateCLI", standalone: "Packs/CreateCLI/src", bundle: "Packs/Utilities/src/CreateCLI" },
  { key: "CreateSkill", standalone: "Packs/CreateSkill/src", bundle: "Packs/Utilities/src/CreateSkill" },
  { key: "Delegation", standalone: "Packs/Delegation/src", bundle: "Packs/Utilities/src/Delegation" },
  { key: "Evals", standalone: "Packs/Evals/src", bundle: "Packs/Utilities/src/Evals" },
  { key: "Fabric", standalone: "Packs/Fabric/src", bundle: "Packs/Utilities/src/Fabric" },
  { key: "PAIUpgrade", standalone: "Packs/PAIUpgrade/src", bundle: "Packs/Utilities/src/PAIUpgrade" },
  { key: "Prompting", standalone: "Packs/Prompting/src", bundle: "Packs/Utilities/src/Prompting" },
  // Media bundle
  { key: "Art", standalone: "Packs/Art/src", bundle: "Packs/Media/src/Art" },
  { key: "Remotion", standalone: "Packs/Remotion/src", bundle: "Packs/Media/src/Remotion" },
];

// ── Denylist: dev/runtime artifacts that live in the standalone but must NOT be
// projected into the bundle. Matched by path SEGMENT (any dir/file named this) or
// by basename. Confirmed against the 2026-07-02 census: Evals/Results (benchmark
// run outputs), Evals/bun.lock, **/.cursor, plus the usual VCS/dep/OS noise.
const DENY_SEGMENTS = new Set([
  "Results",
  "node_modules",
  ".cursor",
  ".git",
]);
const DENY_BASENAMES = new Set([
  "bun.lock",
  "bun.lockb",
  ".DS_Store",
]);

function isDenied(relFromSrc: string): boolean {
  const segments = relFromSrc.split("/");
  if (segments.some((s) => DENY_SEGMENTS.has(s))) return true;
  const base = segments[segments.length - 1];
  return DENY_BASENAMES.has(base);
}

// ── Recursively list files under a dir, relative to it, skipping denylisted paths.
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (absDir: string, relDir: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (isDenied(rel)) continue;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile()) out.push(rel);
      // symlinks/others are skipped (bundles are plain source trees)
    }
  };
  walk(root, "");
  return out;
}

type Change = { mapping: string; rel: string; kind: "create" | "update" };

// ── Compute the overlay plan for one mapping (no writes). ─────────────────────
function planMapping(m: Mapping): Change[] {
  const stdAbs = path.join(REPO_ROOT, m.standalone);
  const bndAbs = path.join(REPO_ROOT, m.bundle);
  if (!existsSync(stdAbs)) {
    throw new Error(`standalone source missing for ${m.key}: ${m.standalone}`);
  }
  const changes: Change[] = [];
  for (const rel of listFiles(stdAbs)) {
    const srcFile = path.join(stdAbs, rel);
    const dstFile = path.join(bndAbs, rel);
    assertNoSymlinkInPath(dstFile);
    if (!existsSync(dstFile)) {
      changes.push({ mapping: m.key, rel, kind: "create" });
    } else {
      const a = readFileSync(srcFile);
      const b = readFileSync(dstFile);
      if (!a.equals(b)) changes.push({ mapping: m.key, rel, kind: "update" });
    }
  }
  return changes;
}

// ── Apply the overlay (byte-verbatim copy, create dirs as needed). Overlay only:
// files present only in the bundle are left untouched. ────────────────────────
function applyMapping(m: Mapping, changes: Change[]): void {
  const stdAbs = path.join(REPO_ROOT, m.standalone);
  const bndAbs = path.join(REPO_ROOT, m.bundle);
  for (const c of changes) {
    const srcFile = path.join(stdAbs, c.rel);
    const dstFile = path.join(bndAbs, c.rel);
    assertNoSymlinkInPath(dstFile);
    mkdirSync(path.dirname(dstFile), { recursive: true });
    writeFileSync(dstFile, readFileSync(srcFile));
  }
}

interface Args {
  apply: boolean;
  check: boolean;
  selfTest: boolean;
  help: boolean;
  only?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, check: false, selfTest: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--check") args.check = true;
    else if (a === "--self-test") args.selfTest = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--only") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --only");
      args.only = v;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function usage(): string {
  return [
    "Usage: bun scripts/build-bundles.ts [--apply | --check] [--only <key>] [--self-test] [--help]",
    "Default is DRY-RUN (prints the plan, writes nothing).",
    `Mappings: ${MAPPINGS.map((m) => m.key).join(", ")}`,
  ].join("\n");
}

function selectMappings(only?: string): Mapping[] {
  if (!only) return MAPPINGS;
  const m = MAPPINGS.filter((x) => x.key === only);
  if (m.length === 0) throw new Error(`--only ${only}: not a known mapping key.\n${usage()}`);
  return m;
}

// ── --self-test: build a synthetic standalone+bundle pair in a temp dir, drift one
// file, and assert the plan detects exactly that drift AND preserves a bundle-only
// file. Proves the tool can go RED. ───────────────────────────────────────────
function selfTest(): number {
  const tmp = path.join(os.tmpdir(), `build-bundles-selftest-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  const std = path.join(tmp, "std");
  const bnd = path.join(tmp, "bnd");
  mkdirSync(std, { recursive: true });
  mkdirSync(bnd, { recursive: true });
  // shared file, drifted; a denylisted dir in std; a bundle-only file in bnd
  writeFileSync(path.join(std, "SKILL.md"), "version: 10\n");
  writeFileSync(path.join(bnd, "SKILL.md"), "version: 3\n");
  mkdirSync(path.join(std, "Results"), { recursive: true });
  writeFileSync(path.join(std, "Results", "run.json"), "{}");
  mkdirSync(path.join(bnd, "State"), { recursive: true });
  writeFileSync(path.join(bnd, "State", "last-check.json"), "{}");

  const m: Mapping = { key: "SelfTest", standalone: path.relative(REPO_ROOT, std), bundle: path.relative(REPO_ROOT, bnd) };
  const plan = planMapping(m);

  const results: string[] = [];
  const drift = plan.find((c) => c.rel === "SKILL.md" && c.kind === "update");
  results.push(drift ? "PASS: detected drifted SKILL.md" : "FAIL: missed drifted SKILL.md");
  const leakedResults = plan.some((c) => c.rel.startsWith("Results"));
  results.push(!leakedResults ? "PASS: denylisted Results/ excluded" : "FAIL: Results/ leaked into plan");

  // apply, then confirm bundle-only State/ survives and SKILL converged
  applyMapping(m, plan);
  const stateSurvives = existsSync(path.join(bnd, "State", "last-check.json"));
  results.push(stateSurvives ? "PASS: bundle-only State/ preserved" : "FAIL: bundle-only State/ deleted");
  const converged = readFileSync(path.join(bnd, "SKILL.md"), "utf8") === "version: 10\n";
  results.push(converged ? "PASS: SKILL.md converged to standalone" : "FAIL: SKILL.md not converged");
  const recheck = planMapping(m);
  results.push(recheck.length === 0 ? "PASS: post-apply check clean" : "FAIL: drift remains after apply");

  rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((r) => r.startsWith("FAIL"));
  for (const r of results) console.log(`  ${r}`);
  if (failed.length) {
    console.error(`SELF-TEST RED: ${failed.length} assertion(s) failed.`);
    return 1;
  }
  console.log("SELF-TEST GREEN: all assertions passed.");
  return 0;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (args.selfTest) return selfTest();

  const mappings = selectMappings(args.only);
  const allChanges: Change[] = [];
  for (const m of mappings) allChanges.push(...planMapping(m));

  const mode = args.check ? "CHECK" : args.apply ? "APPLY" : "DRY-RUN";
  console.log("=".repeat(60));
  console.log(`build-bundles  [mode: ${mode}]  mappings: ${mappings.length}`);
  console.log("=".repeat(60));

  if (allChanges.length === 0) {
    console.log("✅ Bundles are in sync with their standalone sources — nothing to do.");
    return 0;
  }

  const byMapping = new Map<string, Change[]>();
  for (const c of allChanges) {
    if (!byMapping.has(c.mapping)) byMapping.set(c.mapping, []);
    byMapping.get(c.mapping)!.push(c);
  }
  for (const [key, changes] of byMapping) {
    const creates = changes.filter((c) => c.kind === "create").length;
    const updates = changes.filter((c) => c.kind === "update").length;
    console.log(`\n${key}: ${creates} create, ${updates} update`);
    for (const c of changes) console.log(`  ${c.kind === "create" ? "＋" : "~"} ${c.rel}`);
  }

  if (args.check) {
    console.error(`\n❌ CHECK failed: ${allChanges.length} bundle file(s) drifted from standalone. Run --apply to converge.`);
    return 1;
  }
  if (args.apply) {
    for (const m of mappings) applyMapping(m, byMapping.get(m.key) ?? []);
    console.log(`\n✅ APPLIED ${allChanges.length} change(s) across ${byMapping.size} mapping(s).`);
    return 0;
  }
  console.log(`\nDRY-RUN: ${allChanges.length} change(s) pending. Pass --apply to write, --check to fail on drift.`);
  return 0;
}

process.exit(main());
