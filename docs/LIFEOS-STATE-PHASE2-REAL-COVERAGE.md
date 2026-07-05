# LifeOS State — Phase #2: real closeness-to-ideal (the gap engine)

> **Audience:** an agent picking this up cold. Everything you need is here — no re-research required. Companion doc: `docs/LIFEOS-STATE-PHASE1-AUTHOR-IDEALSTATE.md` (authoring the source files this phase scores). Background: `docs/LIFEOS-STATE-UPDATE-PLAN.md` (original research), `docs/TELOS-IMPLEMENTATION-PLAN.md`.
> **Goal:** move a dimension's `pct` from *"how fully articulated"* (setup %, what ships today) to *"how close are you to your ideal"* (real coverage / gap) — Miessler's actual A–F-grade intent.

---

## 0. Orientation — the two trees and how state flows (read first)

**Two divergent repos, no shared git history:**
- **Live install:** `~/.claude/` → remote `origin` = `atabisz/claude-config` (private, the RUNNING system; Pulse :31337 serves from here). Paths `~/.claude/PAI/...`; resolve via `PAI_DIR` or `process.env.HOME ?? process.env.USERPROFILE ?? homedir()` (Windows HOME is unset under Pulse autostart — keep the fallback).
- **Fork (canonical/public):** `c:/src/LifeOS/` → remote `fork` = `atabisz/Personal_AI_Infrastructure` (push here), `origin` = `danielmiessler/LifeOS` (**NEVER push**). Paths `LifeOS/install/LifeOS/...` (resolve via `LIFEOS_DIR`).
- **Rule:** live-first, then mirror to fork (state code is byte-identical across trees today — keep it so).

**The state data flow:**
```
USER/TELOS/IDEAL_STATE/<DIM>.md   (target prose)
USER/TELOS/CURRENT_STATE/<DIM>.md (have/partial/missing rows) ◀── the input #2 needs, MOSTLY ABSENT today
        │
        ▼  (SessionStart hook + Pulse cron "derived-sync" */15)
   DerivedSync.ts ─▶ UpdatePaiState.ts ─▶ LIFEOS_STATE.json ─▶ observability.ts reader ─▶ /telos rings + summary
```

