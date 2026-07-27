#!/usr/bin/env bun
/**
 * upstream-sync — the reviewable channel for folding a LifeOS public release into
 * the maintainer's live tree, which is a DIVERGENT FORK from the release (no
 * shared git history; see MEMORY/WORK/upgrade-v5-to-v6/ISA.md).
 *
 * THREE SHAPES, not two. The pinned baseline is PAI/-shaped (historical), the
 * release payload is LIFEOS/-shaped, and LIVE was itself renamed PAI/ -> LIFEOS/
 * on 2026-07-05. So a baseline path needs a DIFFERENT map per side:
 * `normalizeRelPath` (release side) and `toLiveRelPath` (live side). Assuming one
 * map covered both is what silently turned 504 CONFLICTs into "add"s.
 *
 * The problem git can't solve alone: subtree/submodule/orphan-merge all need a
 * shared object graph + rename detection, and the PAI/->LifeOS/ rename makes
 * every file a delete+add across the repo boundary. So we MANUFACTURE the missing
 * common ancestor: vendor the release payload into the fork as a path-normalized
 * (lifeos-normalize.ts) baseline. Then two plain diffs give the 3-way view:
 *
 *   baseline <-> new-release   = what UPSTREAM changed since the vendored baseline
 *   baseline <-> live          = what YOU diverged (protects your ahead-of-safety line)
 *
 * and the per-file classification tells you which release changes are safe to take,
 * which collide with your own edits (CONFLICT — never auto-take), and which are
 * pure additions.
 *
 * THIS INCREMENT IS READ-ONLY. It vendors/refreshes the baseline (inside the FORK,
 * git-tracked — NOT live) and prints the view. There is no --apply and it never
 * writes into the live ~/.claude tree. Landing items is a later, separately-gated
 * increment with its own (rewritten, not reused) containment guard — build-release's
 * assertDestSafe trusts live as SOURCE and is not reverse-symmetric.
 *
 * Idioms match scripts/build-release.ts: node:fs only, no deps, allowlisted walk,
 * spawnSync for git, self-test via --self-test.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { normalize } from "./lifeos-normalize.ts";

type Klass = "take" | "conflict" | "add" | "local-only" | "unchanged";

// The release payload framework root (renamed LifeOS/) maps onto the live PAI/ root.
// We normalize release paths token-by-token into the PAI/-shaped baseline.
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const RELEASE_PAYLOAD = path.join(REPO_ROOT, "LifeOS", "install");
const BASELINE_ROOT = path.join(REPO_ROOT, "scripts", "upstream-sync", "baseline");

// LIFEOS_DIR is the current override (matches build-release.ts); PAI_DIR is kept
// for back-compat with older invocations. Both name the CONFIG ROOT (~/.claude),
// not the framework subdir inside it.
function liveRoot(): string {
  const home = process.env.HOME || os.homedir();
  const override = process.env.LIFEOS_DIR ?? process.env.PAI_DIR;
  return override ? path.resolve(override) : path.join(home, ".claude");
}

/** Rewrite a release-relative path into its PAI/-shaped baseline path. */
export function normalizeRelPath(rel: string): string {
  return rel
    .split("/")
    .map((seg) => {
      if (seg === "LifeOS") return "PAI"; // framework root dir rename
      if (seg === "LIFEOS_SYSTEM_PROMPT.md") return "PAI_SYSTEM_PROMPT.md";
      return seg;
    })
    .join("/");
}

