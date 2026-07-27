#!/usr/bin/env bun
/**
 * upstream-apply — increment 2 of the sync channel: the GUARDED apply that lands
 * classified release items into the live LIFEOS/-shaped tree.
 *
 * SHAPE (corrected 2026-07-28): live `~/.claude` was renamed PAI/ -> LIFEOS/ on
 * 2026-07-05, and the merged payload is ALSO LIFEOS/-shaped. Both sides now agree,
 * so this tool applies NO transform in either dimension — identity paths, verbatim
 * bytes. It previously ran `lifeos-normalize` on both, which rewrote LIFEOS/ -> PAI/
 * and thereby CAUSED the silent-empty-dir class INVARIANT 4 exists to prevent:
 * 62 of 152 planned adds carried a dead `PAI/` token, 12 carried secret-masking
 * placeholders, and the residual-flag gate blocked 145 files for tokens that are
 * now correct. See MEMORY/WORK/fix-upstream-apply-shape/ISA.md.
 *
 * This is the ONLY tool in the channel that writes into live `~/.claude`, so its
 * guards are deliberately strict. It is NOT a reuse of build-release.ts's
 * assertDestSafe: that guard trusts live as SOURCE and requires the destination be
 * a `.claude` under Releases/ — the exact inverse of what we do here (Cato-flagged:
 * the containment invariant is not reverse-symmetric). We keep build-release's
 * junction-safe realpath primitives (realOrSelf/isUnder) and rewrite the policy.
 *
 * INVARIANTS (all enforced, fail-closed):
 *  1. ADDITIVE-ONLY. Writes ONLY files upstream-sync classifies `add` (release has
 *     it, live lacks it). NEVER overwrites an existing live file — that is how the
 *     397 conflicts (your ahead-of-safety Algorithm/hook line) stay untouched. An
 *     existing destination is a hard skip, not a merge.
 *  2. CONTAINMENT. Every destination realpath-resolves strictly INSIDE the live
 *     root (junction/reparse-safe). A path escaping the root aborts the whole run.
 *  3. SKILLS GO THROUGH CreateSkill. Live's skills/CLAUDE.md mandates Skill("CreateSkill")
 *     for skill ports; this tool REFUSES skills/** and lists them for the human to
 *     route through CreateSkill. It does not hand-drop SKILL.md files.
 *  4. VERBATIM BYTES. Writes the release bytes UNCHANGED. Live and the payload are
 *     both LIFEOS/-shaped, so any rewrite is a corruption, not a port. What this
 *     invariant really guards is "the written file must resolve against live" — and
 *     post-rename that means NO transform. The guard is now a positive assertion
 *     (see PAI_TOKEN_RE below) rather than a transform: a file carrying a live-dead
 *     `PAI/`-rooted path or `PAI_` env token is REFUSED, not silently rewritten.
 *  5. NO AUTO-COMMIT. Writes files and stops. The human reviews `git status`/`git diff`
 *     in the live repo and commits (signed) themselves. Dry-run is the default;
 *     --apply is required to write.
 *  6. DEAD-TOKEN BLOCKING. A file carrying a token that cannot resolve in the live
 *     LIFEOS/-shaped tree (`PAI/`-rooted path, `PAI_` env var, bare terminal `/PAI`
 *     segment) is NOT auto-written under --apply unless --allow-flagged is passed —
 *     it is a human decision. This replaces the old residual-`LifeOS`-token gate,
 *     which was inverted: it blocked 145 files for carrying LIFEOS/LifeOS tokens that
 *     are now CORRECT. Exemptions are enumerated at PAI_TOKEN_EXEMPT below, each with
 *     its reason. The gate deliberately over-refuses (brand-name prose is flagged):
 *     it refuses rather than rewrites, so a false positive costs a human glance while
 *     a false negative writes a broken file into the running system.
 *  7. USER/ IS A SCAFFOLD ZONE, NEVER SYNCED. The release's USER/ tree is SAMPLE
 *     TEMPLATES ("Replace with your own via /interview"). Live USER/ is the human's
 *     real personal data. Landing templates there would scatter placeholders into
 *     populated personal content — the exact "never clobber a populated zone" rule.
 *     USER/ ports are refused; onboarding owns that tree (the LifeOS install skill /
 *     Interview), not the release-sync channel.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const RELEASE_PAYLOAD = path.join(REPO_ROOT, "LifeOS", "install");

// LIFEOS_DIR is the current override (matches build-release.ts and upstream-sync.ts);
// PAI_DIR is kept for back-compat. Both name the CONFIG ROOT (~/.claude), not the
// framework subdir. Honouring only PAI_DIR meant a sandboxed rehearsal written with
// the current env var silently targeted the REAL live tree — on the one tool in the
// channel that writes.
function liveRoot(): string {
  const home = process.env.HOME || os.homedir();
  const override = process.env.LIFEOS_DIR ?? process.env.PAI_DIR;
  return override ? path.resolve(override) : path.join(home, ".claude");
}

/**
 * Tokens that cannot resolve against a LIFEOS/-shaped live tree. A payload file
 * carrying one is REFUSED (INVARIANT 6), never rewritten — the channel is
 * audit-not-auto, and a wrong transform is worse than a skip.
 *
 * Three dead forms, all killed by the 2026-07-05 rename:
 *   `PAI/`-rooted paths, `PAI_<CAPS>` env vars, and a bare TERMINAL `/PAI` segment.
 * The third was a false negative in the first cut of this guard: `PiSync.sh:13` tests
 * `[ -d "$LIFEOS/PAI" ]` against a dir that no longer exists, and a slash-terminated
 * `PAI` has no trailing slash for `PAI\/` to catch.
 *
 * This gate REFUSES rather than rewrites, so the error costs are asymmetric: a false
 * positive costs one human glance at a listed line, a false negative writes a broken
 * file into the running system. It is therefore deliberately tuned to over-refuse —
 * brand-name prose like `{{DA_NAME}}/PAI` gets flagged, and that is the correct trade.
 *
 * Exemptions, each verified against live: `PAI_SYSTEM_PROMPT` (the byte-identical
 * safety-net copy at LIFEOS/PAI_SYSTEM_PROMPT.md, which stays until a launcher is
 * confirmed), `PAIUpgrade`/`PAITheme`/`PAIColors` (names deliberately kept at the cut),
 * `~/.config/PAI` (a DIFFERENT directory, never renamed), and `PAI-Install` (the
 * installer engine's internals, which are fork-build-shaped, not a live surface).
 */
