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
 *  8. DECIDED REFUSALS ARE ENFORCED, NOT DOCUMENTED. Additive-only (INVARIANT 1) does
 *     not make an add safe: where the payload and live disagree about WHERE a file
 *     lives, landing it overwrites nothing and creates a SECOND, divergent copy at a
 *     path nothing reads, while the copy live actually reads keeps its own content.
 *     Those rows were adjudicated one by one in docs/DIVERGENT-DUPE-DISPOSITIONS.md;
 *     REFUSED_ADDS below is that adjudication made executable, because a decision this
 *     tool cannot express is a decision the system does not hold. Enforced by DEFAULT
 *     with NO override flag: unlike INVARIANT 6 (a detector, hence --allow-flagged for
 *     its false positives), this is a record of decisions, and changing one should cost
 *     a reviewable diff that also updates the stated reason. A flag would additionally
 *     let someone do the wrong thing efficiently — for most of these rows the correct
 *     action is to PORT CONTENT onto the live path, which landing the file does not do.
 *     TWO CLASSES live here, each row tagged in its reason. `divergent:` is the above.
 *     `secret:` is a faithful add carrying a hardcoded high-entropy credential: refused
 *     because the live repo's ggshield pre-commit would block it and because "the vendor
 *     published this constant" is a claim this channel cannot verify — the fix is to port
 *     the file reading the value from .env, never to bypass the scanner to land it.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/**
 * INVARIANT 8 — the decided refusals, keyed on the EXACT payload-relative path the
 * plan reports. Every entry is a divergent duplicate: the payload puts the file at a
 * path live does not read, while live holds its own copy elsewhere. Landing one adds a
 * second source of truth silently — no overwrite, no conflict, no diff against anything
 * live consumes. Adjudicated in docs/DIVERGENT-DUPE-DISPOSITIONS.md, evidence in
 * MEMORY/WORK/resolve-divergent-dupes/ISA.md (24/24). Live consumers of each of the four
 * payload locations: ZERO, probed.
 *
 * Keys are EXACT, not prefixes: an exact key cannot silently over-refuse a sibling that
 * upstream later adds to the same directory. The cost of exactness is brittleness to an
 * upstream rename, which is why a key matching no payload file is reported as STALE
 * rather than sitting there reading as coverage.
 *
 * Note `LIFEOS/TOOLS/llcli/llcli.ts` is refused even though its content WAS accepted:
 * the $HOME-expansion fix was ported onto LIFEOS/bin/llcli/llcli.ts, the path live's 5
 * consumers actually read. Landing the payload file too would undo the point of porting.
 */
