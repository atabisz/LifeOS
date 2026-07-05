# LifeOS Configuration

> The system/user split is the LifeOS boundary made physical (`LifeOs/LifeOsThesis.md`): the OS (system tree) is the same for everyone and ships publicly; the *life* (USER tree — identity, TELOS, current state) is yours alone. The merge machinery below is what lets one framework run any life without leaking any of them.

LifeOS configuration follows the **system/user separation** contract (`LIFEOS/DOCUMENTATION/SystemUserBoundary.md`). System config ships in the public LifeOS repo; user config lives in the user's own private USER-data repo and mounts into the live tree via symlink. The two halves are merged at runtime — never at release time, never by hand.

## The split, end-to-end

```
~/.claude/                                       # SYSTEM tree (public LifeOS)
├── settings.json                                # Generated at SessionStart by MergeSettings.ts
├── settings.system.json                         # SYSTEM defaults (public-safe, ships in LifeOS)
├── CLAUDE.md                                    # SYSTEM routing table (public-safe)
├── LIFEOS/LIFEOS_SYSTEM_PROMPT.md                     # SYSTEM constitutional rules (public-safe)
├── LIFEOS/TOOLS/LifeosConfig.ts                       # SYSTEM typed loader (INTERFACE)
├── LIFEOS/TOOLS/MergeSettings.ts                   # SYSTEM merge driver (INTERFACE)
└── LIFEOS/USER → ~/.config/LIFEOS/USER                # Symlink to USER tree

~/.config/LIFEOS/USER/                              # USER tree (private USER-data repo, symlinked)
├── CONFIG/
│   ├── settings.user.json                       # USER settings overlay
│   ├── OPERATIONAL_RULES.md                     # USER operational rules (@-imported)
│   └── LIFEOS_CONFIG.toml                          # USER typed-config implementation
├── PRINCIPAL/PRINCIPAL_IDENTITY.md              # USER identity (@-imported)
├── DIGITAL_ASSISTANT/DA_IDENTITY.md             # USER DA identity (@-imported)
├── TELOS/                                       # USER goals + auto-generated PRINCIPAL_TELOS.md
├── PROJECTS.md                                  # USER project registry (@-imported)
└── INTEGRATIONS/*.yaml                          # USER per-integration configs (homebridge, unifi, etc.)
```

## Core files

| File | Tree | Purpose |
|------|------|---------|
| `settings.json` | SYSTEM (generated) | Merged at SessionStart by `MergeSettings.ts` from `settings.system.json` + `settings.user.json`. Read-only at runtime — manual edits get overwritten next session. |
| `settings.system.json` | SYSTEM | Defaults: hooks, permissions, env, daidentity defaults, notifications, tips. Ships in public PAI. |
| `LIFEOS/USER/CONFIG/settings.user.json` | USER | Per-principal overlay: identity values, voice IDs, principal name + timezone, custom `spinnerVerbs` + `spinnerTipsOverride`, env overrides. Deep-merged into system defaults; USER always wins. |
| `CLAUDE.md` | SYSTEM (with USER `@`-imports) | Routing table + top-level `@`-imports of USER identity files. Public release template at `skills/_LIFEOS/RELEASE_TEMPLATES/CLAUDE.public.md`. |
| `LIFEOS/LIFEOS_SYSTEM_PROMPT.md` | SYSTEM | Constitutional rules (system prompt layer, loaded via `--append-system-prompt-file`). |
| `LIFEOS/USER/CONFIG/OPERATIONAL_RULES.md` | USER | Per-principal operational rules: repo conventions, env paths, vendor-specific doctrine (Cloudflare token, deploy semantics). `@`-imported directly from `CLAUDE.md` — CC does not follow transitive `@`-imports. |
| `LIFEOS/USER/CONFIG/LIFEOS_CONFIG.toml` | USER | Typed user config (identity name/pronunciation/timezone, integration credentials, paths). Read via `LifeosConfig.load()`. |
| `LIFEOS/TOOLS/LifeosConfig.ts` | SYSTEM (INTERFACE) | Typed loader. Returns a strongly-typed object; the schema is the SYSTEM↔USER contract. |
| `LIFEOS/TOOLS/MergeSettings.ts` | SYSTEM | Deep-merge driver that produces `settings.json` from `settings.system.json` + `settings.user.json` at SessionStart. |
| `LIFEOS/USER/INTEGRATIONS/{homebridge,unifi,airgradient}.yaml` | USER | Per-integration credentials/endpoints for private `_*` skills. |
| `LIFEOS/USER/WORK/config.yaml` | USER (optional) | `WORK.REPO` for the Work System. |

## How it works at runtime

1. **SessionStart** — `MergeSettings.ts` reads `settings.system.json` + `LIFEOS/USER/CONFIG/settings.user.json`, deep-merges (USER wins on conflict), writes `settings.json`. This file is what Claude Code reads for hooks, permissions, env, identity.
2. **Identity** — DA and principal values live in `settings.json` under `daidentity` and `principal` keys (provenance: USER overlay). Hooks read these via `hooks/lib/identity.ts` (`getIdentity()`, `getPrincipal()`, `getDAName()`, `getVoiceId()`).
3. **Skills** — private `_*` skills that need credentials/integration data read `LIFEOS_CONFIG.toml` via `LifeosConfig.load()` (e.g. `_HOMEBRIDGE` reads Homebridge token; `_NETWORK` reads UniFi creds).
4. **CLAUDE.md `@`-imports** — at session start, CC loads files referenced by top-level `@`-imports in `CLAUDE.md` (ARCHITECTURE_SUMMARY, PRINCIPAL_TELOS, PRINCIPAL_IDENTITY, DA_IDENTITY, PROJECTS, OPERATIONAL_RULES). CC does NOT follow transitive `@`-imports from inside imported files, so identity files must be listed in `CLAUDE.md` directly.

