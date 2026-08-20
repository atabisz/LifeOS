# LifeOS — feature and skill status

**Measured:** 2026-08-20 · **Platform:** win32

> **This document describes `~/.claude`, not the repository it sits in.** Every count below was
> measured against the live install at `~/.claude` (its own git repo, HEAD `291012f` at measurement
> time) — *not* against this LifeOS checkout. The two trees diverge: this repo ships no `hooks/`
> source at all, so the hook numbers here are unmeasurable from here. Run the commands from
> `~/.claude`, not from the directory containing this file.

Every number below prints the command that produced it. If you disagree with a row, run the command —
that settles it faster than reading further. If the commands now disagree with the numbers, this
document is stale and the commands are right.

## Why this document exists

Four surfaces already claim to answer "what works here", and they answer four different questions:

| Surface | What it actually tracks | Why it isn't this document |
|---|---|---|
| `LIFEOS/MEMORY/STATE/capabilities.json` | 4 external dependencies | Advisory cache, TTL'd, says so in its own `note` field |
| `LIFEOS/MEMORY/STATE/work.json` | 569 Algorithm runs | Per-run ledger, not a feature list |
| `LIFEOS/USER/PROJECTS/PROJECTS.md` | 3 active projects, narrative | `@`-imported prose; repeatedly caught carrying claims past their referent |
| `LIFEOS/TOOLS/FeatureRegistry.ts` | per-project feature rows | Right shape, **holds zero rows** — see below |

None of them can produce the third bucket ("mentioned but not built"), because each enumerates
things that exist. That bucket only appears when you compare documentation against the filesystem.

## How to read the three buckets

The buckets are separated by a stated rule, not by impression:

- **Complete** — the unit exists on disk **and** something reaches it from a live entry point, **and**
  a probe has exercised it. Present is not wired; wired is not working.
- **Requires work** — exists on disk, but at least one of: nothing reaches it, its declared
  dependency is absent, or it is unadjudicated (nobody has decided whether it should be live).
- **Mentioned but not built** — a document in this tree names a path, and that path does not exist
  under any reasonable resolution, in this tree.

Three things are deliberately **not** counted as gaps: documentation placeholders
(`{SkillName}`, `example-module`, `_MYSKILL`), macOS-only units on a win32 host, and references
inside retired doctrine files, which record what was true of their own era.

---

## Summary

| Surface | On disk | Wired / valid | Gap | Instrument |
|---|---|---|---|---|
| Skills (`SKILL.md`) | 87 | 83 validated | 4 = NTFS junctions | `IntegrityCheck.ts` + `census` |
| Hooks | 90 | **45 wired** | 45 orphaned, of which **15 unadjudicated** | `WiringDriftLinter.ts` |
| Pulse modules | 34 | 16 referenced, **2 enabled** | 18 orphaned | `census` + `PULSE.toml` |
| Tools (`LIFEOS/TOOLS/*.ts`) | 205 (8 tests) | — | test coverage ~4% of tools | `census` |
| Slash commands | 8 | 8 | 0 | `IntegrityCheck.ts` |
| Agents | 22 | 22 | 0 | `IntegrityCheck.ts` |
| Skill workflows (files) | 283 | 278 | 5 orphaned — *file exists, doc ignores it* | `IntegrityCheck.ts` |
| Skill workflows (advertised) | 134 rows | 128 built | 5 advertised and absent + 1 placeholder — *the inverse of the row above, and untracked* | `census-advertised-workflows` |
| Documentation (`.md`) | 64 | — | 67 docs carry ≥1 dead path | `census` + `resolve-honest` |
| External capabilities | 4 tracked | 3 live | 1 broken (`cloudflare`) — **and `fabric` is live but untracked**, see below | `capabilities.json` |
| Subsystems (`LIFEOS/<NAME>/`) | 8 assessed | 5 present, 1 external-and-working | 1 tree-absent (`ARBOL`), 1 absent-by-design (`BUNKER`) | in-tree probe + binary probe |
| Feature registry rows | 1 registry | **0 features** | the tool tracks nothing | `FeatureRegistry.ts list lifeos` |

