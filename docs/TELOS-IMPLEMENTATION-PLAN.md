# TELOS page — implementation requirements & plan

> **Subject:** Finish the Pulse `/telos` page so it faithfully realizes Daniel Miessler's TELOS framework.
> **Status:** `/telos` scored **65% completion / 90% maturity** in `docs/PULSESECTIONREPORT.md` — "UI-complete, partially data-wired."
> **Generated:** 2026-07-04 · **Method:** codebase audit (`observability.ts`, `_v7/*`, `USER/TELOS/*`) + web research on Miessler's original TELOS (repo, Fabric patterns, danielmiessler.com), cross-checked against the fork's `data.ts`.
> **Scope of this document:** requirements + a phased, verifiable build plan. **No code is changed by this document** — implementation is a separate approved session.

---

## 1. What Daniel Miessler originally intended (research-grounded)

### 1.1 What TELOS *is*

TELOS is Miessler's open-source framework (created Oct 2024, MIT) defined verbatim as:

> **"Telos is an open-sourced framework for creating Deep Context about things that matter to humans."** — `github.com/danielmiessler/Telos` README

It helps *"entities of any size — from individuals to planets — articulate what they are about and how they're pursuing their purpose in life."* The concrete artifact is a **Telos Context File (TCF)** — a structured Markdown document. The name is the Greek *télos* ("end, purpose, ultimate aim" — root of "teleology"); **note:** no source quotes Miessler stating the etymology himself, so treat it as reasonable inference, not a sourced claim.

**Why it exists — two intertwined theses:**

1. **Deep Context for AI augmentation.** TELOS exists so an AI can genuinely help a person, which requires the AI to know the person deeply. It "addresses the gap between entity self-understanding and AI system comprehension." When given the file, an AI can give advice that *"aligns with your mission and goals, acknowledges your real challenges, references your wisdom and past patterns."* (DeepWiki Telos guide)
2. **Human Activation / Human 3.0.** On his own live dashboard Miessler frames the top problem as the **"Human Activation Crisis"** — most humans don't believe they have valuable contributions to make, worsened by AI/robotics removing traditional jobs. His answer is **Human 3.0**: a framework for helping people articulate who they are, write it down, and work on problems that matter. (`danielmiessler.com/telos`, `daemon.danielmiessler.com/telos`)

The secondary rationale is **transparency/explainability of one's own life**: TELOS *"enabl[es] every project to trace back through strategies, goals, and mission to the foundational problems being solved, thus preventing purposeless activity and ensuring alignment."*

### 1.2 The primitive DAG (the load-bearing structure)

Miessler's own stated chain, verbatim from `personal_telos.md`:

> **"The conceptual path is Problems → Mission → (Narratives) → Goals → Challenges → Strategies → Projects → Journal. This means that any project you're doing can be mapped all the way back up to the problem(s) you're trying to solve."**

**Bidirectional traceability is the core invariant** — downstream execution justifies its existence by tracing upward; upstream purpose decomposes downward into work.

```
Problems ──answered by──▶ Mission ──framed by──▶ Narratives
   ▲                          │
   │                          ▼
   └──────────── serve ── Goals ◀── measure ── Metrics/KPIs
                            ▲
                            │ block
                        Challenges ◀── overcome ── Strategies ── implement ──▶ Goals
                                                        │
                                                        ▼ implemented by
                                                    Projects ── record activity ──▶ Journal/Log
```

### 1.3 The canonical primitives (from Miessler's `personal_telos.md`)

| Primitive | ID prefix | Miessler's definition | Links |
|-----------|-----------|-----------------------|-------|
| **Problems** | `P` | "Fundamental issues or challenges driving the entity's existence." Roots of the chain. | — (mission answers them) |
| **Mission** | `M` | "Core purpose statement explaining why the entity exists." Answers Problems. | addresses → `P` |
| **Narratives** | `N` | Short stories/framing that "reinforce Mission and Goals" (elevator pitch). | reinforce M, G |
| **Goals** | `G` | "Measurable targets with success criteria and KPIs" aligned to mission. | serve M |
| **Metrics/KPIs** | `K` | "Key performance indicators measuring progress." **Reference Goals by ID** (K1→G1). Tracked over time. | feed → `G` |
| **Challenges** | `C` | "Obstacles/constraints preventing goal achievement." Personal (vs. Problems = external). | block → `G` |
| **Strategies** | `S` | "Planned approaches for overcoming challenges and executing goals." Explicitly "solutions to problems." | overcome → `C`, implement → `G` |
| **Projects** | `PR`/`P` | "Concrete, time-bound initiatives implementing strategies toward goals." | implement `S` |
| **Journal/Log** | dated | "Timestamped activity stream tracking real-time progress." Append-only. | record `PR` activity |

**Also-canonical context sections** (unindexed narrative in `personal_telos.md`): History, Ideas (`I`), Predictions (with confidence %), Wisdom, Traumas, Things I've Been Wrong About, Best Books, Best Movies.

**Current State vs Ideal State** is explicit and central: the corporate TCF's dated `## CURRENT STATE` log records repeated KPI readings over time; LifeOS makes it structural with paired `CURRENT_STATE/` and `IDEAL_STATE/` dirs. README: *"The gap between the two is what your TELOS goals, problems, and strategies are trying to close."* This maps 1:1 onto the PAI Algorithm's own "Current State → Ideal State" thesis.

### 1.4 Visualization intent