const PAI_TOKEN_RE = /\bPAI\/|\bPAI_[A-Z]|\/PAI\b/g;
const PAI_TOKEN_EXEMPT = /PAI_SYSTEM_PROMPT|PAIUpgrade|PAITheme|PAIColors|\.config\/PAI|PAI-Install/;

export function deadPaiTokens(text: string): { line: number; token: string; context: string }[] {
  const out: { line: number; token: string; context: string }[] = [];
  text.split("\n").forEach((lineText, i) => {
    PAI_TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PAI_TOKEN_RE.exec(lineText)) !== null) {
      const around = lineText.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20);
      if (PAI_TOKEN_EXEMPT.test(around)) continue;
      out.push({ line: i + 1, token: m[0], context: lineText.trim().slice(0, 110) });
    }
  });
  return out;
}

// ── junction/reparse-safe containment (borrowed from build-release.ts) ─────────
function realOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
function isUnder(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
/** Resolve the deepest existing ancestor's realpath, then re-append the missing
 *  tail — so containment holds even for a not-yet-created destination file. */
function realDestWithin(destAbs: string, root: string): { ok: boolean; resolved: string } {
  let cur = destAbs;
  const tail: string[] = [];
  while (!existsSync(cur) && path.dirname(cur) !== cur) {
    tail.unshift(path.basename(cur));
    cur = path.dirname(cur);
  }
  const resolved = path.join(realOrSelf(cur), ...tail);
  return { ok: isUnder(resolved, realOrSelf(root)), resolved };
}

const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".md", ".mdx", ".json", ".jsonc",
  ".toml", ".yaml", ".yml", ".sh", ".bash", ".zsh", ".txt", ".css", ".scss", ".html", ".hbs",
  ".plist", ".service", ".swift", ".py", ".env", ".example",
]);
const TEXT_BASENAMES = new Set(["LATEST", "VERSION", "Dockerfile", "Makefile"]);
function isText(rel: string): boolean {
  if (TEXT_BASENAMES.has(path.basename(rel))) return true;
  const ext = path.extname(rel).toLowerCase();
  return ext ? TEXT_EXTS.has(ext) : false;
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

// Zones the sync channel must never write into. USER/ is the human's personal data
// (release ships only templates); MEMORY/ is operational state; both are owned by
// onboarding/runtime, not release-sync.
// Both shapes listed: the payload's scaffold trees are top-level (USER/, MEMORY/),
// which is what these prefixes catch today, but the LIFEOS/-rooted forms are the
// live shape and must be covered if a future payload nests them. PAI/ forms retained
// for a baseline-shaped input.
const SCAFFOLD_ZONES = [
  "USER/", "MEMORY/",
  "LIFEOS/USER/", "LIFEOS/MEMORY/",
  "PAI/USER/", "PAI/MEMORY/",
];

type Plan = {
  releaseRel: string; // path within RELEASE_PAYLOAD
  liveRel: string; // path within live root — IDENTICAL to releaseRel (both LIFEOS/-shaped)
  bytes: Buffer;
  flags: number; // count of live-dead PAI tokens
  firstFlag?: { line: number; token: string; context: string };
  status: "will-add" | "skip-exists" | "skip-skill" | "skip-scaffold" | "skip-flagged" | "skip-escape";
};

function buildPlan(only?: string, allowFlagged = false): Plan[] {
  const root = liveRoot();
  const plans: Plan[] = [];
  for (const releaseRel of walk(RELEASE_PAYLOAD)) {
    // IDENTITY. Payload and live are both LIFEOS/-shaped as of 2026-07-05, so there
    // is no path map. (The old `normalizeRelPath` call landed correctly only by
    // accident: it rewrites a segment spelled `LifeOS`, and the payload spells the
    // framework root `LIFEOS`. Relying on that spelling was luck, not design.)
    const liveRel = releaseRel;
    if (only && !liveRel.startsWith(only)) continue;
    const srcAbs = path.join(RELEASE_PAYLOAD, ...releaseRel.split("/"));
    const destAbs = path.join(root, ...liveRel.split("/"));

    // VERBATIM. No transform, no secret-masking. maskSecrets lives inside normalize()
    // and is scoped to the DIFF-ONLY vendored baseline; running it on a write path
    // would land `<REDACTED:high-entropy>` placeholders in executable live files.
    const bytes = readFileSync(srcAbs);
    const dead = isText(releaseRel) ? deadPaiTokens(bytes.toString("utf8")) : [];

    let status: Plan["status"];
    if (existsSync(destAbs)) status = "skip-exists"; // INVARIANT 1: never overwrite
    else if (SCAFFOLD_ZONES.some((z) => liveRel.startsWith(z))) status = "skip-scaffold"; // INVARIANT 7: USER/MEMORY owned by onboarding
    else if (liveRel.startsWith("skills/")) status = "skip-skill"; // INVARIANT 3: CreateSkill owns these
    else if (!realDestWithin(destAbs, root).ok) status = "skip-escape"; // INVARIANT 2: containment
    else if (dead.length > 0 && !allowFlagged) status = "skip-flagged"; // INVARIANT 6: live-dead token
    else status = "will-add";

    plans.push({ releaseRel, liveRel, bytes, flags: dead.length, firstFlag: dead[0], status });
  }
  return plans;
}

function main(argv: string[]): number {
  if (argv.includes("--self-test")) return runSelfTest();
  const apply = argv.includes("--apply");
  const allowFlagged = argv.includes("--allow-flagged");
  const onlyIdx = argv.indexOf("--only");
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : undefined;

  console.log(`upstream-apply — ${apply ? "APPLY (writing ADDs to live)" : "DRY-RUN (no writes)"} | live=${liveRoot()}`);
  if (only) console.log(`  scope: --only ${only}`);
  console.log("  additive-only · contained · verbatim · skills→CreateSkill · no auto-commit\n");

  const plans = buildPlan(only, allowFlagged);
  const counts: Record<Plan["status"], number> = {
    "will-add": 0, "skip-exists": 0, "skip-skill": 0, "skip-scaffold": 0, "skip-flagged": 0, "skip-escape": 0,
  };
  for (const p of plans) counts[p.status] += 1;

  let written = 0;
  for (const p of plans) {
    if (p.status !== "will-add") continue;
    console.log(`  add  ${p.liveRel}${p.flags ? ` (${p.flags} dead PAI token(s), --allow-flagged)` : ""}`);
    if (apply) {
      const destAbs = path.join(liveRoot(), ...p.liveRel.split("/"));
      // Re-check containment at write time (TOCTOU-safe: guard immediately precedes write).
      if (!realDestWithin(destAbs, liveRoot()).ok) {
        console.error(`  ABORT: containment escape at write time: ${p.liveRel}`);
        return 1;
      }
      mkdirSync(path.dirname(destAbs), { recursive: true });
      writeFileSync(destAbs, p.bytes);
      written += 1;
    }
  }

  // A bare skip count reads as "nothing to see". Name every refusal with its token,
  // uncapped: a file silently withheld from the plan is the failure mode this channel
  // is supposed to make visible.
  const flaggedPlans = plans.filter((p) => p.status === "skip-flagged");
  if (flaggedPlans.length) {
    console.log("");
    console.log("REFUSED — live-dead PAI token (INVARIANT 6; --allow-flagged to include):");
    for (const p of flaggedPlans) {
      console.log(`  flag ${p.liveRel}:${p.firstFlag?.line} "${p.firstFlag?.token}" — ${p.firstFlag?.context}`);
    }
  }

  console.log("");
  console.log(`SUMMARY: will-add ${counts["will-add"]} | skip-exists ${counts["skip-exists"]} (conflicts/unchanged — protected)`);
  console.log(`         skip-scaffold ${counts["skip-scaffold"]} (USER/MEMORY — onboarding owns) | skip-skill ${counts["skip-skill"]} (route via CreateSkill)`);
  console.log(`         skip-flagged ${counts["skip-flagged"]} (dead PAI tokens, listed above) | skip-escape ${counts["skip-escape"]}`);
  if (apply) {
    console.log(`\nWROTE ${written} files into ${liveRoot()}. NOT committed — review \`git -C ~/.claude diff\` and commit signed yourself.`);
  } else {
    console.log(`\nDRY-RUN only. Re-run with --apply to write. Skills: route the ${counts["skip-skill"]} skipped via Skill("CreateSkill").`);
  }
  return 0;
}

// ── self-test: guard logic on synthetic plans (no live writes) ────────────────
function runSelfTest(): number {
  const checks: { name: string; got: boolean; want: boolean }[] = [];
  // containment: a ../ escape must be rejected
  const root = path.join(os.tmpdir(), "ua-selftest-root");
  const escape = realDestWithin(path.join(root, "..", "evil.txt"), root);
  checks.push({ name: "escape rejected", got: escape.ok, want: false });
  const inside = realDestWithin(path.join(root, "PAI", "PULSE", "modules", "x.ts"), root);
  checks.push({ name: "inside accepted", got: inside.ok, want: true });
  // isText coverage of the class Cato flagged
  checks.push({ name: ".tsx is text", got: isText("a/b.tsx"), want: true });
  checks.push({ name: "VERSION is text", got: isText("LifeOS/VERSION"), want: true });
  checks.push({ name: ".png is binary", got: isText("a/logo.png"), want: false });

  // ── SHAPE (the regression this tool shipped with) ───────────────────────────
  // The bug was invisible to the old self-test because it asserted the WRONG
  // direction and passed. These cases fail if either half is reintroduced.
  const paiPath = 'pathJoin(CLAUDE_ROOT, "LIFEOS/MEMORY/STATE/x.json")';
  checks.push({
    name: "shape: LIFEOS/ path survives verbatim (no PAI rewrite)",
    got: deadPaiTokens(paiPath).length === 0 && !/PAI\//.test(paiPath),
    want: true,
  });
  checks.push({
    name: "shape: LIFEOS_DIR env token is not a dead token",
    got: deadPaiTokens("const d = process.env.LIFEOS_DIR").length === 0,
    want: true,
  });
  // Anti: a live-dead PAI token must be DETECTED, so it gets refused not written.
  checks.push({
    name: "anti: PAI/-rooted path detected as dead",
    got: deadPaiTokens('join(root, "PAI/MEMORY/STATE/x.json")').length === 1,
    want: true,
  });
  checks.push({
    name: "anti: PAI_ env var detected as dead",
    got: deadPaiTokens("process.env.PAI_CONFIG_DIR").length === 1,
    want: true,
  });
  // The false negative found by the independent PAI-substring scan: a bare TERMINAL
  // segment has no trailing slash, so `PAI\/` alone missed PiSync.sh's real dead test.
  checks.push({
    name: "anti: bare terminal /PAI segment detected as dead",
    got: deadPaiTokens('[ -d "$LIFEOS/PAI" ] || exit 1').length === 1,
    want: true,
  });
  // Exemptions: names deliberately kept at the 2026-07-05 cut, present in live.
  checks.push({
    name: "exempt: PAI_SYSTEM_PROMPT not flagged (safety-net copy exists)",
    got: deadPaiTokens("load LIFEOS/PAI_SYSTEM_PROMPT.md").length === 0,
    want: true,
  });
  checks.push({
    name: "exempt: PAIUpgrade skill dir not flagged",
    got: deadPaiTokens('Skill("PAIUpgrade")').length === 0,
    want: true,
  });
  checks.push({
    name: "exempt: ~/.config/PAI is a different dir, not flagged",
    got: deadPaiTokens('const env = "$HOME/.config/PAI/.env";').length === 0,
    want: true,
  });
  checks.push({
    name: "exempt: PAI-Install engine internals not flagged",
    got: deadPaiTokens("from '../PAI-Install/engine/actions'").length === 0,
    want: true,
  });
  // Brand prose must NOT be a dead token — the old gate blocked 145 files on this.
  checks.push({
    name: "brand prose 'LifeOS is the Life OS' is not a dead token",
    got: deadPaiTokens("LifeOS is the Life Operating System.").length === 0,
    want: true,
  });
  // Scaffold zones must cover the LIVE shape, not just the payload's current one.
  checks.push({
    name: "scaffold: LIFEOS/USER/ is a protected zone",
    got: SCAFFOLD_ZONES.some((z) => "LIFEOS/USER/TELOS/GOALS.md".startsWith(z)),
    want: true,
  });
  checks.push({
    name: "scaffold: LIFEOS/MEMORY/ is a protected zone",
    got: SCAFFOLD_ZONES.some((z) => "LIFEOS/MEMORY/STATE/x.json".startsWith(z)),
    want: true,
  });
  // Anti: a non-scaffold LIFEOS path must NOT be swallowed by the zone list.
  checks.push({
    name: "anti: LIFEOS/TOOLS is not a scaffold zone",
    got: SCAFFOLD_ZONES.some((z) => "LIFEOS/TOOLS/SessionRename.ts".startsWith(z)),
    want: false,
  });
  // Rule 1b: the override the rest of the channel uses must steer THIS tool too.
  const savedLifeos = process.env.LIFEOS_DIR;
  const savedPai = process.env.PAI_DIR;
  const sentinel = path.join(os.tmpdir(), "ua-selftest-lifeos-dir");
  process.env.LIFEOS_DIR = sentinel;
  delete process.env.PAI_DIR;
  checks.push({ name: "env: LIFEOS_DIR steers liveRoot", got: liveRoot() === path.resolve(sentinel), want: true });
  if (savedLifeos === undefined) delete process.env.LIFEOS_DIR;
  else process.env.LIFEOS_DIR = savedLifeos;
  if (savedPai !== undefined) process.env.PAI_DIR = savedPai;
  let pass = 0;
  for (const c of checks) {
    if (c.got === c.want) pass += 1;
    else console.error(`FAIL ${c.name}: got ${c.got} want ${c.want}`);
  }
  console.log(`${pass}/${checks.length} passed`);
  return pass === checks.length ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
