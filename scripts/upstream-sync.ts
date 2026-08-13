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
 * WHAT A COUNT MEANS (corrected 2026-07-28). The five original buckets had three false labels,
 * and `--self-test` was 16/16 green throughout because it only ever exercised path mapping. The
 * counts are what a human acts on, so a label that overstates its evidence is the worst defect
 * this tool can have:
 *
 *   - `take` reported 434. Only 86 were earned. 227 had NO pin entry at all — `mineChanged`
 *     evaluated `base && live ? compare : false`, so a missing ancestor silently meant "you did
 *     not change it". Those 227 differ from live by real bytes (ALGORITHM/changelog.md would lose
 *     93 lines; PULSE/Observability globals.css is 9KB upstream vs 84KB live). 62 more existed in
 *     neither the release nor live: `baseBytes !== !!relBytes` compares a Buffer to a boolean and
 *     is always true, so files that exist nowhere were "safe to land".
 *   - `local-only` said "your own file → ignore" for 58 files that are ALL upstream deletions.
 *     Zero were genuinely local. Adopting a deletion is a decision, not a thing to ignore.
 *
 * Ancestry is therefore an explicit input to `classifyPresence`, and where no ancestor exists the
 * bucket says `take-unproven` rather than guessing. See MEMORY/WORK/fix-sync-classifier/ISA.md.
 *
 * ALSO: nothing in this channel can land a `take`. `upstream-apply.ts` is additive-only
 * (INVARIANT 1: an existing destination is a hard skip) and a take exists live by definition.
 * The run prints that next to the count so the number does not read as a work queue.
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

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { normalize } from "./lifeos-normalize.ts";

/**
 * Seven buckets, not five. The extra three exist because the old five had labels that were not
 * true of their contents (audited 2026-07-28, MEMORY/WORK/fix-sync-classifier/ISA.md):
 *
 *   - `take` conflated 86 genuine takes with 286 paths the pin has NO ENTRY for (where "you did
 *     not change it" was a default branch value, not an observation — and 226 of those 286 differ
 *     from live by bytes, some by 70KB+) and 62 that exist in neither the release nor live.
 *   - `local-only` claimed "your own file, not in release" for 58 files that are all, in fact,
 *     upstream DELETIONS: in the pin, dropped by the release, still present live. That is a real
 *     decision (adopt the deletion?), not something to ignore.
 *
 * ANCESTRY IS NOW AN EXPLICIT INPUT. A `take` requires a pin entry, because without one there is
 * nothing to compare live against and therefore no evidence live is unmodified.
 */
type Klass =
  | "take" // pin HAS it, live == pin, release moved → genuinely safe to land
  | "take-unproven" // no pin entry → cannot prove live is unmodified; review, do not bulk-land
  | "conflict" // pin HAS it, live diverges → your line, never auto-take
  | "add" // release has it, live lacks it → candidate port
  | "upstream-deleted" // pin HAS it, release dropped it, live still has it → adopt-deletion decision
  | "local-only" // no pin entry, release lacks it → genuinely your own file
  | "pin-ghost" // pin only: absent from BOTH release and live → nothing to land
  | "unchanged"; // identical

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

/**
 * Rewrite a release-relative path into its PAI/-shaped baseline path.
 *
 * Position-anchored, and case-folded ONLY at the framework root. Both halves of that
 * sentence are load-bearing:
 *
 *   Case-folded at the root, because git records the payload framework root as `LIFEOS`
 *   while this map only ever handled `LifeOS`. 532 release paths therefore entered the
 *   classification union un-normalized under `LIFEOS/` AND again under `PAI/` from the
 *   baseline walk — 269 live paths landed in both `conflict` and `take-unproven` with
 *   contradicting verdicts, and 14 of 196 `add` rows were the same 14 files twice. The
 *   runtime partition check (`sum == union`) cannot see this: it asserts every ENTRY
 *   received a class, not that entries are distinct files.
 *
 *   NOT folded anywhere else, because a blanket case-insensitive match would rewrite
 *   `LIFEOS/DOCUMENTATION/LifeOs/` into `PAI/DOCUMENTATION/PAI/`, while the baseline
 *   really holds `PAI/DOCUMENTATION/LifeOs/`. The payload census is what makes the
 *   anchoring safe: `LIFEOS` occurs only at depth 1 (532x), `LifeOS` only at depth 2
 *   under `skills/` (23x), `LifeOs` only at depth 3 (4x, documentation).
 */
