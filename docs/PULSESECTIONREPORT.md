# Pulse Web Interface — Section Goals & Completion Report

> **Subject:** PAI Pulse ("PAI Observatory") — the Life Dashboard, a Next.js app on `http://localhost:31337`.
> **Generated:** 2026-06-30 · **Pulse build:** `build_1778733456794` · **Probe:** all routes live, HTTP 200.
> **Method:** Source read (`PAI/Pulse/Observability/src/app/<route>/page.tsx`) + live HTTP probe, fanned out across 3 parallel `Explore` subagents grouped by nav cluster. Read-only — no Pulse files were modified.

> ### 🔄 Correction — 2026-07-03 (SUPERSEDED by the 2026-07-04 update below)
>
> The original 2026-06-30 pass scored `/assistant` at **100% / 100%** on the strength of the *front-end* page (`assistant/page.tsx`, 643 LOC, full CRUD UI). That score was wrong: it measured the page in isolation and missed that **the backend the page depends on was never built**. Every `/assistant/*` data endpoint returned **404** because `assistantModule` was `null` — the `Pulse/Assistant/module` import never resolved (module unbuilt) and the subsystem was config-gated off (`[da]` absent from `PULSE.toml`).
>
> `/assistant` was re-scored to **40% completion / 50% maturity**. **This correction is now itself out of date — the backend was built 2026-07-03→07-04. See the 2026-07-04 update.**

> ### ✅ Update — 2026-07-04: the DA subsystem was BUILT
>
> The gap the 2026-07-03 correction identified has been closed. The `Pulse/Assistant/module.ts` backend now exists and is wired; `PULSE.toml` has a `[da]` section; **all six `/assistant/*` endpoints return HTTP 200** (live-probed 2026-07-04: `health, identity, personality, tasks, diary, opinions`). The subsystem shipped across three build sessions (keystone → fire-executor/growth writers → approve path/formation/delegation), cross-family audited (Forge). A `garry` DA identity loads (`identity_loaded: true`).
>
> `/assistant` is re-scored to **90% completion / 100% maturity**: maturity 100 (the backend is fully built + audited); completion 90, not 100, because the **diary** and **opinions** tabs still render empty — their nightly/weekly writer jobs (`da-diary`, `da-growth`) ship **phase-gated `enabled = false`** pending an owner opt-in, so those two surfaces have no data *by design*, not because code is missing (same "empty data ≠ broken code" logic this report applies to the Life cluster). Blended aggregates recomputed: **completion ≈70%, maturity ≈89%** (maturity returns to the original 2026-06-30 level now that the backend exists). Superseded figures are struck inline below.

## Scoring rubric

Every completion % below is a derived figure (treated as a conjecture until grounded in evidence), computed against **one shared rubric** applied identically to all sections, rounded to the nearest 5:

| Axis | Weight | What it measures |
|------|--------|------------------|
| **UI implementation** | 40% | Is the page built out — layout, cards, charts, styling? |
| **Data wiring** | 35% | Is it reading **real** data (live API / file / JSONL) vs mock / hardcoded / empty? |
| **Feature completeness** | 25% | Are interactions present and working? No `disabled`/stub/"coming soon"/TODO markers? |

**Key backend fact:** `pulse.ts` serves the wiki/perf/syslog/health API groups (`/api/performance`, `/api/pulse/health`, `/api/syslog`, `/api/wiki`) plus — **as of 2026-07-04** — the `/assistant/*` group once the DA module loads (config-gated on `[da].enabled`). The dashboard is otherwise largely a static export reading files/JSONL from `~/.claude/PAI/`. So **"UI-complete" and "wired to live data" diverge sharply** — many Life pages are fully built but render empty-state guides because the underlying `USER/*` source files don't exist yet on this install. That gap is the dominant driver of the scores below. *(This fact was written 2026-06-30 when `/assistant/*` was NOT served — see the 2026-07-04 update; the DA backend has since been built.)*

