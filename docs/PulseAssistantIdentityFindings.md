# Pulse `/assistant` — empty DA identity & missing module: findings

> **Status:** investigation only — **no changes were made** to the install or to Pulse, per request.
> **Date:** 2026-06-30 · **Install:** Windows 11, `C:\Users\AlexTabisz\.claude`, Pulse live on :31337 (pid 34964).
> **Method:** live HTTP probes + source/git archaeology, fanned out across two parallel `Explore` agents, every agent claim re-verified directly before being recorded here.

## TL;DR

The empty `/assistant` identity has **three stacked causes, none of which is the Windows path bug** you also noticed:

1. **The Pulse DA module does not exist.** `pulse.ts` imports `./Assistant/module`, but that file was never written — the DA subsystem is documented as *"Architecture complete, pending implementation."* So every `/assistant/*` endpoint returns **404** and the page renders blank.
2. **The DA subsystem is gated off anyway.** `config.da.enabled` defaults to `false` and there is no `[da]` section in `PULSE.toml` to turn it on. Even if the module existed, it would not load.
3. **No populated DA identity exists on this machine.** Your past `/interview` populated the **principal** identity (`PRINCIPAL_IDENTITY.md` → Alex / Tricentis / Sydney), but that workflow never writes a **DA** identity. The DA-identity tool (`DAInterview.ts`) is a separate command that has not been run here. The file Pulse/Claude actually read — `PAI/USER/DA_IDENTITY.md` — is still the verbatim bootstrap default ("Name: PAI", Rachel voice).

