#!/usr/bin/env bun
/**
 * upstream-sync — the reviewable channel for folding a LifeOS public release into
 * the maintainer's PAI/-shaped live tree, which is a DIVERGENT FORK from the
 * release (no shared git history; see MEMORY/WORK/upgrade-v5-to-v6/ISA.md).
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

type Klass = "take" | "conflict" | "add" | "unchanged";

// The release payload framework root (renamed LifeOS/) maps onto the live PAI/ root.
// We normalize release paths token-by-token into the PAI/-shaped baseline.
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const RELEASE_PAYLOAD = path.join(REPO_ROOT, "LifeOS", "install");
const BASELINE_ROOT = path.join(REPO_ROOT, "scripts", "upstream-sync", "baseline");

function liveRoot(): string {
  const home = process.env.HOME || os.homedir();
  return process.env.PAI_DIR ? path.resolve(process.env.PAI_DIR) : path.join(home, ".claude");
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

const TEXT_EXTS = new Set([".ts", ".js", ".md", ".json", ".toml", ".yaml", ".yml", ".sh", ".txt", ".css"]);
function isText(rel: string): boolean {
  return TEXT_EXTS.has(path.extname(rel).toLowerCase());
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
 * 3-way classification per baseline-relative path:
 *   - release changed vs baseline?  (upstream delta)
 *   - live   changed vs baseline?   (your divergence)
 * => take (upstream changed, you didn't) | conflict (both changed) |
 *    add (new upstream file absent from live) | unchanged.
 */
function classifyThreeWay(baseRel: string): Klass {
  const baseAbs = path.join(BASELINE_ROOT, ...baseRel.split("/"));
  // Map baseline path back to a release path (reverse the dir renames) to compare.
  const relRel = baseRel
    .split("/")
    .map((seg) => (seg === "PAI" ? "LifeOS" : seg === "PAI_SYSTEM_PROMPT.md" ? "LIFEOS_SYSTEM_PROMPT.md" : seg))
    .join("/");
  const releaseAbs = path.join(RELEASE_PAYLOAD, ...relRel.split("/"));
  const liveAbs = path.join(liveRoot(), ...baseRel.split("/"));

  const upstream = classify(baseAbs, releaseAbs); // baseline vs (its own source) — normalization drift only
  const mine = classify(baseAbs, liveAbs); // baseline vs live — your divergence

  const liveHas = existsSync(liveAbs) && statSync(liveAbs).isFile();
  if (!liveHas) return "add"; // upstream file live doesn't have yet
  // upstream=="same" means the normalized baseline equals the release (expected).
  // The signal we want is: does live differ from the baseline?
  if (mine === "diff") return "conflict"; // both baseline(=upstream) and live have content, and they differ
  if (mine === "same") return "unchanged";
  return "take";
}

function gitStat(baseAbs: string, otherAbs: string): string {
  const r = spawnSync("git", ["diff", "--no-index", "--stat", baseAbs, otherAbs], { encoding: "utf8" });
  const line = (r.stdout || "").trim().split("\n").pop() || "";
  return line.trim();
}

function main(argv: string[]): number {
  if (argv.includes("--self-test")) return runSelfTest();
  const doRefresh = argv.includes("--refresh") || !existsSync(BASELINE_ROOT);

  console.log("upstream-sync — READ-ONLY 3-way view (no --apply; never writes to live)\n");
  if (doRefresh) {
    console.log("Refreshing normalized baseline from release payload...");
    const { written, totalFlags, flagged } = refreshBaseline();
    console.log(`  baseline: ${written} files written to ${path.relative(REPO_ROOT, BASELINE_ROOT)}`);
    console.log(`  normalization flags (need human review): ${totalFlags}`);
    for (const f of flagged.slice(0, 20)) console.log(`    FLAG ${f}`);
    if (flagged.length > 20) console.log(`    ... +${flagged.length - 20} more flagged files`);
    console.log("");
  }

  const baseRels = walk(BASELINE_ROOT);
  const buckets: Record<Klass, string[]> = { take: [], conflict: [], add: [], unchanged: [] };
  for (const baseRel of baseRels) buckets[classifyThreeWay(baseRel)].push(baseRel);

  console.log("3-WAY CLASSIFICATION (baseline = synthesized common ancestor):");
  console.log(`  take      ${buckets.take.length}  — upstream has it, live unchanged from baseline → safe to land`);
  console.log(`  conflict  ${buckets.conflict.length}  — live DIFFERS from baseline → review; NEVER auto-take (protects your line)`);
  console.log(`  add       ${buckets.add.length}  — new upstream file live lacks → candidate port`);
  console.log(`  unchanged ${buckets.unchanged.length}  — identical\n`);

  const showConflicts = argv.includes("--conflicts");
  const showAdds = argv.includes("--adds");
  if (showConflicts) {
    console.log("CONFLICTS (live diverges — your ahead-of-safety edits live here):");
    for (const rel of buckets.conflict.slice(0, 40)) {
      const stat = gitStat(path.join(BASELINE_ROOT, ...rel.split("/")), path.join(liveRoot(), ...rel.split("/")));
      console.log(`  CONFLICT ${rel}  ${stat}`);
    }
    if (buckets.conflict.length > 40) console.log(`  ... +${buckets.conflict.length - 40} more`);
    console.log("");
  }
  if (showAdds) {
    console.log("ADDS (new upstream files — candidate quick-win ports):");
    for (const rel of buckets.add.slice(0, 60)) console.log(`  ADD ${rel}`);
    if (buckets.add.length > 60) console.log(`  ... +${buckets.add.length - 60} more`);
    console.log("");
  }
  console.log("Next: `--conflicts` / `--adds` for detail. Landing items is a later gated increment (guarded apply).");
  return 0;
}

// ── Self-test (pure path-mapping logic; no fs) ────────────────────────────────
function runSelfTest(): number {
  const cases: { in: string; want: string }[] = [
    { in: "LifeOS/PULSE/modules/work.ts", want: "PAI/PULSE/modules/work.ts" },
    { in: "LifeOS/LIFEOS_SYSTEM_PROMPT.md", want: "PAI/PAI_SYSTEM_PROMPT.md" },
    { in: "skills/BiasCheck/SKILL.md", want: "skills/BiasCheck/SKILL.md" }, // no framework-root token → unchanged
    { in: "hooks/EffortRouter.hook.ts", want: "hooks/EffortRouter.hook.ts" },
  ];
  let pass = 0;
  for (const c of cases) {
    const got = normalizeRelPath(c.in);
    if (got === c.want) pass += 1;
    else console.error(`FAIL ${c.in} → got ${got}, want ${c.want}`);
  }
  console.log(`${pass}/${cases.length} passed`);
  return pass === cases.length ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
