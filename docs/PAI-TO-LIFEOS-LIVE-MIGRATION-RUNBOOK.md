# Runbook: migrate a live `~/.claude` install PAI → LIFEOS

> A reusable, trap-first runbook for renaming a **running** PAI-shaped framework install
> (`~/.claude/PAI/`) to the LIFEOS identity (`~/.claude/LIFEOS/`) on any machine.
>
> Written from a completed live migration, not a forecast. It supersedes the pre-execution
> `LIVE-PAI-TO-LIFEOS-MIGRATION-PLAN.md`, whose forecasts were partly wrong — the corrections
> are called out inline (see "Corrections to the pre-execution plan"). **Probe your own tree;
> do not trust any count, path, or process id in this document as a constant — yours will differ.**

## What this is (and is not)

This is a **coordinated cut**, not a text sweep. The live tree is a running system: a dashboard/
daemon process, session hooks, and the `CLAUDE.md` constitution all load from `PAI/`. Moving that
directory out from under them is a migration with hard preconditions (rehearsal, safety net,
per-surface verification), the same class upstream's `RenameMap.json` labels "rename-at-cut".

It is **not**: a `sed -i 's/PAI/LIFEOS/g'` (that renames the assistant, the config dir, service ids,
and English substrings — see the keep table), and it is **not** safe to run against real live before
a clone rehearsal passes.

Scope of a single run is the live install directory only (`~/.claude`). If you also maintain a
build/release repo that reads the live tree as a PAI-shaped **source**, that tooling goes stale the
moment live becomes LIFEOS-shaped — treat it as a separate, downstream change (see "Downstream").

---

## Step 0 — Probe YOUR tree first (do not skip, do not assume)

Every number below is discovered, never assumed. Run these and record the outputs in your working
notes before touching anything. (Commands shown for a POSIX shell / Git-Bash; adapt per OS.)

```bash
cd ~/.claude

# Repo identity — confirm you're in the live install repo, not a build/fork repo.
git remote -v
git rev-parse --show-toplevel

# How big is the framework tree? (your number; used only to sanity-check the move)
git ls-files 'PAI/**' | wc -l

# Is anything RUNNING that loads from PAI/? (a dashboard/daemon on a known port, etc.)
# Find it now; you must stop it before the dir move and restart it after.
#   e.g. curl -s localhost:<port>/healthz ; ps/tasklist for the server process

# Shim insufficiency check — how many files HARDCODE the path vs use an overridable env var?
git grep -l 'join(.*"\.claude".*"PAI"' | wc -l     # hardcoded literals — must be rewritten
git grep -l 'process.env.PAI_DIR'      | wc -l     # overridable — a symlink alone would cover these

# Git behavior that changes the mechanics (see OS divergence):
git config --get core.ignorecase   # true (mac/Windows) => case-only renames need a two-step
git config --get core.symlinks     # false => a compat symlink is NOT available; use a content copy
git config --get core.autocrlf     # want false; combined with .gitattributes eol=lf
cat .gitattributes | grep eol      # confirm the repo mandates LF

# The system-prompt LAUNCHER — the referrer that passes --append-system-prompt-file (if any).
# Search settings.json, shell rc, any wrapper, the editor/extension launch args, scheduled tasks.
# You may NOT find it (a launcher can live outside the repo). If you can't, keep the safety-net
# copy (below) so the rename is survivable regardless.
grep -rn 'append-system-prompt\|SYSTEM_PROMPT' ~/.claude/settings.json ~/.bashrc ~/.zshrc 2>/dev/null
```

Record: repo name, PAI file count, the running service + its start command, hardcoded-vs-overridable
counts, the three git settings, and whether you located the launcher. These drive every later decision.

---

## Step 1 — Classify tokens: keep vs rename (the crux)

A blanket rename is wrong. `PAI`/`Pai`/`pai` appears in roles that must be preserved. Build (or reuse)
a tool whose rules encode this table. Derive each verdict from **your** tree, not from a pattern.