**Two numbers, not one (important).** The blended **Completion %** above silently deducts for *empty source data on this install* — which penalises the environment, not Pulse's code. A data-driven Life page correctly rendering an empty-state is **complete software**, not 40%-done software. To avoid measuring "whose laptop ran this," every section below also carries a **Software maturity (UI + wiring present, ignoring install data)** figure. Read maturity for *how built-out the code is*; read completion for *what a user sees on this specific install*. Where they diverge is exactly where source files are missing. Note also that trivially-static pages reach 100% completion easily (no data dependency to be empty), so completion alone is **not** directly comparable across static vs data-driven surfaces — maturity is the fairer cross-section comparison.

## Summary table

`Completion` = what a user sees on *this* install (blended rubric). `Maturity` = how built-out the code is (UI + wiring, ignoring empty install data). They diverge exactly where source files are missing.

| # | Section | Nav | Goal (one-liner) | Completion | Maturity |
|---|---------|-----|------------------|-----------:|---------:|
| 1 | `/` Home | primary | Alias — re-exports the TELOS v7 app (same as `/telos`) | *(alias)* | *(alias)* |
| 2 | `/telos` TELOS | Life | Strategic framework: 11 primitives in column/tree/graph views | 85% ~~65%~~ | 98% ~~90%~~ |
| 3 | `/life` LIFE | Life | Aggregate life overview across all domains + narrative synthesis | 55% | 90% |
| 4 | `/work` WORK | Life | Current focus, active Algorithm sessions, project portfolio | 50% | 85% |
| 5 | `/health` HEALTH | Life | Health hub: labs, fitness, nutrition, metrics, conditions | 40% | 85% |
| 6 | `/finances` FINANCES | Life | P&L dashboard: income/expense/overall, cash-flow sankey | 45% | 90% |
| 7 | `/business` BUSINESS | Life | Revenue streams, product breakdown, pipeline, company overview | 50% | 85% |
| 8 | `/assistant` Assistant | System | Manage the DA's identity, personality, tasks, diary, opinions | 90% ~~40%~~ | 100% ~~50%~~ |
| 9 | `/agents` Agents | System | Tabbed work modes: iterate/optimize/ideate/loop/native/ladder | 95% | 95% |
| 10 | `/knowledge` Knowledge | System | Searchable knowledge archive + graph (people/companies/ideas) | 100% | 100% |
| 10a | `/knowledge/graph` | sub-view | Interactive knowledge graph visualization | 100% | 100% |
| 11 | `/docs` Documentation | System | Searchable subsystem docs with cross-referenced backlinks | 100% | 100% |
| 12 | `/skills` Skills | System | Catalog + in-place markdown editing of skills | 100% | 100% |
| 13 | `/hooks` Hooks | System | Registered lifecycle event handlers, grouped, with source drill-down | 80% | 90% |
| 14 | `/arbol` Arbol | System | Cloud-side actions/pipelines/flows (Cloudflare Workers) | 75% | 90% |
| 15 | `/security` Security | System | Security policy: patterns, path tiers, injection defense, hook status | 65% | 75% |
| 16 | `/performance` Perf | System | API cost ledger, tool-failure rates, Anthropic usage | 70% | 90% |
| 17 | `/air` | **non-nav** | Indoor air-quality monitoring (AirGradient) | 60% | 85% |
| 18 | `/ladder` | **non-nav** | Improvement-methodology pipeline visualization | 55% | 75% |
| 19 | `/novelty` | **non-nav** | Evolutionary novelty-search run dashboard | 75% | 85% |
| 20 | `/system` | **non-nav** | Wiki knowledge-graph + doc index (overlaps `/docs`+`/knowledge`) | 70% | 85% |
| 20a | `/system/graph` | sub-view | System knowledge graph visualization | 70% | 85% |