## Editing

- **Identity / voice / principal name / per-machine integrations** → edit `LIFEOS/USER/CONFIG/settings.user.json` (USER overlay) or `LIFEOS_CONFIG.toml`. Takes effect next SessionStart.
- **Hooks / permissions / system defaults** → edit `settings.system.json`. Takes effect next SessionStart.
- **Routing / `@`-imports / subsystem pointers** → edit `CLAUDE.md`. Takes effect next session.
- **Constitutional rules** → edit `LIFEOS/LIFEOS_SYSTEM_PROMPT.md`. Takes effect next session.
- **NEVER edit `settings.json` directly** — it's generated. Edits get overwritten on next SessionStart.

## Write-time enforcement

`hooks/SystemFileGuard.hook.ts` (PreToolUse, Phase E) blocks USER content from landing in SYSTEM files at write time. Fail-safe-open on hook errors. Primary defense against drift; catches violations the moment they would land, not at release time. Tests: 19/19 pass.

## Two-repo sync

The two trees are physically separate git repos:
- `~/.claude/` → `<your-username>/.claude` (PRIVATE GitHub)
- `~/.config/LIFEOS/USER/` → `<your-username>/<your-user-data-repo>` (PRIVATE GitHub)

`~/.claude/.git/hooks/pre-push` auto-commits and pushes `~/.config/LIFEOS/USER/` before each push from `~/.claude/`, so the two repos stay in sync structurally. A "kai update" / "push both repos" workflow wraps this with four boundary gates:
1. USER-zone leak check on pending `~/.claude` changes
2. `DenyListCheck.ts` must return 0 real-leaks
3. Both remotes confirmed private via `gh api`
4. Post-push HEAD verification on both repos

**Pre-flight refuses to proceed if the public LifeOS repo appears in either remote** — the workflow is explicitly for the two PRIVATE repos only. Public LifeOS release goes through the separate shadow-release pipeline with the 14 ShadowRelease gates.

## Public releases

The Shadow Release system (`skills/_LIFEOS/Tools/ShadowRelease.ts`) produces public staging at `~/.claude/LIFEOS/LIFEOS_RELEASES/{VERSION}/.claude/` via **containment** — clone the live tree, delete sensitive zones (USER, MEMORY, private underscore-prefixed skills), overlay fixed public templates from `skills/_LIFEOS/RELEASE_TEMPLATES/` (including `CLAUDE.public.md` + `settings.public.json`), run 14 gates (G1–G14: zone deletion, identity grep, CF ID grep, trufflehog, .env strays, private tokens, ref integrity, private-skill refs, username-path leak, staging boot, dashboard leak, template-only USER/MEMORY, hidden-file leakage, critical-artifact presence). Write `.shadow-state.json` report. Staging is isolated from `~/Projects/LIFEOS/`; public publish is a separate explicit step.

The `<your-release-skill>` skill workflows:
- **ReviewContainmentZones** — reconcile zone module against live tree (mandatory before any release build).
- **CreateShadowRelease** — fresh build at a version (Step 0 is zone review).
- **UpdateShadowRelease** (`/ur`) — full rebuild at current version.
- **CheckReleaseSecurity** — read-only 14-gate validation against existing staging.
- **CreateRelease** — public publish (Stage 2, requires all 14 gates green).

## Migration history

- **Phase B (2026-05-21)** — `settings.json` split into `settings.system.json` (public) + `settings.user.json` (USER). `MergeSettings.ts` merges at SessionStart.
- **Phase C (2026-05-22)** — `CLAUDE.md` becomes thin router with direct `@`-imports of USER identity files. `OPERATIONAL_RULES.md` created in `LIFEOS/USER/CONFIG/`. `CLAUDE.user.md` sidecar created and then deleted 2026-05-23 (merged back into `CLAUDE.md`) because CC doesn't follow transitive `@`-imports.
- **Phase E (2026-05-22)** — `SystemFileGuard.hook.ts` runtime write-time enforcement begins.
- **Phase F (2026-05-22)** — `LifeosConfig.ts` typed loader + `LIFEOS_CONFIG.toml` populated. Private skills migrated from hardcoded credentials to `LifeosConfig.load()`.
- **Phase G (2026-05-22→23)** — separate private GitHub repo created for USER data. `~/.claude/LIFEOS/USER` becomes symlink to `~/.config/LIFEOS/USER`. Pre-push hook installed for two-repo sync. A two-repo-push workflow ("update the kai repo" / "push both repos") ships in the private `<your-release-skill>` skill with four boundary gates.
- **Phase H (deferred)** — PR-time `DenyListCheck` via GitHub Actions; community v5→v6 migration tool.

## Pre-v6.0 history

The pre-Phase-A model used `LIFEOS_CONFIG.yaml` as a credentials store and a single `settings.json` directly edited by hand. There was no system/user boundary enforced at write time; defenses were release-time only. That model is retired — the contemporary architecture is the split + symlink + `LifeosConfig.ts` described above. The release tooling preserves a `settings.public.json` template for the public release path but the live system reads only from the split files.

## Cross-references

- System/user boundary contract: `LIFEOS/DOCUMENTATION/SystemUserBoundary.md`
- Master architecture: `LIFEOS/DOCUMENTATION/LifeosSystemArchitecture.md`
- _LIFEOS skill workflows: `skills/_LIFEOS/SKILL.md` (UpdateKaiRepo, CreateShadowRelease, CreateRelease)
- Hook system: `LIFEOS/DOCUMENTATION/Hooks/HookSystem.md` (SystemFileGuard, MergeSettings invocation)
