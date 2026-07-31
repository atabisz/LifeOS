# Plan: migrate the LIVE ~/.claude install PAI→LIFEOS

> **✅ EXECUTED — historical record, do not run.** The live cut was performed and signed
> (`a7662ce` + `f0e1738`, Cato-audited, 44/44). The "awaiting approval / ZERO live changes"
> status line below describes this document at the moment it was written on 2026-07-05, not the
> state of the world. Three tracked docs cite it as the account of how the cut was done, which is
> why it is tracked rather than deleted. The completed-migration companion is
> `PAI-TO-LIFEOS-LIVE-MIGRATION-RUNBOOK.md`.
>
> Status: PLAN — awaiting approval. ZERO live changes made by this document or the session that wrote it.
> Author: Garry (DA) | Date: 2026-07-05

## Why this is a "cut", not an "apply"

The fork payload rename (commits 77e04e5..7e02ba4) was safe because it touched inert
`LifeOS/install/**` files. The **live `~/.claude` tree is the running system** — renaming
its `PAI/` root is a coordinated migration, not a text sweep. Upstream's own `RenameMap.json`
classifies the live-tree rename as **class 3/4/6 "rename-at-cut"** with hard preconditions
(staging rehearsal, compat symlink one release cycle, per-path migration ISA). This plan
honors that.

## Live state (probed 2026-07-05, read-only)

- Repo: `atabisz/claude-config` (SEPARATE from the fork). PAI-shaped: `~/.claude/PAI/` = **691 files**.
- **DIRTY: 59 uncommitted changes** — the migration must NOT commingle with this WIP.
- **Pulse is RUNNING** (pid 69956, :31337) against `~/.claude/PAI` — a live service dependency.

## Runtime breakage points (what dies if PAI/ moves uncoordinated)

| Surface | Count | Failure if unmigrated |
|---------|-------|----------------------|
| `CLAUDE.md` `@PAI/...` imports | 52 | Constitution/identity files don't load — DA loses its identity + telos |
| `settings.json` absolute hook paths (`$HOME/.claude/PAI/TOOLS/*`) | ≥1 confirmed | Hooks fail to launch |
| Hooks referencing PAI path/env | 22 | Hook lifecycle breaks |
| Pulse modules referencing PAI | 44 | Dashboard/Assistant break; running Pulse points at a moved dir |
| `PAI_` env readers (whole tree) | 162 | Path resolution fails |
| `--append-system-prompt` launcher + statusline | — | System prompt doesn't load |

**Shim insufficiency (key finding):** 52 files **hardcode** `join(HOME,".claude","PAI")` — NOT
the overridable `process.env.PAI_DIR ?? ...` (only 42 use that). So a filesystem symlink
`~/.claude/PAI → ~/.claude/LIFEOS` makes both names *resolve* (transitional safety net) but
does NOT rename those 52 literals — they must be token-rewritten for a true rename.

## Tooling gap

The fork's `scripts/pai-to-lifeos.ts` has a HARD guard refusing `--apply` outside
`LifeOS/install/**` (by design — it protected live all session). A live migration needs a
sibling tool (or a `--live` mode with its own guard keyed to `$HOME/.claude`). The per-token
**keep/rename map is mostly reusable** from the fork rename (rename PaiConfig/PAIEvent/
getPaiDir/PAIAgentAdapter/Pai* interfaces; KEEP paiPath/PAITheme/PAIColors/doc-constants/
com.pai.*/pai-logo/substrings). Building the live tool is Phase 0 of execution.

### ⚠️ Live-only tool difference discovered (Phase-0 research, 2026-07-05)

**The fork tool's rules are NOT safe to reuse verbatim on live.** Live has quoted `"PAI"`
literals the fork payload never had — 197 occurrences, and only 111 are inside path calls:

- **DA-NAME literals (MUST KEEP):** `aiName || "PAI"`, `DA_NAME // "PAI"`, `displayName: "PAI"`
  in `PAI-Install/engine/{actions,validate}.ts` + `DOCUMENTATION/Hooks/HookSystem.md`. This is
  the ASSISTANT'S NAME, not a directory. A blanket quoted-`"PAI"`→`"LIFEOS"` rule would rename
  the DA itself. The fork tool has no `"PAI"` rule at all, so this is a NEW live-only hazard.
- **`~/.config/PAI/.env` (DIFFERENT dir):** `join(home, ".config", "PAI", ".env")` — a separate
  directory from `~/.claude/PAI`. Out of scope for the `.claude/PAI` rename; decide separately.

**Corrected rule design for the live tool:** the quoted-dir rule must be **path-context-aware**
— only rewrite `"PAI"` when it's a `.claude`-rooted path segment (e.g. `join(...,".claude","PAI")`
or `join(...,"PAI","USER")` under the claude dir), NEVER a bare `"PAI"` string literal. Everything
else (DA name, .config/PAI, brand prose) is preserved + flagged for review. This is why a
staging-clone rehearsal (Phase 1) is mandatory before touching real live.