/**
 * Rewrite a PAI/-shaped BASELINE path into the path it occupies in the LIVE tree.
 *
 * The baseline is pinned in the historical PAI/ shape, but live was renamed
 * PAI/ -> LIFEOS/ on 2026-07-05. Without this map every `PAI/*` baseline path
 * resolved to `~/.claude/PAI/...`, which no longer exists, so `liveHas` was
 * always false and `classifyThreeWay` returned "add" — inverting the tool's core
 * safety promise for 504 paths that were really CONFLICTs.
 *
 * This is the LIVE-side complement of `normalizeRelPath` (which is release-side
 * only) and the exact inverse of build-release.ts's `toDestRel`. Root-anchored,
 * matching that function, rather than per-segment: a nested dir that merely
 * happens to be named PAI is not the framework root.
 *
 * The USER clause encodes the installer's own contract — LinkUser.ts makes
 * `<configRoot>/LIFEOS/USER` the live location of the payload's top-level
 * `install/USER` tree — so USER files compare against real live content instead
 * of reading as pure additions.
 *
 * Known release-only paths deliberately left unmapped (they are installer inputs
 * with no live counterpart, and correctly read as "add"): `install.sh`,
 * `CLAUDE.template.md`, `settings.system.json`, `settings.enhancements.json`.
 */
export function toLiveRelPath(baseRel: string): string {
  if (baseRel === "PAI/PAI_SYSTEM_PROMPT.md") return "LIFEOS/LIFEOS_SYSTEM_PROMPT.md";
  if (baseRel === "PAI" || baseRel.startsWith("PAI/")) return "LIFEOS" + baseRel.slice("PAI".length);
  if (baseRel === "USER" || baseRel.startsWith("USER/")) return "LIFEOS/" + baseRel;
  return baseRel;
}

// Every text-ish source form present in the payload MUST normalize, else its
// LIFEOS_/LifeOS/ tokens ship un-rewritten (silent-empty-dir) AND inflate the
// conflict count with normalization-only false diffs (Cato finding #2). .tsx is
// the big one (138 files); extensionless LATEST/VERSION also carry tokens.
const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
  ".md", ".mdx", ".json", ".jsonc", ".toml", ".yaml", ".yml",
  ".sh", ".bash", ".zsh", ".txt", ".css", ".scss", ".html", ".hbs",
  ".plist", ".service", ".swift", ".py", ".env", ".example",
]);
const TEXT_BASENAMES = new Set(["LATEST", "VERSION", "Dockerfile", "Makefile"]);
function isText(rel: string): boolean {
  const base = path.basename(rel);
  if (TEXT_BASENAMES.has(base)) return true;
  const ext = path.extname(rel).toLowerCase();
  if (ext) return TEXT_EXTS.has(ext);
  return false; // truly extensionless + unknown → treat as binary (copy verbatim)
}

/** Normalized bytes for a release file: token-rewritten for text, verbatim for binary. */
function normalizedReleaseBytes(releaseAbs: string, rel: string): Buffer {
  if (isText(rel)) return Buffer.from(normalize(readFileSync(releaseAbs, "utf8")).text, "utf8");
  return readFileSync(releaseAbs);
}

function walk(root: string, base = ""): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    if (name === "node_modules" || name === ".git" || name === "out") continue;
    const abs = path.join(root, name);
    const rel = base ? `${base}/${name}` : name;
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walk(abs, rel));
    else if (st.isFile()) out.push(rel);
  }
  return out;
}

/** Vendor/refresh the normalized baseline from the current release payload. */
function refreshBaseline(): { written: number; totalFlags: number; flagged: string[] } {
  const relFiles = walk(RELEASE_PAYLOAD);
  let written = 0;
  let totalFlags = 0;
  const flagged: string[] = [];
  for (const rel of relFiles) {
    const srcAbs = path.join(RELEASE_PAYLOAD, ...rel.split("/"));
    const baseRel = normalizeRelPath(rel);
    const destAbs = path.join(BASELINE_ROOT, ...baseRel.split("/"));
    mkdirSync(path.dirname(destAbs), { recursive: true });
    if (isText(rel)) {
      const { text, flags } = normalize(readFileSync(srcAbs, "utf8"));
      writeFileSync(destAbs, text);
      if (flags.length) {
        totalFlags += flags.length;
        flagged.push(`${baseRel} (${flags.length})`);
      }
    } else {
      writeFileSync(destAbs, readFileSync(srcAbs)); // binary: copy verbatim
    }
    written += 1;
  }
  return { written, totalFlags, flagged };
}

