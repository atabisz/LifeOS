# Pulse `/assistant` — empty DA identity & missing module: findings

> **Status:** original investigation was read-only; the DA subsystem it diagnosed as unbuilt **has since been built (2026-07-03→07-04)** — see the ✅ Resolved banner below. This doc now records both the original diagnosis and its resolution.
> **Date:** 2026-06-30 (investigation) · updated 2026-07-04 (resolved) · **Install:** Windows 11, `C:\Users\AlexTabisz\.claude`, Pulse live on :31337.
> **Method:** live HTTP probes + source/git archaeology, fanned out across two parallel `Explore` agents, every agent claim re-verified directly before being recorded here.

> ### ✅ Resolved — 2026-07-04: all three causes closed; `/assistant` is live
>
> **This entire investigation is now historical.** The DA subsystem was built 2026-07-03→07-04 across three sessions. All three stacked causes are resolved, re-confirmed by live probe (2026-07-04):
>
> 1. **Cause A (module never built) — RESOLVED.** `Pulse/Assistant/module.ts` now exists (with `heartbeat.ts`, `store.ts`, `delegation.ts`) and is imported by `pulse.ts`. The subsystem also gained a fire-executor, diary/growth writers, an approve/consent path, and primary→worker delegation — all Forge cross-family audited.
> 2. **Cause B (config gated off) — RESOLVED.** `PULSE.toml` now has a `[da]` section with `enabled = true`.
> 3. **Cause C (no DA identity) — RESOLVED (already, 2026-07-03).** `garry` identity exists and now LOADS (`/assistant/health` → `identity_loaded: true`).
>
> **Live probe 2026-07-04:** `/assistant/{health, identity, personality, tasks, diary, opinions}` **all return HTTP 200** (previously all 404). The page renders the real identity card, not the `EmptyStateGuide`. The only surfaces still empty are the **Diary** and **Opinions** tabs — their writer jobs (`da-diary`, `da-growth`) ship **phase-gated `enabled = false`** pending an owner opt-in, so those two have no data *by design*, not because the backend is missing.
>
> **The rest of this document describes the pre-build state (2026-06-30 investigation + 2026-07-03 partial update) and is preserved as the historical record of how the gap was diagnosed.** The Windows path-bug section (below) is a separate, still-open concern and is NOT resolved by this update.