`Doctor.ts` writes `capabilities.json` and probes exactly four capabilities: `codex`, `interceptor`,
`cloudflare`, `voice`. **`fabric` is not among them** — which is why nothing in the tree contradicted
this document when it wrongly called Fabric absent. A live, configured, 254-pattern external
dependency has no health probe, so its state is whatever the last person to look asserted. That is the
same failure shape as the `cloudflare` row, inverted: `cloudflare` is tracked and broken, `fabric` is
working and invisible. Adding a `fabric` probe to `Doctor.ts` is the cheap structural fix and is **not
done here** — `Doctor.ts` is a governed surface and the probe needs the `</dev/null` guard from Bias 4
or it will hang the doctor.

---

## Complete

These are wired and exercised. Each row names the evidence, not just the file.

### Core loop

- **Algorithm v8.18.0** — `LIFEOS/ALGORITHM/LATEST` reads `8.18.0`; the version file is present and
  is the doctrine actually loaded. 569 ISAs exist under `MEMORY/WORK/`, 514 at `phase: complete`.
- **ISA lifecycle** — `hooks/ISASync.hook.ts` is registered and mirrors to `MEMORY/STATE/work.json`;
  569 of 619 work directories carry an `ISA.md`.
- **Hook dispatch** — 45 of 90 hooks are reached from a live entry point, including by import
  composition (`hooks/MemoryTurnStart.hook.ts:23` imports `MemoryDeltaSurface.hook`), not only by
  `settings.json` registration.
- **Memory pipeline** — `MEMORY/KNOWLEDGE/`, `MEMORY/LEARNING/`, `MEMORY/OBSERVABILITY/` all present
  and written; `LEARNING/REFLECTIONS/algorithm-reflections.jsonl` holds 277 entries, `--check` 277/0
  unparseable.
- **Slash commands (8) and agents (22)** — all validate. Both trees are filesystem-enumerated, so
  writing the file *is* the registration; there is no separate wiring step to be missing.

### Skills

87 `SKILL.md` units: 64 top-level, 23 nested. 67 carry a `Workflows/` directory, 18 carry `Tools/`.
`IntegrityCheck` validates 83 — the 4-unit delta is fully accounted for and is not a defect:

```
cmd //c "dir /AL /S skills"     # 4 NTFS junctions -> C:\src\Interceptor\.agents\skills\
```

`interceptor-browser`, `interceptor-ios`, `interceptor-macos`, `interceptor-research` are junctions
into another repo. `find` does not traverse them; `readdirSync` + `statSync` does. Two instruments
disagreeing by exactly 4 was the junction count, not a missing skill.

### External capabilities — 3 of 4 live

```
bun LIFEOS/TOOLS/Doctor.ts        # writes MEMORY/STATE/capabilities.json
```

| Capability | State | Detail |
|---|---|---|
| `codex` | live | binary present, auth file present |
| `interceptor` | live | skill present, browser found (`msedge.exe`) |
| `voice` | live | piper local: binary + `en_US-amy-medium.onnx` present |
| `cloudflare` | broken | "not set up on this machine" |

`interceptor` read `broken` for weeks and was false — the probe only looked for Chrome and Brave, so
an Edge-only host reported a working install as broken. Fixed 2026-08-20 (`21b50cd`). Worth
remembering when reading any capability row: a `broken` state can be a broken *prober*.

---

## Requires work

### Hooks — 45 orphaned, but only 15 are actually open

```
bun LIFEOS/TOOLS/WiringDriftLinter.ts     # read-only; exit 1 only on undeclared drift
```

`on disk: 90 | wired: 45 | orphaned: 45`. The 45 orphans are not 45 problems — 30 carry a recorded
disposition explaining why they are off:

| Disposition | Count | Meaning |
|---|---|---|
| `defer` | 9 | semantics unclear or rarely fires |
| `needs-user-decision` | 6 | blocking guards and dispatchers; session-breaking risk if wired blind |
| `platform-no-op` | 5 | kitty-terminal and exec-bit hooks — inapplicable on win32 |
| `superseded` | 4 | a registered hook already does the job; wiring would double-fire |
| `dispatch-child` | 4 | dispatched by a parent that is itself unwired |
| `unsafe` | 2 | known to break something if adopted |
| **undeclared drift** | **15** | **on disk, unwired, nobody has decided** |

