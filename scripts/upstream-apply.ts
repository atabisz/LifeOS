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
 *  9. PATH IDENTITY IS CASE-EXACT. A payload path whose live twin differs ONLY by case is
 *     HELD, never written. This is not tidiness — it is the same divergent-duplicate harm
 *     as INVARIANT 8, arriving through a channel a hand-maintained list cannot cover, and
 *     it lands DIFFERENTLY on each filesystem:
 *       - case-insensitive (Windows/APFS): `existsSync` case-folds, so a file-level twin
 *         is already caught by INVARIANT 1 — but a DIRECTORY-level twin is not. Writing
 *         `DOCUMENTATION/ISA/ISAFormat.md` when live tracks `DOCUMENTATION/Isa/` puts the
 *         bytes at `Isa/ISAFormat.md`, a path this tool never printed. INVARIANT 4 promises
 *         verbatim bytes; without this guard nothing promised the printed PATH.
 *       - case-sensitive (Linux/case-sensitive volumes): INVARIANT 1 catches NONE of them, so
 *         this guard is the only thing holding them. Measured 2026-08-12 against live's git
 *         index (case-sensitive, unlike the FS): 41 payload files differ from a live file by
 *         case alone. 37 are under `skills/` and INVARIANT 3 holds those on every host; the
 *         remaining 4 — DOCUMENTATION/ISA/{ISAHierarchy,ISAHtmlMirror,ISASystem}.md and
 *         TOOLS/ISAReconcile.ts — would land as silent second copies of live's `Isa/`-spelled
 *         originals. So the tool's behaviour would otherwise depend on the host's FS.
 *     Fail-closed by construction: an unadjudicated case twin is held with its reason,
 *     rather than needing someone to have foreseen it in REFUSED_ADDS. Discovered the hard
 *     way — the ISAFormat refusal below was BYPASSED by exactly this, and upstream itself
 *     hit the same class (7dd46541 dropped its own case-folded `Isa/` index entries).
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

/**
 * INVARIANT 9. Returns the live path that collides with `rel` only by CASE, or null.
 *
 * Walks `rel` segment by segment against the real live tree and stops at the first segment
 * that is absent under its own spelling but present under another. That is the only case worth
 * holding: if the segment matches exactly the walk continues, and if nothing matches at all the
 * subtree is genuinely new and the add is safe.
 *
 * `readdirSync` per segment is the point — it reads the spelling the FILESYSTEM stores.
 * `existsSync` cannot answer this question at all on a case-insensitive host: it returns true
 * for a path that is not there under that name, which is exactly how the ISAFormat refusal was
 * bypassed and how a plan row can print a path the write does not use.
 *
 * Called only after INVARIANT 1 (skip-exists) has already passed, so an exact full-path match
 * is not a case this needs to rule on — hence the final `null` for a fully-present path.
 */
