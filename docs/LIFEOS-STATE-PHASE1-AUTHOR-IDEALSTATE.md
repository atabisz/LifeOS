# LifeOS State — Phase #1: author the IDEAL_STATE (and CURRENT_STATE) dimensions

> **Audience:** an agent picking this up cold. Everything you need is here — you should NOT have to re-research Miessler's intent or re-audit the code. Companion doc: `docs/LIFEOS-STATE-PHASE2-REAL-COVERAGE.md` (the closeness-to-ideal engine). Background: `docs/LIFEOS-STATE-UPDATE-PLAN.md` (original research), `docs/TELOS-IMPLEMENTATION-PLAN.md` (the /telos build).
> **Status when written (2026-07-04):** the state pipeline (port, trigger, honest scorer) is SHIPPED + live. `/telos` renders `health=65% freedom=70%` (a *setup %*; verified 2026-07-05 against `UpdatePaiState.ts` + `/api/telos/overview` — the earlier "80%/80%" in this doc was stale). What #1 covers = content the principal must author so more dimensions light up. **This is content the principal owns — an agent FACILITATES, never fabricates their targets.**

---

## 0. Orientation — the two trees and how state flows (read first)

**Two divergent repos, no shared git history:**
- **Live install:** `~/.claude/` → git remote `origin` = `atabisz/claude-config` (private). The RUNNING system (Pulse on :31337 serves from here). Paths: `~/.claude/PAI/...`. Resolve via `PAI_DIR` env or `process.env.HOME ?? process.env.USERPROFILE ?? homedir()` (Windows — HOME is unset under Pulse VBS-autostart, so ALWAYS keep the USERPROFILE/homedir fallback).
- **Fork (canonical/public):** `c:/src/LifeOS/` → remote `fork` = `atabisz/Personal_AI_Infrastructure` (push here), `origin` = `danielmiessler/LifeOS` (upstream — **NEVER push**). Paths under `LifeOS/install/LifeOS/...`.
- **Rule:** changes **live-first, then mirror to the fork**.

**The state data flow (all live-working today):**
```
USER/TELOS/IDEAL_STATE/<DIM>.md   (authored prose, per dimension)      ← #1 fills these
USER/TELOS/CURRENT_STATE/<DIM>.md (authored have/partial/missing rows)  ← #1 optionally fills; feeds #2
        │
        ▼  (trigger: SessionStart hook + Pulse cron "derived-sync" */15 — cross-platform, no launchd)
   DerivedSync.ts ─runs─▶ UpdatePaiState.ts ─writes─▶ USER/TELOS/LIFEOS_STATE.json
        ▼
   observability.ts buildDimensionsFromIdealState() → /api/telos/overview → dimension rings + hero summary
```

**How the scorer treats a dimension today** (`PAI/TOOLS/UpdatePaiState.ts`, honest v2):
- If `CURRENT_STATE/<DIM>.md` has `status: have|partial|missing` rows → `pct = (have + 0.5·partial)/total × 100` (real coverage).
- Else the `IDEAL_STATE/<DIM>.md` frontmatter `type:` decides:
  - `type: opt-out` or `type: north-star` → `pct: null` → renders **"not tracked"** (a choice, not a failing 0%).
  - `type: target` (or unset) → substance score `min(100, sections×10 + bullets×5)` (a *setup %*, headroom-tuned so a fully-set-up file lands ~80).
- The reader **drops null-pct dims** so opt-out/directional/absent dimensions don't render as 0%/failing rings.

**Miessler intent (already researched — do NOT re-fetch):** "Managing State" = the DA takes periodic inventory of current-vs-desired state (Personal AI Maturity Model, AS2). His TELOS is section-based; the 7-dim taxonomy (health/money/freedom/creative/relationships/rhythms/infrastructure) is a **LifeOS extension, not canonical Miessler**. Dimensions can be prose/directional by choice — he does NOT mandate a score per dimension. Full sourcing: `docs/LIFEOS-STATE-UPDATE-PLAN.md` §1.

---

## Current state of the 7 dimension files

`~/.claude/PAI/USER/TELOS/IDEAL_STATE/`:

| Dim | file | `type:` | status | renders on /telos? |
|-----|------|---------|--------|--------------------|
| health | HEALTH.md | target | authored (5 sections; incl. a "North-star (aspirational, not scored)" subsection) | ✅ 65% |
| freedom | FREEDOM.md | target | authored | ✅ 70% |
| money | MONEY.md | opt-out | deliberate opt-out (2026-07-03 — do NOT prompt for financial targets) | — not tracked |
| creative | CREATIVE.md | north-star | directional | — not tracked |
| relationships | RELATIONSHIPS.md | north-star | directional | — not tracked |
| rhythms | (absent) | — | no file | — not tracked |
| infrastructure | (absent) | — | no file | — not tracked |

`CURRENT_STATE/` has only `README.md` + `SNAPSHOT.md` — **no per-dimension `<DIM>.md` files**, so no dimension gets a real-coverage score yet (all fall to the setup-% path).

---

## What to do

1. **Facilitate authoring (don't fabricate).** Via `/interview` Phase 2 (the intended path) or hand-authoring, help the principal fill the dimensions they want tracked. The Interview skill (`~/.claude/skills/Interview/SKILL.md`) covers HEALTH/MONEY/FREEDOM/RELATIONSHIPS/CREATIVE in Phase 2. RHYTHMS is Phase 9 (deferred) and INFRASTRUCTURE isn't scanned — add them to `InterviewScan.ts` targets if the principal wants them tracked.
2. **Frontmatter contract (drives the scorer):** each `IDEAL_STATE/<DIM>.md` needs:
   ```
   ---
   dimension: <NAME>
   type: target | north-star | opt-out
   ---
   ```
   `target` = scored (substance now; real coverage once CURRENT_STATE exists). `north-star`/`opt-out` = intentionally not scored → "not tracked", NOT 0%.
3. **For a REAL coverage score (this is the bridge to #2), author `CURRENT_STATE/<DIM>.md`** with `- <item>: status: have|partial|missing` rows. `computeFromCurrent` reads exactly these. **`/interview` does NOT write these today** (it writes narrative prose) — so either author by hand or use the propose/approve capture pipeline (see the Phase #2 doc).
4. **No backend code needed for #1** beyond optionally extending `InterviewScan.ts` targets to include RHYTHMS/INFRASTRUCTURE.

## Verify

- Run `bun ~/.claude/PAI/TOOLS/UpdatePaiState.ts` → new/edited dims get a pct (or "—" if opt-out/north-star).
- Restart Pulse (`bun run pulse.ts` — not watch-mode), then `curl -s localhost:31337/api/telos/overview | jq '.dimensions'` → the dims render.
- `Skill("Interceptor")` on `/telos` → rings show the new dimensions honestly (no fabricated numbers, opt-outs absent not 0%).

## Acceptance

The principal's chosen dimensions render on `/telos` with an honest setup %; opt-out/directional ones stay "not tracked"; nothing fabricated.

## Working agreements

- Live-first then fork-mirror; sign commits (`alex@tabisz.org`); push live→`origin`(claude-config), fork→`fork`; never push `origin`(danielmiessler).
- `LIFEOS_STATE.json` is **derived** — never hand-edit; regenerate via `UpdatePaiState.ts`.
- Content is the principal's — an agent proposes structure and asks; it does not invent health/money/relationship targets.

---
*Written 2026-07-04. Companion: `docs/LIFEOS-STATE-PHASE2-REAL-COVERAGE.md`. This doc changes no code.*