const REFUSED_ADDS: Record<string, string> = {
  // Upstream consolidated skills/Agents/ -> agents/. Live's 10 agent definitions and
  // skills/Agents/Tools/LoadAgentContext.ts all read the skills/Agents/ path, and the
  // agent definitions that would point at the new one are skip-exists — so these land
  // unreferenced by construction. Their content "upgrades" also fail here: gpt-5.6-sol
  // and gpt-5.6-luna both 400 on codex-cli 0.142.5 (gpt-5.5 CONTROL resolves), and the
  // Grok PRIMARY TOOL section needs LIFEOS/TOOLS/Grok.ts + GROK_API_KEY, neither in live.
  "agents/ForgeContext.md": "divergent: live reads skills/Agents/ForgeContext.md; payload's only substantive change is gpt-5.6-sol, which 400s on this codex CLI",
  "agents/CodexResearcherContext.md": "divergent: live reads skills/Agents/; documents gpt-5.6-sol/gpt-5.6-luna, both 400 here",
  "agents/GrokResearcherContext.md": "divergent: live reads skills/Agents/; new PRIMARY TOOL needs Grok.ts + GROK_API_KEY, neither present in live",
  "agents/ClaudeResearcherContext.md": "divergent: live reads skills/Agents/; changes are rebranding + {{DA_NAME}} placeholders only",
  "agents/GeminiResearcherContext.md": "divergent: live reads skills/Agents/; changes are rebranding + placeholders only",
  "agents/PerplexityResearcherContext.md": "divergent: live reads skills/Agents/; changes are rebranding + placeholders only",

  // Upstream relocated bin/llcli/ -> TOOLS/llcli/. Live has 5 consumers of Bin/llcli
  // and 0 of TOOLS/llcli.
  "LIFEOS/TOOLS/llcli/llcli.ts": "divergent: content PORTED to LIFEOS/bin/llcli/llcli.ts ($HOME-expansion fix, upstream #1404/PR #1451); landing the file too would re-split the source of truth",
  "LIFEOS/TOOLS/llcli/package.json": "divergent: byte-identical to LIFEOS/bin/llcli/package.json; the add is pure relocation",
  "LIFEOS/TOOLS/llcli/README.md": "divergent: differs from LIFEOS/bin/llcli/README.md only by the new path + upstream anonymizer swaps",
  "LIFEOS/TOOLS/llcli/QUICKSTART.md": "divergent: every changed line vs LIFEOS/bin/llcli/QUICKSTART.md is the Bin/llcli -> TOOLS/llcli path",

  // Upstream nested the ISA spec one level deeper. Live pins DOCUMENTATION/IsaFormat.md
  // from CLAUDE.md:106, DOCUMENTATION/Isa/IsaSystem.md:7 and :155, skills/ISA/SKILL.md:212.
  "LIFEOS/DOCUMENTATION/Isa/IsaFormat.md": "divergent: live reads DOCUMENTATION/IsaFormat.md (20+ consumers); payload is spec v2.13.0 for Algorithm v6.25.0 while live runs 6.4.19 — an Algorithm-version decision, not a file add",

  // Upstream renamed TEMPLATES/User/ -> USER_TEMPLATES/. The whole directory is the same
  // refactor, so all 6 rows are refused, not just the one the overlap census surfaced.
  // Books.md was caught by content overlap (42%); the other 5 score BELOW the 30% threshold
  // only because the templates are tiny (Beliefs 14 shared lines, README 0%) or have no
  // same-named twin at all (Goals, Pronunciations, Identity -> live PrincipalIdentity.md).
  // Landability is what actually settles them: live LIFEOS/USER_TEMPLATES/ does not exist and
  // has ZERO live consumers, while LIFEOS/TEMPLATES/User/ has 3 (LifeosSystemArchitecture.md,
  // LifeOs/LifeOsSchema.md, TEMPLATES/User/README.md). The only payload file that reads the new
  // location is skills/LifeOS/Workflows/Setup.md, which is skip-skill and never lands — so
  // these arrive unreferenced by construction, exactly like the agents/ rows above.
  "LIFEOS/USER_TEMPLATES/Books.md": "divergent: live reads LIFEOS/TEMPLATES/User/Books.md, which is strictly richer (3 sections + parser note); payload flattens it and ships an anonymizer regression in an author name",
  "LIFEOS/USER_TEMPLATES/Beliefs.md": "divergent: live reads LIFEOS/TEMPLATES/User/Beliefs.md (40 lines vs payload's 24); USER_TEMPLATES/ has 0 live consumers vs 3 for TEMPLATES/User/",
  "LIFEOS/USER_TEMPLATES/README.md": "divergent: live reads LIFEOS/TEMPLATES/User/README.md (53 lines vs payload's 35) and it documents the live dir's own contract; landing this adds a second README nothing reads",
  "LIFEOS/USER_TEMPLATES/Identity.md": "divergent: live's equivalent is LIFEOS/TEMPLATES/User/PrincipalIdentity.md; landing under the renamed dir adds an unread duplicate of the identity template",
  "LIFEOS/USER_TEMPLATES/Goals.md": "divergent: same TEMPLATES/User -> USER_TEMPLATES rename; the dir has 0 live consumers, so this template is unreachable — belongs at the live path if wanted, via a port",
  "LIFEOS/USER_TEMPLATES/Pronunciations.md": "divergent: same rename; 0 live consumers of USER_TEMPLATES/, so it lands unreachable — port to LIFEOS/TEMPLATES/User/ if the template is wanted",

  // NOT a divergent duplicate — a hardcoded-credential refusal, the second kind of add that
  // is faithful and still wrong to land. ggshield flags a Generic High Entropy Secret at
  // eightsleep.ts:30 (APP_CLIENT_SECRET, 64 hex chars). Upstream documents it as a public
  // mobile-app OAuth constant and makes it env-overridable, which is plausible and is NOT
  // sufficient grounds to write a hardcoded high-entropy credential into the live tree: the
  // live repo's ggshield pre-commit would block the commit, and "the vendor published it"
  // is a claim this channel cannot verify. Refused rather than committed with a bypass —
  // never disable a scanner to land a file.
  //
  // Safe to hold back: HealthSync.ts reaches sources through a DYNAMIC import
  // (`await import("./healthsync/${source}.ts")`, line 152), so the absent file breaks only
  // `--source eightsleep`, not the tool — probed, `--help` exits 0 with the file removed.
  // The other 6 healthsync modules and the shared types land normally. EIGHTSLEEP_* is
  // absent from live .env and no cron/hook invokes HealthSync, so nothing is degraded.
  // To adopt: set EIGHTSLEEP_CLIENT_ID/SECRET in .env, replace the two literals with the
  // env reads, then land the file — i.e. port content, don't lift the refusal.
  "LIFEOS/TOOLS/healthsync/eightsleep.ts": "secret: ggshield flags a Generic High Entropy Secret (APP_CLIENT_SECRET, eightsleep.ts:30); upstream calls it a public app constant but this channel cannot verify that, and the live pre-commit would block it — port it with env reads instead of landing hardcoded",
};