| Role | Examples | Verdict | Why |
|------|----------|---------|-----|
| **Path segment** | `PAI/DOCS`, `@PAI/…`, `~/.claude/PAI/…`, `join(HOME,".claude","PAI",…)` | **RENAME → LIFEOS** | filesystem location that is moving |
| **Env var** | `PAI_DIR`, `PAI_CONFIG*`, `PAI_SYSTEM_PROMPT`, `PAI_RELEASES`, any `PAI_<CAPS>` | **RENAME → LIFEOS_*** | resolve to the new tree |
| **Framework symbol** | `getPaiDir`, `PaiConfig`, `usePAIEvents`, `PAIEvent*`, `PAIAgentAdapter`, `UpdatePaiState`, `Pai*` interfaces | **RENAME** | the framework is now Lifeos; match your fork's exact verdicts |
| **DA-name literal** | `aiName \|\| "PAI"`, `displayName: "PAI"`, `name = "PAI"`, a `"PAI"` member of a placeholder set | **KEEP** | this is the assistant's NAME, not a directory. Renaming it renames the DA. |
| **Different dir** | `~/.config/PAI` (`join(home,".config","PAI",…)`) | **KEEP** | a separate config dir, out of scope for the `.claude/PAI` rename |
| **Doc-anchor constant** | `PAITheme`, `PAIColors`, `PAISYSTEMARCHITECTURE`, `PAIAGENTSYSTEM` (as in-content tokens) | **KEEP** | upstream keeps these as content anchors; rename the FILES separately (Step 3), not the token |
| **Service / asset id** | `com.pai.*` plist ids, `pai-logo`/`pai-icon` kebab ids | **KEEP** | renaming breaks service names / asset refs |
| **Installer sub-name** | `PAIUpgrade` (skill dir), `PAI-Install` (installer engine), `skills/PAI` legacy path | **KEEP** | sub-names, not the framework root; the installer is deliberately PAI-shaped |
| **English substring** | `repair`, `Pairwise`, `paint`, `campaign`, `Sinai` | **KEEP** | `pai` isn't the project token here — word-boundary + a preserve list guard these |
| **Brand prose** | a bare `PAI` naming the old project in a doc/changelog | **FLAG, don't rewrite** | ambiguous; emit for human review, never silently rename |

**Doctrine: transform only the unambiguous path/env/symbol tokens. Everything else is preserved
silently or flagged. A silent wrong rename is worse than a flag.**

### Path-shape gotchas the naive `PAI/` rule misses

Your string-literal rule (`\bPAI\/` → `LIFEOS/`) requires a trailing slash and forward slashes.
Real trees also contain, and you MUST add rules for:

- **`.claude/PAI`** with no trailing slash (PAI is the last segment): `"$HOME/.claude/PAI"`, `join(HOME, ".claude/PAI")`, end-of-string. Anchor a rule to a `.claude/` prefix + a negative lookahead so it can't hit `.config/PAI` or `PAI-Install`.
- **`.claude\PAI`** with **backslashes** (Windows paths in `.ps1`/`.cmd`): `Join-Path $home '.claude\PAI\PULSE'`.
- **Multi-line joins**: `join(\n HOME,\n ".claude",\n "PAI",\n …)` — your quoted-segment rule must span newlines.

### Quoted-`"PAI"` must be path-context-aware

`"PAI"` in quotes is *either* a path segment (rename) *or* the DA name (keep). Only rewrite a quoted
`"PAI"` when it's immediately preceded by a quoted `.claude` **or** a claude-dir builder identifier
(`CLAUDE_DIR`/`claudeDir`/`paiDir`). Never rewrite a bare/`|| "PAI"`/placeholder-set `"PAI"`, nor a
`.config`- or `skills`-preceded one.

---

## Step 2 — Build the two-tool pattern

Two small, pure, self-tested tools. Reference implementations to copy/adapt:

