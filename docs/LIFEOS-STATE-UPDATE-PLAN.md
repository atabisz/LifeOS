# LifeOS State — how it should update: requirements & plan

> **Question that started this:** why is `LIFEOS_STATE.json` empty after `/interview`, and how *should* it update?
> **Answer in one line:** the state updater isn't missing — an entire on-edit "managing state" pipeline exists in the canonical fork, but it's **macOS-only and absent from the live Windows tree**, `/interview` never seeds it, and the score it computes measures *"have you written your ideal"* not *"how close are you to it."*
> **Generated:** 2026-07-04 · **Method:** 3-source web research (danielmiessler.com, github.com/danielmiessler, youtube.com/@unsupervised-learning) + code audit of the fork + live trees. **No code changed by this document** — implementation is a separate approved session.

---

## 1. What Daniel Miessler intends (research-grounded)

### 1.1 The concept has a name: "Managing State"

Miessler's term for the current-vs-ideal loop is **Managing State**. From the *Personal AI Maturity Model* (danielmiessler.com/blog/personal-ai-maturity-model), verbatim:

> "your Assistant **takes periodic inventory of all inputs and assesses Current State relative to Desired State, in order to plan actions to move towards Desired State**."

He places this at maturity tier **AS2** (~2028–2030), with **continuous multimodal awareness** at AS3. The universal framing (*The Last Algorithm*): *"You have a current state. You have a desired state. Everything else is figuring out how to close the gap."*

### 1.2 Scoring: A–F grades + next actions (his vision) — NOT 0–100% dials

From *The Real Internet of Things* (2016), verbatim:

> "Provide clear ratings on how you're doing in the various areas you've chosen to monitor. I prefer A through F… the system tells you exactly what to do to improve your ratings… such as, 'Row 500 meters, do one set of push-ups.'"

**Important fidelity note:** Miessler's *published* model stores state as **prose journal + dated metric lines + AI-computed gap at read-time**, not as persisted per-dimension percentages. His personal TELOS (`personal_telos.md`) has a `Log (Journal)` + `Metrics` (dated targets like "100K downloads by July 2026") — **no completion-% or gap score is stored**; the AI computes the gap when it reads the file.

### 1.3 Cadence: manual-monthly today → periodic auto-inventory → continuous

Three tiers, verified:
- **Today (manual):** TELOS is hand-authored; recommended ritual is a monthly re-read/update (third-party paraphrase — flagged) + an ongoing **journal** as the evidence layer + **on-demand** Fabric `t_*` analysis. Corporate KPIs update **quarterly** (his only first-party cadence quote).
- **AS2 (near future):** DA "takes periodic inventory of all inputs" automatically.
- **AS3 (further out):** continuous ingestion from feeds ("every day, every hour, every minute… at scale").

### 1.4 The gap-closing loop + AI-in-the-loop

Traceability is the invariant: journal/activity → Projects → Strategies → Goals → Mission → Problems; a current-state update can even **prune a goal** (his Boise-datacenter example). The AI-in-the-loop today is **Fabric `t_*` patterns** — `t_check_metrics` ("check this person's Metrics/KPIs to see their current state and if they've improved recently"), `t_find_neglected_goals`, `t_year_in_review`. These **read and analyze** a TELOS file; **none write state**. The human is the update mechanism today.

### 1.5 Two premise corrections (both research agents, independently)

1. **SPQA = State / Policy / Questions / Actions** — not "State/Purpose/Question/Answer." Purpose lives in POLICY. (And SPQA is applied to *organizations* in his post, not individuals — the personal analog is an extrapolation.)
2. **The 7-dimension taxonomy** (health, money, freedom, creative, relationships, rhythms, infrastructure) **is a LifeOS-local extension, NOT verifiable as canonical Miessler.** His published TELOS is section-based (Mission/Problems/Goals/Metrics/Log…). Treat the per-dimension dials as *this fork's interpretation* of his A–F-grades vision, not his literal model.

---

## 2. What the code actually does (audit, both trees)

### 2.1 There is a real, complete "managing state" pipeline — in the fork

The GitHub research surfaced more than a lone updater; the fork implements Miessler's loop end-to-end:

| Tool (fork `LifeOS/install/LIFEOS/TOOLS/`) | Role |
|--------------------------------------------|------|
| **`UpdatePaiState.ts`** | Writes `LIFEOS_STATE.json` — a per-dimension `pct` (0–100) for the 7 dims. |
| **`ComputeGap.ts`** | Gap is a *computed view* (not stored): reads IDEAL vs CURRENT + HEALTH/FINANCES, emits a gap report, logs `MEMORY/OBSERVABILITY/gap-history.jsonl` for weekly trends. Splits **metric dims** (health/money/freedom) from **narrative dims** (relationships/creative/rhythms). v1 stub — semantic extraction via Haiku is *planned*. |
| **`ProposeCurrentStateEntry.ts` / `ApproveCurrentStateEntries.ts`** | Approval-gated capture: pollers (lifelog/calendar/gmail/bills) → `CURRENT_STATE/proposals.jsonl` → **human approves** → written into `CURRENT_STATE/*.md`. Principle: *"no auto-capture. Every entity requires explicit approval."* |
| **`GenerateTelosSummary.ts`** | Regenerates `PRINCIPAL_TELOS.md` boot summary. |

> **Verification status (Cato):** `UpdatePaiState.ts` + `DerivedSync.ts` + the plist + the live reader were directly source-inspected. The `ComputeGap.ts` / `ProposeCurrentStateEntry.ts` / `ApproveCurrentStateEntries.ts` / `SeedPulse.ts` descriptions rest on the GitHub research digest, **not** re-inspected line-by-line here — treat them as conjecture-until-verified and confirm against fork source before any Phase 4 commit.
| **`SeedPulse.ts`** | Seeds state once at onboarding end (runs UpdatePaiState + GenerateTelosSummary). |
| **`DerivedSync.ts` + `com.lifeos.derivedsync.plist.template`** | The **trigger**: a macOS **launchd** file-watcher on `USER/TELOS/**` (throttle 30s, RunAtLoad) → on any edit, re-runs the derivers. A private `update-pai-state` Pulse cron job also exists but was moved to `PULSE.user.toml` (stripped from public releases). |

**So Miessler's intended update mechanism is: edit a TELOS markdown file → file-watch fires (30s throttle) → derive `LIFEOS_STATE.json` + summary + gap.** On-edit, event-driven, plus a seed at onboarding. This maps cleanly to his "periodic inventory" AS2 vision, done deterministically.

### 2.2 The scorer semantics (UpdatePaiState.ts)

```
pct = CURRENT_STATE/<DIM>.md coverage:  (have + 0.5·partial) / total × 100     ← primary
    = else IDEAL_STATE/<DIM>.md:         100 − (TBD markers × 10), clamped      ← fallback
```
Deliberately dumb regex counting, no LLM. Writes `{generated_at, dimensions:{id:{pct, tbd_count, last_updated, source_file}}}`.

### 2.3 The gaps (why it's empty / wrong on live)