- The framework docs treat the **Markdown TCF itself as the primary interface** — no dashboard format is mandated.
- **But** Miessler runs a live rendered dashboard of his own file at `daemon.danielmiessler.com/telos`, and the Fabric pattern **`t_visualize_mission_goals_projects`** explicitly produces *"an ASCII art diagram of the relationship [between] my missions, goals, and projects."* So a graph/one-page view is an intended *practice*, even if not a spec requirement.
- No source literally says "see your life on one page" — flagged as not-verified. The full-chain transparency goal is the conceptual basis for the graph view the fork already builds.

### 1.5 Fabric `t_*` tooling (what "using" a TELOS looks like)

Miessler's Fabric patterns *consume* a TELOS file (there is **no** `create_telos` generator — the file is hand/DA-authored):
`t_check_metrics`, `t_find_neglected_goals`, `t_analyze_challenge_handling`, `t_visualize_mission_goals_projects`, `t_find_blindspots`, `t_red_team_thinking`, `t_threat_model_plans`, `t_year_in_review`, `t_create_h3_career`, and more. This validates the fork's `summary.ts` analysis engine (pinch points, weak chains, drift risk) as the *right kind* of surface — it's the dashboard-native equivalent of the `t_*` patterns.

### 1.6 Canonical vs. this fork's extensions (important)

The fork's `data.ts` model is a **superset**. Wiring effort must be prioritized accordingly:

| In `data.ts` | Provenance | Verdict |
|--------------|-----------|---------|
| Problems, Mission, Narratives, Goals, Metrics, Challenges, Strategies, Projects, Work(≈Journal), Ideal/Current State, Dimensions | **Miessler-canonical** (personal TCF) | Wire faithfully — first priority |
| **Team** | Miessler **corporate** TCF only (not personal) | LifeOS extension for a solo user — user-decision-gated |
| **Budget** (money/time/attention) | **Not in Miessler's model at all** | LifeOS extension — user-decision-gated |
| **Recommendations, Stranded, Subtabs, Tweaks** | LifeOS-original dashboard affordances | Keep; several are *computed*, not authored (see §4) |

---

## 2. Current state — what's built vs. what's starved (code audit)

### 2.1 The single root cause

The page is **not half-built — it is starved.** The v7 front-end (`PULSE/Observability/src/app/telos/_v7/`, ~19 components) renders all 11 primitives, three view modes (columns/tree/graph), an item-detail route, a trace overlay, and a whole graph-analysis engine (`summary.ts`). The gap is one backend seam: **`handleTelosOverview()`** (`observability.ts:3052-3207`) hard-returns `null` for 10 of ~21 fields, and even the wired primitives ship with hardcoded derived fields.

> **Canonical live tree:** `LifeOS/install/LifeOS/PULSE/Observability/` (the fullest copy — has `dimension-bars.tsx`, `stillness-kit.tsx`, `section-nav.tsx`, `summary.ts` absent from the `Releases/v5.0.0` snapshot). All line references below are to that tree.

### 2.2 Primitive-by-primitive gap table

Legend: **WIRED** = parsed from real markdown · **NULL** = backend hard-returns null · **SHALLOW** = parsed but derived fields stubbed.

| # | Primitive | Miessler intent | Current state | Source section? | Backend fn needed | Client-contract impact |
|---|-----------|-----------------|---------------|-----------------|-------------------|------------------------|
| 1 | **Problems** | External problems (roots) | **SHALLOW** — parsed (`parseIdEntries P`); `severity` hardcoded `"med"` (`observability.ts:3122`) | exists (`## Problems`) | add severity read | severity from source |
| 2 | **Mission** | Purpose answering problems | **SHALLOW** — parsed; `horizon` always `""`, `active` always `false` (`:3112-3113`) | exists (`## Mission`) | read horizon/active bullets | horizon/active from source |
| 3 | **Narratives** | Elevator-pitch framing | **NOT first-class** — no `narratives[]` field in the `Telos` type; only `narrativeSeed` + synthesis prose exist. `handleTelosOverview` never parses an `N` prefix. | exists (`## Narratives`) | **decision required** (see below) | adding a first-class Narratives card = a NEW `narratives[]` wire field (+ EMPTY default + UI) |
| 4 | **Goals** | Measurable, KPI-bearing | **SHALLOW** — parsed; `kpi`/`target` read from bullets, but `pct:0`, `delta:null`, `dims:[]`, `metrics:[]` (`:3089-3092`) | exists (`## GOALS`) | link goals↔metrics; compute pct | pct/delta/dims/metrics populated |
| 5 | **Metrics/KPIs** | First-class, measure goals, time-series | **NULL** (`metrics: null`, `:3184`) | **MISSING** — no `## Metrics` section | **new** `parseMetrics()` | unblocks goal KPI chips, sparklines |
| 6 | **Challenges** | Personal blockers | **WIRED** — parsed with `blocks` refs | exists (`## Challenges`) | — | — |
| 7 | **Strategies** | Overcome challenges, implement goals | **SHALLOW** — parsed; `active` always `false` (`:3132`) | exists (`## Strategies`) | read active bullet | active from source |
| 8 | **Projects** | Implement strategies | **NULL** (`projects: null`, `:3187`) | partial (`## Projects` in TELOS.md, `PR#`) | **new** `parseProjects()` | unblocks `what.tsx` table, graph project layer |
| 9 | **Work** | ≈ Journal/execution items | **NULL** (nested in projects) | **MISSING** — no per-work source | **new** (part of `parseProjects`) or wire to `/api/work` | work items in project cards |
| 10 | **Team** | *(corporate only — extension)* | **NULL** (`:3188`) | **MISSING** | **new** `parseTeam()` *(gated)* | team cards |
| 11 | **Budget** | *(not Miessler — extension)* | **NULL** (`:3189`) | **MISSING** | **new** `parseBudget()` *(gated)* | budget cards |
| — | **Ideal State / Dimensions** | Current→Ideal gap | **DONE (2026-07-06)** — `buildDimensionsFromIdealState()` surfaces per-dim `mode` (coverage/setup); 4 dims score by real CURRENT_STATE coverage (health 50, freedom 67, creative 60, relationships 67); `summary.ts` renders mode-aware "covered" vs "articulated" language (verified live). See `LIFEOS-STATE-PHASE2-REAL-COVERAGE.md`. | exists (`IDEAL_STATE/` + `CURRENT_STATE/`) | — | dimension rings/bars |
| — | **Snapshot (mood/energy/focus)** | Current-state scores | **WIRED** — `CURRENT_STATE/SNAPSHOT.md` | exists | — | — |
| — | **owner** | Who this is | **NULL** (`owner: null`, `:3177`) | identity file | read principal identity | footer/voice personalization |
| — | **idealState {horizon,note}** | Target date | **NULL** (`:3178`) | `## Ideal State` | parse horizon/note | headline horizon clause |
| — | **Recommendations** | Next moves | **NULL** (`:3190`) — *but* `summary.ts` computes them client-side | n/a (computed) | none (client computes) OR author `## Recommendations` | see §4 |
| — | **Stranded** | Orphan work/goals/strategies | **NULL** (`:3191`) — *computable* from refs | n/a (computed) | **new** `computeStranded()` OR client-side | drift section |
| — | **Subtabs** | Per-dimension deep-dives | **NULL** (`:3192`) | n/a | defer (extension) | subtabs section |
| — | **narrativeSeed** | Synthesis inputs | **NULL** (`:3194`) — synthesis built separately | n/a | none | none |