**Miessler intent (already researched — do NOT re-fetch):** "Managing State" = periodic inventory of current-vs-desired (Personal AI Maturity Model, AS2). Scoring vision = **A–F letter grades + a prescriptive next action to raise each grade** ("The Real Internet of Things", 2016 — *"Row 500 meters, do one set of push-ups"*). Corrections: SPQA = State/**Policy/Questions/Actions**; the 7-dim taxonomy is a LifeOS extension; his gap is **AI-computed at read-time**, not a stored score. Full sourcing: `docs/LIFEOS-STATE-UPDATE-PLAN.md` §1.

---

## Why today's number is only a "setup %"

`UpdatePaiState.ts` scores a `target` dimension by **authored substance** (`sections×10 + bullets×5`) — i.e. *how fully written the IDEAL file is*, NOT how close reality is to it. That's honest (the ring is labeled "Dimension setup", summary prose says "articulated"), but it's not the gap. Real coverage requires a **CURRENT_STATE source** describing where the principal actually is, which `/interview` doesn't write today.

**The existing machinery that's ready for real coverage:**
- `UpdatePaiState.computeFromCurrent(file)` — ALREADY computes real coverage: `pct = (have + 0.5·partial)/total × 100` from `- <item>: status: have|partial|missing` rows in `CURRENT_STATE/<DIM>.md`. It just has no input files. **This is pure regex — no LLM.**
- `PAI/TOOLS/ComputeGap.ts` — a computed gap VIEW (not stored). Reads IDEAL vs CURRENT + `USER/HEALTH`/`USER/FINANCES`; emits `GapEntry{metric, current, target, direction:"above"|"below"|"at"|"unknown", severity:"critical"|"warning"|"info"|"none", note}` per dimension; `--log` appends `MEMORY/OBSERVABILITY/gap-history.jsonl`. `METRIC_DIMENSIONS = [health, money, freedom]` (computable) vs narrative (relationships/creative/rhythms → reminders, not gaps). **It is a v1 STUB** — currently only counts TBD markers; its header states the intended upgrade: pass IDEAL vs CURRENT prose through **Haiku (`PAI/TOOLS/Inference.ts`, ~$0.01/run)** for semantic metric extraction.
- `PAI/TOOLS/ProposeCurrentStateEntry.ts` + `ApproveCurrentStateEntries.ts` — the **capture pipeline** to populate CURRENT_STATE without hand-typing: pollers (`ALLOWED_SOURCES = lifelog,calendar,gmail,homebridge,manual,amazon,bills`; `ALLOWED_TARGETS = CONSUMPTION,ACTIVITY,SOCIAL,FINANCIAL,SIGNALS,SNAPSHOT`) enqueue to `CURRENT_STATE/proposals.jsonl`; `--approve <id>` commits into `CURRENT_STATE/<TARGET>.md`. **Principle (Miessler decision #5): no auto-capture — every entity requires explicit approval.**

⚠️ **Verification-status caveat (from the prior Cato audit):** `ComputeGap.ts` / `ProposeCurrentStateEntry.ts` / `ApproveCurrentStateEntries.ts` were described from the GitHub research digest, **not re-inspected line-by-line**. Re-read them against live source before building on them.

---

## The path (three sub-steps, increasing fidelity)

### #2a — Populate CURRENT_STATE so the existing regex path fires (smallest real-gap step, no LLM)
`computeFromCurrent` already does real coverage; it just needs input. Author `CURRENT_STATE/<DIM>.md` (by hand, or via the propose/approve flow) with `status: have|partial|missing` rows, and the score flips automatically from setup% to coverage% — no scorer change. Optionally wire propose/approve into a cadence for semi-automated capture (respect the approval-gate). **Do this first** — it delivers a real gap for the cheapest cost.

### #2b — Semantic gap via Haiku (ComputeGap's intended upgrade)
Implement the Haiku extraction ComputeGap's header describes: feed IDEAL vs CURRENT prose to `Inference.ts` and extract a real per-metric gap (`GapEntry`) for the metric dimensions (health/money/freedom); keep narrative dims (relationships/creative/rhythms) as reminders, not scored gaps. Feed the result into `LIFEOS_STATE.json` — add a `coverage`/`gap` field, or (if replacing) override `pct`.

### #2c — A–F grades (full Miessler fidelity, optional/largest)
Map coverage/gap → letter grades + a "next action to raise this grade" per dimension. Needs a per-dimension rubric, likely Haiku. This is the AS2/AS3 vision.

---

## Cross-cutting: reverse the honest-labeling once `pct` is real

When `pct` stops being a setup % and becomes real closeness-to-ideal, the honest-labeling done in commits `1406e9f` (live) / `d325aeb` (fork) should be **reversed** so the UI matches the new meaning:
- `PAI/PULSE/Observability/src/app/telos/_v7/hero.tsx` — ring label "Dimension setup" → back to "Current vs Ideal".
- `_v7/summary.ts` `buildHeadline`/`buildPosition` — articulation prose ("X% articulated / left to articulate") → back to achievement framing ("X% of ideal / gaps to close").
These were intentionally written to be cheap to flip. **Don't flip them until the number is genuinely coverage/gap** — otherwise you reintroduce the "articulated masquerading as achieved" dishonesty.

Also coordinate the reader: `observability.ts buildDimensionsFromIdealState` currently reads `pct` (+ `velo`) and hardcodes `ideal:100`. If #2b adds a separate `coverage` field rather than overriding `pct`, teach the reader/UI which one to surface.

---

## Verify (per step)

- #2a: author a `CURRENT_STATE/<DIM>.md`, run `bun UpdatePaiState.ts`, confirm that dim's `source_file` becomes `CURRENT_STATE/...` and its pct reflects have/partial/missing (not substance).
- Restart Pulse (not watch-mode); the client is a static export — `bun run build` in `PAI/PULSE/Observability/` after any `_v7/*` edit.
- Cato cross-vendor audit any scorer/label change (user-facing number). Verify on a scratch HOME (Rule 1b), then Interceptor on `/telos`.

## Acceptance

A dimension with real CURRENT_STATE coverage scores by reality-vs-ideal (not articulation); the number and its ring-label + summary prose all agree; narrative dims stay reminders; nothing fabricated.

## Working agreements

- Live-first then fork-mirror; sign commits (`alex@tabisz.org`); push live→`origin`(claude-config), fork→`fork`; never push `origin`(danielmiessler).
- `LIFEOS_STATE.json` is derived — never hand-edit; regenerate via `UpdatePaiState.ts`/`DerivedSync.ts`.
- Pulse is not watch-mode (restart after `observability.ts` edits); client is a static export (rebuild after `_v7/*` edits).

---
*Written 2026-07-04. Companion: `docs/LIFEOS-STATE-PHASE1-AUTHOR-IDEALSTATE.md`. This doc changes no code.*