The 15 unadjudicated hooks — this is the actionable list:

```
AtlasEventCapture · BashSystemWriteGuard · ComplexityRatchet · ConfigEvalFire
DeployRegistrationGate · ISACloseGate · ISAFoldGate · ISAStaleWriteGuard
KnowledgeWriteGuard · ModelRungGuard · PublicPushGate · SystemChangeSurface
TimeContext · VersionDrift · VoiceEgressGuard
```

Several are guards whose absence is a silent gap rather than a visible one — `PublicPushGate`,
`VoiceEgressGuard`, `KnowledgeWriteGuard` and `BashSystemWriteGuard` all read as safety rails that
exist as files and enforce nothing. Triage is one line each: add to `DISPOSITIONS` in
`WiringDriftLinter.ts`, or register in `settings.json`.

Two orphans are worth naming individually because their reason is a live defect, not a preference:

- `hooks/FileChanged.hook.ts` — **exits 1** reading `/dev/stdin` on Windows. Source fix needed.
- `hooks/SystemFileGuard.hook.ts` — `loadPatterns()` returns 0 patterns because its `DENY_LIST.txt`
  producer is absent, so even if wired it could not block anything.

### Pulse — 34 modules, 2 enabled

```
bun LIFEOS/MEMORY/WORK/20260820-lifeos-feature-status-doc/census.ts
sed -n '/^\[modules\]/,/^\[/p' LIFEOS/PULSE/PULSE.toml
```

Three different numbers, and the gap between them is the finding:

- **34** module files exist on disk.
- **16** are referenced from outside `modules/` (`books`, `content`, `hooks`, `imessage`, `ledger`,
  `memory`, `menubar`, `projects`, `shows`, `syslog`, `tab-freshness`, `telegram`, `usage`,
  `user-index`, `wiki`, `work`).
- **2** are enabled in `PULSE.toml [modules]`: `hooks = true`, `observability = true`.

18 modules are referenced by nothing outside `modules/`:

```
algorithm-tab · amber · assets · atlas · bunker · conduit · doctor · evals
example-module · hermes · hypotheses · local-intelligence · scheduled · siri
synapse · telos · threatmodel · upgrades
```

`example-module` is a template and should stay orphaned. The rest split into two kinds: modules whose
subsystem is absent from this tree (`bunker`, `conduit` has a directory but no module reference,
`atlas`, `hermes`), and modules whose subsystem is present but unreferenced (`telos`, `evals`,
`doctor`, `upgrades`) — those are the cheap wins.

Pulse is not watch-mode; a module edit needs a restart before any probe means anything.

### Test coverage

8 `*.test.ts` files against 205 tools. `LIFEOS/DOCUMENTATION/Testing/TestingDoctrine.md` describes a
harness at `test/harness.ts` and a `bunfig.toml` — **neither exists**, so the documented testing
posture is aspirational. This is the largest single gap between what the docs describe and what runs.

### Feature registry holds nothing

```
bun LIFEOS/TOOLS/FeatureRegistry.ts list lifeos     # Progress: 0/0 passing
```

The `lifeos` registry is initialized and empty. Until `291012f` it reported a *pass* over that empty
set, which is the failure mode this whole document is designed against: a green verdict over zero
measurements. The tool is now honest about the empty set — it just has no rows.

### Stranded Algorithm runs

32 ISAs sit at `phase: verify` and 6 at `phase: observe` — runs that reached verification and never
closed. 8 carry no phase at all, and 5 use non-canonical casing (`VERIFY`, `COMPLETE`, `done`).

```
bun LIFEOS/MEMORY/WORK/20260820-lifeos-feature-status-doc/census.ts   # ISA CORPUS section
```

### Documentation drift — 67 live docs carry a dead path

**Read the funnel, not the headline.** `IntegrityCheck` reports 962 missing references. That number
is not a feature count and should never be quoted as one:

| Stage | Count | Why dropped |
|---|---|---|
| Raw `missing:` findings | 962 | — |
| − gitignored `MEMORY/WORK/` scratch | −605 | machine-local run notes, not documentation |
| − relative TS import specifiers | −52 | `./x` in a code block is an import, not a doc ref |
| − naming file is not markdown | −3 | not a document |
| − resolver artifacts | −33 | DocCheck resolves from the config root; `Workflows/RunScenario.md` in a skill doc means *sibling*, and it exists |
| − documentation placeholders | −3 | `{SkillName}`-class examples |
| − retired doctrine + transcripts | −69 | 25 `ALGORITHM/v6.*.md` files and 10 captured prompt transcripts record their own era |
| **Real gaps** | **197 findings / 160 distinct paths / 67 docs** | a live doc names a path absent under every resolution |

```
bun LIFEOS/MEMORY/WORK/20260820-lifeos-feature-status-doc/resolve-honest.ts
```

That script carries its own positive and negative controls and refuses to print numbers if they fail —
worth keeping, because the first two versions of this analysis were both wrong in the same direction.

Largest offenders among live docs: `skills/Media/Remotion/CriticalRules.md` (28),
`DOCUMENTATION/Work/WorkSystem.md` (17), `DOCUMENTATION/Memory/CurationCoverage.md` (14),
`DOCUMENTATION/Testing/TestingDoctrine.md` (10).

Note that `CurationCoverage.md`'s 14 are a **path-shape** mismatch, not absent features: it describes
the nested `USER/PRINCIPAL/`, `USER/DIGITAL_ASSISTANT/` layout, while this install is biography-flat
(`USER/PRINCIPAL_IDENTITY.md`, `USER/DA_IDENTITY.md`). The content exists; the doc points at the old
shape. Same for `skills/Daemon/Docs/SecurityClassification.md`, whose 4 refs still carry the
pre-rename `PAI/` prefix.

---

## Mentioned but not built

Every entry below was confirmed by direct existence probe in this tree, not inferred from a
reference count.

### Absent subsystems

> **Corrected 2026-08-21.** The first version of this table asked one question of every row —
> `[ -e "LIFEOS/<NAME>" ]`. That is the right question for a subsystem that lives *in* the tree and the
> wrong question for one installed *outside* it, so it reported **FABRIC** as absent when Fabric is
> installed and executing. Two adjacent claims were wrong for the same reason. The in-tree probe is
> kept below because it is still the correct test for ARBOL — but it is now one instrument of three,
> not the only one.

```
# 1. does the tree carry it?          — correct for ARBOL, meaningless for FABRIC
[ -e "LIFEOS/ARBOL" ]                    # absent
# 2. is a binary installed and does it run?
command -v fabric                        # ~/.local/bin/fabric  (+ fabric.exe, 74 MB, winget)
fabric --version </dev/null              # 1.4.455        <- </dev/null required: fabric blocks on stdin
fabric -l </dev/null | wc -l             # 254 patterns, enumerated by fabric's own runtime
fabric -L </dev/null                     # model list incl. Bedrock -> provider config works
ls ~/.config/fabric                      # .env contexts extensions patterns sessions strategies
# 3. does any doc actually assert the in-tree path the probe tested?
rg -n "LIFEOS/FABRIC" .                  # 0 files   <- the probe invented the path it then failed
rg -n "LIFEOS/ARBOL"  .                  # 5 files + hooks/lib/containment-zones.ts:65
```

| Subsystem | Status | Evidence |
|---|---|---|
| **ARBOL** (cloud execution) | **tree absent** | `LIFEOS/ARBOL/` genuinely absent, and 5 docs plus `hooks/lib/containment-zones.ts:65` name paths under it. `DOCUMENTATION/Tools/Cli.md` names 3 files under it. The one row here whose in-tree probe was the right test. |
| **BUNKER** | **partly built** | Not absent: `PULSE/modules/bunker.ts`, `PULSE/bunker.config.ts`, `HERMES/bunker.config.ts`, `DOCUMENTATION/Bunker/BunkerSystem.md` and an Observability `/bunker` page all exist. Absent: `PULSE/Bunker/` and `bin/bunker.ts` — and `BunkerSystem.md:14` states those are private infrastructure held out of the release payload *by design*. Absent-on-purpose, not unbuilt. |
| **FABRIC** | **installed and working — v1.4.455** | Binary on PATH at `~/.local/bin/fabric` (+`.exe`, dated Jul 4), installed via winget as `danielmiessler.Fabric`. 254 patterns enumerated by fabric itself; `~/.config/fabric/` holds `.env`, contexts, extensions, patterns, sessions, strategies; `fabric -L` returns a model list, so provider config resolves. `skills/Fabric/` carries SKILL.md + Patterns/ + Workflows/. It installs outside the tree by design — `FabricSystem.md` never claims an in-tree `LIFEOS/FABRIC/`. |
| ATLAS | present | `DOCUMENTATION/Atlas/AtlasSystem.md`; `LIFEOS/ATLAS/` has 7 entries |
| FLOWS | present | `LIFEOS/FLOWS.md` (its `flow-index.json` and `flow-state.json` are absent) |
| RULES | present | `LIFEOS/RULES/` — 4 doctrine files |
| Pulse Conduit | present | `DOCUMENTATION/Conduit/ConduitSystem.md` (its `USER/CONDUIT/config.json` is absent) |
| Pulse Assistant | present | `DOCUMENTATION/Pulse/PulseSystem.md`; serves the DA Personality tab |