/** Byte-compare two files; null side = absent. */
function classify(baseAbs: string | null, otherAbs: string | null): "same" | "diff" | "onlyBase" | "onlyOther" {
  const b = baseAbs && existsSync(baseAbs) && statSync(baseAbs).isFile() ? readFileSync(baseAbs) : null;
  const o = otherAbs && existsSync(otherAbs) && statSync(otherAbs).isFile() ? readFileSync(otherAbs) : null;
  if (b && o) return Buffer.compare(b, o) === 0 ? "same" : "diff";
  if (b && !o) return "onlyBase";
  if (!b && o) return "onlyOther";
  return "same"; // neither exists
}

/**
 * TRUE 3-way classification per baseline-relative path. Three inputs:
 *   BASELINE — the PINNED, committed common ancestor (last-synced release, normalized)
 *   RELEASE  — the CURRENT release payload, normalized ON THE FLY (the incoming version)
 *   LIVE     — your ~/.claude tree
 *
 * The baseline is a git-committed pin, NOT regenerated each run (that was the bug
 * Cato #1 caught — a regenerated baseline always equals the release, so `take` was
 * unreachable). Refresh advances the pin only via explicit `--adopt` after a sync.
 *
 *   upstream = did RELEASE change vs BASELINE?   (what the new version brings)
 *   mine     = did LIVE    change vs BASELINE?   (your divergence)
 *
 * => add        : release has it, live lacks it            → candidate port
 *    local-only : live has it, release doesn't             → your own file, ignore
 *    take        : upstream changed, you did NOT            → safe to land
 *    conflict    : BOTH changed (or live differs + upstream also moved) → review, never auto-take
 *    unchanged   : neither changed
 *
 * When BASELINE == RELEASE (first run, only one release exists), upstream is always
 * "same", so `take` is legitimately 0 — there is no newer version yet. At v7 the pin
 * lags the new payload and `take` becomes populated. That 0 is now HONEST, not a bug.
 */
function classifyThreeWay(baseRel: string): Klass {
  const baseAbs = path.join(BASELINE_ROOT, ...baseRel.split("/"));
  const relRel = baseRel
    .split("/")
    .map((seg) => (seg === "PAI" ? "LifeOS" : seg === "PAI_SYSTEM_PROMPT.md" ? "LIFEOS_SYSTEM_PROMPT.md" : seg))
    .join("/");
  const releaseAbs = path.join(RELEASE_PAYLOAD, ...relRel.split("/"));
  const liveAbs = path.join(liveRoot(), ...toLiveRelPath(baseRel).split("/"));

  const baseBytes = existsSync(baseAbs) && statSync(baseAbs).isFile() ? readFileSync(baseAbs) : null;
  const relBytes = existsSync(releaseAbs) && statSync(releaseAbs).isFile()
    ? normalizedReleaseBytes(releaseAbs, relRel) // normalize on the fly — matches how the pin was made
    : null;
  const liveBytes = existsSync(liveAbs) && statSync(liveAbs).isFile() ? readFileSync(liveAbs) : null;

  const upstreamChanged = baseBytes && relBytes ? Buffer.compare(baseBytes, relBytes) !== 0 : baseBytes !== !!relBytes;
  const liveHas = liveBytes !== null;
  const releaseHas = relBytes !== null;

  if (releaseHas && !liveHas) return "add";
  if (!releaseHas && liveHas) return "local-only";
  const mineChanged = baseBytes && liveBytes ? Buffer.compare(baseBytes, liveBytes) !== 0 : false;
  if (mineChanged) return "conflict"; // live diverged → protect it, never auto-take
  if (upstreamChanged) return "take"; // upstream moved, live is still at baseline → safe
  return "unchanged";
}

function gitStat(baseAbs: string, otherAbs: string): string {
  const r = spawnSync("git", ["diff", "--no-index", "--stat", baseAbs, otherAbs], { encoding: "utf8" });
  const line = (r.stdout || "").trim().split("\n").pop() || "";
  return line.trim();
}