function caseOnlyCollision(rel: string, root: string): string | null {
  const parts = rel.split("/");
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    const want = parts[i]!;
    let names: string[];
    try {
      names = readdirSync(cur);
    } catch {
      return null; // parent absent or not a directory: nothing to collide with
    }
    if (names.includes(want)) {
      cur = path.join(cur, want);
      continue;
    }
    const other = names.find((n) => n.toLowerCase() === want.toLowerCase());
    if (other) return [...parts.slice(0, i), other].join("/");
    return null; // new from here down
  }
  return null;
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
 * MEMORY/WORK/resolve-divergent-dupes/ISA.md (24/24). Live consumers of each of those
 * payload locations: ZERO, probed. The 2026-07-31 voice-pair rows were adjudicated
 * separately (MEMORY/WORK/20260731-execute-recommended-next-steps/ISA.md) on live's own
 * VoiceSummary.hook.ts docblock, which records absorbing both.
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

  // RE-KEYED 2026-08-12. This row was `LIFEOS/DOCUMENTATION/Isa/IsaFormat.md` and had gone
  // STALE — upstream `7dd46541` (2026-07-29) dropped its own case-folded `DOCUMENTATION/Isa/`
  // index entries as "case-fold collision with ISA/", then `36c6f01e` (release 7.28.3) added
  // the four `DOCUMENTATION/ISA/*` docs fresh. So the refusal key named a path upstream no
  // longer ships while its successor sat in the will-add set: a decided refusal, bypassed by a
  // rename this list is exact about on purpose. INVARIANT 9 now catches the class; this row
  // keeps the DECISION, which the computed guard cannot state.
  //
  // The old reason is also void, and inverted: it said "payload is spec v2.13.0 for Algorithm
  // v6.25.0 while live runs 6.4.19". Live now runs Algorithm 8.18.0 and its own spec doc still
  // reads v2.7 (Algorithm v6.3.0), so the PAYLOAD is the fresher document (v2.18.0, Algorithm
  // v8.12.0, 81,561 B vs live's 50,567 B). The refusal stands anyway, on two grounds that do
  // not depend on which copy is newer:
  //   1. 100 live files reference `IsaFormat.md` at the flat DOCUMENTATION/ path. A second copy
  //      one directory down is read by none of them.
  //   2. The v8 graft already adjudicated the CONTENT and refused it — `LIFEOS/ALGORITHM/
  //      v8.18.0.md:84` records that upstream's v2.18.0 drops `DEFERRED-VERIFY` and replaces
  //      `[FOG]` with a `## Not yet specified` section, while 33 live ISAs use DEFERRED-VERIFY
  //      and `hooks/lib/isa-utils.ts` exports it in BOX_STATES with ten registered hooks
  //      depending on it. Landing this file would put a spec that deletes a mechanically
  //      enforced vocabulary into the tree beside the one that defines it.
  // So the remedy is a doctrine decision at live's own path, not an add — the same shape as
  // every other `divergent:` row here.
  "LIFEOS/DOCUMENTATION/ISA/ISAFormat.md": "divergent: live reads DOCUMENTATION/IsaFormat.md (100 referring files); payload's v2.18.0 deletes DEFERRED-VERIFY and [FOG], which 33 live ISAs and BOX_STATES in hooks/lib/isa-utils.ts mechanically depend on — refused as doctrine by ALGORITHM/v8.18.0.md:84, so adopting it is a port at the live path, not a file add",

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

  // Upstream RETIRED its own mode/tier doctrine into ALGORITHM/archive/ — the frontmatter on
  // archive/mode-detection.md reads "RETIRED 2026-07-11 — historical doctrine. Modes/tiers were
  // abolished with Algorithm v8 ... nothing routes here." Live never made that move: it holds an
  // ACTIVE file at every un-archived path (LIFEOS/ALGORITHM/{mode-detection,parameter-schema,
  // target-types}.md and modes/{README,ideate,iterate,loop,native,optimize}.md — all 9 tracked)
  // and has no archive/ directory at all.
  //
  // So these are NOT duplicates of live-active doctrine. They are upstream's retirement RECORDS
  // for doctrine live still presents as current, which makes landing them worse than either
  // state alone: live would hold two files per subject with contradictory status headers — its
  // own mode-detection.md saying "Loaded by the run on demand when ideate, optimize, or
  // fast-path modes are detected" beside an archive copy saying nothing routes there.
  //
  // The coherent end state is retiring LIVE's copies, and that is a MOVE. INVARIANT 1 is
  // additive-only and never overwrites or relocates, so this channel structurally cannot make
  // one — "not through here" is the correct answer, and the remedy is a doctrine decision at
  // live's own paths, the same shape as every other `divergent:` row above.
  //
  // Reachability measured with `git grep` against live: live's CURRENT doctrine
  // ALGORITHM/v8.18.0.md references NONE of these (its only sibling reference is
  // capabilities.md). Every ALGORITHM-side referrer is a superseded v5.7.0-v6.4.x spec, and a
  // superseded spec is a frozen record by standing decision. Live's copies are therefore stale
  // but unreferenced by current doctrine — a live cleanup, not an add.
  //
  // parameter-schema.md is byte-identical to live's copy and is refused on the same terms: an
  // identical file at a DIFFERENT path is still a second source of truth, and the
  // never-overwrite guard does not fire because the archive path is genuinely absent.
  "LIFEOS/ALGORITHM/archive/mode-detection.md": "divergent: upstream's RETIRED copy of doctrine live holds ACTIVE at LIFEOS/ALGORITHM/mode-detection.md; landing it puts two files with contradictory status headers in the tree, and adopting the retirement is a live-side MOVE this additive-only channel cannot make",
  "LIFEOS/ALGORITHM/archive/parameter-schema.md": "divergent: byte-identical to live's ACTIVE LIFEOS/ALGORITHM/parameter-schema.md, so the add is pure relocation into an archive/ dir live does not have — a second source of truth at a path nothing reads",
  "LIFEOS/ALGORITHM/archive/target-types.md": "divergent: live holds this ACTIVE at LIFEOS/ALGORITHM/target-types.md; the only content delta is the fork's own PAI->LifeOS Inference Tool rename (3 B), so the add is relocation, not an upgrade",
  "LIFEOS/ALGORITHM/archive/modes/README.md": "divergent: live holds this ACTIVE at LIFEOS/ALGORITHM/modes/README.md; payload says the Pulse mode-tab strip was REMOVED 2026-07-14 while live's copy still names agents/page.tsx:23-30 as runtime truth — landing both leaves the contradiction in the tree instead of resolving it",
  "LIFEOS/ALGORITHM/archive/modes/ideate.md": "divergent: live holds this ACTIVE at LIFEOS/ALGORITHM/modes/ideate.md; upstream's archive copy differs only by last_updated_by and ../.. link depth",
  "LIFEOS/ALGORITHM/archive/modes/iterate.md": "divergent: live holds this ACTIVE at LIFEOS/ALGORITHM/modes/iterate.md; archive copy differs only by last_updated_by and relative-link depth",
  "LIFEOS/ALGORITHM/archive/modes/loop.md": "divergent: live holds this ACTIVE at LIFEOS/ALGORITHM/modes/loop.md; archive copy differs only by last_updated_by and relative-link depth",
  "LIFEOS/ALGORITHM/archive/modes/native.md": "divergent: live holds this ACTIVE at LIFEOS/ALGORITHM/modes/native.md; archive copy differs only by last_updated_by and relative-link depth",
  "LIFEOS/ALGORITHM/archive/modes/optimize.md": "divergent: live holds this ACTIVE at LIFEOS/ALGORITHM/modes/optimize.md; archive copy differs by last_updated_by, link depth, and a ../../v6.5.0.md pointer live has no file for",

  // Not an archive file, and a different hazard — a version spec from a lineage live does not
  // run. Live's LATEST reads 8.18.0: the 8.x shape grafted on while KEEPING the fork's v6.4
  // gates, which 8.17.3 has no text for, so reading it as current doctrine drops them silently.
  //
  // Two consumers were measured and only one is a hazard, stated precisely because the sibling
  // v8.4.0.md case WAS a resolver hazard and that reasoning does not transfer:
  //   - ArchitectureSummaryGenerator.ts -> detectAlgorithmVersion() reads ALGORITHM/LATEST first
  //     and returns early when it matches ^\d+\.\d+\.\d+$. Live's LATEST is well-formed, so the
  //     readdirSync semver-sort fallback never fires; and 8.18.0 outsorts 8.17.3 even if it did.
  //     NO resolver hazard.
  //   - LIFEOS/PULSE/modules/wiki.ts:535 readdirSync's ALGORITHM_DIR with an isFile() filter,
  //     NON-recursively. A top-level v8.17.3.md WOULD be indexed into the Pulse wiki as a system
  //     doc beside live's own lineage. (The 9 archive/** files escape this one by being in a
  //     subdirectory — which is also why they are refused on the duplicate-path grounds above
  //     rather than this one.)
  //
  // Live already has the home and the escape hatch: LIFEOS/ALGORITHM/_inert-upstream/ holds
  // upstream's v8.4.0.md plus a README stating "parking is the durable form of 'not this one'"
  // and "kept, not deleted, because it also ships in the upstream install payload — a local
  // delete is reverted by the next sync." Park it there by hand if it is wanted; a directory
  // name cannot match ^v\d+\.\d+\.\d+\.md$ and readdirSync does not recurse, so that location
  // is out of both consumers' reach.
  "LIFEOS/ALGORITHM/v8.17.3.md": "divergent: upstream 8.17.x is not live's lineage — live's grafted 8.18.0 keeps fork v6.4 gates 8.17.3 has no text for; landing it top-level gets it indexed as a system doc by LIFEOS/PULSE/modules/wiki.ts:535, and live's home for upstream specs it does not run is LIFEOS/ALGORITHM/_inert-upstream/ (park by hand, not via this channel)",

  // NOT a divergent duplicate — a hardcoded-credential refusal, the second kind of add that
  // is faithful and still wrong to land. ggshield flags a Generic High Entropy Secret at
  // eightsleep.ts:30 (APP_CLIENT_SECRET, 64 hex chars). Upstream documents it as a public
  // mobile-app OAuth constant and makes it env-overridable, which is plausible and is NOT
  // sufficient grounds to write a hardcoded high-entropy credential into the live tree: the
  // live repo's ggshield pre-commit would block the commit, and "the vendor published it"
  // is a claim this channel cannot verify. Refused rather than committed with a bypass —
  // never disable a scanner to land a file.
  //
  // Upstream's ORIGINAL Stop voice pair. Live absorbed both into a single replacement hook
  // on 2026-07-28 and says so in its own docblock (hooks/VoiceSummary.hook.ts): "THE SINGLE
  // Stop VOICE HOOK. This absorbed VoiceCompletion.hook.ts + handlers/VoiceNotification.ts
  // ... Those were the original upstream pair, never wired here; this hook is the later local
  // replacement that took their place on Stop. Wiring both would have spoken every turn
  // twice, so the four things the old pair did better were ported in instead" — subagent gate,
  // content validation, OSC-9 desktop fallback, and event logging, plus the previously-orphaned
  // isDesktopChannel guard. So the content is already live at a path live actually dispatches;
  // these two are the pre-absorption originals. Landing them is worse than inert: settings.json
  // registers neither (probed, rg exit 1 with a passing positive control), so they arrive
  // dormant — and the moment anyone "fixed" that by wiring them, every turn would be spoken
  // twice. Refused rather than landed-and-left-dormant, which would leave a second source of
  // truth for Stop voice sitting one settings.json edit away from a regression.
  "hooks/VoiceCompletion.hook.ts": "divergent: live's hooks/VoiceSummary.hook.ts absorbed this on 2026-07-28 and is the registered Stop voice hook; landing it re-splits Stop voice and wiring both would speak every turn twice",
  "hooks/handlers/VoiceNotification.ts": "divergent: absorbed into live's hooks/VoiceSummary.hook.ts (2026-07-28) along with its VoiceCompletion caller; landing the handler alone adds an unreferenced second voice path",

  // Safe to hold back: HealthSync.ts reaches sources through a DYNAMIC import
  // (`await import("./healthsync/${source}.ts")`, line 152), so the absent file breaks only
  // `--source eightsleep`, not the tool — probed, `--help` exits 0 with the file removed.
  // The other 6 healthsync modules and the shared types land normally. EIGHTSLEEP_* is
  // absent from live .env and no cron/hook invokes HealthSync, so nothing is degraded.
  // To adopt: set EIGHTSLEEP_CLIENT_ID/SECRET in .env, replace the two literals with the
  // env reads, then land the file — i.e. port content, don't lift the refusal.
  //
  // DISCHARGED 2026-07-31 by exactly that route (live 60bd037): the module is in live with
  // both constants read from ctx.env, zero hardcoded literals (probed — no 40+ hex run in the
  // file), and the ggshield pre-commit passed on the real commit rather than being bypassed.
  // The refusal is KEPT, not deleted: it still governs the payload copy, which is unchanged
  // and still carries the literal, so lifting the entry would re-open a straight `--apply` to
  // write the hardcoded version over a clean live file. The `refusalDischarged` set below is
  // what stops AUDIT A from reporting this as a by-hand landing.
  "LIFEOS/TOOLS/healthsync/eightsleep.ts": "secret: ggshield flags a Generic High Entropy Secret (APP_CLIENT_SECRET, eightsleep.ts:30); upstream calls it a public app constant but this channel cannot verify that, and the live pre-commit would block it — port it with env reads instead of landing hardcoded",
};