## Decisions confirmed by principal (2026-07-05)

- **Rename live + flip tooling** — build-release.ts/upstream-sync.ts/lifeos-normalize.ts will be
  updated to read a LIFEOS-shaped live tree as part of the cut. Approved.
- **Stash the 59 WIP** — DONE. `git stash push -u -m "pre-PAI-to-LIFEOS-migration WIP"` on live;
  clean baseline confirmed (0 uncommitted). Restore after migration.

## Decisions LOCKED (2026-07-05, all 3 confirmed)

1. **PAI_SYSTEM_PROMPT.md → LIFEOS_SYSTEM_PROMPT.md + safety net.** Approved as "symlink safety
   net" — BUT symlinks are NOT feasible on this box (verified: `ln -s` yields a copy under
   `core.symlinks=false`; `mklink` fails without Developer Mode/admin). **Implemented instead as a
   git-tracked CONTENT COPY**: `LIFEOS_SYSTEM_PROMPT.md` (canonical) + `PAI_SYSTEM_PROMPT.md`
   (byte-identical copy) so the unlocated launcher keeps resolving. Same protective effect,
   git-trackable. Retire the copy once the launcher is confirmed pointing at the new name.
2. **Rename all 4 live-only files to LIFEOS naming** + update referrers: top-level
   `PAISYSTEMARCHITECTURE.md`→`LifeosSystemArchitecture.md`, `PAIAGENTSYSTEM.md`→`AgentSystem.md`,
   `RebuildPAI.ts`→`RebuildLifeos.ts`, `PAISystemPhilosophy.md`→`LifeosSystemPhilosophy.md`.
3. **PAI_CONFIG.yaml → LIFEOS_CONFIG.toml** (rename + yaml→toml reformat + dir case + loader path update), matching the fork.

## File-rename layer (added after the rehearsal found it — the content tool does NOT rename files)

Live has **10 physical PAI*-named files** (fork had 3). Authoritative per-file map (targets
derived from origin where it has an equivalent; live-only files marked DECISION):