> ### 🔄 Update — 2026-07-03 (re-verified live, pid 7320) — SUPERSEDED by the 2026-07-04 banner above
>
> Two things changed since 2026-06-30, both re-confirmed by fresh probes; the original record below is preserved for provenance.
>
> 1. **The page no longer "renders blank" — it returns HTTP 200 and shows an empty-state guide.** The `/assistant` *shell* URL returns **200** (Next.js static fallback); only its data APIs (`/assistant/identity|health|personality|tasks|diary|opinions`) return **404**. *(As of 2026-07-04 those data APIs return 200 — see the banner above.)* The 200-vs-404 split had one shared root — `assistantModule` was `null` — plus a trailing-slash routing quirk. See [§1a. The 200-page / 404-API paradox](#1a-the-200-page--404-api-paradox-added-2026-07-03).
> 2. **Cause C is RESOLVED — a DA identity now exists.** `DAInterview.ts` was run 2026-07-03 17:58; `PAI/USER/DA/garry/` and `_registry.yaml` (`primary: garry`, enabled) now exist. See [§4. Cause C — now RESOLVED](#4-cause-c--now-resolved-2026-07-03).
>
> **Net (as of 2026-07-03):** two causes remained open (module unbuilt + config-gated); both were closed 2026-07-04.

## TL;DR

The empty `/assistant` identity had **three stacked causes, none of which is the Windows path bug** you also noticed. **As of 2026-07-04, all three are RESOLVED** (this TL;DR describes the diagnosis at investigation time; see the top banner for the resolved state):

1. **~~The Pulse DA module does not exist.~~ RESOLVED 2026-07-04.** `Pulse/Assistant/module.ts` was written (+ `heartbeat.ts`/`store.ts`/`delegation.ts`); `pulse.ts` imports and loads it; `/assistant/*` data endpoints now return **200**. *(At investigation time the file was absent — historical record below.)*
2. **~~The DA subsystem is gated off anyway.~~ RESOLVED 2026-07-04.** `PULSE.toml` now has a `[da]` section with `enabled = true`, so the module loads. *(At investigation time there was no `[da]` section.)*
3. **~~No populated DA identity exists on this machine.~~ RESOLVED 2026-07-03.** A DA named **garry** was generated via `DAInterview.ts` (`PAI/USER/DA/garry/DA_IDENTITY.{yaml,md}` + `_registry.yaml`, `primary: garry`, enabled), and it now LOADS in Pulse (`identity_loaded: true`). Note the bootstrap file `PAI/USER/DA_IDENTITY.md` (Name: PAI, Rachel voice) is still what `CLAUDE.md` `@`-imports — a separate, unrelated staleness. *(See §4.)*

**Now:** all three causes closed → `/assistant` renders `garry`'s live identity card, not the empty-state. The only empty surfaces are the Diary/Opinions tabs, whose writer jobs are phase-gated off by design.

The Windows path bug is **real and separate** (see [the path section](#the-windows-path-bug-real-but-separate)). It does not affect the identity because the identity path (`join(PAI_DIR, …)`) is already platform-safe — and besides, the module that would read it doesn't run.

> **Why "it should be populated" is understandable but the page disagrees:** on 2026-06-30, `/interview` had run and persisted only the **principal** half, and DA identity lived behind a different, newer mechanism (`DAInterview.ts`) that had not been run. That mechanism *has* since run (garry, 2026-07-03) — but it is still not wired into Pulse, so the page stays empty. Details below.

---

## 1. Reproduction (what the live system actually does)

| Probe | Result (2026-06-30) | Result (2026-07-03) | Result (2026-07-04) |
|-------|--------|--------|--------|
| `curl :31337/assistant` (page shell, **no trailing slash**) | *(not probed)* | **HTTP 200** — static page + `EmptyStateGuide` | **HTTP 200** — real identity card |
| `curl :31337/assistant/identity` | **HTTP 404** | **HTTP 404** | **HTTP 200** |
| `curl :31337/assistant/health` | **HTTP 404** | **HTTP 404** | **HTTP 200** (`identity_loaded: true`) |
| `curl :31337/assistant/personality` `/tasks` `/diary` `/opinions` | **HTTP 404** (all) | **HTTP 404** (all) | **HTTP 200** (all) |
| `curl :31337/api/wiki` (control) | HTTP 200 — server itself is healthy | HTTP 200 | HTTP 200 |

*(2026-07-04: the module was built + `[da]` enabled, so every `/assistant/*` data API now returns 200. The paragraph and §1a below describe the pre-build 404 state as historical record.)*

The `/assistant` React page ([assistant/page.tsx:203-208](../PAI/Pulse/Observability/src/app/assistant/page.tsx#L203-L208)) fetches those six endpoints via `localApiCall`. On a 404, `apiCall` throws ([local-api.ts:14-16](../PAI/Pulse/Observability/src/lib/local-api.ts#L14-L16)), the queries hold no data, and — because `health.identity_loaded` is never set — `isFreshInstall` is `true` and the page renders the `EmptyStateGuide` ([assistant/page.tsx:246,252](../PAI/Pulse/Observability/src/app/assistant/page.tsx#L246)). **The page is fine; it has nothing to show.**

### 1a. The 200-page / 404-API paradox (added 2026-07-03)

Why does the *page* return 200 while every *API it calls* returns 404? One shared root — `assistantModule` is `null` (Causes A + B below) — surfaced through a trailing-slash routing quirk in `pulse.ts`:

```ts
// pulse.ts:438 — the ONLY assistant route guard:
if (assistantModule && pathname.startsWith("/assistant/")) { … }
```

- **`/assistant`** (page shell, no trailing slash) does **not** match `startsWith("/assistant/")`, so it skips the guard entirely and falls through to the Next.js static-export fallback ([pulse.ts:463-466](../PAI/Pulse/pulse.ts#L463-L466)) → **200**.
- **`/assistant/identity`** etc. **do** match `/assistant/`, but the guard body is skipped because `assistantModule` is falsy. They then fall through to the same fallback, which has no matching Next.js route → **404**.

So the empty-state renders **precisely because its own data APIs 404**. Two masking factors make this hard to spot: the module-load `try/catch` ([pulse.ts:120-122](../PAI/Pulse/pulse.ts#L120)) degrades a missing module to a silent `warn`, and the routing quirk serves a misleading 200 empty-state instead of a visible "backend unavailable" error.

## 2. Cause A — the Pulse Assistant module was never built — RESOLVED 2026-07-04

> **RESOLVED 2026-07-04:** `Pulse/Assistant/module.ts` now exists (at exactly the path `pulse.ts:119` imports, `./Assistant/module`), alongside `heartbeat.ts`, `store.ts`, `delegation.ts`, and the `checks/da-*.ts` cron scripts. It exports `startAssistant`/`handleAssistantRequest`/`assistantHealth`/`stopAssistant` and reads `PAI/USER/DA/garry/`. The naming drift noted below was settled in favor of `Assistant/module.ts` (the daemon call-site is authoritative; `DaSubsystem.md` was updated to match). The 2026-06-30 archaeology below is the historical record of when the file was absent.

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

## 3. Cause B — the DA subsystem is disabled in config — RESOLVED 2026-07-04

> **RESOLVED 2026-07-04:** `PULSE.toml` now has a `[da]` section (`enabled = true`, plus `heartbeat_schedule`/`diary_schedule`/`growth_schedule` and four `[[job]]` entries). `config.da.enabled` is `true`, so the module import at `pulse.ts:119` runs. (Registry-as-truth: which DA is primary still comes from `_registry.yaml`, not the toml.) The historical record below describes when no `[da]` section existed.

```ts
// pulse.ts:206 — default when PULSE.toml has no [da] section:
da: (parsed.da as PulseConfig["da"]) ?? { enabled: false },
```

[PULSE.toml](../PAI/Pulse/PULSE.toml) has sections `[pulse]`, `[modules]`, `[observability]`, `[voice]`, `[notifications]`, `[checks]` — **no `[da]`**. So `config.da?.enabled` is `false`, and the import at line 119 is skipped entirely. This is a second, independent reason the routes 404.

## 4. Cause C — now RESOLVED (2026-07-03)

> **2026-07-03 status:** RESOLVED. `DAInterview.ts` was run at 17:58 and a DA named **garry** now exists:
> ```
> PAI/USER/DA/garry/DA_IDENTITY.yaml   (2166 B — Garry, preset "efficient", peers dynamic)
> PAI/USER/DA/garry/DA_IDENTITY.md
> PAI/USER/DA/garry/opinions.yaml
> PAI/USER/DA/garry/diary.jsonl   (empty)
> PAI/USER/DA/garry/growth.jsonl  (empty)
> PAI/USER/DA/_registry.yaml       (version 1, primary: garry, enabled: true, channels: terminal+voice)
> ```
> The identity is thin but present — `voice.main.voice_id` is `""` (no voice picked) and `writing.avoid`/`writing.prefer` are `[]`, but core identity, personality traits, relationship, and autonomy are populated. **This removes Cause C as a blocker.** What remains is that Pulse still has no code reading this directory (Cause A) and the subsystem is still gated off (Cause B), so `/assistant` stays empty regardless. Note also: `CLAUDE.md` still `@`-imports the flat bootstrap `PAI/USER/DA_IDENTITY.md` rather than `DA/garry/DA_IDENTITY.md` — an unrelated staleness in the Claude-session load path, not a Pulse issue.
>
> The 2026-06-30 finding below is preserved as the historical record of the state at investigation time.

---

**[Historical — state as of 2026-06-30]** *This is the part that contradicted the expectation that "the identity process has run." It was accurate on 2026-06-30 and is superseded by the RESOLVED banner above.*

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

**It had not been run as of 2026-06-30** (it has since — see the RESOLVED banner). Direct check of `PAI/USER/DA/` on 2026-06-30:

```
USER/DA/README.md
USER/DA/_example/       ← template only (identity.md / identity.yaml with {PLACEHOLDERS})
USER/DA/_presets.yaml
```

There was **no `_registry.yaml`**, and **no `DA/{name}/` directory** for a real DA. No backups existed (`TELOS/Backups/`, `.bak` — none). The populated DA identity wasn't misfiled at another path — it had not yet been generated. *(As of 2026-07-03, `DAInterview.ts` has been run and `DA/garry/` + `_registry.yaml` now exist — this paragraph describes the 2026-06-30 state only.)*

**The architectural gap that ties it together.** The system moved from a flat `DA_IDENTITY.md` to a `DA/{name}/` model, but the startup import didn't follow: [CLAUDE.md:7](../CLAUDE.md#L7) still does `@PAI/USER/DA_IDENTITY.md` — the old flat path. So even after you run `DAInterview.ts`, the new `DA/{name}/DA_IDENTITY.md` would not be imported until that line is repointed (or the flat file regenerated from the YAML). Pulse, similarly, has no code reading either location yet (Cause A).

## The Windows path bug (real, but separate) — HARDENED 2026-07-04

> **✅ HARDENED 2026-07-04.** The unsafe HOME fallbacks were swept across the Pulse subsystem and replaced with the canonical `process.env.HOME ?? process.env.USERPROFILE ?? homedir()` pattern (+ a `homedir` import where missing). A whole-class re-grep now returns **ZERO** `?? ""` / `|| ""` HOME fallbacks in `PULSE/`, and the daemon was restarted + re-probed (health/assistant/wiki all 200). **Gate-E correction to the original table below:** by the time of the sweep, the `?? "~"` files (setup.ts, modules/wiki.ts, VoiceServer/voice.ts, run-job.ts, pulse-unified.ts) were **already** on the safe pattern, and the stray `${HOME}` fossil directory was **already gone** — so the real remaining work was the `?? ""` set (14 hits / 12 files: calendar, airgradient-poll, messages-db, imessage, syslog, example-module, user-index, telegram, cost-aggregator, Performance/module ×2, github-work, github, life-morning-brief) plus 3 `|| ""` sites (observability.ts:1650, notification-governor, poller-meta-monitor). All fixed. The `observability.ts:554 .replace("${HOME}", HOME)` is a legitimate literal-expansion helper and was intentionally left. The original analysis below is preserved as the historical record.

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

**As of 2026-07-04, all three tracks are complete — `/assistant` populates.** Listed for the record:

1. **~~Generate a DA identity.~~ ✅ DONE 2026-07-03.** `DAInterview.ts` was run; `PAI/USER/DA/garry/` + `_registry.yaml` exist. *(Optional follow-up still open, unrelated to Pulse: repoint [CLAUDE.md:7](../CLAUDE.md#L7) `@PAI/USER/DA_IDENTITY.md` to `DA/garry/DA_IDENTITY.md` so Claude sessions load garry instead of the bootstrap default.)*
2. **~~Build the Pulse module.~~ ✅ DONE 2026-07-04.** The Assistant module was implemented at `./Assistant/module` exposing `handleAssistantRequest`/`assistantHealth`/`startAssistant`/`stopAssistant`, reading `PAI/USER/DA/garry/` — plus the fire-executor, diary/growth writers, approve path, and delegation. Forge cross-family audited.
3. **~~Enable + reconcile the config.~~ ✅ DONE 2026-07-04.** `[da] enabled = true` added to `PULSE.toml`; primary still derives from `_registry.yaml` (registry-as-truth). With the module built AND enabled, the `/assistant/*` endpoints return 200.

*(Remaining, by design: the `da-diary`/`da-growth` writer jobs ship phase-gated `enabled = false` pending an owner opt-in, so the Diary/Opinions tabs stay empty until enabled — not a bug.)*

Separately, the **Windows path hardening** — **✅ DONE 2026-07-04.** All `?? ""` / `|| ""` HOME fallbacks in `PULSE/` were replaced with the `pulse.ts:24` canonical pattern (whole-class re-grep = 0 remaining); the `?? "~"` files were already safe and the stray `${HOME}` fossil dir was already gone by sweep time. Daemon restarted + re-probed (health/assistant/wiki 200). See the HARDENED banner in the Windows-path section above.

## One-line core insight

The `/assistant` page WAS empty not because of a broken path but because the DA subsystem behind it had not yet been built and was disabled in config. **As of 2026-07-04 all three gaps are closed** — the module is built, `[da]` is enabled, and `garry` loads — so `/assistant` now renders the live identity card (a 200 shell wrapping 200 data APIs). The Windows path bug remains a real, parallel issue that bites Pulse's *other* subsystems at autostart, not the identity, and is NOT addressed by this update.

*(2026-07-04 update: all three original gaps — "never given an identity", "never built", "never enabled" — are now resolved. The only empties left are the phase-gated diary/opinions writer jobs, by design.)*

*Investigation only. No files under `~/.claude/PAI/` or `c:/src/LifeOS/` (other than this report) were modified.*