/**
 * Refusals whose live copy arrived through the refusal's OWN prescribed remedy, not by hand.
 *
 * AUDIT A exists because a refused path sitting in live means INVARIANT 8 has stopped
 * protecting anything, and that must never read as coverage. But its message names a cause
 * ("landed before the gate existed, or by hand — review the live copy") that is wrong when the
 * refusal note said "port the content" and someone did precisely that. A permanent warning
 * with a false cause is worse than no warning: it trains the reader to skip the whole block,
 * including the entries that are real.
 *
 * An entry here is a CLAIM ABOUT LIVE, so it is re-probed at runtime rather than trusted —
 * see verifyDischarged(). A discharge whose condition no longer holds reverts to a violation.
 */
const REFUSAL_DISCHARGED: Record<string, { landedIn: string; why: string; probe: (liveAbs: string) => boolean }> = {
  "LIFEOS/TOOLS/healthsync/eightsleep.ts": {
    landedIn: "60bd037",
    why: "ported with env reads per this refusal's own remedy; no hardcoded credential remains",
    // The refusal's grounds were a hardcoded high-entropy literal. The discharge holds only
    // while live has none — so probe for it instead of taking the commit message's word.
    probe: (liveAbs) => {
      let text: string;
      try { text = readFileSync(liveAbs, "utf8"); } catch { return false; }
      return !/[0-9a-f]{40,}/i.test(text) && /env\.EIGHTSLEEP_CLIENT_SECRET/.test(text);
    },
  },
};