type Plan = {
  releaseRel: string; // path within RELEASE_PAYLOAD
  liveRel: string; // path within live root — IDENTICAL to releaseRel (both LIFEOS/-shaped)
  bytes: Buffer;
  flags: number; // count of live-dead PAI tokens
  firstFlag?: { line: number; token: string; context: string };
  status: "will-add" | "skip-exists" | "skip-skill" | "skip-scaffold" | "skip-flagged" | "skip-escape" | "skip-refused" | "skip-excluded";
  refusedReason?: string; // INVARIANT 8: why this add was decided against
};

/** True if `rel` is held back by a repeatable ad-hoc `--exclude <prefix>`. */
function isExcluded(rel: string, excludes: string[]): boolean {
  return excludes.some((e) => rel.startsWith(e));
}

function buildPlan(only?: string, allowFlagged = false, excludes: string[] = []): Plan[] {
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

    // LADDER ORDER IS LOAD-BEARING. skip-exists stays FIRST: INVARIANT 1 is the guard the
    // whole channel rests on, and a refused path that has somehow already landed must report
    // the true live state, not a refusal label that hides it (the violated-refusal audit below
    // is what makes that case loud). INVARIANT 8's two buckets come LAST, after every
    // structural refusal, so no pre-existing bucket can lose a member to them: a file that is
    // both in a scaffold zone and refused reports the structural reason, which is the more
    // informative one, and the refusal counts stay a clean subset of what would otherwise
    // have been written.
    let status: Plan["status"];
    if (existsSync(destAbs)) status = "skip-exists"; // INVARIANT 1: never overwrite
    else if (SCAFFOLD_ZONES.some((z) => liveRel.startsWith(z))) status = "skip-scaffold"; // INVARIANT 7: USER/MEMORY owned by onboarding
    else if (liveRel.startsWith("skills/")) status = "skip-skill"; // INVARIANT 3: CreateSkill owns these
    else if (!realDestWithin(destAbs, root).ok) status = "skip-escape"; // INVARIANT 2: containment
    else if (dead.length > 0 && !allowFlagged) status = "skip-flagged"; // INVARIANT 6: live-dead token
    else if (REFUSED_ADDS[liveRel] !== undefined) status = "skip-refused"; // INVARIANT 8: decided against
    else if (isExcluded(liveRel, excludes)) status = "skip-excluded"; // ad-hoc holdback
    else status = "will-add";

    plans.push({
      releaseRel, liveRel, bytes, flags: dead.length, firstFlag: dead[0], status,
      refusedReason: REFUSED_ADDS[liveRel],
    });
  }
  return plans;
}

