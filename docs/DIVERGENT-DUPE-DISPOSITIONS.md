# Divergent-duplicate dispositions

> Decided 2026-07-28. Companion to `MEMORY/WORK/resolve-divergent-dupes/ISA.md`.
> Governs `scripts/upstream-apply.ts`'s 293-file additive plan against live `~/.claude`.

`upstream-apply` is additive-only: it refuses to overwrite. That reads as a safety property and is
not one. Where the payload and live disagree about *where* a file lives, landing it overwrites
nothing — it creates a second, divergent copy at a path nothing reads, while the copy live actually
reads keeps its own content. Two sources of truth, silently, in doctrine files.

This file records what happens to each such row and why.

## Closing the set

The first census keyed on basename and filed 30 rows as undecidable whenever a payload path had
more than one same-named live file — `page.tsx` had 30 candidates, `README.md` had 158. Re-keyed on
the **path tail** (a relocated module keeps its last two segments; a coincidence does not), with a
best-overlap sweep across all same-basename candidates as a second, independent signal.

Result: **2 of the 30 promote to divergent** — `LIFEOS/TOOLS/llcli/package.json` (100% overlap,
byte-identical to `LIFEOS/bin/llcli/package.json`) and `LIFEOS/TOOLS/llcli/README.md` (97%). Both
were invisible to basename keying. The other 28 are genuinely new: the 12 `page.tsx` routes top out
at 12% overlap against their nearest same-named live file, and the 3 remaining tail-2 hits
(`hooks/hooks.json` vs 6 vendored plugin manifests; `memory/graph/page.tsx` vs
`knowledge|system/graph/page.tsx`) are coincidences of directory naming, not relocations.

**Divergent set closed at 12.**

## The four refactors

The 12 rows are not 12 problems. They are four upstream restructures that an additive channel with
no concept of a rename flattens into orphan file adds:

| refactor | live path | payload path | rows |
|----------|-----------|--------------|------|
| agent-context consolidation | `skills/Agents/*Context.md` | `agents/*Context.md` | 6 |
| llcli relocation | `LIFEOS/bin/llcli/` | `LIFEOS/TOOLS/llcli/` | 4 |
| ISA doc nesting | `LIFEOS/DOCUMENTATION/IsaFormat.md` | `LIFEOS/DOCUMENTATION/Isa/IsaFormat.md` | 1 |
| user-template rename | `LIFEOS/TEMPLATES/User/` | `LIFEOS/USER_TEMPLATES/` | 1 |

## Landability, probed first

Live consumers referencing the **payload** path, counted with `rg -l` over live `~/.claude`
(excluding `MEMORY/`, `projects/`, `sessions/`, `node_modules/`, `.git/`, `history/`, `out/`):

| payload path fragment | live consumers | live-path consumers |
|-----------------------|----------------|---------------------|
| `TOOLS/llcli` | **0** | `Bin/llcli` → 5 |
| `DOCUMENTATION/Isa/IsaFormat` | **0** | `DOCUMENTATION/IsaFormat` → 20+ |
| `USER_TEMPLATES` | **0** | `TEMPLATES/User` → 3 |
| `agents/*Context.md` (in `agents/`) | **0** | `skills/Agents/` → 13 |

Nothing in live reads any of the four payload locations. **`land-as-is` is unavailable for all 12
rows** — decided before content was considered, because a file nothing reads is inert regardless of
how good it is.

The live agent definitions pin the old path explicitly: `agents/Forge.md:74` reads
`~/.claude/skills/Agents/ForgeContext.md`, and 9 more definitions do the same, plus
`skills/Agents/Tools/LoadAgentContext.ts`. Upstream's own `agents/Forge.md:79` reads
`~/.claude/agents/ForgeContext.md` — but that definition is `skip-exists`, so it never lands.
Landing the context files without it leaves them unreferenced by construction.

## Capability probes — why "newer" lost

The payload's agent-context files are not just rebranded; they carry real content changes. Those
changes were probe-tested against the installed toolchain (`codex-cli 0.142.5`) rather than assumed:

```
$ codex exec --model gpt-5.6-sol  --sandbox read-only "reply with the single word OK"
warning: Model metadata for `gpt-5.6-sol` not found. Defaulting to fallback metadata
ERROR: 400 invalid_request_error: The 'gpt-5.6-sol' model requires a newer version of Codex.

$ codex exec --model gpt-5.6-luna --sandbox read-only "say OK"
ERROR: 400 invalid_request_error: The 'gpt-5.6-luna' model requires a newer version of Codex.

$ codex exec --model gpt-5.5      --sandbox read-only "reply with the single word OK"   # CONTROL
OK
```