| # | Gap | Evidence |
|---|-----|----------|
| G1 | **The whole pipeline is absent from the live `~/.claude` tree.** `UpdatePaiState.ts`, `ComputeGap.ts`, `DerivedSync.ts`, the propose/approve tools, `SeedPulse.ts` — none exist under live `PAI/`. | `find ~/.claude -iname UpdatePaiState.ts` → nothing |
| G2 | **macOS-only trigger.** DerivedSync is a launchd agent; Windows has no launchd. Even ported, nothing would fire it. | plist template |
| G3 | **`/interview` seeds nothing.** The Interview skill writes IDEAL_STATE/CURRENT_STATE prose but never invokes any deriver. | Interview `SKILL.md` — no UpdatePaiState ref |
| G4 | **`velo` is never written.** `UpdatePaiState.ts` emits only `pct`; the Pulse reader (`observability.ts buildDimensionsFromIdealState`) reads `state[id].velo` → always `undefined`→0. **(Correction: `ideal` is NOT unwired — the reader hardcodes `ideal: 100` by design as the ring max; it's never read from state. Only `velo` needs work.)** | updater has no velo; reader reads velo at :2541, hardcodes ideal:100 at :2540 |
| G8 | **`UpdatePaiState.ts` is HOME-fragile (Windows blocker).** Line 32 is `process.env.HOME \|\| ""` with **no `USERPROFILE`/`homedir()` fallback** (the live reader HAS that fallback). On Windows with HOME unset, `LIFEOS_DIR` becomes a **relative** path → the tool silently writes/reads the wrong (cwd-relative) dir. This bites *regardless of trigger* — a SessionStart hook must still guarantee HOME, or the port must harden it. | UpdatePaiState.ts:32 vs observability.ts:54 |
| G5 | **Scorer measures "articulated," not "achieved."** With no `CURRENT_STATE/<DIM>.md` files (live has only SNAPSHOT.md), the primary path never fires → always the fallback → a fully-written `HEALTH.md` with 0 TBDs scores **100%**. That file even says *"Health is directional here by choice — the DA tracks the direction, not a scored number."* | live IDEAL_STATE/HEALTH.md, 0 TBDs |
| G6 | **Rich `CURRENT_STATE/SNAPSHOT.md` is unread by the scorer.** Real prose about energy/riding/focus contributes nothing to any dimension score. | scorer reads `<DIM>.md`, not SNAPSHOT.md |
| G7 | **Path divergence.** Fork tools hardcode `~/.claude/LifeOS/...`; live is `~/.claude/PAI/...`. A copy would read the wrong dir. | `LIFEOS_DIR` in UpdatePaiState.ts |

### 2.4 Consumers of `LIFEOS_STATE.json`

- Pulse `/telos` **dimension rings** (via `observability.ts buildDimensionsFromIdealState` — Phase 4, now on both trees).
- The **statusline STATE strip** (`LIFEOS_StatusLine.sh`) — fork only.

---

## 3. Requirements

- **FR-1** Editing a TELOS source file (IDEAL_STATE/CURRENT_STATE/*.md) refreshes `LIFEOS_STATE.json` on the live system without a manual chore — matching Miessler's on-edit "managing state" intent.
- **FR-2** `/interview` seeds/refreshes state on completion (so the user's "I ran /interview, why empty?" never recurs).
- **FR-3** The dimension rings render real values: `pct` (computed), and `velo`/`ideal` resolved (G4) or explicitly rendered as "not tracked yet" rather than a misleading 0.
- **FR-4** The score's *meaning* is honest (G5): either (a) keep articulation-completeness but **label it** ("setup %"), or (b) compute real current-vs-ideal coverage from CURRENT_STATE, or (c) a hybrid. Decision in §4.
- **FR-5** Runs on **Windows** (no launchd) — trigger via a cross-platform mechanism.
- **NFR:** Bun/TS; live paths `~/.claude/PAI/...`; no PII in shipped tools; two-tree parity (fork canonical + live).

---

## 4. Open decisions for the user (surface before building)

- **Q1 — Score semantics (the important one).** What should a dimension `pct` MEAN?
  - **(a) Articulation/setup %** — rename `100 − TBD×10` in the UI to "setup" so it doesn't masquerade as life-progress. **But note a deeper flaw (Cato):** `100 − TBD×10` rewards the *absence of the literal token "TBD"* — a vague/near-empty ideal file scores 100%, while an honest file that flags open questions "TBD" scores *lower*. **The metric punishes flagging gaps.** So even "setup %" is subtly wrong. Better cheap fix: score authored *substance* (count populated sections/bullets, or gate on minimum content) rather than TBD-token absence.
  - **(b) Real coverage %** — measures reality vs ideal via the scorer's *primary* path: deterministic regex over `status: have|partial|missing` rows. **This is NOT LLM-gated** (correction: `computeFromCurrent` is pure regex) — what it needs is an authored **`CURRENT_STATE/<DIM>.md` source with those status rows**, which doesn't exist live and which `/interview` doesn't write (it writes narrative prose). So (b) = plumb a CURRENT_STATE input (author it, or port the fork's propose/approve capture flow), then the existing regex scores it. *Semantic* gap grading (LLM/Haiku) is a further step and lives in `ComputeGap.ts` (Phase 4), not here.
  - **(c) A–F grade** — most faithful to Miessler's stated vision; also needs semantic judgment per dimension.
  - **Recommendation:** ship the **zero-cost integrity move now** — **rename the metric to what it actually measures** ("articulation completeness" / "setup %") so a fully-written HEALTH.md at 100% doesn't masquerade as life-progress (a flattering lie torches trust in the whole `/telos` surface on first view). Then pursue (b) LLM-scored real coverage as v2. Ship-a-truthful-label beats ship-a-flattering-number.
- **Q2 — velo (only).** `ideal` is already correct (hardcoded ring max — not a task). For **velo**: author a per-dim `velo:` frontmatter field the updater emits, compute it from `gap-history.jsonl` deltas over time, or render "—/not tracked" until history exists? **Recommendation:** render "not tracked" now (and make the UI distinguish "unmeasured" from "flat 0"); compute velo from gap-history once ComputeGap runs on a cadence.
- **Q3 — Windows trigger (real on-edit fidelity tradeoff, not just "cron").** Three genuinely different fidelities:
  - **(a) SessionStart hook + `/interview` hook (RECOMMENDED)** — fires the updater when you start a Claude session (i.e. right before you'd look at `/telos`) and at interview completion. Catches edits made between sessions, needs **no persistent process**, and sidesteps the **Windows Pulse-autostart `HOME`-unset landmine** a cron/VBS job walks into (`process.env.HOME` is unset at VBS-autostart on this machine — a known bug). Fresh-at-view, closest cheap analog to Miessler's compute-at-read-time.
  - **(b) Pulse daily cron** (`update-pai-state`, the job Miessler kept in the private `PULSE.user.toml`) — deterministic but **stale-until-next-run**, and inherits the HOME-unset risk; weakest of the three.
  - **(c) chokidar file-watcher** — the only *true* on-edit trigger, but requires a **long-running watcher process** (Pulse is not watch-mode here — new infra, not a Pulse tweak).
  - **(d) compute-on-read in `observability.ts`** — most Miessler-faithful (gap computed when the dashboard is viewed, no state file at all), but the **biggest change** to the reader.
  - **Recommendation:** (a) SessionStart + `/interview` hook. **Explicitly accepted fidelity gap:** a raw editor-save to a TELOS `.md` outside a session/interview won't refresh until the next session — acceptable for v1; (c)/(d) are the upgrade path if true on-edit is wanted later.
- **Q4 — Auto-ingest scope.** Port the propose/approve capture pipeline (calendar/gmail/bills → CURRENT_STATE) now, or defer? **Recommendation:** defer — it's AS2/AS3 territory and needs connectors; v1 stays manual-authored + on-edit derive.
- **Q5 — Honesty in the UI.** Given the 7-dim dials are a LifeOS extension of his A–F vision (not canonical), do we keep dials, switch to A–F grades, or show both? **Recommendation:** keep dials for v1 (already built), note in docs they're a local extension.

---

## 5. Phased implementation plan

Each phase independently shippable, both trees, verified (scratch-HOME probe → live restart → Interceptor ring render), Cato-audited. Ordered smallest-leverage-first.

### Phase 1 — Port the deriver to live + seed it + relabel (smallest first step, ≈E3)
- Port `UpdatePaiState.ts` to live. **Cheapest path (Cato):** don't fork the hardcoded paths — set **`LIFEOS_DIR=$HOME/.claude/PAI`** (the tool already honors that env override at line 33), which points it at the live layout with zero path-code edits (fix G1/G7).
- **HARDEN HOME (G8, Windows blocker):** change line 32 to `process.env.HOME ?? process.env.USERPROFILE ?? homedir()` (match the reader) and assert the resolved path is non-empty/absolute before writing — else on Windows-HOME-unset the tool silently writes a cwd-relative dir. This is required *regardless of trigger*.
- **Relabel in THIS phase (pulled forward from Phase 3, per Cato):** after Phases 1–2 the rings would otherwise show 5 dims at 100% (0 TBDs) + 2 at 0% (RHYTHMS/INFRASTRUCTURE absent live) — a known-misleading dial. So the moment the number is live, label it "articulation/setup %", never an unlabeled life-progress dial.
- Run it once so `LIFEOS_STATE.json` exists with real `pct` from your authored IDEAL_STATE files.
- **Verify:** `bun UpdatePaiState.ts` writes the file; **restart Pulse** (not watch-mode); `curl /api/telos/overview | jq '.dimensions'` shows non-null `cur`; Interceptor shows rings with the *labeled* values.
- **Value:** the empty-state question is *immediately* resolved — rings light up, honestly labeled.

### Phase 2 — `/interview` hook + SessionStart trigger (≈E3)
- Hook the updater into the Interview skill's Phase-2 completion (fix G3). **Confirmed prerequisite:** `/interview` Phase 2 DOES write the IDEAL_STATE dim files (HEALTH/MONEY/FREEDOM/RELATIONSHIPS/CREATIVE) — so the fallback-heuristic path has inputs and the hook is NOT a no-op. It does **not** write `CURRENT_STATE/<DIM>.md` `status:` rows (it writes narrative prose by design), so the *real-coverage* path stays dormant until Phase 3/Q1.
- Add a **SessionStart hook** (not a daily cron — see Q3) that runs the updater, so state is fresh when `/telos` is viewed, avoiding the Windows Pulse-autostart HOME-unset landmine.
- **Verify:** finish an interview → `LIFEOS_STATE.json` refreshes; start a new session → updater runs; **restart Pulse** (it is not watch-mode) then `curl /api/telos/overview` shows the refreshed dims.

### Phase 3 — Honest scoring + velo/ideal (≈E3, gated on Q1/Q2)
- Implement the Q1 decision (rename to "setup %" and/or wire CURRENT_STATE coverage).
- Resolve G4: either author `velo`/`ideal` frontmatter the updater emits, or render "not tracked" in the rings; stop the reader silently coercing undefined→0.
- **Verify:** a dimension with real CURRENT_STATE coverage scores by coverage, not TBD; velo shows real or honest "—".

### Phase 4 — Gap engine + trends (≈E4, gated on Q4)
- Port `ComputeGap.ts` + `gap-history.jsonl`; optionally the propose/approve capture pipeline. Wire ComputeGap into the cron so velo can derive from history deltas.
- **Verify:** gap-history accumulates; velo computes from deltas; ComputeGap report renders.

### Phase 5 — Release hygiene
- Ship ported tools template-style (no PII); keep any private schedule in the `PULSE.user.toml` pattern; two-tree parity.
- **Regen symmetry (maintenance obligation, not afterthought):** the fork tree is regenerated by `build-release.ts`; a **snapshot-only edit gets regen-wiped**, and release-regen is a continuous obligation. Any ported tool must be **live-first-then-regenerated into the fork**, PII-clean and template-style, or the next `build-release --apply` silently reverts it.
- **velo display honesty (Q2):** a ring/statusline showing `velo: 0` reads as "no progress," not "unmeasured." Until velo is computed (from `gap-history.jsonl` deltas), the UI must distinguish **"unmeasured"** from **"flat"** — or the plan explicitly accepts the misread. Small but real.

---

## 6. Faithful-to-Miessler scorecard (definition of done)

- [ ] State refreshes **on TELOS edit** (his on-edit "managing state" model), on Windows.
- [ ] `/interview` seeds state (no more empty-after-interview).
- [ ] The score's meaning is **honest** — "setup %" vs real coverage is labeled, not conflated.
- [ ] Dials are documented as a **LifeOS extension** of his A–F vision, not presented as canonical Miessler.
- [ ] velo/ideal are real or honestly "not tracked" — never a misleading fixture 0.
- [ ] Auto-ingest (calendar/health/finance) is a **named future phase** (AS2/AS3), not silently promised.

---

## 7. Effort summary

| Phase | Tier | Ships |
|-------|------|-------|
| 1 Port + seed | E3 | rings light up on live |
| 2 /interview + cron | E3 | refresh-on-edit + daily, Windows-native |
| 3 Honest scoring + velo | E3 | score means what it says |
| 4 Gap engine + trends | E4 | velocity + gap history (optional) |
| 5 Release hygiene | E2 | template-clean, two-tree parity |

**Critical path to "not empty anymore":** Phase 1 alone (port + run the deriver) resolves the presenting problem in one sitting.

---

*Research sources: danielmiessler.com (Personal AI Maturity Model, The Real Internet of Things, SPQA, The Last Algorithm, Personal AI Infrastructure), github.com/danielmiessler (Telos, LifeOS `UpdatePaiState.ts`/`ComputeGap.ts`/`DerivedSync.ts`/propose+approve/`SeedPulse.ts`, Fabric `t_*`), youtube.com/@unsupervised-learning (titles verified; spoken transcripts NOT accessible — findings rest on his essays that mirror the talks). Honesty caveats: SPQA≠State/Purpose/Question/Answer; the 7-dim taxonomy is a LifeOS extension, not verified canonical Miessler; velo/ideal are fixture-only in current code; no per-dimension % score exists in Miessler's published work — it's this fork's interpretation of his A–F vision. This document changes no code.*