function main(argv: string[]): number {
  if (argv.includes("--self-test")) return runSelfTest();
  // The baseline is a PINNED, committed ancestor. Write it only on first bootstrap
  // (absent) or on explicit `--adopt` (advance the pin to the current release AFTER
  // a sync). A plain run NEVER rewrites the pin — that is what keeps `take` real.
  const bootstrap = !existsSync(BASELINE_ROOT);
  const adopt = argv.includes("--adopt");

  console.log("upstream-sync — READ-ONLY 3-way view (no --apply; never writes to live)\n");
  if (bootstrap || adopt) {
    console.log(bootstrap ? "Bootstrapping pinned baseline from current release..." : "Adopting current release as new pinned baseline...");
    const { written, totalFlags, flagged } = refreshBaseline();
    console.log(`  baseline: ${written} files written to ${path.relative(REPO_ROOT, BASELINE_ROOT)} (commit this pin)`);
    console.log(`  normalization flags (need human review): ${totalFlags}`);
    for (const f of flagged.slice(0, 20)) console.log(`    FLAG ${f}`);
    if (flagged.length > 20) console.log(`    ... +${flagged.length - 20} more flagged files`);
    console.log("");
  }

  // Classify the UNION of baseline + current-release paths (a v7 release may add
  // files absent from the pinned baseline; walking the baseline alone would miss them).
  const relToBaseRel = (rel: string) => normalizeRelPath(rel);
  const baseRels = new Set(walk(BASELINE_ROOT));
  for (const rel of walk(RELEASE_PAYLOAD)) baseRels.add(relToBaseRel(rel));
  const buckets: Record<Klass, string[]> = { take: [], conflict: [], add: [], "local-only": [], unchanged: [] };
  for (const baseRel of baseRels) buckets[classifyThreeWay(baseRel)].push(baseRel);

  console.log("3-WAY CLASSIFICATION (baseline = PINNED common ancestor):");
  console.log(`  take      ${buckets.take.length}  — release changed vs pin, live still at pin → safe to land`);
  console.log(`  conflict  ${buckets.conflict.length}  — live DIFFERS from pin → review; NEVER auto-take (protects your line)`);
  console.log(`  add       ${buckets.add.length}  — release file live lacks → candidate port`);
  console.log(`  local-only ${buckets["local-only"].length}  — your own file, not in release → ignore`);
  console.log(`  unchanged ${buckets.unchanged.length}  — identical\n`);
  if (buckets.take.length === 0) {
    console.log("  (take=0 is HONEST here: pin == current release, so no newer version exists yet.");
    console.log("   At v7, refresh the payload, re-run: take populates with upstream's real changes.)\n");
  }

  const showConflicts = argv.includes("--conflicts");
  const showAdds = argv.includes("--adds");
  // The default caps below are display ergonomics, but a truncated list reads as a
  // complete one: a specific path can be absent from BOTH detail views and still be
  // classified, which is how the PAI/->LIFEOS/ misclassification stayed invisible.
  // --all removes the caps so a named file can be searched for and trusted.
  const showAll = argv.includes("--all");
  const conflictCap = showAll ? buckets.conflict.length : 40;
  const addCap = showAll ? buckets.add.length : 60;
  if (showConflicts) {
    console.log("CONFLICTS (live diverges — your ahead-of-safety edits live here):");
    for (const rel of buckets.conflict.slice(0, conflictCap)) {
      const stat = gitStat(path.join(BASELINE_ROOT, ...rel.split("/")), path.join(liveRoot(), ...toLiveRelPath(rel).split("/")));
      console.log(`  CONFLICT ${rel}  ${stat}`);
    }
    if (buckets.conflict.length > conflictCap) console.log(`  ... +${buckets.conflict.length - conflictCap} more (use --all)`);
    console.log("");
  }
  if (showAdds) {
    console.log("ADDS (new upstream files — candidate quick-win ports):");
    for (const rel of buckets.add.slice(0, addCap)) console.log(`  ADD ${rel}`);
    if (buckets.add.length > addCap) console.log(`  ... +${buckets.add.length - addCap} more (use --all)`);
    console.log("");
  }
  console.log("Next: `--conflicts` / `--adds` for detail (`--all` to defeat the display caps).");
  console.log("Landing items is a later gated increment (guarded apply).");
  return 0;
}