The Windows path bug is **real and separate** (see [the path section](#the-windows-path-bug-real-but-separate)). It does not affect the identity because the identity path (`join(PAI_DIR, …)`) is already platform-safe — and besides, the module that would read it doesn't run.

> **Why "it should be populated" is understandable but the file disagrees:** `/interview` *did* run and *did* persist — just the **principal** half. DA identity lives behind a different, newer, not-yet-wired mechanism. Details below.

---

## 1. Reproduction (what the live system actually does)

| Probe | Result |
|-------|--------|
| `curl :31337/assistant/identity` | **HTTP 404** |
| `curl :31337/assistant/health` | **HTTP 404** |
| `curl :31337/assistant/personality` `/tasks` `/diary` `/opinions` | **HTTP 404** (all) |
| `curl :31337/api/wiki` (control) | HTTP 200 — server itself is healthy |

The `/assistant` React page ([assistant/page.tsx:203-208](../PAI/Pulse/Observability/src/app/assistant/page.tsx#L203-L208)) fetches those six endpoints via `localApiCall`. On a 404, `apiCall` throws ([local-api.ts:14-16](../PAI/Pulse/Observability/src/lib/local-api.ts#L14-L16)), the queries hold no data, and the identity card renders empty. **The page is fine; it has nothing to show.**

## 2. Cause A — the Pulse Assistant module was never built

`pulse.ts` wires the routes conditionally:

```ts
// pulse.ts:117-123
if (config.da?.enabled) {
  try { assistantModule = await import("./Assistant/module") }
  catch (err) { log("warn", "Assistant module not available", { error: String(err) }) }
}
// pulse.ts:438 — route only handled if the module loaded:
if (assistantModule && pathname.startsWith("/assistant/")) { … }
```

- `C:\Users\AlexTabisz\.claude\PAI\Pulse\Assistant\` **does not exist** on disk.
- `git log --all --full-history -- "PAI/Pulse/Assistant/*"` → **no results.** It was never committed, never deleted — it never existed in this repo (41 commits checked).
- It is **not** in `Releases/v5.0.0/` or `Packs/` either (only the compiled Next.js `/assistant` *page* ships, not a server module).
- The design doc confirms it's unbuilt: [DaSubsystem.md:6-7](../PAI/DOCUMENTATION/Pulse/DaSubsystem.md#L6-L7) says **"Location: …`modules/da.ts`… Status: Architecture complete, pending implementation"**, and its task list marks the module `[P]` pending / `[ ]` incomplete (lines 1001-1005).

**Naming drift worth noting:** the docs are internally inconsistent about where this module should live —
- `pulse.ts` imports `./Assistant/module` (i.e. `Pulse/Assistant/module.ts`)
- [ARCHITECTURE_SUMMARY.md:90](../PAI/DOCUMENTATION/ARCHITECTURE_SUMMARY.md#L90) and [ObservabilitySystem.md:242-250](../PAI/DOCUMENTATION/Observability/ObservabilitySystem.md#L242-L250) list `Pulse/Assistant/module.ts`
- [DaSubsystem.md](../PAI/DOCUMENTATION/Pulse/DaSubsystem.md#L6) (the newest design) says `Pulse/modules/da.ts`

So even the spec hasn't settled on a path. Whoever implements it will be writing it fresh.

## 3. Cause B — the DA subsystem is disabled in config

```ts
// pulse.ts:206 — default when PULSE.toml has no [da] section:
da: (parsed.da as PulseConfig["da"]) ?? { enabled: false },
```

[PULSE.toml](../PAI/Pulse/PULSE.toml) has sections `[pulse]`, `[modules]`, `[observability]`, `[voice]`, `[notifications]`, `[checks]` — **no `[da]`**. So `config.da?.enabled` is `false`, and the import at line 119 is skipped entirely. This is a second, independent reason the routes 404.

## 4. Cause C — no populated DA identity exists anywhere

This is the part that contradicts the expectation that "the identity process has run."

**What the file Pulse reads contains.** `PAI/USER/DA_IDENTITY.md` is the untouched bootstrap default:
- Literally headed *"Bootstrap default — functional before interview. Run `/interview`…"*
- `Name: PAI`, `Voice (main): 21m00Tcm4TlvDq8ikWAM (Rachel — ElevenLabs public voice)`
- `git log -- PAI/USER/DA_IDENTITY.md` → **only `6ceddb1` (initial commit)**; mtime `2026-05-14 13:32` = install time. Never edited.

**What `/interview` actually does.** The `/interview` you ran populated the **principal** side — which is why `PRINCIPAL_IDENTITY.md` correctly shows Alex Tabisz / Tricentis / Sydney. The Interview skill walks TELOS + principal context. It does **not** create a DA identity.

**The DA identity is a different, newer mechanism.** A dedicated tool, [`PAI/TOOLS/DAInterview.ts`](../PAI/TOOLS/DAInterview.ts) (31 KB, present), writes the DA identity — but to the **new directory-per-DA layout**, not the flat file:

```
// DAInterview.ts:14-19 — what it creates:
PAI/USER/DA/{name}/DA_IDENTITY.yaml
PAI/USER/DA/{name}/DA_IDENTITY.md
PAI/USER/DA/{name}/opinions.yaml   (+ growth.jsonl, diary.jsonl)
Updates PAI/USER/DA/_registry.yaml
```

**It has not been run here.** Direct check of `PAI/USER/DA/`:

```
USER/DA/README.md
USER/DA/_example/       ← template only (identity.md / identity.yaml with {PLACEHOLDERS})
USER/DA/_presets.yaml
```

There is **no `_registry.yaml`**, and **no `DA/{name}/` directory** for a real DA. No backups exist (`TELOS/Backups/`, `.bak` — none). The populated DA identity isn't misfiled at another path — **it was never generated.**

**The architectural gap that ties it together.** The system moved from a flat `DA_IDENTITY.md` to a `DA/{name}/` model, but the startup import didn't follow: [CLAUDE.md:7](../CLAUDE.md#L7) still does `@PAI/USER/DA_IDENTITY.md` — the old flat path. So even after you run `DAInterview.ts`, the new `DA/{name}/DA_IDENTITY.md` would not be imported until that line is repointed (or the flat file regenerated from the YAML). Pulse, similarly, has no code reading either location yet (Cause A).

## The Windows path bug (real, but separate)

You were right that Pulse points at paths that don't resolve on Windows — but this is independent of the identity issue, and it bites at **autostart**, not in your interactive shell.

**The mechanism.** Pulse autostarts from the Windows **Startup folder via VBS** (`start-pulse-hidden.vbs` → `bun run pulse.ts`). In that login context, `process.env.HOME` is **undefined** — only `USERPROFILE` exists. In *your* Git Bash session HOME happens to be set (`C:\Users\AlexTabisz`), which is why `/api/wiki` works when you test by hand and the failure is intermittent/context-dependent.

**The safe pattern exists but isn't used everywhere.** The entry file already does it right:

```ts
// pulse.ts:24 — correct, Windows-safe:
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir()
```

…but **~22 other active files fall back to `""` or `"~"`**, which silently build broken paths when HOME is unset:

| Pattern | Files |
|---------|-------|
| `process.env.HOME ?? ""` | `lib/messages-db.ts`, `modules/{user-index,imessage,syslog,telegram,example-module}.ts`, `Performance/{module,cost-aggregator}.ts`, all 7 `checks/*.ts` |
| `process.env.HOME ?? "~"` | `setup.ts:16`, `modules/wiki.ts:38`, `VoiceServer/voice.ts:170`, `run-job.ts`, `pulse-unified.ts` |
| `process.env.HOME \|\| ""` (no USERPROFILE fallback) | **`Observability/observability.ts:1650`** (the `/api/user-index` handler) |

**Smoking gun — a literal `${HOME}` folder on disk.** Unexpanded path strings have already misdirected writes. There is a real directory:

```
PAI/Pulse/Observability/${HOME}/.claude/PAI/MEMORY/LEARNING/SIGNALS/ratings.jsonl  (858 bytes)
```

— a fossil created when a literal `${HOME}` (or empty-string HOME → relative path) was used as a write target. The real `ratings.jsonl` is 639 KB at the correct location; this stray 858-byte copy confirms the bug has fired in practice. Related: [observability.ts:554](../PAI/Pulse/Observability/observability.ts#L554) does a literal `.replace("${HOME}", HOME)`.

**Why it doesn't touch the identity.** The DA-identity read path is `join(PAI_DIR, "USER", …)` and `PAI_DIR` derives from the safe HOME in `pulse.ts` — so identity resolution is already cross-platform. The path bug corrupts *other* subsystems' file access under autostart; it is not why `/assistant` is empty.

---

## What would actually fix the empty `/assistant` page

Listed for completeness — **not done**, per request. Three independent tracks:

1. **Generate a DA identity.** Run `bun ~/.claude/PAI/TOOLS/DAInterview.ts` (quick/standard/deep). Creates `PAI/USER/DA/{name}/DA_IDENTITY.{yaml,md}` + `_registry.yaml`.
2. **Make the system read it.** Repoint [CLAUDE.md:7](../CLAUDE.md#L7) `@PAI/USER/DA_IDENTITY.md` to the new `DA/{name}/DA_IDENTITY.md` (or regenerate the flat file from the YAML) so Claude sessions pick it up.
3. **Build + enable the Pulse module.** Implement `Pulse/modules/da.ts` (per [DaSubsystem.md](../PAI/DOCUMENTATION/Pulse/DaSubsystem.md), still pending) exposing `handleAssistantRequest` / `assistantHealth` / `startAssistant` / `stopAssistant`, fix the `pulse.ts:119` import path to match, and add `[da]\nenabled = true` to `PULSE.toml`. Only then do the `/assistant/*` endpoints stop 404ing.

Separately, the **Windows path hardening** (replace the `?? ""` / `?? "~"` fallbacks with the `pulse.ts:24` canonical pattern across the ~22 files, and remove the stray `${HOME}` directory after confirming nothing unique lives in it) is its own task with its own blast radius on the live service.

## One-line core insight

The `/assistant` page is empty not because of a broken path but because the DA subsystem behind it was never built, never enabled, and never given an identity — three separate gaps the page faithfully reflects; the Windows path bug is a real, parallel issue that bites Pulse's *other* subsystems at autostart, not the identity.

*Investigation only. No files under `~/.claude/PAI/` or `c:/src/LifeOS/` (other than this report) were modified.*