The asymmetry this section used to assert — *"`CLAUDE.md` advertises Arbol and Fabric as loadable
subsystems; a routing entry pointing at an absent tree reads as a capability"* — **does not hold, and
was a third instance of the same error.** Both routing rows point at a **doc**, not a tree, and both
docs resolve: `CLAUDE.md:114` → `DOCUMENTATION/Arbol/ArbolSystem.md`, `CLAUDE.md:116` →
`DOCUMENTATION/Fabric/FabricSystem.md`. For Fabric the entry is simply correct. For Arbol the gap is
one level deeper than the routing table — the doc resolves and *its* contents name an absent tree — so
the fix belongs in `ArbolSystem.md`, not in `CLAUDE.md`.

**One real Fabric gap, found while checking the false one:** the pattern mirror has drifted.
`~/.config/fabric/patterns/` holds 256 entries and fabric's runtime enumerates 254, while the
in-tree mirror `skills/Fabric/Patterns/` holds **237** — roughly 17 behind. `FabricSystem.md:18` also
advertises "240+ patterns" at the mirror, which the mirror no longer meets. The sync command is
already documented at `FabricSystem.md:82` (`fabric -U && rsync -av ~/.config/fabric/patterns/
~/.claude/skills/Fabric/Patterns/`); it just has not been run lately. Not fixed here — running it
rewrites 19-ish tracked files and that is a separate change.

### The Work / ULWork subsystem — documented in full, built not at all

`LIFEOS/DOCUMENTATION/Work/WorkSystem.md` describes a complete subsystem. 17 of the paths it names
are absent, including every executable one:

```
hooks/ULWorkSync.hook.ts          skills/_ULWORK/SKILL.md
skills/_ULWORK/Tools/RegenerateTasklist.ts    skills/_ULWORK/Tools/BootstrapLabels.ts
skills/_ULWORK/Tools/SetWorkRepo.ts
USER/WORK/config.yaml   USER/WORK/labels.yml   USER/WORK/work_repo.json   USER/WORK/CLAUDE.md
MEMORY/STATE/reminder-router-seen.json         MEMORY/STATE/com.lifeos.worksweep.log
```

`LIFEOS/USER/WORK/` does exist, but holds unrelated content (`expenses.md`, `MY_ORG`, `Talks`,
sample directories). This connects to a live orphan: `hooks/ReminderRouter.hook.ts` is fail-closed
OFF precisely because its `work_repo.json` producer is one of these absent files — wiring it would
buy outward GitHub actuation the moment that file appears.

### Private skill families — zero of them exist

```
ls -d skills/_* 2>/dev/null | wc -l      # 0
```

The documentation refers to `skills/_PAI/`, `skills/_LIFEOS/`, `skills/_SYSTEM/`, `skills/_PERSONAL/`,
`skills/_ULWORK/`, `skills/_INCIDENT_RESPONSE/`, `skills/_X/`, `skills/_WRITING/`, `skills/_HARVEST/`
and `skills/_CLOUDFLARE/`. **The measured count of `_`-prefixed skills in this install is 0.** The
whole family is phantom here. Named by: `LifeosSystemArchitecture.md`, `SystemUserBoundary.md`,
`DOCUMENTATION/Config/ConfigSystem.md`, `DOCUMENTATION/Tools/Containment.md`,
`DOCUMENTATION/Ledger/LedgerSystem.md`, `DOCUMENTATION/Amber/AmberSystem.md`,
`DOCUMENTATION/Writing/AIWritingPatterns.md`, `ALGORITHM/v8.18.0.md`, `skills/Fabric/`, `skills/Art/`.