// ── Self-test (pure path-mapping logic; no fs) ────────────────────────────────
// Covers BOTH directions. The release-only version of this test passed while the
// live side was unmapped, so a green here previously said nothing about whether
// `liveAbs` resolved — hence the round-trip and live-shape cases below.
function runSelfTest(): number {
  const releaseCases: { in: string; want: string }[] = [
    { in: "LifeOS/PULSE/modules/work.ts", want: "PAI/PULSE/modules/work.ts" },
    { in: "LifeOS/LIFEOS_SYSTEM_PROMPT.md", want: "PAI/PAI_SYSTEM_PROMPT.md" },
    { in: "skills/BiasCheck/SKILL.md", want: "skills/BiasCheck/SKILL.md" }, // no framework-root token → unchanged
    { in: "hooks/EffortRouter.hook.ts", want: "hooks/EffortRouter.hook.ts" },
  ];
  const liveCases: { in: string; want: string }[] = [
    // The regression this map exists for: PAI/ is gone from live as of 2026-07-05.
    { in: "PAI/TOOLS/Inference.ts", want: "LIFEOS/TOOLS/Inference.ts" },
    { in: "PAI/PAI_SYSTEM_PROMPT.md", want: "LIFEOS/LIFEOS_SYSTEM_PROMPT.md" },
    { in: "PAI/ALGORITHM/LATEST", want: "LIFEOS/ALGORITHM/LATEST" },
    // LinkUser's contract: payload USER/ lives at <configRoot>/LIFEOS/USER.
    { in: "USER/TELOS/GOALS.md", want: "LIFEOS/USER/TELOS/GOALS.md" },
    // Shared-shape paths are identical in both trees.
    { in: "hooks/EffortRouter.hook.ts", want: "hooks/EffortRouter.hook.ts" },
    { in: "skills/BiasCheck/SKILL.md", want: "skills/BiasCheck/SKILL.md" },
    // Root-anchored, not per-segment: a nested dir named PAI is not the root.
    { in: "skills/PAI/SKILL.md", want: "skills/PAI/SKILL.md" },
    // Installer inputs with no live counterpart stay unmapped (correctly "add").
    { in: "install.sh", want: "install.sh" },
    { in: "settings.system.json", want: "settings.system.json" },
  ];
  let pass = 0;
  let total = 0;
  for (const c of releaseCases) {
    total += 1;
    const got = normalizeRelPath(c.in);
    if (got === c.want) pass += 1;
    else console.error(`FAIL release ${c.in} → got ${got}, want ${c.want}`);
  }
  for (const c of liveCases) {
    total += 1;
    const got = toLiveRelPath(c.in);
    if (got === c.want) pass += 1;
    else console.error(`FAIL live ${c.in} → got ${got}, want ${c.want}`);
  }
  // Round-trip: release → baseline → live must land on the live framework root.
  for (const [releaseRel, wantLive] of [
    ["LifeOS/TOOLS/Inference.ts", "LIFEOS/TOOLS/Inference.ts"],
    ["LifeOS/LIFEOS_SYSTEM_PROMPT.md", "LIFEOS/LIFEOS_SYSTEM_PROMPT.md"],
  ] as const) {
    total += 1;
    const got = toLiveRelPath(normalizeRelPath(releaseRel));
    if (got === wantLive) pass += 1;
    else console.error(`FAIL round-trip ${releaseRel} → got ${got}, want ${wantLive}`);
  }
  // Anti-case: no live path may retain a PAI/ framework root, or liveAbs misses.
  total += 1;
  const leaks = [...releaseCases, ...liveCases]
    .map((c) => toLiveRelPath(normalizeRelPath(c.in)))
    .filter((p) => p === "PAI" || p.startsWith("PAI/"));
  if (leaks.length === 0) pass += 1;
  else console.error(`FAIL anti: ${leaks.length} live path(s) still PAI/-rooted: ${leaks.join(", ")}`);
  console.log(`${pass}/${total} passed`);
  return pass === total ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
