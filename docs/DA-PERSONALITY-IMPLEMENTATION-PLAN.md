# DA Personality - requirements and implementation plan

> **⚠️ SUPERSEDED — historical record, do not execute.** Written against v5.0.0; the repo is at
> 7.1.1. The Personality tab was built and enabled on 2026-07-04 (live `dd82be3`), so the
> "Status: requirements + plan only" line below is no longer true. Paths naming `Releases/` are
> dead — that tree was deleted in `ea1dd8f0`. Read for intent, not for instructions.
>
> Scope: the **Personality tab** of Pulse's `/assistant` page (identity, traits, preferences, anchors, companion, autonomy display, and the opinions/growth that feed personality). Sibling surfaces - heartbeat, scheduled tasks, diary mechanics - are already documented in `PAI/DOCUMENTATION/Pulse/DaSubsystem.md` and are out of scope here except where they feed the Personality view.
>
> Status: requirements + plan only. No feature code is written or committed by the task that produced this doc.
>
> Author date: 2026-07-04.

## Why this matters first (Miessler's intent)

Daniel Miessler does not treat the Digital Assistant as a tool with a coat of paint. In his own words the DA is the named entity you talk to and, eventually, live alongside:

- "I've named my entire personalized system Kai. Kai is my Digital Assistant that will always be with me." - [personal-ai-infrastructure](https://danielmiessler.com/blog/personal-ai-infrastructure)
- "The Digital Assistant is the personality you talk to. Everyone running PAI names their own." - [announcing-pai-5](https://danielmiessler.com/blog/announcing-pai-5-life-operating-system)
- "Personality is what transforms a generic assistant into a distinct entity you actually enjoy working with." - personal-ai-infrastructure

The Life OS thesis in this repo says the same thing structurally: "The DA is personal - a name, a voice, a personality, an identity" (`PAI/DOCUMENTATION/LifeOs/LifeOsThesis.md:54`). The maturity model names the endpoint: an AS3 assistant "feels more like trusted companions, partners, protectors, friends, and confidants than technology" ([personal-ai-maturity-model](https://danielmiessler.com/blog/personal-ai-maturity-model)).

Three design commitments follow, and they are the standard this plan holds the Personality tab to:

1. **The DA is a future-friend, not a servant.** The shipped identity role is literally `"{principal}'s AI assistant and future friend"` (`DaSubsystem.md:142`). Miessler frames Kai as "a proto-version of his future self" and the two of them "as peers" - "when I make a mistake, he's snarky about it; when he makes a mistake, I cuss about it" (personal-ai-infrastructure). Personality traits exist to make that relationship feel real: they are "functional, not decoration. They shape how the system expresses emotions vocally, how it approaches problems, and how the interaction feels moment to moment."
2. **Identity grows in relationship, within guardrails.** Miessler describes "a whole bunch of stuff about Kai's identity, which ebbs and flows" as the relationship develops ([we-are-all-building-single-digital-assistant](https://danielmiessler.com/blog/we-are-all-building-single-digital-assistant)). PAI's concretization of that intent is the growth engine: opinions form, gain and lose confidence, decay, and prune; traits drift slowly within bounds.
3. **A real assistant disagrees with you.** The anti-sycophancy stance is explicit in the lineage: "An assistant that only says 'yes' isn't an assistant - it's a mirror" (attributed to an OpenClaw SOUL.md guide via web research; **lineage-unverified** - not anchored to an in-repo file, so treat as indicative not canonical). PAI encodes the stance concretely as an anti-sycophancy floor - directness and precision may not drift down autonomously (`da-growth.ts:59-61`).

Everything below serves those three commitments. The Personality tab is where the principal *sees* them.

### Provenance note on sourcing

This section separates what Miessler actually published from what PAI implemented on top of his intent:

- **Sourced to Miessler / lineage (quotable):** Kai as the DA's name and "future friend / proto-future-self" framing; the voice as "slightly masculine, androgynous, with rapid speech"; the 12-trait numeric system with published values; the peer/anti-sycophancy dynamic; identity that "ebbs and flows in relationship"; the AS3 companion/advocate endpoint.
- **PAI implementation of the intent (do NOT attribute to Miessler as quotes):** opinion confidence math, decay 0.02/month, prune-below-0.3-after-90-days, ≤5-point/month trait drift, the never-autonomous field list. These are this repo's growth-engine mechanics (`da-growth.ts`), consistent with the intent but not published by Miessler.
- **Explicitly unverified (kept out of the requirements):** a "Japanese-accented" voice (appeared only in a paraphrased snippet, contradicted by fuller sources); any literal "2036" narrative (the sourced futures are the 2016 IoT essay and AS3). These are noted here only so a future reader does not reintroduce them as fact.

## The canonical personality schema (what "done" looks like)

Miessler's canonical machine-readable identity is the `schema_version: 1` YAML that `DAInterview.ts` emits and `DaSubsystem.md:128-272` documents. The personality-relevant fields:

| Block | Fields | Notes |
|-------|--------|-------|
| `core` | name, full_name, display_name, color, role, origin_story | role includes "…and future friend"; origin_story is prose |
| `voice` | provider, main.{voice_id, stability, similarity_boost, style, speed, volume}, optional `algorithm` voice | Kai's is an ElevenLabs voice; bootstrap defaults Rachel `21m00Tcm4TlvDq8ikWAM` / Adam `pNInz6obpgDQGcFmaJgB` |
| `personality` | base_description, preset, **traits (12 numeric 0-100)**, **anchors[]** {name, description} | traits vocabulary below |
| `writing` | style, avoid[], prefer[], examples[], modes{conversational, operational} | |
| `relationship` | principal, dynamic (peers/commander/mentor), interaction_style, history_file | |
| `autonomy` | can_initiate[], must_ask[], cost_ceiling_per_action | enforced, not just displayed |
| `companion` | name, species, personality, relationship | optional; "ambient micro-commentary. We don't overlap." |
| `growth` | initial_beliefs[], learned_preferences[], interaction_count, created_at, last_growth_update | seeds the growth engine |

The 12-trait vocabulary (all integer 0-100): **enthusiasm, energy, expressiveness, resilience, composure, optimism, warmth, formality, directness, precision, curiosity, playfulness**. Miessler's published values for Kai: precision 95, curiosity 90, resilience 85, directness 80, energy 75, optimism 75, warmth 70, composure 70, expressiveness 65, enthusiasm 60, playfulness 45, formality 30 (personal-ai-infrastructure).

Five presets ship in `_presets.yaml`, each a full 12-trait vector:

| Trait | efficient | friendly | creative | mentor | worker |
|---|---|---|---|---|---|
| enthusiasm | 60 | 80 | 90 | 65 | 40 |
| energy | 70 | 75 | 90 | 60 | 60 |
| expressiveness | 50 | 80 | 95 | 70 | 30 |
| resilience | 85 | 75 | 70 | 90 | 95 |
| composure | 80 | 65 | 50 | 85 | 90 |
| optimism | 60 | 80 | 85 | 75 | 55 |
| warmth | 40 | 85 | 70 | 80 | 30 |
| formality | 40 | 25 | 15 | 45 | 60 |
| directness | 90 | 60 | 50 | 70 | 95 |
| precision | 95 | 75 | 60 | 85 | 98 |
| curiosity | 70 | 80 | 95 | 85 | 50 |
| playfulness | 20 | 60 | 85 | 30 | 5 |

Descriptions: efficient "Fast, precise, minimal small talk"; friendly "Warm, encouraging, conversational"; creative "Imaginative, exploratory, playful"; mentor "Thoughtful, teaching-oriented, patient"; worker "Background agent - task-focused, minimal personality."

### The growth model (personality that evolves)

PAI's concretization of "identity that ebbs and flows," implemented in `checks/da-growth.ts` and specified in `DaSubsystem.md §5`:

- **Opinions** (`opinions.yaml`): confidence-weighted beliefs. New opinion seeds at 0.5 (observation) or 0.8 (stated). Confirmation raises confidence by `0.05 * (1 - confidence)`; unconfirmed opinions decay 0.02/month; opinions below 0.3 confidence prune after 90 days; max 50. Frontend field contract is `topic` / `position` / `confidence` (not the design-doc `belief`).
- **Traits** drift at most 5 points per month per trait, clamped against a per-month baseline ledger so four weekly runs can't sum to 20.
- **Diary** (`diary.jsonl`): one entry per day - interaction_count, topics, mood, avg_rating, notable_moments, learning.
- **Growth log** (`growth.jsonl`): append-only auditable before/after events.

### The guardrails (bounded growth)

- **Never-autonomous fields** - `core.name`, `core.full_name`, `voice.*`, `relationship.dynamic` - may only change via the principal's `/interview` or a direct edit (`da-growth.ts:56-58`, `DaSubsystem.md:763-767`). The growth engine throws if an LLM proposal targets one.
- **Anti-sycophancy floor** - `directness` and `precision` may only be raised, never autonomously lowered (`da-growth.ts:59-61`).
- **must_ask is enforced, not displayed** - a task whose action falls under `autonomy.must_ask` is stored `pending_approval`, never auto-fired (`module.ts:128-167`, `DaSubsystem.md:18`).
- **Formation is double-gated** - `da-growth` ships `enabled=false`, and even when enabled, opinion/trait formation only runs under `DA_GROWTH_EXTRACT=1`. Deterministic decay/prune always runs; autonomous persona mutation does not until the principal opts in (`DaSubsystem.md:20,452-459`).

### Personality ↔ TELOS

Personality is authored to serve the principal's goals, not derived from them. The generated `origin_story` hardcodes purpose ("built to help {principal} achieve their goals"); `role` is literally "{principal}'s AI assistant"; and the deep interview seeds `growth.initial_beliefs` from the topics the principal says they care about - the one direct coupling between what the human values and what the DA starts believing. TELOS lives separately under `USER/TELOS/` and is read as goal context every session (`LifeOsThesis.md:62-63`).

## Current state - the gap analysis

The Personality tab's frontend (`LifeOS/install/LifeOS/PULSE/Observability/src/app/assistant/page.tsx`) renders a rich model. The backend (`Releases/v5.0.0/.claude/PAI/PULSE/Assistant/module.ts`) serves it, and the interview (`LifeOS/install/LifeOS/TOOLS/DAInterview.ts`) is supposed to author it. They do not currently agree.

### Provenance of this analysis

Files were read from two trees (they are divergent forks, no shared history):

- **Frontend + interview** from `LifeOS/install/…` - `page.tsx` (1035 lines), `DAInterview.ts` (967 lines), `USER/DIGITAL_ASSISTANT/{DA_IDENTITY.md,_presets.yaml,README.md,_example/identity.md}`.
- **Backend + growth + design doc** from `Releases/v5.0.0/.claude/PAI/PULSE/…` - `Assistant/module.ts`, `checks/da-growth.ts`, `DOCUMENTATION/Pulse/DaSubsystem.md`.
- Live `~/.claude` runs its own private copy that may be older than either - see the two-homes follow-up.
- Git: HEAD `38e39b4`; working tree had `M observability.ts` + untracked `MEMORY/`, `docs/`.

### Field-by-field gap table

Legend: **BLOCKING** breaks the tab (empty/wrong data reaches the UI); **ENHANCEMENT** is missing depth against Miessler's intent but doesn't break rendering.

**Important qualifier (from the cross-vendor audit):** the BLOCKING severity on G1/G2 - and the "BLOCKING via G1" rows derived from them - is **tree-dependent, not absolute**. If Pulse deploys the Releases tree, its own interview (`PAI/TOOLS/DAInterview.ts`) already writes the exact path/format the reader expects, and those rows do not block. G1/G2 block only when the install-tree interview is paired with a `USER/DA`-reading backend, or when the live `~/.claude` runs a lagging pair. The **enhancement** rows (G5, G6, G10, G11) hold for **both** interview forks - neither the install-tree nor the Releases-tree interview captures `what_i_love`/`what_i_dislike`/`anchors`/`writing.avoid`/`writing.prefer`, and both write `voice_id: ""` (Releases `DAInterview.ts:448`, install `DAInterview.ts:456`). So the enhancement work is genuine net-new regardless of which tree ships.

| # | Field | Miessler intent | Frontend contract | Backend behavior | Interview capture | Gap | Severity |
|---|-------|-----------------|-------------------|------------------|-------------------|-----|----------|
| G1 | **identity file location** | one identity per DA under the DA registry dir | reads `/assistant/personality` | reads `PAI/USER/DA/<primary>/DA_IDENTITY.**yaml**` (`module.ts:41,95,98`) | writes `LIFEOS/USER/DIGITAL_ASSISTANT/<slug>/DA_IDENTITY.**md**` (`DAInterview.ts:38,828,838`) | writer and reader disagree on **both** the parent dir (`DA` vs `DIGITAL_ASSISTANT`) and the namespace root (`PAI` vs `LIFEOS`), and the filename/format (`.yaml` vs `.md`) | **BLOCKING** |
| G2 | **file format** | `schema_version:1` YAML is canonical | consumes JSON built from YAML | parses `DA_IDENTITY.yaml` with a YAML lib (`module.ts:119`) | emits frontmatter-YAML **inside a .md** + prose body (`DAInterview.ts:363-364`) | backend `YAML.parse` on a `.md` with a prose tail would fail even if the path matched | **BLOCKING** |
| G3 | **base_description** | one-sentence persona summary | rendered at top of Traits card (`page.tsx:868`) | served from `personality.base_description` (`module.ts:200`) | captured (`DAInterview.ts:283,465`) | works *if* G1/G2 fixed; today lands in an unread file | BLOCKING (via G1) |
| G4 | **traits (12 numeric)** | functional 0-100 sliders | `TraitBar` per entry (`page.tsx:874`) | served + PATCH-editable ≤5pt (`module.ts:201,340`) | captured via preset + formality (`DAInterview.ts:242,468-480`) | schema is right; only G1/G2 block it | BLOCKING (via G1) |
| G5 | **preferences.what_i_love / what_i_dislike / working_style / intellectual_interests** | part of a rich persona | four lists rendered (`page.tsx:887-907`) | served, defaulting to `[]` when absent (`module.ts:203-208`) | **not captured at all** | interview never asks; tab shows empty even after a full deep interview | **ENHANCEMENT** (but user-visible emptiness) |
| G6 | **anchors (key moments)** | "defining moments that shaped personality" (`DaSubsystem.md:191`) | rendered when non-empty (`page.tsx:910`) | served, default `[]` (`module.ts:202`) | **not captured** | interview never asks; always empty | **ENHANCEMENT** |
| G7 | **companion** | optional named companion, ambient micro-commentary | rendered when present (`page.tsx:923`) | served or null (`module.ts:209`) | captured in deep mode (`DAInterview.ts:320-332,410-417`) | works if G1/G2 fixed | BLOCKING (via G1) |
| G8 | **relationship.dynamic / interaction_style** | peers/commander/mentor + prose | shown in autonomy region + used elsewhere | served with defaults (`module.ts:210-213`) | captured (`DAInterview.ts:336-345,493-497`) | works if G1/G2 fixed | BLOCKING (via G1) |
| G9 | **autonomy.can_initiate / must_ask** | enforced guardrail, displayed | two columns (`page.tsx:937-951`) | served (`module.ts:214-217`); enforced (`module.ts:128-167`) | must_ask captured; can_initiate hardcoded (`DAInterview.ts:501-508`) | works if G1/G2 fixed | BLOCKING (via G1) |
| G10 | **writing.style / avoid / prefer** | voice-shaping guidance | interface field (`page.tsx:39`) | served (`module.ts:218-222`) | style captured; avoid/prefer emitted empty (`DAInterview.ts:486-487`) | avoid/prefer always empty | ENHANCEMENT |
| G11 | **voice** | a real ElevenLabs voice = identity | `{provider}` only (`page.tsx:40`) | provider only, never fabricates id (`module.ts:223-225`) | writes `voice_id: ""` (`DAInterview.ts:456`) | no real voice ever set; "voice becomes identity" unmet | ENHANCEMENT |
| G12 | **opinions (Formed Opinions)** | confidence-weighted, evolving | parsed from `/assistant/opinions` `{raw}` for topic/position/confidence (`page.tsx:954-981`) | serves raw `opinions.yaml` (`module.ts:299-305`); writer is `da-growth.ts` | interview seeds `initial_beliefs` in identity, **not** `opinions.yaml` seeds (`DAInterview.ts:352-355`) | opinions only appear once the phase-gated growth engine runs; interview's seeded beliefs never surface as opinions | ENHANCEMENT |
| G13 | **trait-schema drift** | numeric 12-trait map | numeric map | numeric map | numeric map | but `_example/identity.md` teaches a **string-array** traits shape - a copy-paste trap | ENHANCEMENT (foot-gun) |
| G14 | **opinions field drift** | topic/position/confidence + provenance | topic/position/confidence | reads whatever `da-growth.ts` wrote | growth engine emits topic/position/confidence/source/evidence_count | design doc still shows `belief`/`confirmations`/`contradictions`; three shapes documented | ENHANCEMENT (doc/contract) |
| G15 | **edit surface** | principal can shape personality | only traits are editable (PATCH) | only `/assistant/personality/traits` (`module.ts:340`) | interview is the only author of the rest | base_description, preferences, anchors, companion, autonomy, writing have no in-dashboard edit path | ENHANCEMENT |
| G16 | **phase-gate visibility** | opt-in after observation | no indicator of gated state | jobs default off; `DA_GROWTH_EXTRACT` gate | n/a | the tab gives no signal that growth is dormant vs running | ENHANCEMENT |

Root cause (5-Whys, corrected by a cross-vendor audit): the tab shows empty → the backend returns synthesized defaults (`module.ts:193-227` builds a safe shape when fields are absent) → the identity file is not found at the read path → the interview that ran wrote it to a different namespace/dir/extension → **there are two divergent forks of `DAInterview.ts` and the install-tree fork lags the backend's fork.**

This is the important correction. The backend reader (`Releases/v5.0.0/.claude/PAI/PULSE/Assistant/module.ts`) lives in a tree that has its **own** interview at `Releases/v5.0.0/.claude/PAI/TOOLS/DAInterview.ts`, and that interview already writes `PAI/USER/DA/{name}/DA_IDENTITY.yaml` and updates `PAI/USER/DA/_registry.yaml` (`DAInterview.ts:14-19,34,36`) - matching the reader's path and format exactly. The mismatch is real only between the **install-tree** interview (`LifeOS/install/…`, writes `DIGITAL_ASSISTANT/*.md`) and the **Releases-tree** backend. Within the Releases tree, writer and reader already agree. There is no migration/symlink bridging the two (confirmed absent in both trees); reconciliation in the backend's tree is achieved structurally by the newer interview already writing to `USER/DA/`.

So the Personality tab is not half-designed, and it is not unreconciled within a single deployable system either. It is **fork-divergent**: whichever tree ships the backend must also ship the matching interview. The single highest-leverage fix is **fork convergence** - bring the install-tree interview up to the Releases-tree version (or ensure the live `~/.claude` runs a consistent pair), not new UI and not fresh interview code (which largely exists already).

## Requirements

Derived from the intent and the gaps. **R-numbers** are the requirements; the plan phases below satisfy them.

- **R1 (blocking):** the interview's output and the backend's read path must resolve to the same file, in the same format, so a completed `/interview` populates the Personality tab. (Closes G1, G2, and unblocks G3/G4/G7/G8/G9.)
- **R2:** the served personality must match `page.tsx:26-41` exactly - no field the UI dereferences may be absent (already true via `module.ts` defaulting; must stay true after R1).
- **R3:** the interview must capture every field the tab renders that a human should author - `preferences.*`, `anchors`, `writing.avoid/prefer`, and offer a real `voice_id`. (Closes G5, G6, G10, G11.)
- **R4:** there must be one authoritative trait schema (numeric 12-map) and one authoritative opinions schema (topic/position/confidence + provenance); the string-array `_example` and the `belief` design-doc shape must be reconciled or clearly deprecated. (Closes G13, G14.)
- **R5:** the "Formed Opinions" card must have a path to real data: either interview-seeded opinions surface, or the observe-then-enable path for the growth engine is documented and reachable - without enabling the gated jobs in this work. (Closes G12, G16.)
- **R6:** an authoring/edit strategy for the read-only fields must be decided - extend the PATCH contract or declare interview-only with rationale. (Closes G15.)
- **R7:** the never-autonomous guardrails and anti-sycophancy floor must be preserved by every change; nothing here may let the growth engine touch name/voice/relationship or lower directness/precision.
- **R8:** the safety phase-gate must be preserved; no requirement is satisfied by flipping an autonomous-action or persona-mutation job to `enabled=true`.

## Implementation plan (phased, smallest-first)

Each phase names its files and tree, its verification probe, and the requirements it satisfies. Phases are ordered so the first one delivers a visible round-trip.

### Phase 1 - Converge the interview forks (unblocks the tab)

**Goal:** a completed `/interview` populates the live Personality tab, in whichever tree ships the backend.

**Reframed by the audit:** the reconciliation this phase needs largely **already exists** in the Releases-tree interview (`PAI/TOOLS/DAInterview.ts` writes `USER/DA/{name}/DA_IDENTITY.yaml` + updates `_registry.yaml`). Phase 1 is therefore **fork convergence**, not fresh code: bring the install-tree `DAInterview.ts` up to the Releases-tree version (or retire the install-tree divergence), and confirm the live `~/.claude` runs a matching interview+backend pair. Do NOT write a new interview - port or delete the lagging one.

**Reader is live (confirmed, not assumed):** `GET /assistant/personality` calls `loadIdentity()` at request time and returns 503 if the file is unreadable, otherwise `buildPersonalityResponse(id)` (`module.ts:541-544`). The synthesized defaults in `buildPersonalityResponse` only fill fields that are *absent* from a file that WAS read; they are not a hardcoded response that ignores the file. So relocating the interview's output to the read path does light the tab. The path fix is genuinely Phase 1, not a decoy for a "wire the reader" task.

**The `<primary>` coupling (must be named, not glossed):** the read target is `PAI/USER/DA/<primary>/DA_IDENTITY.yaml`, where `<primary>` is resolved at startup from `_registry.yaml`'s `primary:` key (`parsePrimary`, `module.ts:104,513`), falling back to `cfg.primary` then `"kai"` (`module.ts:56,515,518`). "Unify the path" therefore means two things that must both hold: the interview writes into `USER/DA/<slug>/` under the same `PAI/USER/DA/` root, AND it registers that `<slug>` as `primary:` in the same `_registry.yaml` the backend parses. A path move that misses the registry link still leaves the reader looking in the wrong `<primary>` dir.

The decision (see Open decisions Q1) is *which* root wins. Assuming we unify on the backend's `PAI/USER/DA/<primary>/DA_IDENTITY.yaml` (it is the documented canonical, already read by both `module.ts` and `da-growth.ts`):

- Change `DAInterview.ts` to (a) resolve its `DA_DIR` to the same `PAI/USER/DA/` root the backend uses, (b) write the structured schema to `DA_IDENTITY.yaml` as pure YAML with no prose tail, so `YAML.parse` (`module.ts:119`) succeeds, and optionally still emit a readable `DA_IDENTITY.md` for the CLAUDE.md `@`-import as a *generated* companion, (c) write the `<slug>` as `primary:` into the registry the backend reads. Files: `LifeOS/install/LifeOS/TOOLS/DAInterview.ts`.
- Alternatively (Q1 = keep `DIGITAL_ASSISTANT`), point `module.ts` `DA_DIR` and `da-growth.ts` `DA_DIR` at `USER/DIGITAL_ASSISTANT/` and teach them to read frontmatter-in-`.md`. This touches the backend tree (`Releases/…`) and the growth engine, a larger blast radius, so it is the less-preferred option.
- Satisfies **R1, R2**.

**Verification (a parsed round-trip, not a file-exists check):** run `bun DAInterview.ts --depth deep` against a scratch HOME, then `curl -s localhost:31337/assistant/personality` and confirm `base_description`, `traits`, `companion`, and `relationship` reflect the interview answers rather than the synthesized defaults. The probe must prove the served JSON *parsed into the rendering contract* with the interview's values, not merely that a file was moved into place.

**Scope the visible win honestly:** after Phase 1 the identity, traits, base_description, companion, relationship, and autonomy sections populate. The "Formed Opinions" card stays empty by design, because it is fed by `da-growth` (phase-gated OFF) plus `DA_GROWTH_EXTRACT=1` (Phase 5 addresses it). Say this explicitly so a reader who runs Phase 1 and sees empty opinions does not conclude the fix failed.

### Phase 2 - Capture the under-captured fields in the interview

**Goal:** a deep interview fills every human-authored field the tab renders.

- Extend `DAInterview.ts` Phase 2/3: ask for `what_i_love` / `what_i_dislike` (comma lists), `working_style`, `intellectual_interests` (can reuse the "topics you care about" answer), and `writing.avoid` / `writing.prefer`. Add an optional "defining moments" prompt that seeds one or two `anchors`. Emit them into the `personality.preferences`, `personality.anchors`, and `writing` blocks. File: `DAInterview.ts` (`LifeOS/install/…`).
- Satisfies **R3** (except voice, Phase 4).

**Verification:** re-run the deep interview on a scratch HOME; `curl /assistant/personality` and confirm the four preference arrays and `anchors` are non-empty; load the tab and confirm the "What I Love / Dislike" and "Key Moments" sections render.

### Phase 3 - Reconcile the schemas (remove the foot-guns)

**Goal:** one trait schema, one opinions schema, no contradictory examples.

- Decide `_example/identity.md`'s fate (Open decisions Q2): either rewrite it to the numeric 12-trait `schema_version:1` shape so it teaches the real contract, or delete it and point users at a generated sample. File: `USER/DIGITAL_ASSISTANT/_example/identity.md`.
- Update `DaSubsystem.md §5b` so the opinions example uses `topic`/`position`/`confidence` (+ `source`/`evidence_count`/`first_observed`/`last_confirmed`) - matching what `da-growth.ts` actually writes and the frontend reads - rather than the stale `belief`/`confirmations`/`contradictions`. File: `DaSubsystem.md` (`Releases/…`).
- Satisfies **R4**.

**Verification:** grep `_example/identity.md` for a numeric trait and confirm no string-array traits remain; grep `DaSubsystem.md` opinions block for `position:` and confirm `belief:` is gone from the live-contract example.

### Phase 4 - Voice as identity

**Goal:** the interview offers a real ElevenLabs voice, so "the voice becomes identity."

- Add a voice-selection step to `DAInterview.ts` (present a small curated list of ElevenLabs public voice IDs, or accept a custom trained-voice id), writing `voice.main.voice_id`. Keep the bootstrap default honest (empty → backend serves `{provider}` only, never a fabricated id). File: `DAInterview.ts`.
- Satisfies the remainder of **R3** and G11.

**Verification:** run the interview picking a voice; `curl /assistant/personality` and confirm `voice.provider` is present and the identity YAML now carries a non-empty `voice_id`; optionally fire a `/notify` with that voice id and confirm it speaks.

### Phase 5 - Opinions data path and edit surface

**Goal:** the "Formed Opinions" card can show real data, and the principal can shape more than traits - without enabling the gated jobs.

- **Opinions:** make interview-seeded beliefs surface. Either write the deep-interview "topics you care about" into `opinions.yaml` (seed at the contract confidence) in addition to `growth.initial_beliefs`, so the card is non-empty before the growth engine ever runs; or document the observe-then-enable path (observe `da-diary` for a cycle, then the principal flips `da-growth` on + sets `DA_GROWTH_EXTRACT=1`). File: `DAInterview.ts` for seeding; doc note for the enable path. Satisfies **R5**.
- **Edit surface (Open decisions Q3):** decide whether to extend the PATCH contract beyond traits (e.g. `PATCH /assistant/personality` for base_description, preferences, writing) or to declare the interview the sole author of those fields. If extended, the same bounded/guardrail discipline as the trait PATCH applies, and the never-autonomous fields stay excluded. Satisfies **R6, R7**.
- **Phase-gate visibility (G16):** add a small indicator to the tab that growth is dormant vs running (reads the job `enabled` state). Non-blocking polish.

**Verification:** seed via interview → `curl /assistant/opinions` returns non-empty `raw` → the "Formed Opinions" card renders topics with confidence bars. If PATCH extended: `curl -X PATCH /assistant/personality -d '{...}'` returns ok and a re-GET reflects the change; confirm a name/voice/relationship field is rejected.

### Cross-cutting: preserve the guardrails (R7, R8) in every phase

No phase may (a) let the growth engine touch `core.name`, `core.full_name`, `voice.*`, or `relationship.dynamic`; (b) lower `directness`/`precision` autonomously; or (c) flip `da-heartbeat`, `da-scheduled-tasks`, or `da-growth` to `enabled=true`. The plan delivers the Personality tab with only `da-diary` running, exactly as shipped.

## Open decisions (for the principal)

1. **Which identity home wins - `PAI/USER/DA/<primary>/` (recommended) or `USER/DIGITAL_ASSISTANT/`?** Recommend `USER/DA/` because the backend (`module.ts`, `da-growth.ts`) AND the Releases-tree interview already use it - so converging means porting the install-tree interview to the version that already exists, not writing new code. Trade-off: the install tree ships `DIGITAL_ASSISTANT/` and a lagging `DAInterview.ts`; convergence must retire that fork or the two will re-diverge. (Correction from the cross-vendor audit: the earlier framing called this "a single-file change" as if the target code had to be written - it largely exists in the Releases tree; the work is convergence + retiring the divergence.)
2. **Rewrite or delete `_example/identity.md`?** Recommend rewrite to the numeric `schema_version:1` shape - a wrong example is worse than none because it teaches the string-array trap (G13). Delete only if a generated sample replaces it.
3. **Extend the edit surface beyond traits, or keep personality interview-authored?** Recommend interview-authored for now (smallest, preserves the single-author model), with a `PATCH /assistant/personality` as a later enhancement - the trait PATCH is the proven pattern to extend when it's wanted.
4. **Seed `opinions.yaml` from the interview, or wait for the growth engine?** Recommend seeding, so the "Formed Opinions" card isn't empty on day one and the principal sees the feature before opting into autonomous growth.

## Follow-ups and cross-references

- **Two-homes port obligation.** These changes target the fork trees (`LifeOS/install/…` for interview/frontend, `Releases/v5.0.0/.claude/…` for backend). The live `~/.claude` runs its own private copy that may be older; after building in the fork, re-apply or re-sync to live before it's real for this machine. (Same pattern the TELOS-page work hit - see `PROJECTS.md` open sessions.)
- **DaSubsystem.md is the system of record.** This plan does not restate its As-Built decisions (phase-gate, concurrency lock, consent gate, structural no-notify); it cross-references them. Read `DaSubsystem.md` "As-Built Decisions" before touching any of this.
- **Sibling surfaces.** Heartbeat, scheduled tasks, and diary mechanics are covered by `DaSubsystem.md §3-5` and are only touched here where they feed the Personality view (opinions, phase-gate visibility).