Two consequences already observed: `ShadowRelease.ts` is referenced from four separate docs at three
different `_`-prefixed paths and exists at none of them; and `LIFEOS/ATLAS/collectors/Secrets.ts`
calls `Tools/GenerateRegistry.ts` and `Tools/DetectCriticalKeys.ts` under
`skills/_INCIDENT_RESPONSE/`, so that collector could not run even if ATLAS were enabled.

### Skill content shipped as an index with no contents

- **`skills/Media/Remotion/rules/`** — `CriticalRules.md` is an index to 28 rule files
  (`rules/3d.md`, `rules/animations.md`, … `rules/videos.md`). The directory does not exist. The
  index is the largest single dead-reference cluster in the tree.
- **`skills/Media/Remotion/Tools/`** — `Ref-text-animations.md` and `Ref-charts.md` point at
  `assets/*.tsx` component files that are absent.
- **`skills/Parser/Workflows/extract/`** — `ParseContent.md` routes to `Workflows/extract/Youtube.md`,
  `/Article.md`, `/Pdf.md`, `/Newsletter.md`, `/Twitter.md`. The `extract/` subdirectory does not
  exist — but flat equivalents do (`ExtractYoutube.md`, `ExtractArticle.md`, `ExtractPdf.md`,
  `ExtractNewsletter.md`, `ExtractTwitter.md`). **This one is a routing-table rename, not missing
  content**; fixing `ParseContent.md` costs six line edits.
- **`skills/Scraping/Apify/`** — `INTEGRATION.md` and `README.md` reference a whole absent
  `filesystem-mcps/` tree (4 files) plus `skills/social/SKILL.md`.
- **`skills/Research/MigrationNotes.md`** — names 4 `commands/perform-*-research.md` slash commands
  and `Workflows/PerplexityResearch.md`, none present. Consistent with a migration that removed the
  commands and left the note.

### Workflows a skill advertises and does not have

A `SKILL.md` routing table is an advertisement. Nothing in the tree checks it in the direction that
matters here — see Bias 3 below — so this section is measured by its own census:

```
bun LIFEOS/MEMORY/WORK/20260820-lifeos-feature-status-doc/census-advertised-workflows.ts
```

87 `SKILL.md` units, 50 with a parseable routing table, 37 with none. 134 distinct
(skill, workflow) pairs. Three shapes, and they differ in whether any instrument *could* see them:

| Shape | Count | Detectable by a path checker? |
|---|---|---|
| Path given, file exists | 116 | — built |
| **Path given, file missing** | **2** | yes |
| **Named in a row with no path** | **16** | **no — structurally invisible** |

Of the 16 nameless rows, 12 are built anyway — the doc just omits the path (`AustMetrics`,
`USMetrics`, `Council`, `RedTeam` and the two nested `Thinking/` copies, 2 each). That is a
documentation nit, not a gap. **4 are genuinely unbuilt, and all 4 are in one skill:**

- **`skills/Hardening/`** — `Workflows/PropertyTest.md` is the only file present. The routing table
  names `MutationTest`, `CrapAnalysis`, `DryAnalysis` and `AcceptanceTestMutation`, each marked
  `— planned, not yet built (stub; see Status)`, and a `## Status` table gives each one a blocker
  (Stryker integration, an AST walker, a jscpd wrapper, an ISC-text perturbation generator). This is
  the *best-documented* gap in the tree: the skill declares it in two places and the frontmatter's
  `USE WHEN` list is the only thing that overstates it.

The 2 path-given-but-missing rows split one placeholder from one real defect:

- `skills/CreateSkill/SKILL.md:280` names `Workflows/WorkflowName.md` — a template placeholder in a
  skill-authoring example. Correctly not a feature.