function main(argv: string[]): number {
  if (argv.includes("--self-test")) return runSelfTest();
  const apply = argv.includes("--apply");
  const allowFlagged = argv.includes("--allow-flagged");
  const onlyIdx = argv.indexOf("--only");
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : undefined;
  // Repeatable: collect EVERY --exclude, not just the first. A silently-dropped second
  // holdback is exactly the class of failure this gate exists to prevent.
  const excludes: string[] = [];
  argv.forEach((a, i) => {
    if (a === "--exclude" && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) excludes.push(argv[i + 1]);
  });

  console.log(`upstream-apply — ${apply ? "APPLY (writing ADDs to live)" : "DRY-RUN (no writes)"} | live=${liveRoot()}`);
  if (only) console.log(`  scope: --only ${only}`);
  if (excludes.length) console.log(`  holdback: --exclude ${excludes.join(" --exclude ")}`);
  console.log("  additive-only · contained · verbatim · skills→CreateSkill · decided-refusals · no auto-commit\n");

  const plans = buildPlan(only, allowFlagged, excludes);
  const counts: Record<Plan["status"], number> = {
    "will-add": 0, "skip-exists": 0, "skip-skill": 0, "skip-scaffold": 0, "skip-flagged": 0, "skip-escape": 0,
    "skip-refused": 0, "skip-excluded": 0,
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

  // INVARIANT 8. Each refusal carries its reason to the point of use, uncapped — a bare
  // count would rot into a number nobody can audit, which is how the doc-only version of
  // this decision failed.
  const refusedPlans = plans.filter((p) => p.status === "skip-refused");
  if (refusedPlans.length) {
    console.log("");
    console.log("REFUSED — decided divergent duplicate (INVARIANT 8; edit REFUSED_ADDS to change):");
    for (const p of refusedPlans) console.log(`  hold ${p.liveRel}\n         ${p.refusedReason}`);
  }

  const excludedPlans = plans.filter((p) => p.status === "skip-excluded");
  if (excludedPlans.length) {
    console.log("");
    console.log("HELD BACK — ad-hoc --exclude (not a recorded decision):");
    for (const p of excludedPlans) console.log(`  skip ${p.liveRel}`);
  }

  // AUDIT A — a refused path that is ALREADY in live. The ladder reports it as skip-exists
  // (truthfully), which means the refusal is silently doing nothing; that must not read as
  // coverage. Advisory only: it never changes the exit code, because the run itself is safe.
  const planned = new Set(plans.map((p) => p.liveRel));
  const violated = plans.filter((p) => p.status === "skip-exists" && REFUSED_ADDS[p.liveRel] !== undefined);
  if (violated.length) {
    console.log("");
    console.log("⚠ VIOLATED REFUSAL — refused path already present in live (INVARIANT 8 no longer protecting):");
    for (const p of violated) console.log(`  live ${p.liveRel} — decided against: ${REFUSED_ADDS[p.liveRel]}`);
    console.log("  Someone landed these before the gate existed, or by hand. Review the live copy.");
  }

  // AUDIT B — a refusal key matching no payload file. Exact keys are brittle to an upstream
  // rename, and a stale entry reads as protection while protecting nothing. Scoped to
  // unfiltered runs: under --only, "absent" just means out of scope.
  if (!only && !excludes.length) {
    const stale = Object.keys(REFUSED_ADDS).filter((k) => !planned.has(k));
    if (stale.length) {
      console.log("");
      console.log("⚠ STALE REFUSAL — REFUSED_ADDS key matches no payload file (upstream moved or dropped it):");
      for (const k of stale) console.log(`  gone ${k} — ${REFUSED_ADDS[k]}`);
      console.log("  Re-adjudicate against the new path, or remove the entry. It protects nothing as written.");
    }
  }

  console.log("");
  console.log(`SUMMARY: will-add ${counts["will-add"]} | skip-exists ${counts["skip-exists"]} (conflicts/unchanged — protected)`);
  console.log(`         skip-scaffold ${counts["skip-scaffold"]} (USER/MEMORY — onboarding owns) | skip-skill ${counts["skip-skill"]} (route via CreateSkill)`);
  console.log(`         skip-flagged ${counts["skip-flagged"]} (dead PAI tokens, listed above) | skip-escape ${counts["skip-escape"]}`);
  console.log(`         skip-refused ${counts["skip-refused"]} (decided divergent duplicates — INVARIANT 8) | skip-excluded ${counts["skip-excluded"]} (ad-hoc --exclude)`);
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
  // ── INVARIANT 8: decided refusals are ENFORCED, not documented ───────────────
  // The failure this guards is a decision that survives only in a markdown table: the
  // original 12 rows were adjudicated, and before this gate existed the plan still reported
  // all 12 as will-add. Now 18: +5 USER_TEMPLATES siblings (the rename refactor was refused
  // only in part) and +1 hardcoded-credential refusal, which is a SECOND refusal class —
  // faithful, not divergent, and still wrong to write into live.
  const refusedKeys = Object.keys(REFUSED_ADDS);
  checks.push({ name: "refuse: REFUSED_ADDS holds exactly 18 adjudicated rows", got: refusedKeys.length === 18, want: true });
  // Every row states its class, so a reader can tell a divergence refusal from a secret one
  // without reading the surrounding comment block.
  checks.push({
    name: "refuse: every reason names its class (divergent:/secret:)",
    got: refusedKeys.every((k) => /^(divergent|secret):/.test(REFUSED_ADDS[k] ?? "")),
    want: true,
  });
  // A bare count is a weak guard: it notices ANY edit but cannot tell a correct addition from
  // the mistake that actually happened here. USER_TEMPLATES was refused for ONE row (Books.md,
  // the only one a >=30% content-overlap census could see) while 5 siblings from the SAME
  // rename stayed in the write set — a partially-refused refactor, which is the defect class
  // this invariant exists to prevent. So assert WHOLE-DIRECTORY closure: for every refused
  // path, every sibling file that ships in the same payload directory is refused too. This
  // fails loudly if a future payload adds a 7th USER_TEMPLATES file and nobody adjudicates it.
  // Scoped twice over.
  //
  // First to siblings that would actually be WRITTEN: a sibling already present in live is
  // skip-exists and cannot create a duplicate — agents/Forge.md is deliberately NOT refused
  // (see the anti-check below) precisely because live already has it.
  //
  // Second to siblings that are DUPLICATES, i.e. that have a live file of the same name at
  // some other path. Without this, the check demands refusal of genuinely-new files that merely
  // share a directory with a refused one: DOCUMENTATION/Isa/IsaHierarchy.md and IsaHtmlMirror.md
  // sit beside the refused IsaFormat.md but exist nowhere in live, so landing them creates no
  // second source of truth. They are the LIFEOS/RULES/ class — new doctrine whose reader is
  // skip-skill — which is an unread-clutter question, not a divergence one, and refusing them
  // here would encode the wrong reason.
  const refusedDirs = new Set(refusedKeys.map((k) => path.posix.dirname(k)));
  const willAddRel = new Set(buildPlan(undefined, true).filter((p) => p.status === "will-add").map((p) => p.liveRel));
  const liveBasenames = new Set(walk(liveRoot()).map((f) => path.posix.basename(f.replace(/\\/g, "/"))));
  const hasLiveTwinElsewhere = (rel: string): boolean => {
    // The path itself would be skip-exists, so a basename hit here is necessarily elsewhere.
    return liveBasenames.has(path.posix.basename(rel));
  };
  const unrefusedSiblings = [...refusedDirs].flatMap((d) => {
    const abs = path.join(RELEASE_PAYLOAD, ...d.split("/"));
    if (!existsSync(abs)) return [];
    return walk(abs)
      .filter((f) => !f.includes("/")) // direct children only; a nested subdir is its own decision
      .map((f) => `${d}/${f}`)
      .filter((rel) => REFUSED_ADDS[rel] === undefined && willAddRel.has(rel) && hasLiveTwinElsewhere(rel));
  });
  checks.push({
    name: `refuse: no unrefused DUPLICATE sibling in a refused directory (found ${unrefusedSiblings.length}: ${unrefusedSiblings.slice(0, 3).join(", ") || "none"})`,
    got: unrefusedSiblings.length === 0,
    want: true,
  });
  checks.push({
    name: "refuse: every entry carries a non-trivial reason",
    got: refusedKeys.every((k) => (REFUSED_ADDS[k] ?? "").trim().length > 20),
    want: true,
  });
  // The port row is still a refusal: its CONTENT went to the live path, so landing the
  // payload file would re-split the source of truth the port just unified.
  checks.push({
    name: "refuse: the ported llcli.ts row is refused too (content went to bin/llcli)",
    got: REFUSED_ADDS["LIFEOS/TOOLS/llcli/llcli.ts"] !== undefined,
    want: true,
  });
  // Anti: exact keys, so a sibling upstream later drops into a refused directory is NOT
  // swept up. agents/Forge.md is a real payload file next to the 6 refused context files.
  checks.push({
    name: "anti: a non-refused sibling in a refused directory is untouched",
    got: REFUSED_ADDS["agents/Forge.md"] !== undefined,
    want: false,
  });
  checks.push({
    name: "anti: the LIVE twin path is not itself a refusal key",
    got: REFUSED_ADDS["LIFEOS/bin/llcli/llcli.ts"] !== undefined,
    want: false,
  });
  // No override flag exists (INVARIANT 8 is a record of decisions, not a detector), so the
  // gate must hold with allowFlagged forced ON — the only include-anyway flag in the tool.
  const sandbox = path.join(os.tmpdir(), "ua-selftest-refuse-root");
  const savedForRefuse = process.env.LIFEOS_DIR;
  const savedPaiForRefuse = process.env.PAI_DIR;
  delete process.env.PAI_DIR;
  process.env.LIFEOS_DIR = sandbox;
  mkdirSync(sandbox, { recursive: true });
  const oneRefused = buildPlan("agents/ForgeContext.md", true);
  checks.push({
    name: "refuse: enforced by default, and --allow-flagged does not bypass it",
    got: oneRefused.length === 1 && oneRefused[0]!.status === "skip-refused",
    want: true,
  });
  checks.push({
    name: "refuse: the plan row carries the reason through to the caller",
    got: (oneRefused[0]?.refusedReason ?? "").includes("gpt-5.6-sol"),
    want: true,
  });
  // LADDER ORDER: skip-exists must WIN over skip-refused. If a refused path has already
  // landed, the status has to report true live state; the violated-refusal audit is what
  // makes that case loud, and inverting the ladder would hide it behind a refusal label.
  mkdirSync(path.join(sandbox, "agents"), { recursive: true });
  writeFileSync(path.join(sandbox, "agents", "ForgeContext.md"), "already landed\n");
  const alreadyThere = buildPlan("agents/ForgeContext.md", true);
  checks.push({
    name: "ladder: skip-exists outranks skip-refused (INVARIANT 1 not shadowed)",
    got: alreadyThere[0]?.status === "skip-exists",
    want: true,
  });
  rmSync(path.join(sandbox, "agents"), { recursive: true, force: true });

  // ── ad-hoc --exclude ────────────────────────────────────────────────────────
  checks.push({ name: "exclude: prefix match holds a path back", got: isExcluded("LIFEOS/TOOLS/x.ts", ["LIFEOS/TOOLS/"]), want: true });
  checks.push({ name: "exclude: repeatable — any of several prefixes matches", got: isExcluded("agents/Forge.md", ["LIFEOS/", "agents/"]), want: true });
  checks.push({ name: "anti: exclude does not match an unrelated path", got: isExcluded("hooks/x.ts", ["LIFEOS/TOOLS/"]), want: false });
  checks.push({ name: "anti: an empty exclude list holds nothing back", got: isExcluded("hooks/x.ts", []), want: false });
  // MONOTONICITY: --exclude may only ever SHRINK the write set. An exclude that matches
  // nothing must leave will-add identical; one that matches must reduce it.
  const baseAgents = buildPlan("agents/", true).filter((p) => p.status === "will-add").length;
  const noMatch = buildPlan("agents/", true, ["zzz-nonexistent/"]).filter((p) => p.status === "will-add").length;
  const withMatch = buildPlan("agents/", true, ["agents/"]).filter((p) => p.status === "will-add").length;
  checks.push({ name: "exclude: a non-matching prefix leaves the write set identical", got: noMatch === baseAgents, want: true });
  checks.push({ name: "exclude: a matching prefix strictly shrinks the write set to 0", got: withMatch === 0 && baseAgents > 0, want: true });
  checks.push({ name: "anti: exclude never grows the write set", got: noMatch <= baseAgents && withMatch <= baseAgents, want: true });
  rmSync(sandbox, { recursive: true, force: true });
  if (savedForRefuse === undefined) delete process.env.LIFEOS_DIR;
  else process.env.LIFEOS_DIR = savedForRefuse;
  if (savedPaiForRefuse !== undefined) process.env.PAI_DIR = savedPaiForRefuse;

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