**Overall maturity gradient (the real story).** Averaging the 19 distinct sections (Home excluded as an alias): blended **completion ≈ 70%** (~~68%~~ / ~~71%~~ — see the 2026-07-04 `/assistant` update, which rebuilt the backend the 2026-07-03 correction had docked), but **software maturity ≈ 89%** (~~87%~~ — returns to the original level now that `/assistant`'s backend exists). The ~19-point gap *is* the headline — **Pulse the codebase is near-production-ready; what's missing is install data, not code.** *(As of 2026-07-04 there is no longer a never-built-backend exception — `/assistant` shipped; its only remaining empties are the diary/opinions writers, which are phase-gated off by design.)* Two corrections the raw completion number hides:

1. **The nav-order "inversion" is an artifact of the install, not the code.** On completion, System wiki pages (95–100%) outrank Life pages (40–65%); on maturity they're near-equal (85–100%). The Life cluster looks immature only because `USER/*` source files are empty here — populate them and those pages self-complete with zero code change.
2. **Static pages reach 100% trivially.** `/docs`, `/knowledge`, `/skills` hit 100% partly because they have no data dependency to be empty; that is not evidence they are "more built" than the data-driven Life dashboard. Compare on **maturity**, not completion, across static vs data-driven surfaces.

The genuine implementation gaps (where maturity itself is <90%) are: **`/security` (75%** — RulesInspector disabled by design), **`/ladder` (75%** — thin/missing backend), and **`/agents` (95%** — data wiring delegated to opaque sub-components). *(`/assistant` was in this list at 50% — its backend was built 2026-07-04 and it is now 100% maturity; see the update above.)*

---

## Life cluster

These six pages share a pattern: **complete, polished UI with Recharts visualizations and graceful empty-states, but data wiring blocked on `USER/*` source files that are empty/absent on this install.** UI implementation is ~90%+ across the cluster; the scores are dragged down by the 35% data-wiring axis.

### 1. `/` Home
- **Goal:** Entry point — but it is a thin re-export, not a distinct surface.
- **Completion:** *alias (not separately counted)*
- **Evidence:** `app/page.tsx` is 5 lines: `import App from "./telos/_v7/app"` and renders it. Identical to `/telos`. Counting it separately would double-count the TELOS v7 app.

### 2. `/telos` — TELOS

> ### ✅ Update — 2026-07-04: the TELOS backend was BUILT (re-scored)
>
> The original 65%/90% reflected the *starved backend* — `handleTelosOverview()` hard-returned `null` for metrics/projects/work/etc. That gap is now largely closed. Implemented + shipped **in both trees** (canonical fork + live `~/.claude`), Cato cross-vendor audited, live-verified over real HTTP:
> - **Phase 1** — shallow reads: problem `severity`, mission `horizon`/`active`, strategy `active`, goal `pct` (value-normalizer across time/money/unit/percent/count; dates→0).
> - **Phase 2** — first-class **Metrics** (`K#`) with bidirectional goal↔metric links; `metrics` no longer null.
> - **Phase 3** — **Projects** (`PR#`) + nested **Work** (`W#`); `projects` no longer null; the `what.tsx` table + graph project layer light up.
> - Parser stack added (`parseIdEntries`, `pickLabeledValue`, boundary-aware `refsByPrefix`, `parseMetrics`, `parseProjects`, …); `isPersonalized` counts metrics+projects (fork).
>
> Commits (signed): fork `0210215` + `788ea29`; live `8026006` + `b7529f6`. Plan/as-built: `docs/TELOS-IMPLEMENTATION-PLAN.md` (Build status).
>
> **Re-scored to ~85% completion / ~98% maturity.** Maturity ~98: the canonical primitive backend (Problems→Mission→Goals←Metrics, Challenges←Strategies→Projects→Work) is built + audited on both trees; short of 100 because Phase 4 (dimensions/velocity, owner, idealState, stranded) and Team/Budget (deliberately skipped — not Miessler-canonical) remain. Completion ~85, not higher, because the user's *real* TELOS source files are still prose without `K#`/`PR#`/KPI sub-fields, so Metrics/Projects render sample/empty until authored — the same "empty data ≠ broken code" pattern this report applies elsewhere. Superseded figures struck below.

- **Goal:** Display the TELOS v7 strategic framework (11 primitives: ideal state, problems, missions, goals, metrics, challenges, strategies, projects, work, team, budget) in column / tree / graph views.
- **Completion:** **85%** ~~65%~~ — UI-complete AND backend now wired (Phases 1–3); real user source data still sparse.
- **Maturity:** **98%** ~~90%~~ — canonical primitive backend built + cross-vendor audited on both trees.
- **Evidence:** `telos/page.tsx` re-exports `telos/_v7/app.tsx` (full impl + supporting files in `_v7/`). Multiple view modes (columns/tree/graph), goal modal, trace modal. Data via `/api/telos/overview` now parses problems/missions/goals/strategies/challenges + `metrics`(array) + `projects`(array w/ nested work) from `USER/TELOS/*` sources (previously returned mostly null). Still null by design/deferral: owner, idealState, dimensions (Phase 4), team, budget (skipped — non-canonical). No stub markers.
- **Sub-views:** Columns / Tree / Graph view modes; Goal-detail and Trace modals.

### 3. `/life` — LIFE
- **Goal:** Aggregate dashboard of life across business, health, work, finances, telos goals, and air quality with a real-time narrative synthesis.
- **Completion:** **55%** — best-wired Life page (partial goal data), still mostly empty.
- **Evidence:** `life/page.tsx` (521 LOC). Fetches 8 APIs (home, health, finances, business, work, goals, air, user-index). Backend reads `CURRENT.md`, `GOALS.md`, `SPARKS.md` — return empty/null (`oneSentence="Unknown, Unknown energy"`, `spark=null`). DomainCards show "Wire finances pipeline…", "Add health files…" empty-states. No stub markers — empty states are intentional guidance.
- **Sub-views:** Narrative Banner (mood/energy/focus rings), Domain Grid (6 cards), Active Goals, Next-Actions+Spark, System-Context drawer.

### 4. `/work` — WORK
- **Goal:** Show current work focus, active Algorithm sessions, and the project portfolio with progress tracking.
- **Completion:** **50%** — UI-complete, data near-empty.
- **Evidence:** `work/page.tsx` (262 LOC). `/api/life/work` returns `projects=[]`, `currentFocus=""`, 5 algorithm sessions but all `progress="0/0"`. EmptyStateGuide renders because session/project counts are zero.
- **Sub-views:** Banner, Algorithm Sessions list, Projects grid.

### 5. `/health` — HEALTH
- **Goal:** Centralized health hub showing labs, fitness, nutrition, metrics, and conditions with privacy and freshness indicators.
- **Completion:** **40%** — lowest in cluster; zero source files.
- **Evidence:** `health/page.tsx` (199 LOC). `/api/life/health` returns every array empty (files, labs, conditions, medications, fitness, nutrition, metrics…). `isFreshInstall=true`, banner shows "0 tracked sources · 0 lab panels". UI built; no data exists.
- **Sub-views:** Lab Panels, Core Files.

### 6. `/finances` — FINANCES
- **Goal:** Comprehensive P&L dashboard with income/expense/overall tabs, cash-flow sankey, spending analysis, and multi-collector vendor tracking.
- **Completion:** **45%** — the most elaborate Life UI (1377 LOC), entirely empty data.
- **Evidence:** `finances/page.tsx` (1377 LOC — largest page). `/api/life/finances` returns v2 envelope with `income.streams=[]`, `annual=0`, `outbound.vendors=[]`. Backend reads `vendors.yaml`/`obligations.yaml` (empty). Sankey + TrendChart + tab cycling all built; EmptyStateGuide triggers.
- **Sub-views:** Income tab · Outbound tab · Overall tab (net + sankey + trend + accounts).

### 7. `/business` — BUSINESS
- **Goal:** Business operations dashboard surfacing revenue streams, product breakdown, pipeline, and company overview.
- **Completion:** **50%** — UI-complete, empty data.
- **Evidence:** `business/page.tsx` (296 LOC). `/api/life/business` returns empty `revenueSummary`, `revenueByProduct`, and a placeholder `businessOverview=[{heading:"What goes here"}]`. Banner shows "—". EmptyStateGuide triggers.
- **Sub-views:** Revenue Banner, Revenue-by-Product chart, Business Overview, Revenue Details.

---

## System cluster

The System cluster splits cleanly. The **wiki-backed group (`/agents`, `/knowledge`, `/docs`, `/skills`) is production-ready** — they read live data through the mature `/api/wiki` backend and ship full CRUD interactions. **`/assistant` is the exception in this cluster** — its front-end is equally polished, but it depends on a dedicated Assistant module that was never built (endpoints 404), so it is re-scored down (see §8, corrected 2026-07-03). The **infrastructure group (`/hooks`, `/arbol`, `/security`, `/performance`) is strong but each has a specific gap.**

### 8. `/assistant` — Assistant
- **Goal:** Display and manage the DA's identity, personality, scheduled tasks, diary entries, and formed opinions.
- **Completion:** **90%** (~~40%~~ / ~~100%~~) — UI-complete AND backend now built; live on this install except the two writer-fed tabs.
- **Maturity:** **100%** (~~50%~~) — front-end + server module + data wiring all present and cross-family audited.
- **Evidence (updated 2026-07-04):** `assistant/page.tsx` (643 LOC) — 6 `useQuery` calls, 3 mutations, identity card, stats, 3 tabs. The backend it depends on now EXISTS: `Pulse/Assistant/module.ts` (+ `heartbeat.ts`, `store.ts`, `delegation.ts`) is built and imported by `pulse.ts`, and `PULSE.toml` has a `[da]` section (`enabled = true`). Live probe (2026-07-04): `/assistant/{health, identity, personality, tasks, diary, opinions}` **all return HTTP 200**; `/health` reports `identity_loaded: true, primary_da: "garry"`. The subsystem shipped across three sessions — module keystone; the scheduled-task **fire-executor** + heartbeat cron entrypoint + **diary/growth writers**; then the **approve/consent path**, **growth formation**, and primary→worker **delegation** — all Forge cross-family audited. Server-side autonomy is enforced (`must_ask` → `pending_approval`, fail-closed; approve promotes to `active + confirmed`).
- **Why 90 not 100 completion:** the **Diary** and **Opinions** tabs render empty on this install because their writer jobs (`da-diary` nightly, `da-growth` weekly) ship **phase-gated `enabled = false`** pending an owner opt-in (the autonomous-action + persona-mutation jobs are held back after an observation window). So those two surfaces have no data *by design* — the same "empty data ≠ broken code" pattern the Life cluster shows, not a missing backend. Identity, Personality, and Tasks tabs are live.
- **Sub-views:** Tasks (live) · Personality (live, incl. bounded trait PATCH) · Diary / Opinions (backend present; empty until the phase-gated writer jobs are enabled).

### 9. `/agents` — Agents
- **Goal:** Tabbed interface for work modes — iterate, optimize, ideate, loop, native, ladder — plus actions.
- **Completion:** **95%** — slight deduction for data-layer opacity.
- **Evidence:** `agents/page.tsx` (119 LOC) composes 5 dashboard components + SystemHealthVitals; 7 tabs render conditionally. Data wiring delegated to sub-components (not visible at page level → 5% opacity deduction). No stub markers.
- **Sub-views:** Iterate · Optimize · Ideate · Loop · Native · Ladder · Actions.

### 10. `/knowledge` — Knowledge
- **Goal:** Index and search a knowledge archive (people, companies, ideas, blogs, bookmarks) with semantic linking and graph visualization.
- **Completion:** **100%** — live search, detail views, backlinks.
- **Evidence:** `knowledge/page.tsx` (518 LOC). Live `/api/wiki/search` autocomplete; 3 `useQuery` (index, knowledge, bookmark). Landing (hero + stats + recents), detail (MarkdownRenderer + WikiMeta sidebar w/ backlinks). No stub markers.
- **Sub-views:** Landing · Knowledge detail · Bookmark detail.

#### 10a. `/knowledge/graph` (sub-view)
- **Goal:** Interactive knowledge-graph visualization with category toggles and search filtering.
- **Completion:** **100%.**
- **Evidence:** `knowledge/graph/page.tsx` (153 LOC). `useQuery` to `/api/wiki/graph`; node-click navigation, category toggle, search-query node filtering.

### 11. `/docs` — Documentation
- **Goal:** Searchable documentation organized by subsystem (System Architecture, Algorithm, Decisions, Changelog) with cross-referenced backlinks.
- **Completion:** **100%.**
- **Evidence:** `docs/page.tsx` (388 LOC). 2 `useQuery` (wiki-index, wiki-doc). DocsLanding (3 start-here cards, browse-by-section grid, recently-updated w/ quality badges), detail view + WikiMeta sidebar. No stub markers.
- **Sub-views:** Landing (start-here + browse + recents) · Doc detail.

### 12. `/skills` — Skills
- **Goal:** Catalog and manage skills (public + private) with editable markdown descriptions and effort metadata.
- **Completion:** **100%** — full CRUD with in-place editing.
- **Evidence:** `skills/page.tsx` (317 LOC). 2 `useQuery` + `useMutation` (PUT to save). SkillsLanding cards w/ effort badges; SkillDetailView with edit mode (textarea, save/cancel). The `disabled` at line 185 is a transient loading state, not a stub.
- **Sub-views:** Landing (public + private cards) · Detail (view + edit mode).

### 13. `/hooks` — Hooks
- **Goal:** Display registered lifecycle event handlers (shell + HTTP) grouped by event type, with drill-down to handler source.
- **Completion:** **80%.**
- **Evidence:** `hooks/page.tsx` (294 LOC). Fetches `/api/wiki/hooks` + detail; landing grouped-by-event table w/ metric cards, empty-state guide; detail shows hook source in `pre`. Live React Query, no disabled markers.
- **Sub-views:** Landing (grouped table) → Detail (source viewer).

### 14. `/arbol` — Arbol
- **Goal:** Visualize cloud-side actions, pipelines, and flows (Cloudflare Workers) as composable primitives, with drill-down to wrangler config + source.
- **Completion:** **75%.**
- **Evidence:** `arbol/page.tsx` (290 LOC). Fetches `/api/wiki/arbol` + detail; landing metric cards + 3-column grid (action/pipeline/flow); detail shows `wrangler.jsonc` + `src/index.ts`; empty-state guide. Score reflects dependence on endpoint availability / sparse deployed data.
- **Sub-views:** Landing (grid by type) → Detail (config + source).

### 15. `/security` — Security
- **Goal:** Multi-tab security policy dashboard — block/alert patterns, path tiers, prompt-injection defense, and real-time hook status across the pipeline (Pattern/Egress/Prompt/Rules inspectors).
- **Completion:** **65%** — UI ~85% but a whole tab is disabled by design.
- **Evidence:** `security/page.tsx` (1035 LOC). Fetches `/api/security` + `/api/security/hooks-detail`; 4 tabs (policy/rules/events/hooks) with editable pattern tables. **RulesInspector is explicitly "currently disabled"** (lines 780, 961, 981) — natural-language rules migrated to deterministic inspectors; InjectionInspector regex is "hardcoded, not editable from UI" (line 894). These intentional-but-incomplete surfaces drag feature-completeness down.
- **Sub-views:** Policy (patterns + path tiers) · Rules (disabled editor) · Events (log) · Hooks (status table).

### 16. `/performance` — Perf
- **Goal:** Ledger of API costs (token spend, model breakdown, daily trend), tool-failure rates, and Anthropic subscription usage with call-site classification.
- **Completion:** **70%.**
- **Evidence:** `performance/page.tsx` (707 LOC). 3 tabs (cost/failures/anthropic); fetches `/api/performance/{cost,failures,anthropic-cost}` with 30s polling. Cost: summary cards, model bar chart, daily trend, top-sessions table. Failures: rate chart + per-tool table. Anthropic: alerts, call-site inventory, 24h trend. Live data, no stub markers. Score reflects breadth of real data populating the views.
- **Sub-views:** Cost · Failures · Anthropic.

---

## Non-nav routes

These four routes respond (HTTP 200) but are **not linked from `AppHeader`** (`lifeNav`/`systemNav`) — they are experimental / secondary surfaces reachable only by direct URL.

### 17. `/air`
- **Goal:** Real-time indoor air-quality monitoring from AirGradient devices (AQI, PM2.5, CO2, temp, humidity, TVOC, NOx) across monitors with an EPA color scale.
- **Completion:** **60%** — *non-nav.*
- **Evidence:** `air/page.tsx` (346 LOC). Fetches `/api/life/air` (60s polling); Banner + Legend + sorted MonitorCard grid; data-driven EPA AQI color scale; empty-state instructs running `airgradient-poll.ts`. Live wiring depends on AirGradient integration being set up.
- **Sub-views:** none (single flat view).

### 18. `/ladder`
- **Goal:** Pipeline visualization of the improvement methodology: Sources → Ideas → Hypotheses → Experiments → Algorithms → Results, with per-stage entry counts and status.
- **Completion:** **55%** — *non-nav.*
- **Evidence:** `ladder/page.tsx` (361 LOC). Fetches `/api/ladder` (5s polling); pipeline flow + 6 stage cards + status breakdown (draft/active/testing/complete/archived). UI complete but data sparse (no example data; likely thin/missing backend).
- **Sub-views:** none (single pipeline view).

### 19. `/novelty`
- **Goal:** Multi-cycle evolutionary novelty-search dashboard: running/complete runs with phase pipeline, fitness trajectory, top candidates, checkpoint gates, domain fertility, phase metrics.
- **Completion:** **75%** — *non-nav.*
- **Evidence:** `novelty/page.tsx` (590 LOC). Uses `useNoveltyDashboard()` hook; RunPanel with 7 sub-sections (header, phase pipeline, fitness LineChart, checkpoints A/B, top candidates, domain fertility, phase metrics); empty-state if no runs. UI complete; data wiring via hook (not separately audited).
- **Sub-views:** none (single run panel, expandable candidates).

### 20. `/system`
- **Goal:** Wiki knowledge-graph + documentation index (system docs, people, companies, ideas, bookmarks) — overlaps `/docs` and `/knowledge`.
- **Completion:** **70%** — *non-nav.*
- **Evidence:** `system/page.tsx` (430 LOC). Fetches `/api/wiki` (index), `/api/wiki/doc/{slug}`, `/knowledge/{cat}/{slug}`, `/bookmark/{slug}`; stats grid + recent-changes; doc viewer (MarkdownRenderer + WikiMeta); bookmark viewer; 404 handling. Live data; appears to be an earlier/alternate of the now-promoted `/docs`+`/knowledge`.
- **Sub-views:** Landing (index) · Doc viewer · Bookmark viewer · Graph (→ `/system/graph`).

#### 20a. `/system/graph` (sub-view)
- **Goal:** System knowledge-graph visualization (nodes by category/quality/backlinks, edges, click-to-navigate).
- **Completion:** **70%.**
- **Evidence:** `system/graph/page.tsx` (93 LOC). `useQuery` to `/api/wiki/graph`; KnowledgeGraph component + 4-category legend + click-to-route. Live wiring.

---

## How to read these numbers

- **A low Life-cluster score is not broken code.** Every Life page is UI-complete and wired to a real backend — it scores low because the **source data** (`USER/HEALTH/*`, `vendors.yaml`, `CURRENT.md`, …) isn't present on this install. Populate those files and these jump to 80–95% with no code change.
- **The System wiki pages (100%)** are the maturity benchmark — they read live data through the one fully-built backend (`/api/wiki`) and ship complete CRUD.
- **`/security` (65%)** and **`/agents` (95%)** are where the score reflects a genuine implementation gap rather than missing source data — respectively: a disabled inspector tab; opaque sub-component data wiring. *(`/assistant` was here at 40%/50% — its backend was built 2026-07-04 and it is now 90%/100%; the only empties are the phase-gated diary/opinions writers.)*
- **`/system` overlaps `/docs`+`/knowledge`** and is unlinked — likely a predecessor superseded by the promoted System-nav pages.

*Report produced read-only; no files under `~/.claude/PAI/Pulse/` were modified.*