/**
 * Refusals whose PAYLOAD file upstream has deleted. The decision is kept; the path is gone.
 *
 * AUDIT B reports any refusal key matching no payload file, because an exact key is brittle to
 * an upstream rename and a key protecting nothing must never read as coverage. That arm is
 * correct and stays. What it could not do is tell the two causes apart, and they need opposite
 * responses:
 *   - upstream MOVED the file -> the refusal is BYPASSED. Its successor is in the write set
 *     right now. Act immediately.
 *   - upstream DELETED the file -> the refusal is DORMANT. Nothing can land, nothing to do.
 * Reported identically, 11 rows deep, the second kind drowns the first: that is precisely how
 * the ISAFormat row above sat bypassed while its warning printed every run. An entry here is
 * the second case, adjudicated, so the loud arm is left holding only rows that need a human.
 *
 * The keys stay in REFUSED_ADDS deliberately rather than being deleted. Upstream restoring a
 * path is a real event (release 7.28.3 both deleted and re-added files), and a deleted key
 * would let the restored file land silently. Retiring RE-ARMS: the moment the path reappears in
 * the payload, the refusal is enforced again and the retirement is reported as no longer holding.
 *
 * Like REFUSAL_DISCHARGED, an entry here is a CLAIM — "upstream does not ship this" — so it is
 * re-probed against the payload every run instead of trusted.
 */
const RETIRED_REFUSALS: Record<string, { droppedIn: string; why: string }> = {
  // Upstream deleted all six in release 7.28.3. Live's copies are untouched at skills/Agents/,
  // which is the path live's 10 agent definitions and LoadAgentContext.ts already read — i.e.
  // the divergence the refusal was protecting against no longer has a payload side.
  "agents/ForgeContext.md": { droppedIn: "36c6f01e", why: "deleted in release 7.28.3; live keeps skills/Agents/ForgeContext.md" },
  "agents/CodexResearcherContext.md": { droppedIn: "36c6f01e", why: "deleted in release 7.28.3; live keeps skills/Agents/CodexResearcherContext.md" },
  "agents/GrokResearcherContext.md": { droppedIn: "36c6f01e", why: "deleted in release 7.28.3; live keeps skills/Agents/GrokResearcherContext.md" },
  "agents/ClaudeResearcherContext.md": { droppedIn: "36c6f01e", why: "deleted in release 7.28.3; live keeps skills/Agents/ClaudeResearcherContext.md" },
  "agents/GeminiResearcherContext.md": { droppedIn: "36c6f01e", why: "deleted in release 7.28.3; live keeps skills/Agents/GeminiResearcherContext.md" },
  "agents/PerplexityResearcherContext.md": { droppedIn: "36c6f01e", why: "deleted in release 7.28.3; live keeps skills/Agents/PerplexityResearcherContext.md" },

  // Same release deleted the whole TOOLS/llcli/ directory, and upstream now ships no LIFEOS/bin/
  // either — so llcli has left the payload entirely. The port these rows protected is intact:
  // live LIFEOS/bin/llcli/ still holds all four files, and it is now the only copy anywhere.
  "LIFEOS/TOOLS/llcli/llcli.ts": { droppedIn: "36c6f01e", why: "deleted in release 7.28.3, and upstream ships no LIFEOS/bin/ either; the ported live copy at LIFEOS/bin/llcli/llcli.ts is now the only one" },
  "LIFEOS/TOOLS/llcli/package.json": { droppedIn: "36c6f01e", why: "deleted in release 7.28.3; live keeps LIFEOS/bin/llcli/package.json" },
  "LIFEOS/TOOLS/llcli/README.md": { droppedIn: "36c6f01e", why: "deleted in release 7.28.3; live keeps LIFEOS/bin/llcli/README.md" },
  "LIFEOS/TOOLS/llcli/QUICKSTART.md": { droppedIn: "36c6f01e", why: "deleted in release 7.28.3; live keeps LIFEOS/bin/llcli/QUICKSTART.md" },
};

/**
 * Split refusal keys that match no payload file into the three cases that need different
 * responses. Pure and exported so the self-test can grade it on synthetic inputs: this is the
 * arm that FAILED — 11 undifferentiated rows hid one bypassed refusal for eleven days — and an
 * arm whose logic lives inline in a report block cannot be tested except by reading it.
 *
 * `bypassed` is found by case-folding the payload's own path set, so it catches the exact
 * relationship that defeated the old single list: upstream re-spelled a path, the key stopped
 * matching, and the successor entered the write set. Anything neither bypassed nor recorded as
 * retired stays in `stale`, which is the loud default — absence with no explanation is a finding.
 */
export function classifyAbsentRefusals(
  absentKeys: string[],
  payloadPaths: Iterable<string>,
  retired: Record<string, unknown>,
): { bypassed: [string, string][]; retired: string[]; stale: string[] } {
  const byLower = new Map<string, string>();
  for (const p of payloadPaths) byLower.set(p.toLowerCase(), p);
  const bypassed: [string, string][] = [];
  const retiredOut: string[] = [];
  const stale: string[] = [];
  for (const k of absentKeys) {
    const twin = byLower.get(k.toLowerCase());
    if (twin !== undefined && twin !== k) bypassed.push([k, twin]);
    else if (retired[k] !== undefined) retiredOut.push(k);
    else stale.push(k);
  }
  return { bypassed, retired: retiredOut, stale };
}

