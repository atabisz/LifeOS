# Plan: mirror the upstream PAI→LIFEOS rename in the fork

> Status: PLAN — FINALIZED, awaiting "execute". No files changed by this document.
> Author: Garry (DA) | Date: 2026-07-05 | Fork: atabisz/Personal_AI_Infrastructure

## Decisions locked (2026-07-05)

- **Scope: payload-only** — rename applies to `LifeOS/install/**` only. Repo-root
  `scripts/`+`Tools/` and the live `~/.claude` tree stay PAI-shaped (they face the build
  source). Confirmed by principal.
- **PAI_CONFIG.yaml → LIFEOS_CONFIG.toml: ALREADY DONE, NO WORK.** Probed on decision:
  our payload already ships `LifeOS/install/USER/CONFIG/LIFEOS_CONFIG.toml`, **byte-identical
  to upstream's** (blob `7a9d2b2`). The earlier `PAI_CONFIG.yaml` grep hit was from the
  archived `Releases/v5.0.0/` snapshot (out of scope). Drop this item from Phase 2.
  NOTE: that toml's header comment still says "read through LIFEOS/TOOLS/PaiConfig.ts
  (loadPaiConfig())" — the `PaiConfig`→`LifeosConfig` symbol rename (Phase 1/2) must update
  this comment too.
- **Commit shape: phased** — separate signed commits (content-tokens / dir+file renames /
  reference fixup) so a bisect isolates a rename bug. Confirmed by principal.

## What "the LIFEOS rename" actually is

Upstream danielmiessler/LifeOS renamed the **install-payload framework** from the `PAI`
identity to the `LIFEOS` identity, in three coordinated forms:

1. **Framework directory** `LifeOS/install/LifeOS/` → `LifeOS/install/LIFEOS/` (the runtime
   payload: ALGORITHM, TOOLS, DOCUMENTATION, PULSE, USER_TEMPLATES, VERSION, system prompt).
2. **Path/env string tokens** inside payload content: `"LifeOS"`→`"LIFEOS"` in `join()` segments,
   `PAI/…`→`LIFEOS/…` doc refs, `PAI_DIR`→`LIFEOS_DIR`, `PAI_CONFIG`→`LIFEOS_CONFIG`, etc.
3. **Symbol / filename renames**: `PaiConfig.ts`→`LifeosConfig.ts`, `UpdatePaiState.ts`→
   `UpdateLifeosState.ts`, `PaiUpgrade.ts`→`LifeosUpgrade.ts`, `paiUserDir`→`lifeosUserDir`,
   `PAI_SYSTEM_PROMPT.md`→`LIFEOS_SYSTEM_PROMPT.md`, `PAI_CONFIG.yaml`→`LIFEOS_CONFIG.toml`.

It is **NOT** a blind global `PAI`→`LIFEOS` sed. The token `PAI`/`LifeOS` appears in roles that must be preserved (see § Do-Not-Rename).

## Critical scope boundary (the thing that makes this safe)

**The rename applies to the SHIPPING PAYLOAD only — `LifeOS/install/**`.**