- **`skills/PAIUpgrade/Workflows/TwitterBookmarks.md` is absent, and this one is worse than
  Hardening's four.** The other five workflows its frontmatter advertises are all present. This one
  is named in the routing table (`SKILL.md:52`), in the frontmatter `description`, and behind six
  `USE WHEN` triggers — "check bookmarks", "scan bookmarks", "twitter bookmarks", "X bookmarks",
  "bookmarks for upgrades", "what have I bookmarked" — with no `planned` marker anywhere. So a prompt
  asking to scan bookmarks activates the skill and routes to a file that does not exist. The inversion
  is worth stating plainly: the declared stubs are safe, and the undeclared one is the live hazard.

### Absent observability sinks

Several documented telemetry files have no producer in this tree:

```
MEMORY/OBSERVABILITY/mode-classifier.jsonl      (HookSystem.md, 25 retired doctrine files)
MEMORY/OBSERVABILITY/escalation-gate.jsonl      (ALGORITHM v6.0.0, v6.1.0)
MEMORY/OBSERVABILITY/effort-router.jsonl        (DOCUMENTATION/Router/RouterSystem.md)
MEMORY/OBSERVABILITY/intelligence-routing.jsonl (DOCUMENTATION/Router/RouterSystem.md)
MEMORY/OBSERVABILITY/capture-guard.jsonl        (RULES/Verification.md, RULES/VerificationExpanded.md)
MEMORY/SIGNALS/ratings.jsonl                    (THEHOOKSYSTEM.md)
MEMORY/STATE/agent-sessions.json                (HookSystem.md, THEHOOKSYSTEM.md)
MEMORY/STATE/atlas-insights.json                (Atlas/AtlasSystem.md)
MEMORY/STATE/kitty-env.json                     (HookSystem.md — kitty is absent, so correctly absent)
```

`effort-router.jsonl` and `intelligence-routing.jsonl` matter more than the others:
`RouterSystem.md` is a current doc, and effort routing is a live doctrine concern — the E1–E5 tiers
were retired at v8.18.0, so this may be a doc that outlived its subsystem rather than a missing sink.
Worth one check before either wiring or deleting.

---

## Instruments — and where they lie

If you re-measure, use these. Four carry known biases that will mislead you, and the fourth is this
document's own probe.

| Instrument | Command | Use it for |
|---|---|---|
| WiringDriftLinter | `bun LIFEOS/TOOLS/WiringDriftLinter.ts` | **hook wiring — this is the authority** |
| IntegrityCheck | `bun LIFEOS/TOOLS/IntegrityCheck.ts --json` | skills, commands, agents, workflows, ISA phases |
| Doctor | `bun LIFEOS/TOOLS/Doctor.ts` | external capabilities |
| DocCheck | `bun LIFEOS/TOOLS/DocCheck.ts` | doc reference freshness |
| SkillHygieneGate | `bun LIFEOS/TOOLS/SkillHygieneGate.ts` | skill structure (exit 0 clean / 1 violations / 2 scan error) |
| census / resolve-honest / census-advertised-workflows | under `MEMORY/WORK/20260820-lifeos-feature-status-doc/` | the numbers in this document (the third covers advertised-vs-built workflows, which no shipped tool measures) |

**Bias 1 — `IntegrityCheck`'s hook_registration count over-reports dormancy.**
`LIFEOS/TOOLS/IntegrityCheck.ts:237` reads only `settings.json`. Any hook composed by import from a
registered dispatcher reads as unregistered. It reported `MemoryDeltaSurface.hook.ts` as dormant
while that hook was supplying the current session's memory line — registration is not the only
wiring path. Its counts: 42 wired / 48 unregistered. The linter's, resolving composition: 45 / 45.
**Use the linter.**

**Bias 2 — `IntegrityCheck`'s `references` check text-matches path-like tokens.**
Its 962 "missing" rows reduce to 197 real gaps once scratch, import specifiers, resolver artifacts,
placeholders and retired doctrine come out — a 4.9× over-report. The full funnel is in the
documentation-drift section above.