type Plan = {
  releaseRel: string; // path within RELEASE_PAYLOAD
  liveRel: string; // path within live root — IDENTICAL to releaseRel (both LIFEOS/-shaped)
  bytes: Buffer;
  flags: number; // count of live-dead PAI tokens
  firstFlag?: { line: number; token: string; context: string };
  status: "will-add" | "skip-exists" | "skip-skill" | "skip-scaffold" | "skip-flagged" | "skip-escape" | "skip-refused" | "skip-excluded" | "skip-case";
  refusedReason?: string; // INVARIANT 8: why this add was decided against
  caseTwin?: string; // INVARIANT 9: the live path this collides with by case alone
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
    // INVARIANT 9 sits with the structural gates, above INVARIANT 8's two buckets, for the
    // reason the block above gives: skip-refused stays a clean subset of what would OTHERWISE
    // have been written, and a case-colliding file would not have been written either way. The
    // report re-attaches the refusal reason where both apply, so the human-written decision is
    // never lost to the computed catch.
    let status: Plan["status"];
    let caseTwin: string | null = null;
    if (existsSync(destAbs)) status = "skip-exists"; // INVARIANT 1: never overwrite
    else if (SCAFFOLD_ZONES.some((z) => liveRel.startsWith(z))) status = "skip-scaffold"; // INVARIANT 7: USER/MEMORY owned by onboarding
    else if (liveRel.startsWith("skills/")) status = "skip-skill"; // INVARIANT 3: CreateSkill owns these
    else if (!realDestWithin(destAbs, root).ok) status = "skip-escape"; // INVARIANT 2: containment
    else if ((caseTwin = caseOnlyCollision(liveRel, root)) !== null) status = "skip-case"; // INVARIANT 9: case-only twin
    else if (dead.length > 0 && !allowFlagged) status = "skip-flagged"; // INVARIANT 6: live-dead token
    else if (REFUSED_ADDS[liveRel] !== undefined) status = "skip-refused"; // INVARIANT 8: decided against
    else if (isExcluded(liveRel, excludes)) status = "skip-excluded"; // ad-hoc holdback
    else status = "will-add";

    plans.push({
      releaseRel, liveRel, bytes, flags: dead.length, firstFlag: dead[0], status,
      refusedReason: REFUSED_ADDS[liveRel],
      caseTwin: caseTwin ?? undefined,
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
    "skip-refused": 0, "skip-excluded": 0, "skip-case": 0,
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
      // Same for INVARIANT 9, and for the same reason: an EARLIER write in this very run can
      // create the colliding directory (the payload index may hold two spellings of one path
      // even where a case-insensitive checkout cannot). Planned-clean is not written-clean.
      const twinNow = caseOnlyCollision(p.liveRel, liveRoot());
      if (twinNow !== null) {
        console.error(`  ABORT: case-only collision appeared at write time: ${p.liveRel} vs live ${twinNow}`);
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

  // INVARIANT 9. Each hold names BOTH paths, because the whole harm is that the two differ by
  // something a reader skims past. Where a recorded refusal also covers the row, print its
  // reason too: the computed guard says "these collide", only the adjudication says why the
  // live copy is the one that stays.
  const casePlans = plans.filter((p) => p.status === "skip-case");
  if (casePlans.length) {
    console.log("");
    console.log("HELD — case-only path collision (INVARIANT 9; would land at a path this plan did not print):");
    for (const p of casePlans) {
      console.log(`  hold ${p.liveRel}\n         live has ${p.caseTwin}`);
      const decided = REFUSED_ADDS[p.liveRel];
      if (decided) console.log(`         also a recorded refusal: ${decided}`);
    }
    console.log("  Port the content onto the live path, or rename live's copy deliberately — never land both spellings.");
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
  const refusedInLive = plans.filter((p) => p.status === "skip-exists" && REFUSED_ADDS[p.liveRel] !== undefined);
  // A discharge is a claim about live, so re-probe it here. Trusting the table would let a
  // stale entry mute a real violation — the same failure mode AUDIT B guards for stale keys.
  const discharged = refusedInLive.filter((p) => {
    const d = REFUSAL_DISCHARGED[p.liveRel];
    return d !== undefined && d.probe(path.join(liveRoot(), ...p.liveRel.split("/")));
  });
  const dischargedSet = new Set(discharged.map((p) => p.liveRel));
  const violated = refusedInLive.filter((p) => !dischargedSet.has(p.liveRel));
  if (violated.length) {
    console.log("");
    console.log("⚠ VIOLATED REFUSAL — refused path already present in live (INVARIANT 8 no longer protecting):");
    for (const p of violated) console.log(`  live ${p.liveRel} — decided against: ${REFUSED_ADDS[p.liveRel]}`);
    console.log("  Someone landed these before the gate existed, or by hand. Review the live copy.");
  }
  if (discharged.length) {
    console.log("");
    console.log("✓ REFUSAL DISCHARGED — live copy arrived via the refusal's own remedy (re-probed this run):");
    for (const p of discharged) {
      const d = REFUSAL_DISCHARGED[p.liveRel]!;
      console.log(`  live ${p.liveRel} — ${d.why} (${d.landedIn})`);
    }
    console.log("  The refusal stays in force for the PAYLOAD copy, which still carries the original.");
  }
  // A discharge entry whose probe FAILS is the dangerous case: it means live no longer matches
  // the condition that justified the discharge, so the path must fall back to a violation —
  // which the filter above already does. Say so, rather than letting it vanish from the report.
  const dischargeStale = Object.keys(REFUSAL_DISCHARGED).filter(
    (k) => refusedInLive.some((p) => p.liveRel === k) && !dischargedSet.has(k),
  );
  if (dischargeStale.length) {
    console.log("");
    console.log("⚠ DISCHARGE NO LONGER HOLDS — reverted to a violation above:");
    for (const k of dischargeStale) console.log(`  ${k} — the live copy stopped satisfying the discharge probe`);
  }

  // AUDIT B — a refusal key matching no payload file. Exact keys are brittle to an upstream
  // rename, and a stale entry reads as protection while protecting nothing. Scoped to
  // unfiltered runs: under --only, "absent" just means out of scope.
  //
  // Split three ways, because one list of 11 hid the one row that mattered. The BYPASSED arm is
  // the teeth: it finds the successor by case-folding the payload's own path set, which is the
  // relationship `existsSync` cannot see and a human skimming two near-identical strings does
  // not either. RETIRED is adjudicated absence, quiet by design. Anything left is unexplained
  // and stays loud — that is the default arm, so a NEW rename is never silently retired.
  if (!only && !excludes.length) {
    const absent = Object.keys(REFUSED_ADDS).filter((k) => !planned.has(k));
    const { bypassed, retired, stale } = classifyAbsentRefusals(absent, planned, RETIRED_REFUSALS);

    if (bypassed.length) {
      console.log("");
      console.log("⚠ REFUSAL BYPASSED BY A RENAME — the key is gone but upstream still ships the file under another spelling:");
      for (const [k, twin] of bypassed) {
        console.log(`  gone ${k}\n    -> now ${twin} (status: ${plans.find((p) => p.liveRel === twin)?.status ?? "unknown"})`);
        console.log(`       decided against: ${REFUSED_ADDS[k]}`);
      }
      console.log("  RE-KEY the entry onto the new path. Until then the decision is not being enforced.");
    }
    if (stale.length) {
      console.log("");
      console.log("⚠ STALE REFUSAL — REFUSED_ADDS key matches no payload file (upstream moved or dropped it):");
      for (const k of stale) console.log(`  gone ${k} — ${REFUSED_ADDS[k]}`);
      console.log("  Re-adjudicate against the new path, or record it in RETIRED_REFUSALS. It protects nothing as written.");
    }
    if (retired.length) {
      console.log("");
      console.log(`RETIRED REFUSALS — ${retired.length} adjudicated absences (upstream deleted the path; the key re-arms if it returns):`);
      for (const k of retired) {
        const r = RETIRED_REFUSALS[k]!;
        console.log(`  gone ${k} — ${r.why} (${r.droppedIn})`);
      }
    }
    // The mirror of DISCHARGE NO LONGER HOLDS: a retirement claims upstream does not ship the
    // path, so a retired key that IS in the payload means the claim expired. The refusal itself
    // is already back in force (the ladder never consulted this table) — say so, rather than
    // leaving a stale annotation asserting the file is gone while the plan holds it.
    const retirementExpired = Object.keys(RETIRED_REFUSALS).filter((k) => planned.has(k));
    if (retirementExpired.length) {
      console.log("");
      console.log("⚠ RETIREMENT NO LONGER HOLDS — upstream restored a path recorded as deleted (refusal re-armed):");
      for (const k of retirementExpired) {
        console.log(`  back ${k} — recorded as ${RETIRED_REFUSALS[k]!.why} (${RETIRED_REFUSALS[k]!.droppedIn})`);
      }
      console.log("  Drop the RETIRED_REFUSALS row; the refusal is enforcing again and the note now contradicts the payload.");
    }
  }

  console.log("");
  console.log(`SUMMARY: will-add ${counts["will-add"]} | skip-exists ${counts["skip-exists"]} (conflicts/unchanged — protected)`);
  console.log(`         skip-scaffold ${counts["skip-scaffold"]} (USER/MEMORY — onboarding owns) | skip-skill ${counts["skip-skill"]} (route via CreateSkill)`);
  console.log(`         skip-flagged ${counts["skip-flagged"]} (dead PAI tokens, listed above) | skip-escape ${counts["skip-escape"]}`);
  console.log(`         skip-refused ${counts["skip-refused"]} (decided divergent duplicates — INVARIANT 8) | skip-excluded ${counts["skip-excluded"]} (ad-hoc --exclude)`);
  console.log(`         skip-case ${counts["skip-case"]} (case-only twin of a live path — INVARIANT 9)`);
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
  // all 12 as will-add. Then 18: +5 USER_TEMPLATES siblings (the rename refactor was refused
  // only in part) and +1 hardcoded-credential refusal, which is a SECOND refusal class —
  // faithful, not divergent, and still wrong to write into live. Now 20: +2 for upstream's
  // original Stop voice pair, which live's VoiceSummary.hook.ts absorbed on 2026-07-28.
  //
  // This count alone is a WEAK guard — a bare total goes green on a half-finished edit, so it
  // is the class check below (every reason tagged divergent:/secret:) and the STALE-key report
  // at plan time that do the structural work. The count's only job is to make a silent DROP of
  // an adjudicated row loud.
  //
  // Still 20 after the first 2026-08-12 pass: the ISA row was RE-KEYED (Isa/IsaFormat.md ->
  // ISA/ISAFormat.md), not added or dropped. That the total did not move is the point — a count
  // cannot see a re-key, which is why the bypass arm in AUDIT B and the derived fixture below
  // exist.
  //
  // Now 30 (2026-08-13): +10 for the ALGORITHM adds — 9 `archive/**` retirement records whose
  // un-archived twin is live and ACTIVE, plus v8.17.3.md from a lineage live does not run. A
  // THIRD shape of refusal, and worth naming because the first two do not describe it: the
  // payload file here is not stale, not a secret, and not even necessarily worse than live's —
  // it is upstream's record of a MOVE live never made, and this channel cannot make a move.
  const refusedKeys = Object.keys(REFUSED_ADDS);
  checks.push({ name: "refuse: REFUSED_ADDS holds exactly 30 adjudicated rows", got: refusedKeys.length === 30, want: true });
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
  // share a directory with a refused one — the LIFEOS/RULES/ class, new doctrine whose reader is
  // skip-skill, which is an unread-clutter question rather than a divergence one, and refusing
  // it here would encode the wrong reason.
  //
  // The illustration this comment used to give has EXPIRED and is worth recording as a lesson
  // rather than quietly swapping: it named DOCUMENTATION/Isa/IsaHierarchy.md and IsaHtmlMirror.md
  // as siblings that "exist nowhere in live". They exist in live now — landed by live commit
  // deb8d78 "Land 20 upstream subsystem docs (reference only, nothing wired)", which is this very
  // channel doing its job. A justification comment that cites the CURRENT contents of another
  // tree dates the moment it is written; the check itself re-derives liveBasenames every run,
  // which is why the check stayed correct while the prose explaining it went stale.
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
  // payload file would re-split the source of truth the port just unified. Upstream has since
  // DELETED the payload copy (release 7.28.3), so the row is retired below rather than removed —
  // the key must survive that, or a restored upstream file would land unrefused.
  checks.push({
    name: "refuse: the ported llcli.ts row is refused too (content went to bin/llcli)",
    got: REFUSED_ADDS["LIFEOS/TOOLS/llcli/llcli.ts"] !== undefined,
    want: true,
  });

  // ── RETIREMENT: adjudicated absence, re-probed rather than trusted ───────────
  // A retirement is a claim about the PAYLOAD ("upstream deleted this"), so the same rule as
  // REFUSAL_DISCHARGED applies: grade the claim against the payload every run. Case-sensitive
  // membership in the walked set, NOT existsSync — existsSync case-folds on Windows and would
  // report a re-spelled path as still present, which is the precise failure that let the
  // ISAFormat refusal read as live while it was bypassed.
  const payloadRel = new Set(walk(RELEASE_PAYLOAD));
  const retiredKeys = Object.keys(RETIRED_REFUSALS);
  checks.push({
    name: "retire: every retired key is still a REFUSED_ADDS row (retiring is not deleting)",
    got: retiredKeys.every((k) => REFUSED_ADDS[k] !== undefined),
    want: true,
  });
  checks.push({
    name: `retire: every retired key is genuinely absent from the payload (re-probed, ${retiredKeys.length} rows)`,
    got: retiredKeys.every((k) => !payloadRel.has(k)),
    want: true,
  });
  checks.push({
    name: "retire: every retirement names the commit that dropped it (checkable claim)",
    got: retiredKeys.every((k) => /^[0-9a-f]{7,40}$/.test(RETIRED_REFUSALS[k]!.droppedIn)),
    want: true,
  });
  // Anti: a refusal whose payload file is PRESENT must never be retired — that would annotate a
  // live refusal as gone and mute the report for a file the plan is actively holding.
  checks.push({
    name: "anti: no retirement covers a refusal whose payload file is present",
    got: retiredKeys.some((k) => payloadRel.has(k)),
    want: false,
  });

  // ── AUDIT B classification: the arm that failed, graded on synthetic input ────
  // Discriminating pair. Same absent key, same retirement table; the ONLY difference is whether
  // the payload holds a re-spelled twin. A classifier that ignored case (or ignored the payload)
  // would put the key in the same bucket both times, which is exactly the old behaviour.
  const cBypass = classifyAbsentRefusals(["a/B/Thing.md"], ["a/b/thing.md", "other.md"], {});
  checks.push({
    name: "auditB: a case-respelled twin in the payload classifies as BYPASSED, not stale",
    got: cBypass.bypassed.length === 1 && cBypass.bypassed[0]![1] === "a/b/thing.md" && cBypass.stale.length === 0,
    want: true,
  });
  const cStale = classifyAbsentRefusals(["a/B/Thing.md"], ["other.md"], {});
  checks.push({
    name: "auditB: the same key with NO twin in the payload classifies as STALE",
    got: cStale.stale.length === 1 && cStale.bypassed.length === 0,
    want: true,
  });
  const cRetired = classifyAbsentRefusals(["a/B/Thing.md"], ["other.md"], { "a/B/Thing.md": {} });
  checks.push({
    name: "auditB: an absent key with a retirement row classifies as RETIRED (quiet)",
    got: cRetired.retired.length === 1 && cRetired.stale.length === 0,
    want: true,
  });
  // PRECEDENCE, and it is load-bearing: a retirement row must NOT be able to silence a bypass.
  // Retiring is a human annotation; a twin in the payload is a fact. If the annotation won, a
  // wrong retirement would hide an unenforced decision — the failure this whole split addresses.
  const cBoth = classifyAbsentRefusals(["a/B/Thing.md"], ["a/b/thing.md"], { "a/B/Thing.md": {} });
  checks.push({
    name: "auditB: a payload twin OUTRANKS a retirement row (annotation cannot mute a bypass)",
    got: cBoth.bypassed.length === 1 && cBoth.retired.length === 0,
    want: true,
  });
  checks.push({
    name: "anti: an exact self-match is not reported as a bypass of itself",
    got: classifyAbsentRefusals(["a/b/thing.md"], ["a/b/thing.md"], {}).bypassed.length > 0,
    want: false,
  });
  // CASE-EXACTNESS OF THE KEYS THEMSELVES, graded from the other side. A key that existsSync
  // calls present while the case-sensitive walked set does not is a case-MISMATCHED key — the
  // precise state the ISAFormat refusal sat in for eleven days, reading as enforced because the
  // only cheap presence test available on this platform lies about it. Platform note, and it is
  // the asymmetry INVARIANT 9's docblock describes: on a case-SENSITIVE host both sides return
  // false and this arm is vacuous. It is a Windows/APFS arm on purpose — that is where the lie
  // lives, and the bypass arm below is the check that holds on every host.
  checks.push({
    name: "refuse: no refusal key is present only under case-folding (existsSync vs walked set)",
    got: refusedKeys.every(
      (k) => existsSync(path.join(RELEASE_PAYLOAD, ...k.split("/"))) === payloadRel.has(k),
    ),
    want: true,
  });
  // The live table must be CLEAN on both loud arms right now — this is the regression guard for
  // the defect being fixed. It grades the real REFUSED_ADDS against the real payload, so an
  // upstream rename that bypasses a refusal fails the self-test instead of only printing a line.
  const liveAbsent = Object.keys(REFUSED_ADDS).filter((k) => !payloadRel.has(k));
  const liveClass = classifyAbsentRefusals(liveAbsent, payloadRel, RETIRED_REFUSALS);
  checks.push({
    name: `auditB: no refusal is currently bypassed by a rename (found ${liveClass.bypassed.length}: ${liveClass.bypassed.map(([k, t]) => `${k} -> ${t}`).join(", ") || "none"})`,
    got: liveClass.bypassed.length === 0,
    want: true,
  });
  checks.push({
    name: `auditB: no refusal is stale-and-unexplained (found ${liveClass.stale.length}: ${liveClass.stale.join(", ") || "none"})`,
    got: liveClass.stale.length === 0,
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
  //
  // FIXTURE IS DERIVED, NOT NAMED. The previous version of these three checks hardcoded
  // `agents/ForgeContext.md`, and all three went red the day upstream deleted that file — a
  // red that said nothing about the refusal gate, only about the fixture. Selection is a
  // case-sensitive lookup in the walked payload set (`payloadRel`), deliberately NOT
  // `existsSync`: on Windows existsSync would case-fold a re-spelled key back into "present"
  // and hand these checks a fixture the plan can never emit as skip-refused. Zones that
  // outrank INVARIANT 8 in the ladder are excluded so the expectation is unambiguous.
  //
  // Honest limit on that choice, measured: substituting existsSync here SURVIVES mutation
  // today, because no current key is case-mismatched, so the two tests agree on every row.
  // It is defence against a future key, not a guard with teeth now — the arm that actually
  // catches a case-mismatched key is the existsSync-vs-walked-set check above.
  const sandbox = path.join(os.tmpdir(), "ua-selftest-refuse-root");
  const savedForRefuse = process.env.LIFEOS_DIR;
  const savedPaiForRefuse = process.env.PAI_DIR;
  delete process.env.PAI_DIR;
  process.env.LIFEOS_DIR = sandbox;
  mkdirSync(sandbox, { recursive: true });
  const payloadList = [...payloadRel];
  const refuseFixture = refusedKeys.find(
    (k) =>
      payloadRel.has(k) &&
      REFUSAL_DISCHARGED[k] === undefined &&
      !k.startsWith("skills/") &&
      !SCAFFOLD_ZONES.some((z) => k.startsWith(z)),
  );
  // Fail LOUD rather than silently skipping: an empty intersection means every adjudicated
  // refusal has left the payload, which is itself the thing worth knowing.
  checks.push({
    name: `refuse: a live refusal fixture is derivable from the payload (got ${refuseFixture ?? "NONE"})`,
    got: refuseFixture !== undefined,
    want: true,
  });
  if (refuseFixture !== undefined) {
    const refuseRow = buildPlan(refuseFixture, true).find((p) => p.liveRel === refuseFixture);
    checks.push({
      name: "refuse: enforced by default, and --allow-flagged does not bypass it",
      got: refuseRow?.status === "skip-refused",
      want: true,
    });
    // Assert on IDENTITY with the table, not on a substring of one reason's prose. The old
    // check looked for "gpt-5.6-sol", which pinned it to one specific entry's wording.
    checks.push({
      name: "refuse: the plan row carries that key's own reason through to the caller",
      got: refuseRow?.refusedReason === REFUSED_ADDS[refuseFixture],
      want: true,
    });
    // LADDER ORDER: skip-exists must WIN over skip-refused. If a refused path has already
    // landed, the status has to report true live state; the violated-refusal audit is what
    // makes that case loud, and inverting the ladder would hide it behind a refusal label.
    const fixtureSegs = refuseFixture.split("/");
    const fixtureAbs = path.join(sandbox, ...fixtureSegs);
    mkdirSync(path.dirname(fixtureAbs), { recursive: true });
    writeFileSync(fixtureAbs, "already landed\n");
    const alreadyThere = buildPlan(refuseFixture, true).find((p) => p.liveRel === refuseFixture);
    checks.push({
      name: "ladder: skip-exists outranks skip-refused (INVARIANT 1 not shadowed)",
      got: alreadyThere?.status === "skip-exists",
      want: true,
    });
    rmSync(path.join(sandbox, fixtureSegs[0]!), { recursive: true, force: true });
  }

  // ── INVARIANT 9: case-only path collision ───────────────────────────────────
  // Direct unit tests first, on the guard itself. The FILE-level twin is the one the plan
  // ladder can never show on Windows (existsSync case-folds, so INVARIANT 1 claims it), which
  // is exactly why it needs testing here rather than through buildPlan.
  mkdirSync(path.join(sandbox, "cs", "inner"), { recursive: true });
  writeFileSync(path.join(sandbox, "cs", "inner", "thing.md"), "live\n");
  checks.push({
    name: "case: a file-level twin differing only in case is reported with live's spelling",
    got: caseOnlyCollision("cs/inner/Thing.md", sandbox) === "cs/inner/thing.md",
    want: true,
  });
  checks.push({
    name: "case: a directory-level twin is reported at the colliding SEGMENT, not the leaf",
    got: caseOnlyCollision("cs/INNER/brand-new.md", sandbox) === "cs/inner",
    want: true,
  });
  checks.push({
    name: "anti: an exactly-matching path is not a collision (that is INVARIANT 1's job)",
    got: caseOnlyCollision("cs/inner/thing.md", sandbox) !== null,
    want: false,
  });
  checks.push({
    name: "anti: a genuinely new subtree is not a collision",
    got: caseOnlyCollision("brand/new/thing.md", sandbox) !== null,
    want: false,
  });
  rmSync(path.join(sandbox, "cs"), { recursive: true, force: true });

  // Then through the production entry point, with a derived payload fixture — a guard that
  // works in isolation but is not reachable from buildPlan would still write the bytes.
  const flipCase = (s: string) =>
    s
      .split("")
      .map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()))
      .join("");
  const caseFixture = payloadList.find((r) => {
    const segs = r.split("/");
    if (segs.length < 2) return false;
    const parentLast = segs[segs.length - 2]!;
    return (
      flipCase(parentLast) !== parentLast &&
      REFUSED_ADDS[r] === undefined &&
      !r.startsWith("skills/") &&
      !SCAFFOLD_ZONES.some((z) => r.startsWith(z))
    );
  });
  checks.push({
    name: `case: a payload fixture with a case-flippable parent directory exists (got ${caseFixture ?? "NONE"})`,
    got: caseFixture !== undefined,
    want: true,
  });
  if (caseFixture !== undefined) {
    const segs = caseFixture.split("/");
    const parent = segs.slice(0, -1);
    const flippedParent = parent.map((s, i) => (i === parent.length - 1 ? flipCase(s) : s));
    // CONTROL FIRST, and it is the half that makes the positive meaningful: with nothing in
    // the sandbox this same path must be a plain will-add. Without it, a guard that held
    // EVERYTHING back would pass the positive check.
    const before = buildPlan(caseFixture, true).find((p) => p.liveRel === caseFixture);
    checks.push({
      name: "case: control — with no live twin the payload path is a plain will-add",
      got: before?.status === "will-add",
      want: true,
    });
    mkdirSync(path.join(sandbox, ...flippedParent), { recursive: true });
    const after = buildPlan(caseFixture, true).find((p) => p.liveRel === caseFixture);
    checks.push({
      name: "case: a parent directory differing only in case HOLDS the write (INVARIANT 9)",
      got: after?.status === "skip-case",
      want: true,
    });
    checks.push({
      name: "case: the held row names live's spelling so the report can print both paths",
      got: after?.caseTwin === flippedParent.join("/"),
      want: true,
    });
    rmSync(path.join(sandbox, flippedParent[0]!), { recursive: true, force: true });
    // Symmetry: removing the twin must return the path to will-add. A guard that latched
    // would silently freeze the channel after any transient collision.
    const restored = buildPlan(caseFixture, true).find((p) => p.liveRel === caseFixture);
    checks.push({
      name: "case: removing the twin returns the path to will-add (the hold does not latch)",
      got: restored?.status === "will-add",
      want: true,
    });
  }

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