The repo-root tooling — `scripts/build-release.ts`, `scripts/upstream-sync.ts`,
`scripts/lifeos-normalize.ts`, `Tools/*` — **deliberately** references `PAI_DIR` /
`.claude/PAI` / `PaiConfig` because it reads from the maintainer's **live PAI-shaped
tree** (`$HOME/.claude`, still `PAI/`-rooted) as the build SOURCE. Renaming those would
break the live→release pipeline. They stay `PAI`. See `scripts/build-release.ts:529`
(`process.env.PAI_DIR ?? ~/.claude`) and `upstream-sync.ts` header (live tree "stays
PAI/-shaped because it is the build SOURCE for releases").

`scripts/lifeos-normalize.ts` is the codified proof of this boundary: it exists to rewrite
`LIFEOS→PAI` when ingesting a release INTO the live tree. Its rule table is the exact
inverse of what this plan applies, and its PRESERVE list is our Do-Not-Rename list.

## Scope tally (git-tracked, install payload)

| Class | Count | Action |
|-------|-------|--------|
| A. `install/LifeOS/` dir files | 504 | `git mv` dir → `install/LIFEOS/` |
| B. `"LifeOS"`/`/LifeOS/` path-string tokens in install content | 118 files | token rewrite |
| C. `PAI_`/`Pai*` env + symbol tokens in install | 25 files | token rewrite |
| D. `PAI/` path tokens in install content | 50 files | token rewrite |
| E. physical `*Pai*` files to rename | 3 | `git mv` |

The 3 file renames (E): `PaiConfig.ts`→`LifeosConfig.ts`, `PaiUpgrade.ts`→`LifeosUpgrade.ts`,
`UpdatePaiState.ts`→`UpdateLifeosState.ts` (all under `install/LIFEOS/TOOLS/`). Plus
`PAI_SYSTEM_PROMPT.md`→`LIFEOS_SYSTEM_PROMPT.md` and `PAI_CONFIG.yaml`→`LIFEOS_CONFIG.toml`
(note: extension change yaml→toml — confirm upstream's file content, may be a reformat not just rename).

## The transform table (inverse of lifeos-normalize.ts)

Ordered, longest-first, case-sensitive. Apply ONLY within `LifeOS/install/**`.

| # | Match (regex) | Replace | Notes |
|---|---------------|---------|-------|
| 1 | `\bPAI_SYSTEM_PROMPT\b` | `LIFEOS_SYSTEM_PROMPT` | compound first |
| 2 | `\bPAI_CONFIG_DIR\b` | `LIFEOS_CONFIG_DIR` | |
| 3 | `\bPAI_CONFIG\b` | `LIFEOS_CONFIG` | |
| 4 | `\bPAI_RELEASES\b` | `LIFEOS_RELEASES` | |
| 5 | `\bPAI_DIR\b` | `LIFEOS_DIR` | |
| 6 | `\bPAI_([A-Z][A-Z0-9_]*)` | `LIFEOS_$1` | generic env prefix, after specifics |
| 7 | `\bPAI/` | `LIFEOS/` | path segment |
| 8 | `(['"])LifeOS\1` | `$1LIFEOS$1` | quoted dir segment in join() |
| 9 | `\bPaiConfig\b` | `LifeosConfig` | symbol |
| 10 | `\bUpdatePaiState\b` | `UpdateLifeosState` | symbol |
| 11 | `\bPaiUpgrade\b` | `LifeosUpgrade` | symbol |
| 12 | `\bpaiUserDir\b` | `lifeosUserDir` | symbol |
| 13 | `\bGeneratePaiState\b` | `GenerateLifeosState` | symbol (if present) |

**After transform, flag any residual `\bPAI\b` / `PaiX` / bare `LifeOS` for human review** — do not auto-rewrite (mirrors normalize's RESIDUAL_RE gate).

## Do-Not-Rename (the ambiguity traps — from normalize's PRESERVE_RES)

- `com.pai.*` / `com.lifeos.*` — plist/launchd service ids (breaking these breaks services)
- `pai-logo`, `pai-icon`, kebab asset ids — asset filenames
- `PairwiseComparison.ts`, "pairwise", "repair", "impair" — substring false-positives (word-boundary guards this)
- Anything under `scripts/`, `Tools/`, `hooks/` at repo root — the live-tree-facing pipeline (OUT OF SCOPE)
- `scripts/upstream-sync/baseline/**` — the vendored diff-only baseline (must stay PAI-shaped; it's the comparison anchor)
- Brand prose "PAI" in historical docs/changelogs where it names the old project — review case-by-case

## Recommended approach: build a `pai-to-lifeos.ts` transform tool (NOT sed)

**Why a tool, not sed:** the same lessons that made `lifeos-normalize.ts` a tool apply in
reverse — word-boundary precision, a PRESERVE list, residual-flagging for human review, and
determinism/testability. A global sed would corrupt service ids and substring matches.

Build it as the mirror of `lifeos-normalize.ts`: pure function `paiToLifeos(text) →
{text, rewrites, flags}`, `--self-test`, allowlisted to `LifeOS/install/**`,
DRY-RUN default + `--apply`. Reuse that file's structure wholesale (it's ~120 lines).

### Phased execution (each phase = one signed commit, verifiable independently)

**Phase 0 — tool + tests (no repo mutation).**
- Write `scripts/pai-to-lifeos.ts` (invert normalize's rules; port its PRESERVE_RES + RESIDUAL flagging).
- `--self-test` with fixtures: a `join(x,"LifeOS","MEMORY")` → `"LIFEOS"`; a `com.pai.pulse` PRESERVED; a `PairwiseComparison` untouched; a `PAI_DIR` → `LIFEOS_DIR`; a bare "PAI" in prose → FLAGGED not rewritten.
- Gate: self-test green before touching any payload file.

**Phase 1 — content token rewrite (no file/dir moves yet).**
- Run the tool `--apply` over `LifeOS/install/**` (excluding the dir-rename, done in Phase 2).
- This rewrites the 118+50+25 content-token files in place.
- Verify: `git grep -nE '\bPAI/|PAI_DIR|PaiConfig' -- LifeOS/install/` returns only FLAGGED-and-reviewed residuals; tool's flag report has zero unreviewed items.

**Phase 2 — directory + file renames (git mv, ignorecase-safe).**
- `install/LifeOS/` → `install/LIFEOS/`: on Windows ignorecase this is a case-only rename — use the index-only two-step pattern proven in commit 65a39d8 (git rm --cached + update-index at new path, OR `git mv` via temp name). NEVER have both casings in the index at once.
- 3 file renames under `install/LIFEOS/TOOLS/` (Pai*→Lifeos*). Extension change `PAI_CONFIG.yaml`→`LIFEOS_CONFIG.toml`: confirm upstream content first — if it's a yaml→toml *reformat*, take upstream's file; if pure rename, keep our content under new name.
- Verify: `git ls-files | tr A-Z a-z | sort | uniq -d` empty (no case-collision); no `install/LifeOS/` path survives.

**Phase 3 — internal reference fix-up.**
- Any import/require/path referencing the renamed files/dir (e.g. `from "./PaiConfig"`, `install/LifeOS/`) updated. The tool's Phase-1 pass catches string refs; hunt code imports separately: `git grep -nE 'PaiConfig|UpdatePaiState|PaiUpgrade|install/LifeOS' -- LifeOS/install/`.
- Verify: every renamed symbol's importers resolve (grep import → test -f target).

**Phase 4 — verify + audit.**
- `forceConsistentCasingInFileNames` (just shipped) means a casing mismatch now fails typecheck — run any available tsc/bun build on the payload.
- EOL check on rewritten files (byte-level, not grep — the Git-Bash `grep -c $'\r'` false-positive lesson from 65a39d8).
- Cato cross-vendor audit: "did the rename miss a live PAI reference or corrupt a preserved id?" — this is correctness-critical (E4 mandatory).
- Full `git grep '\bPAI\b' -- LifeOS/install/` census; every survivor is either FLAGGED-and-justified or a bug.

**Phase 5 — commit + push.** Signed commit(s), push to fork. Origin untouched.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Blind rewrite corrupts service ids / substrings | Tool with word boundaries + PRESERVE list; residual-flagging for review |
| Renaming the live-tree-facing pipeline breaks build-release | Scope HARD-limited to `LifeOS/install/**`; repo-root scripts/Tools explicitly excluded |
| Windows ignorecase collision on dir rename | Index-only two-step rename (proven in 65a39d8) + `git ls-files` collision gate |
| CRLF introduced by rewrite | `.gitattributes eol=lf` + re-add from worktree + byte-level EOL verify |
| yaml→toml on PAI_CONFIG is a reformat not a rename | Diff upstream's LIFEOS_CONFIG.toml content before deciding rename-vs-take |
| Divergence from live `~/.claude` (still PAI-shaped) widens | Expected + intended — the payload is public LIFEOS-branded; live stays PAI. This rename does NOT touch live. |

## Open questions — RESOLVED

1. ~~Scope confirm~~ → **payload-only** (locked above).
2. ~~PAI_CONFIG.yaml → LIFEOS_CONFIG.toml~~ → **already migrated, no work** (locked above).
3. ~~One commit or phased~~ → **phased** (locked above).
4. **Effort tier** → E4, Cato audit mandatory at execution. (Standing recommendation; confirm at execute time.)

## Ready to execute

All decisions locked. On "execute", I start at **Phase 0** (build+self-test
`scripts/pai-to-lifeos.ts`), then run phases 1→5 with a signed commit per phase and a Cato
audit before push. Nothing runs until you say go.