- **Transform** — `scripts/pai-to-lifeos.ts` (the fork's proven payload tool) and its live-scoped
  sibling `LIFEOS/TOOLS/pai-to-lifeos-live.ts` (adds the path-context-aware quoted rule, the DA-name /
  `.config` / doc-anchor keeps, the `.claude/PAI` trailing + backslash rules, and a compound-symbol
  flag pass). Pure function `(text) → {text, rewrites, flags}`, plus a `--self-test` fixture suite that
  MUST be green before use. Include the DA-name-KEEP, `.config`-KEEP, and multi-line-join-RENAME cases
  as fixtures — and lock every adversarial case an auditor finds as a regression fixture.
  - Guard `--apply` to `$HOME/.claude` only, and resolve the **real** path (`realpathSync`, which
    follows symlinks *and* Windows junctions) before the containment check, so a link named inside
    `.claude` but pointing outside can't smuggle an out-of-scope target past a textual prefix test.

- **Orchestrator** — `LIFEOS/TOOLS/migrate-live.ts`. Git-free (mutates the working tree only; you do
  staging + signed commits yourself). Parameterize it by `--root` so the **clone rehearsal runs the
  exact same code path as the live cut**. Sequence, content-first then move-last:
  1. content pass (transform every tracked text file **at its old PAI/ path**);
  2. filename-referrer pass (fix doc/tool basenames the transform KEEPS as anchors but that are also
     files being physically renamed);
  3. physical file renames (the handful of `PAI*`/`Pai*`-named files → `Lifeos*`);
  4. config reformat (e.g. `USER/Config/PAI_CONFIG.yaml` → `USER/CONFIG/LIFEOS_CONFIG.toml`);
  5. safety-net copy (see Step 4);
  6. **dir move last** (see OS divergence — this is the step that fails on Windows).

> ⚠️ **Enumeration trap (this cost a correction cycle):** a content pass that iterates `git ls-files`
> rewrites **only tracked files**. But the physical dir move relocates *everything*, including
> **gitignored source files** (`.ts`/`.cmd`/`.ps1` under ignored dirs — scheduled-task scripts,
> autostart launchers, ad-hoc tools). Those move with stale `PAI` paths and break at runtime.
> **Enumerate the physical tree for executable source, not just the index.** Leave genuine runtime
> telemetry (`.jsonl`, logs, state caches) and frozen historical records alone — rewriting them
> falsifies history and they regenerate anyway.

---

## Step 3 — Physical file renames

The content pass rewrites file *contents*, never *names*. Enumerate every `PAI*`/`Pai*`-named file in
your tree (`git ls-files | grep -iE '/(PAI|Pai)'` plus a physical `find` for ignored ones) and map each:

- code files (`PAILogo.ts`, `RebuildPAI.ts`, `UpdatePaiState.ts`, a `usePAIEvents.ts` hook, …) → `Lifeos*`
  / `useLifeosEvents.ts`, **and update their importers** (the content pass renames the *symbol*, so
  importers referencing the module by symbol/extension-less path already update; verify);
- doc files (`PAISystemArchitecture.md`, top-level `PAISYSTEMARCHITECTURE.md`, `PAIAGENTSYSTEM.md`, …) →
  their Lifeos/canonical names, **and update referrers** — these are the doc-anchor constants the
  transform KEEPS as content, so their filename references need a separate pass;
- the config file → its reformatted name (Step 4).

Confirm each new name doesn't collide with an existing file (e.g. a top-level `PAIAGENTSYSTEM.md` →
`AgentSystem.md` might collide with a `DOCUMENTATION/…/AgentSystem.md` — different dir, so OK, but check).

---

## Step 4 — The system-prompt safety net

The constitution's system prompt is loaded by a **launcher** (typically `--append-system-prompt-file`)
that may live outside the repo and may be unlocatable from inside `~/.claude` (a shell wrapper, an
editor/extension setting, a scheduled task). Two facts:

- If you **cannot** locate the launcher, renaming `PAI_SYSTEM_PROMPT.md` risks silently breaking
  constitution loading.
- On a `core.symlinks=false` box (Windows without Developer Mode), a filesystem symlink is unavailable
  (`ln -s` yields a copy; `mklink` needs admin/Dev Mode).

**Resolution:** rename to `LIFEOS_SYSTEM_PROMPT.md` (canonical) **and keep a byte-identical copy at the
old name** (`PAI_SYSTEM_PROMPT.md`) as a launcher safety net. Verify byte-identity (`cmp -s`). Retire the
copy only once you've confirmed a launcher that points at the new name. If your session itself carries no
such flag, that's not proof no launch path uses it — keep the copy.

---

## Step 5 — Rehearse on a clone (mandatory gate)

Never let real live be the rehearsal surface.

```bash
# Build a clone from HEAD (tracked files) and overlay any new-but-uncommitted tools you built.
REHEARSE=~/lifeos-rehearsal && rm -rf "$REHEARSE" && mkdir -p "$REHEARSE/clone"
git archive HEAD | tar -x -C "$REHEARSE/clone"
cp <your new tools> "$REHEARSE/clone/…/TOOLS/"
( cd "$REHEARSE/clone" && git init -q && git add -A && git commit -qm base )

# Run the ORCHESTRATOR against the clone (same code as the live cut).
bun <orchestrator> --root "$REHEARSE/clone" --apply
```

Then verify on the clone: `PAI/` gone / `LIFEOS/` present; 0 residual `.claude/PAI` in runtime code;
DA-name + `.config/PAI` survived; all constitution `@LIFEOS/` imports resolve; the renamed files'
importers resolve; **zero case-collisions** (`git ls-files | tr A-Z a-z | sort | uniq -d` AND a physical
`find | tr A-Z a-z | sort | uniq -d`); run a moved tool to confirm path resolution.