| # | Live file | Target | Notes |
|---|-----------|--------|-------|
| 1 | `PAI_SYSTEM_PROMPT.md` | `LIFEOS_SYSTEM_PROMPT.md` | **RUNTIME-CRITICAL** — launcher `--append-system-prompt-file`. Referrer is OUTSIDE ~/.claude (see UNKNOWN below) |
| 2 | `USER/Config/PAI_CONFIG.yaml` | `USER/CONFIG/LIFEOS_CONFIG.toml` | rename + **yaml→toml reformat** + dir case `Config`→`CONFIG`. Loaded by LifeosConfig.ts — must update the loader path |
| 3 | `PULSE/…/hooks/usePAIEvents.ts` | `useLifeosEvents.ts` | clean rename (no live collision — `useLifeosEvents.ts` absent live; the clone "collision" was a phantom from grepping origin). **4 importers move in lockstep.** OPEN: upstream also has `useAgentEvents.ts` — did it consolidate? content decision |
| 4 | `TOOLS/PAILogo.ts` | `TOOLS/LifeosLogo.ts` | + update importers |
| 5 | `DOCUMENTATION/PAISystemArchitecture.md` | `LifeosSystemArchitecture.md` | + update doc referrers (changelog.md etc.) |
| 6 | `PAISYSTEMARCHITECTURE.md` (top-level, all-caps, 548 lines) | DECISION | **live-only** — fork/origin has NO top-level all-caps file. Keep, or fold into DOCUMENTATION version |
| 7 | `PAIAGENTSYSTEM.md` (top-level, 177 lines) | DECISION | **live-only** — same |
| 8 | `TOOLS/RebuildPAI.ts` | `RebuildLifeos.ts`? | **live-only** — fork has RebuildAll/RebuildArchSummary, not this. Decide name |
| 9 | `DOCUMENTATION/PAISystemPhilosophy.md` | `LifeosSystemPhilosophy.md`? | **live-only** — decide |
| 10 | (PAI_CONFIG counted at #2) | | |

### 🔴 CRITICAL UNKNOWN — the launcher referrer for PAI_SYSTEM_PROMPT.md
`--append-system-prompt-file` is NOT in settings.json, shell rc (.zshrc/.bashrc), kitty config,
or a `bin/pai` wrapper. On this Windows setup the `claude` launch (VS Code extension setting?
scheduled task? external wrapper?) that passes it is OUTSIDE the repo and NOT locatable from
here. **Renaming PAI_SYSTEM_PROMPT.md without finding + updating that referrer silently breaks
constitution loading.** MUST be resolved (principal points me at the launcher) before file #1
is renamed — or keep PAI_SYSTEM_PROMPT.md as a symlink to LIFEOS_SYSTEM_PROMPT.md as a safety net.

## Execution status (2026-07-05)

- Phase 0: live WIP stashed ✓. Built `pai-to-lifeos-live.ts` (path-context-aware, DA-name/`.config` keeps) — **self-test 15/15**.
- Phase 1 REHEARSAL on `~/lifeos-rehearsal/clone` (git archive of live, real live NEVER touched):
  content rewrite **467 files / 2779 rewrites** PROVEN clean (DA name kept, `.config` kept, 0 path/symbol misses); dir rename + CLAUDE.md 52 @-imports + settings.json hook path all resolve.
  **Rehearsal FOUND the file-rename layer gap** (above) + the launcher UNKNOWN + the usePAIEvents/useAgentEvents question.
- STOPPED before Phase 2 (the real cut). Resuming needs: (1) principal locates the launcher for #1, (2) decisions on files #6-#9 + the yaml→toml #2 + the useAgentEvents consolidation #3, (3) then a re-rehearsal of the COMPLETE migration (content+dir+files+referrers) on the clone, boot Pulse against it, then the real cut.
- Scratch clone `~/lifeos-rehearsal` is safe to delete.

## Staged migration plan

**Phase 0 — tooling + baseline (no live mutation).**
- Commit or stash the 59 live WIP changes first (clean baseline; migration must be an isolated commit range).
- Write `PAI/TOOLS/pai-to-lifeos-live.ts` — reuse the fork tool's rule/preserve map; guard `--apply` to `$HOME/.claude` (not the fork). `--self-test` green before use.
- Add a `PAISYSTEMARCHITECTURE`-style census of live-only breakage surfaces (settings.json, CLAUDE.md, launcher).

**Phase 1 — staging rehearsal (the RenameMap precondition; NO touch to real live).**
- Clone the live tree to a scratch dir; point a throwaway session at it via `CLAUDE_CONFIG_DIR` (honored by hooks) + `PAI_DIR` override.
- Run the full migration in the CLONE. Boot Pulse against the clone, load a session, confirm: constitution `@`-imports resolve, hooks fire, Pulse serves, statusline renders. This is the "rename lands as formality, not migration" gate.
- Only proceed if the clone is fully green.

**Phase 2 — the cut (real live, coordinated with the running service).**
1. Stop live Pulse (it holds the old path).
2. Rename dir `~/.claude/PAI` → `~/.claude/LIFEOS` (single atomic `git mv`/index op; ignorecase-safe two-step as proven in the fork work).
3. Create compat symlink `~/.claude/PAI → LIFEOS` (transitional; retire after one cycle per RenameMap).
4. Token-rewrite the 52 hardcoded literals + env + the keep/rename symbol map via the Phase-0 tool.
5. Rewrite the live-only surfaces: `settings.json` hook paths + env block, `CLAUDE.md` 52 `@PAI/`→`@LIFEOS/` imports, the `--append-system-prompt` launcher path, statusline.
6. Restart Pulse against `~/.claude/LIFEOS`; re-run the Phase-1 green checks on real live.

**Phase 3 — verify + audit.**
- Constitution loads (session start shows identity/telos), hooks fire (probe), Pulse healthz 200, statusline renders, no unresolved `~/.claude/PAI` literal remains except the intentional symlink + kept tokens.
- Cato cross-vendor audit (correctness-critical: this is the running system).
- Byte-level EOL, case-collision gate, `git grep` census of residual PAI.

**Phase 4 — commit.** Isolated signed commit(s) in claude-config, phased (dir-rename / token-rewrite / live-surfaces) for bisectability. This is a PRIVATE repo (claude-config), not the public fork.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Breaks the running system mid-cut | Phase-1 staging rehearsal on a clone MUST pass first; keep the compat symlink |
| 52 hardcoded literals missed by a symlink | token-rewrite them explicitly (the tool), don't rely on the symlink |
| Commingle with 59 WIP changes | commit/stash WIP before Phase 0; migration is its own commit range |
| Pulse serving stale path | stop Pulse before the dir move, restart after |
| CLAUDE.md constitution fails to load | rewrite all 52 @PAI imports in the same commit as the dir move |
| Irreversible | compat symlink + phased commits + the clone rehearsal make it reversible |

## Open questions before Phase 0

1. **The 59 uncommitted live changes** — commit, stash, or review first? The migration needs a clean baseline.
2. **Symlink retention** — keep `~/.claude/PAI → LIFEOS` indefinitely (safest, matches nothing-forces-removal), or retire after a set period per RenameMap?
3. **Do you actually want live renamed at all?** The entire session's design keeps live PAI-shaped as the build SOURCE for releases (`build-release.ts`/`upstream-sync.ts` read `~/.claude` PAI-shaped). Renaming live means those tools must flip to read LIFEOS-shaped too — a coupled change. Worth confirming this is the intent, not just symmetry with the fork.
4. **Scope of Phase 2** — full 691-file rename, or a narrower "make live LIFEOS-addressable via symlink + rewrite only the 52 hardcoded literals" first step?