### 2.3 The parser you already have (reuse, don't replace)

`parseIdEntries(content, prefix)` (`observability.ts:2339`) is capable and should be the backbone of every new parse fn:
- **Three entry forms**: heading (`## P1: text`), bullet (`- **P0:** text`), and ID-less prose fallback (positional IDs).
- **Per-entry extraction**: `**Summary:**`, `**Detail:**`, `**References:** M0, G3, P1` (any-order ID tokens).
- **`refsByPrefix(refs, prefix)`** bins references by target primitive — this is the exact mechanism for every edge (a Strategy's `References: C0, G2` splits into `overcomes:[C0]`, `implements:[G2]`).
- `pickBulletValue(body, "KPI")` / `pickBulletValue(body, "Target")` already pull labeled sub-fields — the model for reading `Severity`, `Horizon`, `Active`, `Value`, `Trend`.

`parseTelosUnified()` (`:2521`) splits `TELOS.md` by H2 with legacy per-file fallback. **New primitives = new H2 sections in `TELOS.md` + a `sectionOrFile()` line + a parse fn.** No new format, no new file needed.

### 2.4 The regression line you must not cross

The `isPersonalized` gate (`:3168`) and `useTelosData.ts` null→EMPTY merge exist because of the **2026-06-09 fixture-leak incident** (real user saw "sample build push" over his life data). **Any new field must return real-or-null, never the `TELOS` sample constant on a personalized install.** Do not touch the gate logic; only add primitives behind it.

**EMPTY-default parity (mandatory per-phase checklist item).** The plan's rule is "populate existing `Telos` fields, don't add new ones" (NFR-2) — so in the common case *no* client-type change is needed and the existing `EMPTY` blanks already cover the field. **But** the moment any phase *does* add a new field to the `Telos` wire type, it MUST also add the matching entry to the `EMPTY` constant in `useTelosData.ts` (`:12-39`) in the SAME change. The `passthrough(key)` merge falls back to `EMPTY[key]` for null/missing fields on a personalized install (`:62-66`); a field present in the type but missing from `EMPTY` returns `undefined` → either a render crash or a fall-through path toward fixture content. This is the same failure class as the 2026-06-09 leak. **Rule: every new `Telos` field ⇒ a new `EMPTY` default, verified in the same commit.** (Cross-vendor audit confirmed all Phase 1–5 target fields — `metrics, projects, team, budget, stranded, subtabs, recommendations, owner, idealState` — already exist in BOTH the type and `EMPTY`, so for the scoped phases this is a guard, not new work — but it is a required check, not an assumption.)

### 2.5 Audited implementation hazards (cross-vendor, code-verified)

These are latent traps in the *existing* backend that a naive implementation of the phases below would hit. Each was verified against `observability.ts` line-by-line in a cross-vendor (GPT-family) audit. **Read before writing any parse code.**

- **HZ-1 [CRITICAL] — the `isPersonalized` gate has a hole for the new primitives.** The gate (`:3168-3173`) is `missions || goals || problems || strategies || challenges > 0`. It does **not** include `metrics`, `projects`, `team`, or `budget`. A user who authors *only* a `## Metrics` or `## Projects` section (exactly what Phases 2–3 add) but hasn't populated the core five gets `isPersonalized = false` → `useTelosData.ts:55-57` returns `FALLBACK` (the sample fixture) over their real data — the precise 2026-06-09 leak class §2.4 claims to prevent. **Fix (Phase 2/3):** add `metrics.length || projects.length` to the gate, OR document that the canonical five must be populated first. **Phase 6 must add a "populate only Metrics" fixture-leak test** — the currently-planned "populate only Problems" test does NOT catch this (Problems is already in the gate).
- **HZ-2 [MAJOR] — `pickBulletValue` over-captures on bullet-form entries.** `parseIdEntries` Pass 2 joins a bullet entry's body with `.join(" ")` (`:2372`), collapsing sub-bullets to one line; `pickBulletValue`'s line-anchored regex (`:2455`) then captures the entire tail (Value becomes `"6h58 - **Unit:** - **Trend:** +0.12 - **References:** G0"`). The §3.3 schema's nested `- **Value:**`/`- **Trend:**` sub-bullets under a `- **K0:**` bullet trigger this; it also endangers Phase 1's `Severity`/`Horizon`/`Active` sub-field reads. Heading-form entries (Pass 1, `join("\n")`) are unaffected. **Fix:** for any primitive carrying multiple labeled sub-fields, mandate **heading form** (`### K0: Sleep duration` then sub-bullets), OR change Pass 2 to `join("\n")`, OR make `pickBulletValue` delimiter-aware. Confirm which form the real `TELOS.md` sections use before Phase 1. *(The current sample files use single-line bullet form `- **P0:** text` with no sub-fields, so today's data doesn't bite — but the moment sub-fields are added per §3.3, it does.)*
- **HZ-3 [MAJOR] — `refsByPrefix` uses `startsWith` → Problem/Project ID collision.** `refsByPrefix` bins by `id.startsWith(prefix)` (`:3076-3077`). With Problems=`P` and Projects=`PR` (as §1.3/§3.3 propose), `"PR0".startsWith("P")` is `true`, so every `refsByPrefix(refs, "P")` call (Mission.addresses, Goal.addresses) vacuums up project refs as problems. **Fix:** use boundary-aware matching (`/^PR\d/` vs `/^P\d/`) OR pick non-overlapping namespaces (the fixture already uses `PB*` for problems, `P*`/`PR*` for projects — a naming scheme to standardize) **before Phase 3.**
- **HZ-4 [MAJOR] — `refsByPrefix` is a local closure, not a reusable helper.** It lives inside `handleTelosOverview` (`:3076`), not at module scope. §2.3 lists it in the parser toolkit; new `parseMetrics`/`parseProjects` fns must **hoist it to module scope** (or reimplement) — do the hoist first so all parsers share one boundary-aware implementation (also fixes HZ-3 in one place).
- **HZ-5 [MAJOR] — dimension taxonomy mismatch + `velo`/`ideal` are hardcoded.** `buildDimensionsFromIdealState` (`:2467-2514`) emits **4 composite surfaces** (`health`, `creative_freedom`, `relationships`, `finances`) with `ideal:100` and `velo:0` **hardcoded**, and `cur` sourced from `LIFEOS_STATE.json` — NOT from `IDEAL_STATE/` markdown. But goals/projects/metrics reference **7 granular dims** (`creative`, `money`, `freedom`, `rhythms`, `infrastructure`, …) that won't resolve against the 4 emitted ids. So §4's "author velo in `IDEAL_STATE/`" is misdirected (velo is a literal `0`; `cur` lives in JSON), and `summary.ts` drift (FR-6) is fed a constant 0 today. **Fix (Phase 4):** reconcile the 4-surface vs 7-dim taxonomies before wiring `Goal.dims`/`Project.dims`/`Metric.color`; source `velo` from `LIFEOS_STATE.json` (or add it there), not `IDEAL_STATE` markdown.

---

## 3. Requirements

### 3.1 Functional requirements

- **FR-1** Every Miessler-canonical primitive that has a first-class `Telos` wire field (Problems, Mission, Goals, Metrics, Challenges, Strategies, Projects, Work) renders real authored data on a personalized install, or a graceful empty-state if unpopulated — never fixture leak. *(Narratives is canonical but has no first-class field today — see Q5; it contributes to the synthesis paragraph in v1.)*
- **FR-2** Goals link to Metrics bidirectionally (`Goal.metrics[]` ↔ `Metric.feeds[]`) so the goal-card KPI chip and the metric sparkline both light up. This is the highest-leverage single wire (Miessler-canonical + already-coded UI).
- **FR-3** Projects (and their Work items) render in the existing `what.tsx` table and the graph's project/work layers, each tracing to its strategy.
- **FR-4** Every primitive's cross-references resolve in the trace overlay and item-detail page (`/telos/item?id=`) — the bidirectional-traceability invariant is observable in the UI.
- **FR-5** Shallow fields on already-wired primitives are read from source: Problem `severity`, Mission `horizon`+`active`, Strategy `active`, Goal `pct`.
- **FR-6** The `summary.ts` analysis engine (pinch/drift/traction/recommendations) produces real output — it depends on `goals.pct/delta`, `dimensions.velo`, `projects`, `stranded`, so it self-completes once those wire.
- **FR-7** Team/Budget (extensions) are behind an explicit user decision (§5, Q2) — build only if the user wants them for a solo install.

### 3.2 Non-functional requirements

- **NFR-1** No new data format. Extend `parseIdEntries`/`parseTelosUnified`; author new primitives as H2 sections in `TELOS.md` with the existing `- **ID:** text` + `**References:**`/`**Field:**` conventions.
- **NFR-2** The client `Telos` type (`_v7/data.ts`) is the wire contract. Backend returns that shape; changing a field's type is a two-sided change (backend emit + client consume). Prefer *populating existing fields* over adding new ones.
- **NFR-3** No v7 UI rewrite. Components are complete; they consume `telos.*`. UI changes limited to: (a) empty-state affordances where a section can render nothing, (b) removing any dead "coming soon"/stub markers if found.
- **NFR-4** Windows-native paths (`process.env.HOME ?? process.env.USERPROFILE`), no hardcoded separators.
- **NFR-5** Release-boundary clean: any new `TELOS.md` section ships as a **sample template** (`(sample)` entries) so public releases stay PII-free (the release builder strips `USER/**` and re-seeds scaffold).
- **NFR-6** `bun`/TypeScript only; backend is `Bun.serve`-hosted `observability.ts`; Pulse is `bun run pulse.ts` (not watch-mode — restart to reload the module before probing).

### 3.3 Data-contract requirements (source-markdown schema)

New/extended `TELOS.md` sections the backend will parse. All use the existing bullet + labeled-subfield + `**References:**` convention `parseIdEntries` already understands.

**Metrics** (new `## Metrics` section):
```markdown
## Metrics
- **K0:** Sleep duration
  - **Value:** 6h58
  - **Unit:**
  - **Trend:** +0.12
  - **References:** G0        ← feeds Goal G0
- **K1:** Weekly distance
  - **Value:** 18.4
  - **Unit:** km
  - **Trend:** +1.4
  - **References:** G1
```
(`Metric.spark[]` time-series is deferred — see §4; v1 renders value+trend without sparkline, or a flat single-point spark.)

**Projects** (extend `## Projects`, add subfields + Work children):
```markdown
## Projects
- **PR0:** Ship the benchmark harness
  - **Status:** amber            ← green|amber|red
  - **References:** S0, creative, money   ← strategy + dimension ids
  - **Work:**
    - **W0:** Define schema | status: green | eta: 2d | owner: A
    - **W1:** Wire graph | status: amber | eta: 4d | owner: U
```
(Work-item sub-parse is a small dedicated helper; or Phase 3b wires Work to the live `/api/work` board instead — see §5, Q3.)

**Shallow-field reads** (existing sections, add labeled subfields):
```markdown
## Problems
- **P0:** Tools fragment knowledge work
  - **Severity:** high          ← high|med|low
  - **References:** M1

## Mission
- **M1:** Make AI testing reliable
  - **Horizon:** 10y
  - **Active:** true
  - **References:** P0, P1

## Strategies
- **S0:** Start small and adjust
  - **Active:** true
  - **References:** C0, G2
```

**Team / Budget** (extensions — schema only if user opts in, §5 Q2):
```markdown
## Team
- **T0:** Alex | role: Principal | kind: human | References: PR0, PR1

## Budget
- **B0:** Monthly burn | kind: money | value: $6.4k | of: $8.0k | References: PR0
```

---

## 4. Derived-field resolution (authored vs computed vs deferred)

Every field the UI shows but the source can't directly provide gets an explicit decision here (ISC-18):

| Field | Decision | Rationale |
|-------|----------|-----------|
| `Goal.metrics[]` / `Metric.feeds[]` | **Authored** (via `**References:**`) | Miessler-canonical (K→G links); cheapest high-value wire |
| `Goal.kpi` / `Goal.target` | **Authored** (already read via `pickBulletValue`) | Present in schema today |
| `Goal.pct` | **Computed** from `kpi`→`target` via a small **value-normalizer** (~10 lines); else `0`/omit bar | Deterministic; no new source burden. **Verified feasible** against the real `data.ts` formats: the normalizer must handle time (`6h58`→418 min → 93% of `7h30`), money+`k` (`$18.2k`/`$40k`→46%), unit suffixes (`18.4km`/`25km`→74%), percent (`54%`/`80%`→68%), plain counts (`19`/`50`→38%), and return **null** for non-numeric KPIs (`"Wife by 35"`→omit bar). A naive `parseFloat` alone fails on `6h58` and `$18.2k` — the normalizer is required, not optional. |
| `Goal.delta` | **Deferred** to time-series (needs history); v1 `null` (UI already handles null delta) | No history store yet; honest null |
| `Metric.spark[]` | **Deferred**; v1 single/flat point | Needs a metric-history log (future: append-only `METRICS_LOG.md` per Miessler's dated CURRENT STATE pattern) |
| `Metric.trend` | **Authored** (`**Trend:**`) | One number the user knows |
| `Dimension.velo` | **Authored** in `IDEAL_STATE/` or **deferred** `0` | Verify what `buildDimensionsFromIdealState` reads today |
| `Problem.severity`, `Mission.horizon/active`, `Strategy.active` | **Authored** (labeled subfields) | One-token reads |
| `Stranded` | **Computed** server-side from refs (mirror `summary.ts` logic: work-no-goal, goals-no-strategy, idle-strategies) OR leave client-computed | `summary.ts` already computes drift client-side; server `computeStranded()` optional |
| `Recommendations` | **Computed** client-side (`summary.ts buildRecommendations`) — graph-derived, already works once inputs wire. **Authored/DA-generated recommendations are explicitly out of scope** (that is the `/assistant` DA subsystem, not this page). v1 = graph-derived only. | Avoids silent scope-creep into DA territory; `summary.ts` already falls back to graph-derived when no authored recs exist |
| `owner.name` | **Authored** (read principal identity file) | Personalizes voice/footer |
| `owner.day` / `owner.streak` | **Computed** (`day` = server date) / **Deferred** (`streak` needs a store → default `0` in v1) | These are NOT in an identity file — the `Owner` type needs them but only `name` has an authored source; don't promise `streak` without a tracking store |
| `Subtabs`, `narrativeSeed`, `Tweaks` | **Deferred** (LifeOS extensions, low leverage) | Not blocking the canonical page |

**Key insight:** wiring the *authored* fields (Metrics links, Projects, shallow subfields) automatically lights up the *computed* layer (`summary.ts` pinch/drift/traction/recommendations and the graph edges) with **zero additional code** — the analysis engine is already written and starved of the same inputs.

---

## 5. Open decisions for the user (surface before building)

These change scope materially and are the user's call (ISC-21):

- **Q1 — Metric history / sparklines.** v1 renders metrics as value+trend (no sparkline history), OR we add an append-only `METRICS_LOG.md` (Miessler's dated CURRENT-STATE pattern) so sparklines + real `delta` work. History store is ~1 extra phase. **Recommendation:** defer to v2; ship value+trend first.
- **Q2 — Team & Budget.** Neither is in Miessler's *personal* model (Team is corporate-only; Budget isn't his at all). For a solo researcher they may be noise. **Options:** (a) skip both, (b) wire Team only, (c) wire both. **Recommendation:** skip for v1; the page is faithful without them, and their sections render empty-state cleanly.
- **Q3 — Work source.** Work items can be (a) authored as children under Projects in `TELOS.md`, or (b) pulled live from the existing `/api/work` kanban board (`buildWorkNarrative` already reads it). **Recommendation:** (b) — reuse the live board, less duplication, already Windows-tested.
- **Q4 — Recommendations.** Rely on `summary.ts` graph-derived recs (free once inputs wire), or also allow an authored `## Recommendations` override? **Recommendation:** graph-derived only for v1.
- **Q5 — Narratives as a first-class card?** Narratives is Miessler-canonical but the `Telos` wire type has **no `narratives[]` field** — it only feeds `narrativeSeed`/synthesis prose today. Making it a first-class clickable section is the one canonical primitive that requires a NEW wire field (+ EMPTY default + a new UI section component), i.e. it crosses the "don't add new fields / don't rewrite UI" lines. **Options:** (a) accept Narratives as a non-goal for v1 (it already contributes to the synthesis paragraph — strike it from FR-1/§8), or (b) add the field+section as a small dedicated task. **Recommendation:** (a) — keep v1 to populating existing fields; Narratives already colors the synthesis, so it isn't invisible. §8 DoD is written accordingly (Narratives = "contributes to synthesis," not "first-class card").

---

## Build status (updated 2026-07-04)

**Phases 1 + 2 + 3 + 4 SHIPPED in BOTH trees** — the canonical fork AND the live running `~/.claude` system. Each increment was verified against a scratch HOME (synthetic-`Request` probes of the real module, distinct from the live install), Cato cross-vendor audited, and — for the live tree — confirmed over real HTTP after a Pulse restart. Commits (all signed):

| Increment | Fork (`atabisz/Personal_AI_Infrastructure`) | Live (`atabisz/claude-config`) |
|-----------|---------------------------------------------|-------------------------------|
| Phase 1+2 (Metrics + shallow reads + HZ-1) | `0210215` | ported as part of the live rewrite `8026006` |
| Live backend port (adapt to `~/.claude/PAI` paths, preserve Windows HOME hardening) | — | `8026006` |
| Phase 3 (Projects + nested Work) | `788ea29` | `b7529f6` |
| Phase 4 (dimensions HZ-5 + stranded + idealState) | `fb93a02` | `5fdd4d8` |
| owner (from principal identity) + port summary.ts engine to live | `708787c` | `c38bbf6` |

**Shipped (both trees):** module-scope boundary-aware `refsByPrefix` (HZ-3/HZ-4), `pickLabeledValue`/`pickRefs`/`mergeRefs` (HZ-2), `normalizeGoalNumber` (now rejects date-shaped targets)/`computeGoalPct`, `parseMetrics` (phantom-entry guard), `normStatus`/`parseProjects` (PR# block-splitter with nested `W#` rows, pipe-in-title safe, dedupe-by-id); Phase-1 reads (severity/horizon/active/pct); Phase-2 metrics + bidirectional goal↔metric links; Phase-3 projects + work; `isPersonalized` counts metrics+projects (HZ-1, fork tree; the live tree's older handler has no fixture gate).

> **Two-tree note:** the live `~/.claude` is a SEPARATE repo (`claude-config`) running an older, structurally different `observability.ts` (different paths `~/.claude/PAI/…` not `/LifeOS/…`; overview handler was ~46 lines via `parseSourceHeadings`). The features were **re-implemented in the live idiom, not file-copied** — a wholesale copy would have reverted the Windows HOME hardening and pointed TELOS at the wrong paths. The two trees now carry logically-identical `parseMetrics`/`parseProjects`/helpers.

**Live-on-your-dashboard status:** `/api/telos/overview` on the running daemon returns real parsed problems/missions/goals/strategies/challenges + `metrics`(array) + `projects`(array with nested work). The sample `METRICS.md`/`PROJECTS.md` scaffolds provide a starting point; your real TELOS files are still prose without `K#`/`PR#`/KPI sub-fields, so those surfaces show sample/empty until authored (via `/interview` or by hand) — code ready, data pending.

**Done since Phase 4:**
- **`owner`** ✅ — `buildOwner()` reads `**Name:**` from the identity file (live: `PRINCIPAL_IDENTITY.md`; fork: `BASICINFO.md`→`ABOUTME.md`), line-anchored capture + placeholder filter (`user`/`your name`/`tbd`/`(interview)` → null); `day`=server date, `streak`=0. Fork `708787c`, live `c38bbf6`. Live-verified: `owner.name` "Alex Tabisz".
- **`summary.ts` on live** ✅ — ported the fork's analysis engine into the live `_v7/` + a `.hero-summary` block (headline/position/traction/pinch/drift), gated on the backend's authoritative `meta.isPersonalized` (added to the live overview + threaded through `useTelosData`→`app`→`Hero`, so it can't analyze the FALLBACK fixture — Cato F1). Live-verified in real Chrome. Same commit `c38bbf6`.

**Deferred / follow-up:**
- **Live client fixture-blend (narrowed)** — the summary is now correctly gated on `meta.isPersonalized`, but the older live `use-telos-data.ts` still shows FALLBACK samples for individual `null` primitives (e.g. `idealState`). Pre-existing older-client behavior; the parallel of the fork's gate hole. A full fix would invert the merge to per-field authoritative.
- **Team / Budget** — deliberately skipped (Q2 — not Miessler-canonical: Team is corporate-TCF-only, Budget isn't in his model).
- **Metric history / sparklines / real `delta`** — deferred (Q3); needs a time-series store (`METRICS_LOG.md`, Miessler's dated CURRENT-STATE pattern).
- **Gate hole (Cato Finding 2, MAJOR, PRE-EXISTING, fork tree only):** `isPersonalized` still returns false for an install that authored ONLY dimensions/narratives/preferences → `mergeTelos` serves the FALLBACK fixture over real data (2026-06-09 class). Not introduced by this work. **Recommended:** fold `dimensions.length`, non-null narratives, and populated preferences into the gate, or invert it to "personalized unless every source is empty."
- **`PR#` vs `P#` cross-ref alignment (Cato info):** projects use `PR#`; when Team/Budget/Recommendations get wired their cross-refs must target `PR#` (harmless today — those fields are null).
- **Dead code (live tree):** `parseSourceHeadings`/`asLifeSections`/`asLifeGoals`/`LifeGoalsPayload` are now orphaned by the rewrite — safe to delete in a cleanup pass.

## 6. Phased implementation plan

Each phase is independently shippable and ends with a live probe. Ordered by **leverage × dependency** and front-loaded so the smallest first step delivers visible progress in one sitting (per start-small work pattern).

### Phase 0 — Project ISA + decisions (≈E2, 30 min)
Seed `<telos-page>/ISA.md` as the project system-of-record; resolve Q1–Q4 with the user; confirm the canonical tree. **No code.**

### Phase 1 — Shallow-field reads (smallest first step) (≈E2–E3, ~1–2h)
Wire the fields whose source sections already exist — pure additive reads, zero new sections, zero client-contract change:
- `Problem.severity` ← `**Severity:**` bullet (fallback `"med"`)
- `Mission.horizon` + `active` ← `**Horizon:**` / `**Active:**`
- `Strategy.active` ← `**Active:**`
- `Goal.pct` ← computed from numeric `kpi`→`target`
- Populate the sample `TELOS.md` templates with these subfields (`(sample)` values).

**Verify:** `curl -s localhost:31337/api/telos/overview | jq '.problems[0].severity, .missions[0].horizon, .strategies[0].active'` returns real values (not `"med"`/`""`/`false`); Interceptor screenshot of `/telos` shows severity dots, horizon labels, "doing this" badge.
**Value:** immediately visible — problem severity coloring, mission horizon tabs, active-strategy badge.

### Phase 2 — Metrics + Goal↔Metric links (highest leverage, **authored-only**) (≈E3, ~2–3h)
The keystone. Add `## Metrics` section + `parseMetrics()`; wire `Goal.metrics[]` (from goal `**References:** K*`) and `Metric.feeds[]` (from metric `**References:** G*`); stop returning `metrics: null`.
- New `parseMetrics(raw)` modeled on `parseIdEntries` + `pickBulletValue` for Value/Unit/Trend.
- Goal ref-binning: extend `refsByPrefix(g.references, "K")` → `metrics[]`.
- `Metric.spark` = single/flat point; `color` mapped from feeding goal's dim or default.

> **Explicit scope stance (resolves the leverage-vs-smallest-step tension):** Phase 2 Metrics is **authored-only**. `Metric.trend`, `.value`, `.unit` are authored (one token each). `Metric.spark[]` (history sparkline) and `Goal.delta` (movement-since-last) are **deferred** — both require a time-series store that does not exist (see §4, Q1). The UI already renders null `delta` and a flat/absent spark gracefully. This is why Phase **1** (shallow reads — zero computed fields) is the smallest first step, not Phase 2: Metrics is the highest *leverage* but not the lowest *risk*, so it comes second, with `delta`/history named as a future upgrade rather than silently promised.

**Verify:** `jq '.metrics | length'` > 0; `jq '.goals[0].metrics'` non-empty; screenshot shows Metrics section populated + goal cards with metric chips + KPI arrows.
**Value:** the page stops looking like a static list and becomes a measured dashboard; `summary.ts` traction paragraph activates.

> **Note — `stranded` is an even-cheaper alternative quick win.** If a faster visible lightup than Metrics is wanted, `stranded` (orphan goals/work/idle strategies) is *purely computable* from the reference graph already parsed via `refsByPrefix` — no source authoring at all (see §4, Phase 4). It can be pulled forward ahead of Metrics as a near-zero-cost demo of the "starved pipeline" thesis. Kept in Phase 4 by default because Metrics is higher-value, but flagged as a swap option.

### Phase 3 — Projects & Work (≈E3, ~2–3h) — ✅ SHIPPED (both trees: fork `788ea29`, live `b7529f6`)
Add `parseProjects()` reading `## Projects` (`PR#` with Status + References binning strategy/dims). Work items via **Q3 decision** — resolved to **authored under Projects** (child-parse), because `/api/work` returns 404 on the live tree (the board join wasn't viable there). Stop returning `projects: null`. As-built: a dedicated block-splitter (not `parseIdEntries`) keeps nested `W#` rows intact; Work rows are pipe-delimited `W#: title | status | eta | owner`; pipe-in-title safe; projects dedupe by id.

**Verify:** `jq '.projects | length'` > 0, each with `strategy`, `dims`, `work[]`; `what.tsx` table renders; graph project/work layers appear; `summary.ts` pinch/red-project signals activate.
**Value:** the execution layer of the DAG becomes visible; full Problems→…→Projects trace works end-to-end.

### Phase 4 — Computed layer & polish (≈E2–E3, ~1–2h) — ✅ SHIPPED (both trees: fork `fb93a02`, live `5fdd4d8`)
As-built: `buildDimensionsFromIdealState` emits the **7 granular dims** (not 4 composites — HZ-5 resolved); `cur`/`velo` from `LIFEOS_STATE.json` (fork) / default 0 (live, no state file). `computeStranded` derives orphans from the reference graph. `buildIdealStateMeta` parses `## Ideal State` (unified only — NOT the sample README). `owner` deferred (no clean identity source). Live-verified: 5 real dims + stranded (2/4/3) on the running daemon.

- Server `computeStranded()` (or confirm client `summary.ts` covers it) → stop returning `stranded: null`.
- `owner.name` from principal identity; `owner.day`=server date; `owner.streak`=0 (no store); `idealState {horizon, note}` from `## Ideal State`.
- **Reconcile the dimension taxonomy (HZ-5, blocking):** `buildDimensionsFromIdealState` emits 4 composite surfaces with hardcoded `ideal:100`/`velo:0` and `cur` from `LIFEOS_STATE.json`, but goals/metrics reference 7 granular dims. Reconcile the two taxonomies and source `velo` from `LIFEOS_STATE.json` before `Goal.dims`/`Metric.color` will resolve or `summary.ts` drift will be non-zero.
- Confirm `summary.ts` recommendations render (should be automatic once pct/dims/projects wire).

**Verify:** `summary.ts` headline/position/pinch/drift/recommendations all non-empty on populated data; stranded section shows orphans; no `null` for owner/idealState.

### Phase 5 — Extensions (only if Q2 = yes) (≈E3, ~2h)
`parseTeam()` + `parseBudget()` + sample sections. Skip entirely if user declines.

### Phase 6 — Regression + release hygiene (≈E2, ~1h)
- **Fixture-leak regression:** confirm a personalized install with a half-populated `TELOS.md` never renders `TELOS` sample constant (the 2026-06-09 line). Test A: populate only Problems, verify Metrics section shows empty-state, not sample metrics. **Test B (HZ-1, required): populate ONLY `## Metrics` (none of the core five) and confirm `isPersonalized=true` and no fixture leak** — this fails today because the gate omits metrics/projects; it MUST pass after the Phase 2/3 gate fix.
- **Empty-state audit:** every newly-wired section renders a graceful empty-state guide when its source section is absent.
- **Release-boundary:** all new `TELOS.md` sample sections carry `(sample)` markers; run the release PII scanner; confirm `USER/**` strip still clean.
- **Cross-tree sync:** apply the same backend changes to any release-snapshot tree that ships (`build-release.ts` regen — snapshot-only edits get regen-wiped).

---

## 7. Verification strategy (per phase)

| Check | Tool | Applies to |
|-------|------|-----------|
| API shape | `curl -s localhost:31337/api/telos/overview \| jq '<path>'` | every phase |
| No fixture leak | populate one section only; `jq '.meta.isPersonalized'`==true AND other sections null | Phase 6 (regression) |
| UI render | `Skill("Interceptor")` screenshot of `/telos` (mandatory web-verify) + `/telos/item?id=<ID>` | every phase |
| Trace integrity | click a primitive → trace overlay resolves up+down the DAG | Phase 3, 4 |
| Pulse reload | `bun run pulse.ts` restart before probing (not watch-mode) | every phase |
| Parser back-compat | legacy per-file fallback still parses when `TELOS.md` section absent | Phase 1–3 |

**Do NOT use agent-browser for verification** — Interceptor only (real Chrome catches rendering issues CDP misses).

---

## 8. Faithful-to-Miessler scorecard (definition of done)

The page is "finished, true to Miessler" when:
- [ ] All canonical primitives (Problems, Mission, Goals, Metrics, Challenges, Strategies, Projects, Work/Journal) render real data or clean empty-states. *(Narratives — see Q5: contributes to the synthesis paragraph rather than a first-class card in v1, unless Q5=b.)*
- [ ] Goals↔Metrics link both directions (his K→G reference model).
- [ ] The bidirectional-traceability invariant is observable: any Project traces up to a Problem, any Problem traces down to Work, in the trace overlay + item pages.
- [ ] Current↔Ideal gap is visible (dimensions with cur/ideal).
- [ ] The analysis surface (`summary.ts`, the dashboard-native `t_*` equivalent) produces real pinch/drift/traction/recommendations.
- [ ] Extensions (Team/Budget) are consciously included or excluded, not accidentally half-wired.
- [ ] No fixture leak; releases stay PII-clean.

---

## 9. Effort summary

| Phase | Tier | Rough time | Ships |
|-------|------|-----------|-------|
| 0 Decisions | E2 | 30 min | ISA + Q1–Q4 answered |
| 1 Shallow reads | E2–E3 | 1–2h | severity, horizon, active, pct |
| 2 Metrics ★ | E3 | 2–3h | metrics + goal links (keystone) |
| 3 Projects/Work | E3 | 2–3h | execution layer + graph |
| 4 Computed/polish | E2–E3 | 1–2h | stranded, owner, idealState, recs |
| 5 Extensions | E3 | 2h | Team/Budget (optional) |
| 6 Regression/release | E2 | 1h | fixture-leak + PII gates |

**Critical path to "looks alive":** Phase 1 → Phase 2 (≈half a day) gets the page from static list to measured, traceable dashboard. Phases 3–4 complete the canonical model. Phase 5 optional. Phase 6 always.

---

*Research sources: `github.com/danielmiessler/Telos` (README, personal_telos.md, corporate_telos.md), `github.com/danielmiessler/fabric` (`t_*` patterns), `danielmiessler.com/telos`, `daemon.danielmiessler.com/telos`, DeepWiki Telos guide. Code audit: `LifeOS/install/LifeOS/PULSE/Observability/observability.ts` + `src/app/telos/_v7/*` + `USER/TELOS/*`. This document changes no code.*