> The clone is `git archive` — **tracked-only**, so it shares the enumeration trap above and **cannot**
> surface a gitignored-source miss. That gap is what the cross-vendor audit (Step 8) catches.

If the clone is not fully green after at most a few catch-and-fix passes on the tool, **STOP** — don't
carry a known-broken tool to live. (Declare a loop cap up front, e.g. ≤3 passes.)

---

## Step 6 — The coordinated cut (real live)

Order matters. Do the filesystem mutation as **one orchestrator run** (so no session hook fires
mid-cut against a half-migrated tree), then commit separately afterward.

1. **Stop the running service** (dashboard/daemon) that holds the old path. Confirm its process is gone
   and its port is closed.
2. **Relocate your own working notes/ISA out of the moving tree** if you're editing them live (else your
   editor's handle blocks the move — see OS divergence).
3. **Run the orchestrator `--apply` on `~/.claude`** (content → referrers → file renames → config →
   safety-net → dir move).
4. **Restart the service** from its new `LIFEOS/…` location; confirm health.
5. Proceed to verification (Step 7) **before** committing.

---

## Step 7 — Verify against the REAL live tree

- Constitution loads: every `@LIFEOS/…` import in `CLAUDE.md` resolves to a real file.
- A hook fires without a path error (run one synthetically; a security/context hook that reads a
  moved config proves the path resolves).
- The service is healthy (`/healthz` 200 or equivalent) and any UI/statusline renders.
- **0 residual `.claude/PAI`** in tracked *runtime* code (`git grep`), excluding intentional keeps and
  your tool's own self-test fixtures.
- **0 case-collisions** (tracked oracle + physical scan).
- **Byte-level EOL**: sample rewritten files with `od -An -tx1 <f> | tr ' ' '\n' | grep -c '^0d'` → 0 CR.
  **Do not** use `grep -c $'\r'` on Git-Bash — it is unreliable and false-flags binaries.
- Anti-checks: DA name literal intact; `~/.config/PAI` untouched; doc-anchor constants + installer
  sub-names not renamed; any separate build/fork repo shows zero modifications from the cut.

If a security-pattern file (deny/allow path lists) was rewritten, that is a **security-surface edit**:
run its real invariant suite (not a dry run) and an adversarial deny-verdict probe (assert the verdict,
never execute a destructive command), and have a cross-vendor agent refute it.

---

## Step 8 — Cross-vendor audit (do not skip)

A same-family reviewer reproduces the author's blind spots. Spawn a cross-vendor auditor (a different
model family) to refute "the cut is correct and safe to commit." It reliably catches what your tool and
your same-family clone rehearsal **share** — most notably the **tracked-only enumeration miss** (Step 2):
gitignored source files that moved with stale paths. Fix the whole class it surfaces, then re-verify.

---

## Step 9 — Phased, signed commits

Git detects a rename only when a file's **delete (old path) and add (new path) land in the same commit**.
So you cannot split "content rewrite" from "the move" into separate commits — the move fuses them.
Partition by **change-class** instead, each self-contained:

1. **Framework-tree rename** — stage `PAI/` (deletions) + `LIFEOS/` (adds) **together** so git records
   renames (`git add -A PAI/ LIFEOS/`; expect mostly `R` entries, plus `A`/`D` for the reformatted
   config and any file whose content changed enough to drop below git's rename-similarity threshold —
   verify each such `D` is intended, a bulk-move deletion census).
2. **Live surfaces** — the in-place sibling edits that don't move (`CLAUDE.md`, `settings.json`,
   `.gitignore`, `hooks/**`, `skills/**`, launcher/statusline).

Sign every commit (the repo's configured signing; never disable it), verify the signature after each
(`git log --show-signature -1`), and run a secret scan across the **whole** range (a scanner short-circuits
on the first hit, so a large commit can hide multiple — scan the range, not just the first flagged file).
Never commingle the migration with unrelated stashed WIP.

---

## OS divergence (read before the dir move)

The classification + rehearsal method is universal. The **mechanics** are not:

- **Windows dir move fails with `EPERM`/`EACCES` if ANY process holds an open handle on a descendant**
  — empirically true for both `fs.renameSync` and `git mv`. Your own live session's hooks (which
  append to files under the tree between tool-calls) and the running service are the usual culprits.
  Stop the service, relocate your own open files out of the tree, and if `renameSync` still EPERMs,
  use **`robocopy <src> <dst> /MOVE /E /R:3 /W:1`** — its retry loop rides out transient handle races
  (exit code 0–7 = success; 1 = "files copied", normal). Do the move **last** so an EPERM leaves a
  recoverable state (content already rewritten, tree still at old path, restorable via `git checkout`).
  The clone rehearsal cannot reproduce this — a clone has no live process holding handles.