export function normalizeRelPath(rel: string): string {
  return rel
    .split("/")
    .map((seg, i) => {
      // Framework root: fold case. Current payloads spell it LIFEOS, older ones LifeOS.
      if (i === 0 && seg.toLowerCase() === "lifeos") return "PAI";
      // A skill DIRECTORY named LifeOS is the installer skill; its baseline twin is
      // skills/PAI. Exact-case on purpose — see the LifeOs caveat above.
      if (i > 0 && seg === "LifeOS") return "PAI";
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
/**
 * Rewrite a PAI/-shaped BASELINE path back into its path in the RELEASE payload.
 *
 * Extracted from two byte-identical inline `.map()` chains (classifyThreeWay and the
 * --unproven renderer) so there is one place where the release spelling is decided.
 * Both copies emitted `LifeOS` for the framework root; git records it as `LIFEOS`, so
 * every release read resolved only because NTFS is case-insensitive and would miss
 * silently on a case-sensitive checkout. The exact inverse of `normalizeRelPath`, so
 * `toReleaseRelPath(normalizeRelPath(p)) === p` for every real payload path.
 */
export function toReleaseRelPath(baseRel: string): string {
  return baseRel
    .split("/")
    .map((seg, i) => {
      if (i === 0 && seg === "PAI") return "LIFEOS"; // framework root, as git spells it
      if (i > 0 && seg === "PAI") return "LifeOS"; // the installer skill dir
      if (seg === "PAI_SYSTEM_PROMPT.md") return "LIFEOS_SYSTEM_PROMPT.md";
      return seg;
    })
    .join("/");
}

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

/**
 * Paths the PIN must never vendor, because pinning them redistributes them.
 *
 * Upstream removed its licensed webfonts from the release payload and left a `FONTS-README.md`
 * saying they "cannot be redistributed" — Matthew Butterick's Concourse / Valkyrie / Advocate /
 * Heliotrope / Equity / Triplicate families, licensed per-user at mbtype.com. THIS REPO IS PUBLIC,
 * so a font binary sitting in `scripts/upstream-sync/baseline/` is a redistribution no matter what
 * the payload currently holds. 33 such files were pinned by `38e39b43` (2026-07-04, "pin masked
 * v6.0.0 baseline") and outlived upstream's own deletion, because `refreshBaseline` only ever
 * WRITES — it never prunes. That non-pruning is deliberate and stays: the `upstream-deleted` bucket
 * exists precisely because the pin retains a path the release dropped.
 *
 * The rule is FONT BINARIES AS A CLASS, not a list of family names, for two reasons. A name list
 * silently misses the next family upstream ships. And a pinned font contributes nothing a 3-way
 * CONTENT diff can use — `normalize()` skips binaries, so the pin can only ever report same/diff
 * over opaque bytes. Excluding the class costs noticing upstream re-cut a woff2, and buys a
 * guarantee that no licensed binary reaches a public tree through the pin.
 *
 * Scope: `walk()` already skips `out/`, so the two OFL-licensed Geist woff2 files in the payload's
 * `out/_next/static/media/` were never pinned and this rule does not reach them.
 *
 * Live's own copies are a SEPARATE question, adjudicated 2026-08-13 and deliberately KEPT:
 * `~/.claude` is a private repo with no outbound publish path, and upstream's README tells licence
 * holders to "place the woff2 files here". This exclusion governs what the PUBLIC pin carries only.
 */
const RESTRICTED_PIN_EXTS = new Set([".woff", ".woff2", ".ttf", ".otf", ".eot"]);
function isRestrictedForPin(rel: string): boolean {
  return RESTRICTED_PIN_EXTS.has(path.extname(rel).toLowerCase());
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
function refreshBaseline(): { written: number; totalFlags: number; flagged: string[]; skippedRestricted: string[] } {
  const relFiles = walk(RELEASE_PAYLOAD);
  let written = 0;
  let totalFlags = 0;
  const flagged: string[] = [];
  const skippedRestricted: string[] = [];
  for (const rel of relFiles) {
    // Redistribution invariant, enforced at the only place the pin is written. Counted and
    // printed rather than skipped silently, so a future payload that ships fonts says so.
    if (isRestrictedForPin(rel)) {
      skippedRestricted.push(rel);
      continue;
    }
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
  return { written, totalFlags, flagged, skippedRestricted };
}

/**
 * Enforce the redistribution invariant on an EXISTING pin: remove any restricted file already
 * vendored. Deliberately separate from `refreshBaseline` and reachable without `--adopt`, because
 * adopting advances the pin to the current release and rewrites every classification — far too
 * large a side effect for "delete files that must never have been here". Dry-run unless `write`.
 */
function pruneRestrictedFromBaseline(write: boolean): string[] {
  const hits = walk(BASELINE_ROOT).filter(isRestrictedForPin);
  if (write) for (const rel of hits) unlinkSync(path.join(BASELINE_ROOT, ...rel.split("/")));
  return hits;
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
 *    local-only : STRUCTURALLY UNREACHABLE here — see the note at the count
 *    take        : upstream changed, you did NOT            → safe to land
 *    conflict    : BOTH changed (or live differs + upstream also moved) → review, never auto-take
 *    unchanged   : neither changed
 *
 * When BASELINE == RELEASE (first run, only one release exists), upstream is always
 * "same", so `take` is legitimately 0 — there is no newer version yet. At v7 the pin
 * lags the new payload and `take` becomes populated. That 0 is now HONEST, not a bug.
 */
/**
 * The decision, expressed over PRESENCE (three booleans) and then equality. Written as an explicit
 * 8-way table rather than a chain of early returns, because the old chain's guess-by-default is
 * what produced three false labels:
 *
 *   `mineChanged = baseBytes && liveBytes ? compare : false`
 *       With no pin entry this yields `false` — "you did not change it" — which is an ASSERTION,
 *       not an observation. 286 paths took this branch and were reported "safe to land".
 *
 *   `upstreamChanged = ... : baseBytes !== !!relBytes`
 *       Compares a Buffer to a boolean. Always true. 62 pin-only ghosts were reported as takes.
 *
 * Both are now unreachable: equality is only ever consulted when both sides of that comparison
 * actually exist, and every presence combination has its own named outcome.
 */
export function classifyPresence(
  base: Buffer | null,
  release: Buffer | null,
  live: Buffer | null,
): Klass {
  const hasBase = base !== null;
  const hasRelease = release !== null;
  const hasLive = live !== null;

  // ── no pin entry: ancestry is absent, so nothing about live can be PROVEN ──────
  if (!hasBase) {
    if (hasRelease && !hasLive) return "add"; // straightforwardly new upstream file
    if (!hasRelease && hasLive) return "local-only"; // genuinely yours: no pin, not in release
    if (hasRelease && hasLive) {
      // Both sides have it and there is no common ancestor to attribute the difference to.
      // Byte-equal is safe to call unchanged; differing is UNPROVEN, never "safe to land".
      return Buffer.compare(release, live) === 0 ? "unchanged" : "take-unproven";
    }
    return "unchanged"; // exists nowhere — a walk artefact
  }

  // ── pin entry exists: a real 3-way comparison is possible ─────────────────────
  if (!hasRelease && !hasLive) return "pin-ghost"; // pin-only: nothing to land anywhere
  if (!hasRelease && hasLive) return "upstream-deleted"; // release dropped it, live keeps it
  if (hasRelease && !hasLive) return "add"; // live lacks it → candidate port

  const mineChanged = Buffer.compare(base, live) !== 0;
  const upstreamChanged = Buffer.compare(base, release) !== 0;
  if (mineChanged) return "conflict"; // live diverged from the pin → protect it
  if (upstreamChanged) return "take"; // live still AT the pin, release moved → earned
  return "unchanged";
}

function classifyThreeWay(baseRel: string): Klass {
  const baseAbs = path.join(BASELINE_ROOT, ...baseRel.split("/"));
  const relRel = toReleaseRelPath(baseRel);
  const releaseAbs = path.join(RELEASE_PAYLOAD, ...relRel.split("/"));
  const liveAbs = path.join(liveRoot(), ...toLiveRelPath(baseRel).split("/"));

  const baseBytes = existsSync(baseAbs) && statSync(baseAbs).isFile() ? readFileSync(baseAbs) : null;
  const relBytes = existsSync(releaseAbs) && statSync(releaseAbs).isFile()
    ? normalizedReleaseBytes(releaseAbs, relRel) // normalize on the fly — matches how the pin was made
    : null;
  const liveBytes = existsSync(liveAbs) && statSync(liveAbs).isFile() ? readFileSync(liveAbs) : null;

  return classifyPresence(baseBytes, relBytes, liveBytes);
}

function gitStat(baseAbs: string, otherAbs: string): string {
  const r = spawnSync("git", ["diff", "--no-index", "--stat", baseAbs, otherAbs], { encoding: "utf8" });
  const line = (r.stdout || "").trim().split("\n").pop() || "";
  return line.trim();
}

function main(argv: string[]): number {
  if (argv.includes("--self-test")) return runSelfTest();

  // Enforce the pin's redistribution invariant without touching live and without advancing the
  // pin. Dry-run by default; `--write` performs the unlink. Returns before the read-only banner
  // below because this mode DOES write — to the repo's own pin, never to live.
  if (argv.includes("--prune-restricted")) {
    const write = argv.includes("--write");
    const hits = pruneRestrictedFromBaseline(write);
    console.log(`prune-restricted — ${write ? "WRITE" : "dry-run"}: ${hits.length} restricted file(s) vendored in the pin`);
    for (const h of hits) console.log(`  ${write ? "removed " : "would remove "}${h}`);
    if (!hits.length) console.log("  pin is clean — no font binaries vendored");
    return 0;
  }
  // The baseline is a PINNED, committed ancestor. Write it only on first bootstrap
  // (absent) or on explicit `--adopt` (advance the pin to the current release AFTER
  // a sync). A plain run NEVER rewrites the pin — that is what keeps `take` real.
  const bootstrap = !existsSync(BASELINE_ROOT);
  const adopt = argv.includes("--adopt");

  console.log("upstream-sync — READ-ONLY 3-way view (no --apply; never writes to live)\n");
  if (bootstrap || adopt) {
    console.log(bootstrap ? "Bootstrapping pinned baseline from current release..." : "Adopting current release as new pinned baseline...");
    const { written, totalFlags, flagged, skippedRestricted } = refreshBaseline();
    console.log(`  baseline: ${written} files written to ${path.relative(REPO_ROOT, BASELINE_ROOT)} (commit this pin)`);
    console.log(`  skipped as non-redistributable (font binaries — see isRestrictedForPin): ${skippedRestricted.length}`);
    for (const s of skippedRestricted) console.log(`    SKIP-RESTRICTED ${s}`);
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
  const buckets: Record<Klass, string[]> = {
    take: [], "take-unproven": [], conflict: [], add: [],
    "upstream-deleted": [], "local-only": [], "pin-ghost": [], unchanged: [],
  };
  for (const baseRel of baseRels) buckets[classifyThreeWay(baseRel)].push(baseRel);

  // A bucket set that does not partition the union means a path was silently dropped or
  // double-counted — which is precisely how a wrong count stays invisible. Assert it at
  // RUNTIME, not only in the self-test: the self-test runs on synthetic input.
  const bucketTotal = Object.values(buckets).reduce((n, b) => n + b.length, 0);
  if (bucketTotal !== baseRels.size) {
    console.error(`FATAL: buckets sum to ${bucketTotal} but the union has ${baseRels.size} paths — classification is dropping or duplicating paths.`);
    return 1;
  }

  console.log("3-WAY CLASSIFICATION (baseline = PINNED common ancestor):");
  console.log(`  take            ${buckets.take.length}  — pin HAS it, live == pin, release moved → safe to land (proven)`);
  console.log(`  take-unproven   ${buckets["take-unproven"].length}  — NO pin entry, release and live both have it and DIFFER →`);
  console.log(`                        no common ancestor exists, so nothing proves live is unmodified. Review individually.`);
  console.log(`  conflict        ${buckets.conflict.length}  — pin HAS it, live DIFFERS from pin → your line; NEVER auto-take`);
  console.log(`  add             ${buckets.add.length}  — release has it, live lacks it → candidate port`);
  console.log(`  upstream-deleted ${buckets["upstream-deleted"].length}  — pin HAS it, release DROPPED it, live still has it → adopt the deletion?`);
  // This count is STRUCTURALLY 0 and must be read as "not measured", never as "live has no
  // files of its own". `local-only` needs no-base AND no-release, but the classified set is
  // walk(BASELINE) ∪ walk(RELEASE) — a live-only path is not a member, so classifyThreeWay is
  // never called on it. The bucket is kept because classifyPresence is a total function over
  // all eight presence combinations and the self-test asserts that branch; only the production
  // union cannot reach it. Measured 2026-07-31: 1443 live files under LIFEOS/ skills/ hooks/
  // agents/ sit outside the union. A 0 next to the words "genuinely your own file" invited
  // exactly the wrong reading — that this channel had audited them and found none.
  console.log(`  local-only      ${buckets["local-only"].length}  — ALWAYS 0: unreachable, the classified set is baseline ∪ release,`);
  console.log(`                        so live-only files are never classified. NOT a measurement of your own files.`);
  console.log(`  pin-ghost       ${buckets["pin-ghost"].length}  — pin only: absent from BOTH release and live → nothing to land`);
  console.log(`  unchanged       ${buckets.unchanged.length}  — identical`);
  console.log(`  (sum ${bucketTotal} == union ${baseRels.size} ✓)\n`);

  // The channel READS. Nothing here can land a `take`: upstream-apply.ts is additive-only
  // (INVARIANT 1 — an existing destination is a hard skip) and every take exists live by
  // definition. Saying so next to the count stops the number reading as a work queue.
  if (buckets.take.length > 0 || buckets["take-unproven"].length > 0) {
    console.log("  NOTE: no tool in this channel lands a take. upstream-apply.ts is additive-only, and a");
    console.log("        take exists live by definition, so it reports skip-exists. Landing an in-place");
    console.log("        update is a separate, unbuilt increment.\n");
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
  if (argv.includes("--unproven")) {
    console.log("TAKE-UNPROVEN (no pin ancestor — RELEASE vs LIVE delta, so the size of what landing");
    console.log("this would overwrite is visible; a small delta is not evidence of safety, only of scale.");
    console.log("The diff is release-vs-live deliberately: there IS no baseline file for these paths,");
    console.log("which is the entire reason they are unproven):");
    const cap = showAll ? buckets["take-unproven"].length : 40;
    for (const rel of buckets["take-unproven"].slice(0, cap)) {
      const relRel = toReleaseRelPath(rel);
      const stat = gitStat(path.join(RELEASE_PAYLOAD, ...relRel.split("/")), path.join(liveRoot(), ...toLiveRelPath(rel).split("/")));
      console.log(`  UNPROVEN ${toLiveRelPath(rel)}  ${stat}`);
    }
    if (buckets["take-unproven"].length > cap) console.log(`  ... +${buckets["take-unproven"].length - cap} more (use --all)`);
    console.log("");
  }
  if (argv.includes("--deleted")) {
    console.log("UPSTREAM-DELETED (in the pin, dropped by the release, still live — adopt the deletion?):");
    const cap = showAll ? buckets["upstream-deleted"].length : 60;
    for (const rel of buckets["upstream-deleted"].slice(0, cap)) console.log(`  DELETED-UPSTREAM ${toLiveRelPath(rel)}`);
    if (buckets["upstream-deleted"].length > cap) console.log(`  ... +${buckets["upstream-deleted"].length - cap} more (use --all)`);
    console.log("");
  }
  console.log("Next: `--conflicts` / `--adds` / `--unproven` / `--deleted` for detail (`--all` defeats the caps).");
  console.log("Landing items is a later gated increment (guarded apply, additive-only).");
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

  // ── CASE-SHAPE cases ────────────────────────────────────────────────────────
  // The union double-count bug: git says the payload framework root is spelled LIFEOS,
  // but the map only handled LifeOS, so 532 release paths entered the union
  // un-normalized under LIFEOS/ AND again under PAI/ from the baseline walk — 269 live
  // paths landed in both `conflict` and `take-unproven` with contradicting verdicts.
  // Invisible to every fixture above because none used the real spelling, and invisible
  // to the runtime partition check because that asserts every ENTRY got a class, not
  // that entries are distinct files.
  //
  // The obvious fix is a trap: a blanket case-insensitive fold also rewrites
  // LIFEOS/DOCUMENTATION/LifeOs/ into PAI/DOCUMENTATION/PAI/, where the baseline really
  // has PAI/DOCUMENTATION/LifeOs/. The payload census is what makes the anchoring safe:
  // LIFEOS appears only at position 1 (532x), LifeOS only at position 2 under skills/
  // (23x, and skills/PAI is a real baseline dir), LifeOs only at position 3 (4x).
  const caseCases: { name: string; in: string; want: string }[] = [
    // The bug itself: the spelling git actually records for the payload root.
    { name: "release root LIFEOS/ normalizes", in: "LIFEOS/ALGORITHM/LATEST", want: "PAI/ALGORITHM/LATEST" },
    { name: "release root bare LIFEOS", in: "LIFEOS", want: "PAI" },
    // Both spellings must converge, or the same logical file classifies twice.
    { name: "LIFEOS and LifeOS converge", in: "LIFEOS/TOOLS/Inference.ts", want: normalizeRelPath("LifeOS/TOOLS/Inference.ts") },
    // No regression on the pre-existing mappings.
    { name: "no regression: LifeOS root still maps", in: "LifeOS/PULSE/pulse.ts", want: "PAI/PULSE/pulse.ts" },
    { name: "no regression: system prompt basename", in: "LIFEOS/LIFEOS_SYSTEM_PROMPT.md", want: "PAI/PAI_SYSTEM_PROMPT.md" },
    // The trap: a nested dir named LifeOs is documentation, NOT the framework root.
    { name: "anti: nested LifeOs is NOT the framework root", in: "LIFEOS/DOCUMENTATION/LifeOs/LifeOsThesis.md", want: "PAI/DOCUMENTATION/LifeOs/LifeOsThesis.md" },
    { name: "anti: nested lowercase lifeos untouched", in: "LIFEOS/TOOLS/lifeos/x.ts", want: "PAI/TOOLS/lifeos/x.ts" },
    // skills/LifeOS is a SKILL name at position 2, and its baseline twin is skills/PAI.
    { name: "skills/LifeOS maps to skills/PAI", in: "skills/LifeOS/SKILL.md", want: "skills/PAI/SKILL.md" },
    // Reverse direction (baseline -> release payload). Duplicated inline at two call
    // sites before this fix, both emitting LifeOS for the root — resolving only because
    // NTFS is case-insensitive, and silently broken on a case-sensitive checkout.
    { name: "reverse: PAI root emits the real LIFEOS spelling", in: "@rev:PAI/ALGORITHM/LATEST", want: "LIFEOS/ALGORITHM/LATEST" },
    { name: "reverse: bare PAI root", in: "@rev:PAI", want: "LIFEOS" },
    { name: "reverse: skills/PAI emits skills/LifeOS", in: "@rev:skills/PAI/SKILL.md", want: "skills/LifeOS/SKILL.md" },
    { name: "reverse: system prompt basename", in: "@rev:PAI/PAI_SYSTEM_PROMPT.md", want: "LIFEOS/LIFEOS_SYSTEM_PROMPT.md" },
    { name: "reverse anti: nested LifeOs untouched", in: "@rev:PAI/DOCUMENTATION/LifeOs/LifeOsThesis.md", want: "LIFEOS/DOCUMENTATION/LifeOs/LifeOsThesis.md" },
    // Round-trip closure: every real payload path must survive both maps unchanged.
    { name: "round-trip: LIFEOS root", in: "@rt:LIFEOS/ALGORITHM/LATEST", want: "LIFEOS/ALGORITHM/LATEST" },
    { name: "round-trip: skills/LifeOS", in: "@rt:skills/LifeOS/SKILL.md", want: "skills/LifeOS/SKILL.md" },
    { name: "round-trip: nested LifeOs docs", in: "@rt:LIFEOS/DOCUMENTATION/LifeOs/RenameMap.json", want: "LIFEOS/DOCUMENTATION/LifeOs/RenameMap.json" },
    { name: "round-trip: system prompt", in: "@rt:LIFEOS/LIFEOS_SYSTEM_PROMPT.md", want: "LIFEOS/LIFEOS_SYSTEM_PROMPT.md" },
  ];
  for (const c of caseCases) {
    total += 1;
    const got = c.in.startsWith("@rev:")
      ? toReleaseRelPath(c.in.slice(5))
      : c.in.startsWith("@rt:")
        ? toReleaseRelPath(normalizeRelPath(c.in.slice(4)))
        : normalizeRelPath(c.in);
    if (got === c.want) pass += 1;
    else console.error(`FAIL case-shape ${c.name} → got ${got}, want ${c.want}`);
  }
  // ── CLASSIFICATION cases ────────────────────────────────────────────────────
  // The old self-test was 16/16 green while three bucket labels were false, because it only
  // exercised path mapping. These cases test what a bucket MEANS. Each is written so that
  // reverting the corresponding guard turns it RED (mutation-proven — see the ISA).
  const B = (s: string) => Buffer.from(s, "utf8");
  const classCases: { name: string; base: Buffer | null; rel: Buffer | null; live: Buffer | null; want: Klass }[] = [
    // A take is EARNED: pin present, live identical to pin, release moved.
    { name: "take: pin==live, release moved", base: B("v1"), rel: B("v2"), live: B("v1"), want: "take" },
    // The 286-path bug. No pin entry => no ancestor => cannot prove live is unmodified.
    { name: "take-unproven: NO pin entry, release and live differ", base: null, rel: B("v2"), live: B("v1"), want: "take-unproven" },
    // Anti-case for the same bug: the old code returned "take" here. If the ancestry guard is
    // reverted to `mineChanged ? ... : false`, this case fails.
    { name: "anti: no-pin + differing must NOT be a plain take", base: null, rel: B("aaa"), live: B("bbb"), want: "take-unproven" },
    // No pin, but both sides agree — nothing to do, and not "unproven" either.
    { name: "unchanged: no pin entry but release==live", base: null, rel: B("same"), live: B("same"), want: "unchanged" },
    // The 62-ghost bug: Buffer !== !!Buffer was always true, so this returned "take".
    { name: "pin-ghost: pin only, absent from release AND live", base: B("old"), rel: null, live: null, want: "pin-ghost" },
    { name: "anti: pin-ghost must NOT be a take", base: B("old"), rel: null, live: null, want: "pin-ghost" },
    // The local-only mislabel: all 58 real ones are upstream deletions.
    { name: "upstream-deleted: pin has it, release dropped, live keeps", base: B("x"), rel: null, live: B("x"), want: "upstream-deleted" },
    { name: "upstream-deleted even when live edited it since the pin", base: B("x"), rel: null, live: B("x-edited"), want: "upstream-deleted" },
    // Genuine local-only requires NO pin entry.
    { name: "local-only: no pin entry and not in release", base: null, rel: null, live: B("mine"), want: "local-only" },
    // Conflict needs a pin to attribute divergence to.
    { name: "conflict: pin has it, live diverged", base: B("v1"), rel: B("v2"), live: B("mine"), want: "conflict" },
    { name: "conflict even when release is unchanged vs pin", base: B("v1"), rel: B("v1"), live: B("mine"), want: "conflict" },
    // Adds, both with and without a pin entry.
    { name: "add: release has it, live lacks it (no pin)", base: null, rel: B("new"), live: null, want: "add" },
    { name: "add: release has it, live lacks it (pin had it)", base: B("v1"), rel: B("v2"), live: null, want: "add" },
    { name: "unchanged: all three identical", base: B("s"), rel: B("s"), live: B("s"), want: "unchanged" },
    { name: "unchanged: exists nowhere", base: null, rel: null, live: null, want: "unchanged" },
  ];
  for (const c of classCases) {
    total += 1;
    const got = classifyPresence(c.base, c.rel, c.live);
    if (got === c.want) pass += 1;
    else console.error(`FAIL class ${c.name} → got ${got}, want ${c.want}`);
  }

  // A "take" must never be reachable without a pin entry. Exhaustive over the presence lattice
  // rather than a spot check: this is the invariant the whole fix rests on.
  total += 1;
  const takeWithoutAncestor = ([null, B("a")] as (Buffer | null)[]).flatMap((rel) =>
    ([null, B("a"), B("b")] as (Buffer | null)[]).map((live) => classifyPresence(null, rel, live)),
  ).filter((k) => k === "take");
  if (takeWithoutAncestor.length === 0) pass += 1;
  else console.error(`FAIL anti: ${takeWithoutAncestor.length} no-pin combination(s) classified as a proven take`);

  // The buckets must PARTITION: every presence/equality combination lands in exactly one, and
  // no combination falls through to a default.
  total += 1;
  const allKlasses = new Set<Klass>();
  for (const base of [null, B("p")] as (Buffer | null)[])
    for (const rel of [null, B("p"), B("r")] as (Buffer | null)[])
      for (const live of [null, B("p"), B("l")] as (Buffer | null)[])
        allKlasses.add(classifyPresence(base, rel, live));
  const known: Klass[] = ["take", "take-unproven", "conflict", "add", "upstream-deleted", "local-only", "pin-ghost", "unchanged"];
  const unknown = [...allKlasses].filter((k) => !known.includes(k));
  if (unknown.length === 0) pass += 1;
  else console.error(`FAIL partition: unexpected class(es) ${unknown.join(", ")}`);

  // `local-only` is a total-function branch that the PRODUCTION union cannot reach, and the
  // printed 0 must never be read as "audited your files, found none". The claim is asserted,
  // not just commented: the only way to reach the branch is a path absent from BOTH baseline
  // and release, and the classified set is the union of exactly those two walks. If someone
  // later adds a live walk to that union, this case fails and forces the label to be revisited.
  total += 1;
  {
    // Reconstruct the membership rule over synthetic roots: a member must exist in >=1 of the
    // two walked trees, which is precisely the negation of local-only's precondition.
    const memberOf = (inBase: boolean, inRel: boolean) => inBase || inRel;
    const reachable = [false, true].flatMap((inBase) =>
      [false, true].map((inRel) => ({ inBase, inRel })),
    ).filter(({ inBase, inRel }) => {
      if (!memberOf(inBase, inRel)) return false; // not classified at all
      const k = classifyPresence(inBase ? B("p") : null, inRel ? B("r") : null, B("mine"));
      return k === "local-only";
    });
    if (reachable.length === 0) pass += 1;
    else console.error(`FAIL anti: local-only reachable from the baseline∪release union in ${reachable.length} case(s) — the printed count is no longer structurally 0, so its label must change`);
  }
  // Control for the case above: with a live-only path treated as a member (the hypothetical
  // third walk), the branch MUST become reachable. Without this, the assertion above would
  // pass just as happily if classifyPresence had stopped returning local-only altogether.
  total += 1;
  if (classifyPresence(null, null, B("mine")) === "local-only") pass += 1;
  else console.error(`FAIL control: local-only is no longer produced for a live-only path, so the unreachability assertion above proves nothing`);

  // The pin's redistribution invariant (see isRestrictedForPin). Asserted in BOTH directions,
  // because a predicate that answered true for everything would satisfy the exclusion cases on
  // its own and would silently empty the pin on the next --adopt.
  for (const rel of [
    "PAI/PULSE/Observability/public/fonts/valkyrie_a_regular.woff2",
    "skills/Telos/ReportTemplate/Public/Fonts/concourse_3_bold.woff2",
    "PAI/LIFEOS_INSTALL/public/assets/fonts/equity_text_b_regular-webfont.woff",
    "PAI/LIFEOS_INSTALL/public/assets/fonts/triplicate_t3_code_regular.ttf",
  ]) {
    total += 1;
    if (isRestrictedForPin(rel)) pass += 1;
    else console.error(`FAIL restricted: ${rel} would be vendored into the PUBLIC pin`);
  }
  for (const rel of [
    "PAI/TOOLS/Inference.ts",
    "PAI/PULSE/Observability/public/fonts/FONTS-README.md", // the README must survive the rule
    "PAI/PULSE/Observability/src/app/globals.css",
    "install.sh",
    "PAI/ALGORITHM/LATEST", // extensionless — must not be swept in as "unknown"
  ]) {
    total += 1;
    if (!isRestrictedForPin(rel)) pass += 1;
    else console.error(`FAIL control: ${rel} is not a font binary but was excluded from the pin`);
  }
  // The invariant must hold on the pin AS COMMITTED, not merely on synthetic paths. This is the
  // arm that was red before the 2026-08-13 prune (33 files), and it goes red again if any future
  // --adopt or hand-copy re-vendors a font binary into a public tree.
  total += 1;
  {
    const vendored = existsSync(BASELINE_ROOT) ? walk(BASELINE_ROOT).filter(isRestrictedForPin) : [];
    if (vendored.length === 0) pass += 1;
    else console.error(`FAIL pin: ${vendored.length} restricted file(s) vendored in the committed baseline — run --prune-restricted --write`);
  }

  console.log(`${pass}/${total} passed`);
  return pass === total ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