**Bias 3 — the `workflows` check runs in only one direction, so half the question has no
instrument.** `LIFEOS/TOOLS/IntegrityCheck.ts:364` loops over `wfFiles` — the workflow files that
exist — and asks whether each skill's `SKILL.md` mentions it. That finds orphans (a file nothing
routes to) and it is the only loop in the check: there is no pass over the routing table asking
whether each advertised workflow exists. The consequence is not that the reverse direction is
under-reported, it is that it is unmeasured. Probed against the four Hardening stubs, every candidate
instrument returns nothing:

| Instrument | What it checks | Sees a missing advertised workflow? |
|---|---|---|
| `IntegrityCheck` check 6 `workflows` | file → is it referenced? | no — wrong direction (`:364`) |
| `IntegrityCheck` `references` / `DocCheck` | doc → does the path resolve? | **only if the row gives a path.** It did catch `TwitterBookmarks`; `MutationTest` is a bare word, so 0 hits |
| `FeatureRegistry.ts` | declared features | no — `list lifeos` reports `0/0`, nothing is registered |
| `capabilities.json` | external tools | no — 4 coarse rows, no skill granularity |
| `SkillDriftLint.ts` | coercive prose in skill docs | no — regex patterns on rhetoric |
| `SkillHygieneGate.ts` | identity strings, home paths, vendored deps | no — release cleanliness |
| `WiringDriftLinter.ts` | hook reachability | no — hooks only |
| **`skills/Hardening/SKILL.md` § Status** | four stubs and their blockers | **yes — and it is the only tracker in the tree** |

That last row is the real finding. The one place this class is tracked is a hand-written table inside
the single skill that happens to declare it, and nothing aggregates it: a grep for stub vocabulary
across all 87 `SKILL.md` files returns 3 files, and the two that are not Hardening are unrelated prose
(`Trim` describing a refactor move, `Interceptor` describing a Windows API stub). So the honest answer
to "are we tracking these" is: **Hardening tracks its own, by hand, and nothing tracks anyone else's.**

**Bias 4 — this document's own subsystem probe asked one question and treated it as the whole
question.** `[ -e "LIFEOS/<NAME>" ]` tests in-tree presence. Applied to a row set built by analogy
(`ARBOL`, `BUNKER`, `FABRIC`, …) it invented `LIFEOS/FABRIC` — a path **no file in the tree asserts**
— and then reported the invented obligation unmet, publishing `FABRIC | absent` while `fabric`
v1.4.455 sat on PATH serving 254 patterns. The tell was available and unasked: *does any document
claim this path?* `rg "LIFEOS/FABRIC"` returns 0 files; `rg "LIFEOS/ARBOL"` returns 5 plus a
containment zone. Same probe, same shape, opposite meaning.

Two second-order traps came out of chasing it, both worth carrying:

- **`rg -rn` is not `rg -n`.** `-r` is `--replace`, so `-rn` silently means "replace each match with
  the string `n`". The Arbol hits printed as `~/.claude/n/Actions`, which reads as a *different real
  path* rather than as mangled output — I nearly concluded Arbol lived at `~/.claude/n/` on that
  evidence. A zero from a broken search and a zero from an empty tree are indistinguishable without a
  positive control, so every search backing a row here now runs one.
- **`fabric` blocks on stdin.** `fabric --version` hangs to timeout and exits 143, which reads as a
  broken binary. `fabric --version </dev/null` returns `1.4.455` immediately.

The pattern across all four biases is one thing: **every instrument in this section over-reported
brokenness, and none under-reported it.** Bias 1 called live hooks dormant, Bias 2 inflated real gaps
4.9×, Bias 3 measured a direction and left the other unmeasured, Bias 4 failed a path it had made up.
When a row in this document says "absent" or "broken", the first suspect is the instrument.

## Maintaining this document

It will go stale, and that is expected. What it must not do is go stale *invisibly* — which is why
every number here prints its command and the header states the HEAD it was measured at. Two habits
keep it honest:

1. **Re-measure, never edit a number to match a memory.** If a count changed, the command output is
   the new value and the old one was a fact about a different tree.
2. **Do not promote this file to an `@`-imported context file.** It lives outside
   `LIFEOS/DOCUMENTATION/`, so `DocIntegrity.hook.ts` does not police it and it creates no standing
   freshness obligation. That is deliberate — the four surfaces in the opening table all decayed
   partly because something loaded them automatically and nobody re-derived them.