- **Case-only renames** (`USER/Config` → `USER/CONFIG`) on `core.ignorecase=true` (mac/Windows) need a
  two-step through a temp name (`Config` → `Config__tmp` → `CONFIG`); never have both casings in the
  index at once. Oracle for collisions: `git ls-files | tr A-Z a-z | sort | uniq -d`.
- **Symlinks** are unavailable on `core.symlinks=false`; use a content copy for the safety net (Step 4).
- **EOL**: raw index writes (`git checkout origin --`, `git update-index --cacheinfo`) bypass
  `.gitattributes eol=lf` — re-`git add` from the worktree to apply the LF filter, and byte-verify with
  `od`, not `grep $'\r'`.
- macOS/Linux: `renameSync` on a dir generally succeeds despite open handles; robocopy is Windows-only
  (use `mv`); case-insensitivity applies to macOS (APFS) and Windows, not typical Linux.

---

## Downstream: build/release tooling goes stale

If a separate repo maintains build/release tooling that reads the live tree as a **PAI-shaped source**
(e.g. a `build-release`/`upstream-sync`/`normalize` script doing `process.env.PAI_DIR ?? ~/.claude` then
joining `PAI/` internally, or a reverse-normalizer that maps `LIFEOS_DIR → PAI_DIR`), those break the
moment live becomes LIFEOS-shaped. Repoint them to a LIFEOS-shaped source in a **separate, signed commit
in that repo** — it's a different repo with its own risk profile; do not fold it into the live cut.

---

## Failure modes & recovery

| Symptom | Cause | Recovery |
|---------|-------|----------|
| `EPERM`/`EACCES` on the dir move | open handle under the tree (Windows) | stop service, relocate your own open files, retry with `robocopy /MOVE /R:3`; content is already applied, tree still at old path |
| A hook/tool breaks after the cut with a `PAI` path error | a gitignored source file was moved but not content-rewritten (tracked-only enumeration) | grep the physical tree for `.claude/PAI` in `.ts/.cmd/.ps1`; rewrite the class |
| Constitution doesn't load / identity missing | a `@PAI/` import wasn't rewritten, or the launcher points at the old system-prompt name | fix the import; the safety-net copy covers the system-prompt name |
| Clone rehearsal not green | tool rule gap (path shape, a false keep/rename) | fix the tool + add a regression fixture; re-rehearse; **STOP** — never carry a broken tool to live |
| Case-collision after rename | both casings in the index (ignorecase FS) | index-only two-step through a temp name |

**If the clone rehearsal or any live probe fails, STOP and report — do not press on.**

---

## Corrections to the pre-execution plan

If you're reading the older `LIVE-PAI-TO-LIFEOS-MIGRATION-PLAN.md`, note these forecasts that execution
refuted (probe your own tree — the point is that plans mis-estimate; runbooks encode what actually held):

- **"52 `@PAI/` imports in CLAUDE.md."** The plan conflated `@PAI/` imports with total `PAI/` path
  references. Count yours: the import count is small; the path-ref count is larger. Both are handled by
  the content pass; neither is a gate.
- **"Update the loader path in a `LifeosConfig.ts`."** No such loader existed in the live tree — the
  config file was read by no live code. Don't chase a phantom loader; probe who actually reads the config.
- **No mention of the dir-move `EPERM`.** The single highest-probability live-only failure on Windows.
  It's in "OS divergence" now because it *will* happen if your session holds handles under the tree.
- **Tool spec missed the `.claude/PAI` no-slash and `.claude\PAI` backslash forms.** Both are real and
  both are in the classification section now.
- **No anticipation of the tracked-only enumeration blind spot.** The plan (and any `git archive`
  rehearsal) is tracked-only; gitignored source files are the gap. The cross-vendor audit is the catch.

---

## Reference implementations

- Transform (payload, proven): `scripts/pai-to-lifeos.ts`
- Transform (live-scoped, path-context-aware): `~/.claude/LIFEOS/TOOLS/pai-to-lifeos-live.ts`
- Orchestrator (git-free, `--root`-parameterized): `~/.claude/LIFEOS/TOOLS/migrate-live.ts`
- Prior execution record (traps as they were hit): the migration ISA + the memory notes on the
  tracked-only miss and the Windows open-handle EPERM.