The control matters: without it, a 400 could be my probe rather than the model. `gpt-5.5` — the
string live's ForgeContext documents — resolves. Both payload strings 400.

`GrokResearcherContext.md`'s new "PRIMARY TOOL — Grok.ts" section instructs the agent to call
`bun ~/.claude/LIFEOS/TOOLS/Grok.ts` **first** on any research task, reading `GROK_API_KEY` from
`~/.claude/.env`. `Grok.ts` does not exist in live (it is itself one of the 293 adds), and
`GROK_API_KEY` is absent from live `.env`.

So porting either "upgrade" would put instructions into live doctrine that fail on this machine —
a documented capability that does not resolve is worse than no documentation.

## Dispositions

| # | payload path | live twin | overlap | disposition | reason |
|---|--------------|-----------|---------|-------------|--------|
| 1 | `agents/ForgeContext.md` | `skills/Agents/ForgeContext.md` | 86% | **drop-add** | lands unread; its only substantive change is `gpt-5.6-sol`, which 400s here |
| 2 | `agents/CodexResearcherContext.md` | `skills/Agents/…` | 81% | **drop-add** | same; documents `gpt-5.6-sol`/`gpt-5.6-luna`, both 400 |
| 3 | `agents/GrokResearcherContext.md` | `skills/Agents/…` | 95% | **drop-add** | lands unread; its new PRIMARY TOOL needs `Grok.ts` + `GROK_API_KEY`, neither present |
| 4 | `agents/ClaudeResearcherContext.md` | `skills/Agents/…` | 94% | **drop-add** | lands unread; 8 changed lines, all rebranding + `{{DA_NAME}}` placeholders |
| 5 | `agents/GeminiResearcherContext.md` | `skills/Agents/…` | 95% | **drop-add** | as above |
| 6 | `agents/PerplexityResearcherContext.md` | `skills/Agents/…` | 95% | **drop-add** | as above |
| 7 | `LIFEOS/TOOLS/llcli/llcli.ts` | `LIFEOS/bin/llcli/llcli.ts` | 99% | **port-content** | carries a real `$HOME`-expansion fix (upstream #1404 / PR #1451) live lacks |
| 8 | `LIFEOS/TOOLS/llcli/package.json` | `LIFEOS/bin/llcli/package.json` | 100% | **drop-add** | byte-identical to live; the add is pure relocation |
| 9 | `LIFEOS/TOOLS/llcli/README.md` | `LIFEOS/bin/llcli/README.md` | 97% | **drop-add** | differences are the new path + upstream's own anonymizer swaps |
| 10 | `LIFEOS/TOOLS/llcli/QUICKSTART.md` | `LIFEOS/bin/llcli/QUICKSTART.md` | 62% | **drop-add** | every changed line is the `Bin/llcli` → `TOOLS/llcli` path |
| 11 | `LIFEOS/DOCUMENTATION/Isa/IsaFormat.md` | `LIFEOS/DOCUMENTATION/IsaFormat.md` | 91% | **drop-add** | payload is v2.13.0 for **Algorithm v6.25.0**; live runs v6.4.19 — a 14-section spec live cannot satisfy |
| 12 | `LIFEOS/USER_TEMPLATES/Books.md` | `LIFEOS/TEMPLATES/User/Books.md` | 42% | **drop-add** | live version is strictly richer, and the payload carries a regression |
| 13 | `LIFEOS/USER_TEMPLATES/Beliefs.md` | `LIFEOS/TEMPLATES/User/Beliefs.md` | 14 shared lines | **drop-add** | same refactor as row 12; live is 40 lines vs payload's 24 |
| 14 | `LIFEOS/USER_TEMPLATES/README.md` | `LIFEOS/TEMPLATES/User/README.md` | 0% | **drop-add** | same refactor; live is 53 lines vs payload's 35 |
| 15 | `LIFEOS/USER_TEMPLATES/Identity.md` | `LIFEOS/TEMPLATES/User/PrincipalIdentity.md` | renamed | **drop-add** | same refactor, plus a rename — no same-named twin to score |
| 16 | `LIFEOS/USER_TEMPLATES/Goals.md` | — | no twin | **drop-add** | same refactor; lands in a directory with 0 live consumers |
| 17 | `LIFEOS/USER_TEMPLATES/Pronunciations.md` | — | no twin | **drop-add** | as above |
| 18 | `LIFEOS/TOOLS/healthsync/eightsleep.ts` | — | n/a | **refuse (`secret:`)** | carries a hardcoded 64-hex-char credential; see the `secret:` class below |

**1 port · 16 drop-add · 1 secret-refusal · 0 land-as-is.**

### Rows 13–17: a partially-refused refactor is worse than an unrefused one

Rows 12–17 are all the same upstream refactor (`TEMPLATES/User/` → `USER_TEMPLATES/`), but only row
12 came out of the content-overlap sweep. The other five score below the 30% threshold for reasons
that have nothing to do with whether they should land: the templates are tiny (`Beliefs.md` shares 14
lines; `README.md` scores 0%), or they were renamed so there is no same-named twin to compare
(`Identity.md` → live `PrincipalIdentity.md`, `Goals.md`, `Pronunciations.md`).

Landability settles all six identically. Live `LIFEOS/USER_TEMPLATES/` does not exist and has **zero**
live consumers; `LIFEOS/TEMPLATES/User/` has **three** (`LifeosSystemArchitecture.md`,
`LifeOs/LifeOsSchema.md`, `TEMPLATES/User/README.md`). The only payload file reading the new location
is `skills/LifeOS/Workflows/Setup.md`, which is `skip-skill` and never lands — so these arrive
unreferenced by construction.

Refusing 1 of 6 files from one refactor would have left five copies of it landing anyway, which is
the shape a count-based guard cannot see: the plan count drops, so the edit reads as done. The
tool's self-test now carries a **structural** check instead — no unrefused sibling in a refused
directory may be in `will-add` while a live twin of that basename exists elsewhere. A bare count
notices any edit but cannot tell a correct addition from a half-finished one.

### Row 18: the `secret:` class

`REFUSED_ADDS` now holds two classes, each named in its own reason string. `divergent:` is everything
above — a faithful add that would create a second source of truth. `secret:` is new and different:
the file is not a duplicate of anything, it is simply carrying a credential.

`LIFEOS/TOOLS/healthsync/eightsleep.ts:30` hardcodes `APP_CLIENT_SECRET` as 64 hex characters.
ggshield flags it as a Generic High Entropy Secret. Upstream documents it as a public mobile-app
OAuth constant and makes it env-overridable, which is plausible — but this channel cannot verify
"the vendor published this constant", and the live repo's ggshield pre-commit blocks it either way.

The fix is to port the file reading the value from `.env`, never to bypass the scanner to land it.
Holding it back is safe: live `LIFEOS/TOOLS/HealthSync.ts` loads sources through
`await import('./healthsync/' + source + '.ts')`, so an absent source is an unresolved dynamic import
on a path nothing takes — `HealthSync.ts --help` exits 0 without it, `EIGHTSLEEP_*` is absent from
live `.env`, and no cron job or hook invokes it.

### Notes on the two that needed a content judgement, not just a consumer count

**`IsaFormat.md`** — the payload spec is not a newer edition of the live file; it is the spec for a
different Algorithm. It adds `## Dependencies` and `## Bridge Criteria` (14 sections), deletes the
numeric ISC floors in favour of a Coverage Gate, and adds `parent:`/`children:` constraint
inheritance — all keyed to Algorithm v6.25.0. Live `ALGORITHM/LATEST` is `6.4.19`. Three
independent live files pin the spec at the live path: `CLAUDE.md:106`,
`DOCUMENTATION/Isa/IsaSystem.md:7` and `:155`, and `skills/ISA/SKILL.md:212`. Adopting the payload
spec is an Algorithm-version decision, not a file add.

Correcting an earlier claim of mine: live `DOCUMENTATION/Isa/` is **not** empty — it contains
`IsaSystem.md`, which is precisely the file that points at the live spec path. The parent ISA's
"the `Isa/` dir is empty live" is wrong. The disposition is unchanged; the reasoning is now right.

**`Books.md`** — the live template has `## Favorites` / `## Currently Reading` / `## Want to Read`
plus a parser note documenting the `**Name** — Creator · ★rating` shape and the `(private)` prefix.
The payload collapses all of that to one flat list. It also ships
`**Thinking, Fast and Slow** — {{PRINCIPAL_NAME}} Kahneman` — upstream's anonymizer replaced the
author's first name with a template placeholder. Landing it would add a worse template at a path
nothing reads.

## What was ported

One change, at the live path, and nothing else. Live `LIFEOS/bin/llcli/llcli.ts` gained the
`$HOME`-normalization guard for `LIFEOS_DIR` / `LIFEOS_CONFIG_DIR` / `PROJECTS_DIR`. Claude Code can
inject those vars unexpanded, so a literal `$HOME/...` value resolves to a directory named `$HOME`
instead of the home directory.

Applied **once**. Upstream's own file carries the stanza twice (lines 2–8 and 23–29, near-identical);
copying the diff verbatim would replicate that duplication into live.

## Not landed, and left as open questions

- **`Grok.ts` / `GrokAudit.ts`** are in the genuinely-new 253, not this set. If they land and a
  `GROK_API_KEY` is configured, the GrokResearcher PRIMARY TOOL section becomes worth porting — at
  which point row 3 should be revisited on its merits rather than re-derived.
- **The `gpt-5.6-sol` rows** are blocked on the codex CLI, not on judgement. Upgrade the CLI, re-run
  the two probes above, and rows 1–2 become a live port onto `skills/Agents/`.
- **The four refactors themselves** are undecided by design. Adopting upstream's layout
  (`skills/Agents/` → `agents/`, `bin/llcli` → `TOOLS/llcli`) means moving live files and updating
  every consumer — a migration, not an apply. Until then the live paths are canonical.
## Enforcement

**These refusals are enforced by the tool, not by this document.** `scripts/upstream-apply.ts`
carries all 18 rows as `REFUSED_ADDS` under **INVARIANT 8**, keyed on the exact payload path with the
reason attached. The plan's write set dropped from `will-add 293` to `will-add 281`, `skip-refused 12`
when the first 12 landed, then to `will-add 275`, `skip-refused 18` when rows 13–18 were added — every
other bucket unchanged. **The tool is authoritative; this table is the rationale.** If the two ever
disagree, `REFUSED_ADDS` is what runs.

The self-test covers the rows two ways, because the count assertion alone was not enough. It asserts
the exact row count (18), that every reason names its class (`divergent:` or `secret:`), and — the
check that would have caught the half-finished `USER_TEMPLATES` edit — that no unrefused sibling in a
refused directory is in `will-add` while a live twin of its basename exists elsewhere. Each assertion
is mutation-proven: strip the row, confirm the source really changed, confirm a check goes red,
restore.

Three properties worth knowing before editing either:

- **No override flag.** There is no `--allow-refused`. `--allow-flagged` exists for INVARIANT 6
  because that is a *detector* with false positives; INVARIANT 8 is a record of *decisions*, so
  changing one costs a reviewable diff that also updates the reason. A flag would also make it easy
  to do the wrong thing: for most of these rows the correct action is to **port content** onto the
  live path, which landing the payload file does not do.
- **`skip-exists` still outranks `skip-refused`.** If a refused path has already landed in live, the
  status reports the true live state and a separate `⚠ VIOLATED REFUSAL` block names it — a refusal
  quietly protecting nothing is worse than none, because it reads as coverage.
- **A key matching no payload file is reported as `⚠ STALE REFUSAL`.** Keys are exact so they cannot
  over-refuse a sibling upstream later adds to the same directory; the cost is brittleness to an
  upstream rename, which the warning surfaces. Neither warning changes the exit code.

`--exclude <prefix>` (repeatable, composes with `--only`) covers ad-hoc holdbacks that are not
recorded decisions. It can only ever shrink the write set.

## The refusals held through a real apply

The 275 landable files were written into live `~/.claude` on 2026-07-28 in six signed slices
(`301319e9` Algorithm · `deb8d781` docs · `10f457e8` hooks · `f5b898b5` TOOLS · `1c3812ba` Pulse ·
`e0497c76` root config + RULES). Afterwards the plan reports `will-add 0 | skip-refused 18`, so every
row above was exercised against the real tree rather than a stub mirror, and none of the 18 landed.

Nothing was overwritten or deleted — all six commits are pure adds (`+275 ~0 -0`). Live
`settings.json` is byte-identical to its pre-apply hash and still wires the same 31 hooks; the Pulse
daemon answered `/health` 200 throughout. Everything landed dormant: `ALGORITHM/LATEST` still reads
`6.4.19` so the landed `v8.4.0.md` spec is inert, `PULSE.toml` is untouched so no job self-registers,
and no hook was wired. Landing a file and activating it are separate decisions; only the first was
taken.

## Still open

- Rows 1–3 are blocked on toolchain, not judgement. When the codex CLI is upgraded (or `Grok.ts`
  lands with a `GROK_API_KEY`), re-run the probes above and those become live ports onto
  `skills/Agents/` — at which point the `REFUSED_ADDS` reasons need updating too, since they cite the
  400s as the grounds.
