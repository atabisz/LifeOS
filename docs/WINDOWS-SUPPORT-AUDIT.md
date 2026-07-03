# Windows support audit — files that assume macOS/Linux

This is a triage audit of where the LifeOS (PAI) codebase assumes a macOS or Linux environment and would break or degrade on Windows. It is a map for further work, not a set of fixes. Six parallel search agents swept the current code surface; this report consolidates what they found, ranks it by severity, and lists the files to analyze next.

**Date:** 2026-06-30
**Method:** content search (afplay/osascript/launchctl/plist, paplay/notify-send/systemd, `uname`/`sed -i ''`, `/tmp`/`/usr`/`~/Library`, literal `~/` in TS, `process.env.HOME` without a fallback, `process.platform` switches missing a `win32` case, bare external-CLI spawns, `.sh`/`#!/usr/bin/env` shebangs) followed by reading each hit to judge severity and confirm whether a Windows branch already exists.

> **Verification pass — 2026-06-30 (live install).** The findings below were re-checked against the **live install** at `C:\Users\AlexTabisz\.claude`, not just the release snapshot. The "Live-install verification" section after the severity definitions records what was confirmed fixed, what is still broken, and which claims were release-only. Where a row below has a known live status, it is flagged inline as ✅ FIXED-LIVE, ❌ STILL-BROKEN-LIVE, or ⚠️ RELEASE-ONLY.

## Scope

The audit covered the live/current code surface, not the frozen historical snapshots:

| Area | Path | Files swept |
|------|------|-------------|
| Active pack sources | `Packs/` | ~1,850 (178 .ts, 28 .py) |
| Hooks | `Releases/v5.0.0/.claude/hooks/` | 72 |
| Pulse daemon + voice | `Releases/v5.0.0/.claude/PAI/PULSE/` | 117 (excl. Next.js `out/` build output) |
| PAI tools + bin | `Releases/v5.0.0/.claude/PAI/{TOOLS,bin}/` | 88 |
| Installer + root tools | `Releases/v5.0.0/.claude/PAI/PAI-Install/`, `install.{sh,ps1}`, `settings.json`, `Tools/` | ~25 |
| Skills | `Releases/v5.0.0/.claude/skills/` | ~93 code + 45 SKILL.md |

`Releases/v2.3` through `v4.0.3` are frozen snapshots that carry the same patterns in duplicate; they were not swept individually. `Packs/Utilities/src/` and `Packs/Media/src/` contain duplicate copies of several top-level packs (AudioEditor, Evals, Prompting, Fabric, CreateCLI, PAIUpgrade, Art, Apify) — fixes there must be applied in both trees.

## Severity definitions

- **BLOCKER** — fails outright on Windows with no fallback (crash, exit, or a path/binary that cannot resolve).
- **MAJOR** — degraded or silently broken behavior, but not a crash (a feature no-ops, writes to the wrong place, or returns empty).
- **MINOR** — documentation/example only, or the code already has a working `win32` branch and is listed only for coverage.

## Live-install verification (2026-06-30)

Each load-bearing claim was probed against the live tree at `C:\Users\AlexTabisz\.claude`. Scope of the counts below: live tree only. Verdicts:

| Claim under test | Probe | Live result | Verdict |
|---|---|---|---|
| Hook interpreter prefixes exist in the live `settings.json` | Read `settings.json` hook command lines | Every PAI `*.hook.ts` is prefixed `"$HOME/.bun/bin/bun.exe"`; GSD hooks use explicit `node`/`bash`; statusline is an inline bash pipeline | ✅ **FIXED-LIVE** — and suitable; this is the back-port source |
| `voice.ts` carries a Windows audio path | Read `PAI/PULSE/VoiceServer/voice.ts` (819 lines) | Real `win32` branch → `powershell.exe -File play-mp3.ps1`/`play-wav.ps1`; Piper TTS provider wired; `tmpdir()` not `/tmp`; `osascript` notification early-returns when `platform !== "darwin"` (graceful no-op). `play-mp3.ps1`, `play-wav.ps1`, `piper/` all present | ✅ **FIXED-LIVE** — and suitable |
| HOME fallback chain is the canonical pattern | grep the four cited files | `algorithm.ts:58`, `PULSE/pulse.ts:24`, `ComposeAgent.ts:37` carry `HOME ?? USERPROFILE ?? homedir()` (two via `\|\|`, one via `??`). **`hooks/lib/paths.ts` does NOT** — it uses bare `homedir()` (portable, but not the fallback chain it is credited with) | ⚠️ **PARTIAL** — cite the three real exemplars, not `paths.ts` |
| The HOME sweep is largely done in the live tree | grep variant counts across `PAI/`, `hooks/`, `skills/`, `PULSE/` | **33 files** still use throwing `process.env.HOME!`; **26** use `\|\| ""` / `?? ""` (relative-path collapse); only **18** carry the proper fallback chain. No shared helper module exists to "promote" | ❌ **STILL-BROKEN-LIVE** — the sweep is barely started even live |
| `/tmp` literals persist | grep the three flagged hooks | `ConfigAudit.hook.ts:45`, `lib/notifications.ts:15`, `TaskGovernance.hook.ts:48` all still hardcode `/tmp` | ❌ **STILL-BROKEN-LIVE** |
| `ContextReduction.hook.sh` is a live registered hook | grep live `settings.json`; glob `hooks/*.sh` | **Correction (2026-07-01):** the earlier claim "no `.sh` files in live `hooks/`" was WRONG. The live `hooks/` **does** contain `.sh` files: `ContextReduction.hook.sh` plus `gsd-{phase-boundary,session-state,validate-commit}.sh`. What holds is narrower — `ContextReduction.hook.sh` is not *registered* in the live `settings.json` (PAI hooks there use `"$HOME/.bun/bin/bun.exe"` prefixes; GSD `.sh` hooks ARE registered via `bash`). It appears in the **release** `settings.json:95`. The statusline `.sh` (`PAI/statusline-command.sh`) exists on disk and is registered in the **release** (`settings.json:370`); the **live** statusline is an inline bash command, not that file. | ⚠️ **MOSTLY RELEASE-ONLY** — `ContextReduction.hook.sh` is unregistered live but the file exists |
| `validate.ts` false-green via `process.execPath` | Read `PAI-Install/engine/validate.ts:60` | `spawnSync(process.execPath, [hookPath], …)` — confirmed; smoke test bypasses the real shebang/command-string invocation path | ✅ Confirmed (the trap is real) |
| No lint rule guards bare HOME / `/tmp` | search live tree for a custom rule | None found | ✅ Confirmed (guard does not exist) |

**Net:** two of the three "live tree already carries this fix" claims hold and are suitable (hook prefixes, voice.ts). The third — the HOME-resolution sweep — does **not** hold: the live tree itself still has ~59 files on the broken patterns, and there is no shared helper or lint rule. The `ContextReduction.hook.sh` / statusline `.sh` blockers are release-snapshot registration concerns — the `.sh` *files* exist in the live install (see the corrected row above), but `ContextReduction.hook.sh` is not registered in the live `settings.json`. **Update 2026-07-01:** Step 1 addressed the release hooks via an installer per-OS interpreter-normalization pass (not a verbatim back-port) — see `docs/WINDOWS-SUPPORT-PLAN.md` Step 1 (DONE).

## Read this first: the release snapshot is behind the live install

The existing field report [docs/WINDOWS-INSTALL.md](WINDOWS-INSTALL.md) documents a *working* native Windows install. That account is accurate for the live `~/.claude` tree, but most of those fixes were never back-ported into the `Releases/v5.0.0` snapshot this audit scanned. So the release a fresh Windows user would install still ships the bugs the field report calls resolved. The three sharpest cases:

1. **`PULSE/VoiceServer/voice.ts`** in the release has **no Windows code path** — it plays audio with `/usr/bin/afplay`, notifies with `/usr/bin/osascript`, writes `/tmp`, and deletes with `/bin/rm`. The Piper TTS swap and `play-mp3.ps1`/`play-wav.ps1` helpers described in the field report are not in this tree. The `.ps1` files present here cover daemon *autostart* only, not audio.
2. **`settings.json`** ships every hook command as a bare `*.hook.ts` path with no interpreter prefix, relying on the `#!/usr/bin/env bun` shebang + exec bit. The field report's seam 2 fix (explicit `bun.exe`/`node` prefixes) lives only in the live tree.
3. The **`HOME` literal-`~` / no-fallback** bug the field report marks resolved is still present in dozens of release-snapshot files (see below).

The installer engine is the exception — its cross-platform pass *was* committed to the release (see "Already handled").

## Cross-cutting blockers (fix once, fix many)

Three patterns account for the large majority of findings. Each has a single canonical fix that resolves dozens of files.

### 1. `HOME` read with no `USERPROFILE`/`homedir()` fallback — ~70+ files

The dominant issue by file count. On Windows `process.env.HOME` is set inside Git Bash but unset in the native login/autostart context, so `process.env.HOME!` throws, and `process.env.HOME || ""` collapses every PAI path to a relative or `/`-rooted root, silently writing to the wrong place. Variants seen: `process.env.HOME!` (non-null assert → throws), `process.env.HOME || ""` / `?? ""` (→ relative path), and string concat `HOME + '/.claude/PAI'`.

**Canonical fix** (already used correctly in `PAI/TOOLS/algorithm.ts:58`, `PAI/PULSE/pulse.ts:24`, `skills/Agents/Tools/ComposeAgent.ts:37` — verified live 2026-06-30):
```ts
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
```
> **Correction (2026-06-30):** `hooks/lib/paths.ts` was previously cited here as an exemplar. It is portable on Windows but uses **bare `os.homedir()`**, not the `HOME ?? USERPROFILE ?? homedir()` chain — it never reads `process.env.HOME`, so it is not the pattern to copy for files that legitimately need the env-var-first chain. Use the three files above. **Live-tree status:** the sweep is *not* done — 33 files still use throwing `process.env.HOME!`, 26 use `\|\| ""`/`?? ""`, only 18 carry the chain. There is no shared helper module yet; "promote the existing pattern" means *create* the shared helper, not re-export one.

Worst-affected files, by area:
- **TOOLS (~30):** `ActivityParser.ts`, `ArchitectureSummaryGenerator.ts`, `Banner.ts`/`BannerMatrix.ts`/`BannerNeofetch.ts`/`BannerRetro.ts`/`NeofetchBanner.ts`, `GetCounts.ts`, `HarvestExecutor.ts`, `KnowledgeGraph.ts`, `KnowledgeHarvester.ts`, `LearningPatternSynthesis.ts`, `MemoryRetriever.ts`, `SessionHarvester.ts`, `TlpArchive.ts`, `DAIdentityGenerator.ts`, `WisdomCrossFrameSynthesizer.ts`/`WisdomDomainClassifier.ts`/`WisdomFrameUpdater.ts`, `AgentWatchdog.ts`, `FailureCapture.ts`, `OpinionTracker.ts`, `RelationshipReflect.ts`, `IntegrityMaintenance.ts`, plus `HOME || ""` variants in `ComputeGap.ts`, `DocCheck.ts`, `InterviewIdealState.ts`, `MigrateScan.ts`, `Recommend.ts`, `ReferenceCheck.ts`, `CostTracker.ts`, and others.
- **Hooks:** `lib/identity.ts` and `lib/observability-transport.ts` (highest impact — many hooks import them), `ContainmentGuard.hook.ts`, `handlers/UpdateCounts.ts`, `RepeatDetection.hook.ts`, `LastResponseCache.hook.ts`, `PreCompact.hook.ts`, `PromptProcessing.hook.ts`, `SatisfactionCapture.hook.ts`, `SessionCleanup.hook.ts`, `WorkCompletionLearning.hook.ts`.
- **Pulse:** `checks/{airgradient-poll,calendar,github,life-morning-brief,notification-governor,poller-meta-monitor}.ts`, `modules/{syslog,telegram,user-index,example-module}.ts`, `Performance/{module,cost-aggregator}.ts`, `Observability/observability.ts`, `lib/messages-db.ts`, `checks/github-work.ts`.
- **Packs/skills:** `Art/Tools/{Generate,GeneratePrompt,GenerateMidjourneyImage,ComposeThumbnail}.ts` (+ Media duplicates), `Telos/Tools/UpdateTelos.ts`, `Telos/DashboardTemplate/App/api/chat/route.ts`, `USMetrics/Tools/UpdateSubstrateMetrics.ts`, `Security/Recon/Tools/BountyPrograms.ts`.

### 2. Hardcoded `/tmp` and other POSIX paths

`/tmp` does not exist on Windows; replace with `os.tmpdir()`. Sites: `hooks/ConfigAudit.hook.ts:45`, `hooks/lib/notifications.ts:15`, `hooks/TaskGovernance.hook.ts:48`, `PULSE/VoiceServer/voice.ts`, `Webdesign/Tools/DriveClaudeDesign.ts:51`, `Art/Tools/GenerateMidjourneyImage.ts:82`. Related: `hooks/SmartApprover.hook.ts` trusts only `/tmp`, `/private/tmp`, `/var/folders` prefixes (over-restrictive on Windows, not a crash), and `TOOLS/HealthSnapshot.ts` hardcodes the macOS iCloud path `~/Library/Mobile Documents/com~apple~CloudDocs/`.

### 3. Shelling out to Unix-only binaries

Many tools spawn binaries that are absent or named differently on Windows. Note that Bun's `$` shell implements `cp`/`rm -rf`/`mkdir -p`/`which`-style builtins cross-platform, so those inside `` $`...` `` are *not* blockers — the real risks are non-builtin external binaries and raw `child_process`/`execSync` of POSIX shell idioms (`2>/dev/null`, `;` chaining, `|| true`).

| Binary | Used in | Notes |
|--------|---------|-------|
| `afplay`, `osascript` | `PULSE/VoiceServer/voice.ts` | audio playback + desktop notification, no win32 branch |
| `which` / `command -v` | `Webdesign/Tools/{DriveClaudeDesign,VerifyDesign}.ts` (exit 127), `AudioEditor/Tools/Transcribe.ts`, `hooks/lib/tab-setter.ts` | use `where` or PATH probe |
| `ls` | `Prompting/Tools/RenderTemplate.ts` (×2 copies) | replace with `fs.readdirSync` |
| `timeout` (GNU) | `Evals/Graders/CodeBased/BinaryTests.ts` | grader breaks |
| `whisper`, `ffmpeg`, `ffprobe` | `AudioEditor/Tools/{Transcribe,Edit}.ts` (+ Utilities dup), `TOOLS/SplitAndTranscribe.ts` | also `--device-id mps` Apple Metal hardcoded |
| `magick` (ImageMagick) | `Art/Tools/{Generate,FillFrame,ComposeThumbnail}.ts`, `TOOLS/AddBg.ts` | bare exec |
| `rembg` | `Art/Tools/Generate.ts` (`~/.local/bin/rembg`), `TOOLS/RemoveBg.ts` | POSIX path; env override exists |
| `find`, `tail`, `fd`, `head` | `hooks/{PromptProcessing,RestoreContext}.hook.ts`, `hooks/lib/isa-utils.ts` | degrade silently to empty result |
| `rg`, `curl` | `TOOLS/{CostTracker,KnowledgeHarvester,RelationshipReflect}.ts` | POSIX shell idioms in command string |
| `readlink`, `brew`, `bash -c \| curl \| bash` | `TOOLS/pai.ts` (update + MCP-symlink path) | macOS-only update flow |
| `dig`, `whois`, `subfinder`, `masscan`, `nmap`, `ffuf` | `Packs/Security/Recon/Tools/*` | entire recon toolchain |
| `kitten`, `kitty`, `cmux`, `sh -c stty`, `tput` | `hooks/lib/tab-setter.ts`, `TOOLS/Banner*.ts` | terminal control; banners degrade gracefully |
| `mkcert`, `sudo`, `/etc/hosts`, `ps -p`, `launchctl` | `PULSE/setup.ts` | macOS installer step |

## Findings by area

### Pulse daemon + voice — most platform-coupled subsystem

| File | Lines | Severity | Assumption |
|------|-------|----------|------------|
| `PULSE/VoiceServer/voice.ts` | 356, 361, 369 | BLOCKER | audio via `/usr/bin/afplay`, temp `/tmp/voice-*.mp3`, cleanup `/bin/rm` — no win32 branch |
| `PULSE/VoiceServer/voice.ts` | 381-393 | BLOCKER | desktop notification via `osascript` AppleScript |
| `PULSE/setup.ts` | 254-365 | BLOCKER | `/etc/hosts` + `sudo`, `which mkcert`/`brew install`, launchd plist install, `ps -p` |
| `PULSE/lib.ts` | 252-258 | MAJOR | `spawnScript()` runs all checks via `Bun.spawn(["bash","-c",...])` (Git Bash dependency) |
| `PULSE/lib.ts` | 206-207 | MAJOR | email fallback hardcodes `/opt/homebrew/bin/gws` |
| `PULSE/lib/messages-db.ts`, `lib/imessage-send.ts`, `modules/imessage.ts` | various | MAJOR | iMessage: `~/Library/Messages/chat.db` + AppleScript (config-gated off by default → degrades) |
| `PULSE/checks/github-work.ts` | 279-285 | MAJOR | spawns `claude`; `~/.local/bin/claude` fallback |
| `PULSE/start-pulse.sh`, `manage.sh`, `com.pai.pulse.plist`, `MenuBar/*` | — | MINOR | macOS service mgmt + Swift menubar app; superseded on Windows by `.ps1` autostart (menubar has no Windows equivalent) |
| `PULSE/start-pulse-hidden.ps1`, `install-pulse-autostart.ps1` | all | MINOR | **already handled** — correct Windows autostart |

### Hooks

| File | Lines | Severity | Assumption |
|------|-------|----------|------------|
| `hooks/lib/tab-setter.ts` | 106, 148, 214, 217 | BLOCKER | `command -v kitten` + `/Applications/kitty.app/...`, `/tmp/kitty-$USER` socket, `jq` pipe |
| `hooks/RestoreContext.hook.ts` | 161-164 | BLOCKER | `fd -t f ... \| head -1 2>/dev/null` (degrades silently) |
| `hooks/ConfigAudit.hook.ts` | 45 | MAJOR | `/tmp/pai-settings-snapshot.json` |
| `hooks/lib/notifications.ts` | 15 | MAJOR | `/tmp/pai-session-start.txt` |
| `hooks/TaskGovernance.hook.ts` | 48 | MAJOR | `/tmp/pai-task-governance.json` |
| `hooks/lib/isa-utils.ts` | 392-396 | MAJOR | `tail -200` shellout |
| `hooks/PromptProcessing.hook.ts` | 628-629 | MAJOR | `find ... -maxdepth` Unix syntax |
| `hooks/security/inspectors/PatternInspector.ts` | 86-99 | MINOR | glob regex hardcodes `/` separators — security patterns may miss Windows `\` paths |
| `hooks/handlers/UpdateCounts.ts` | 194-201 | MINOR | Keychain `security find-generic-password` — **has darwin branch**; else reads `.credentials.json` (works on Windows) |
| `hooks/ContextReduction.hook.sh` | whole | MAJOR | bash-only RTK hook; self-guards (exits if rtk/jq absent) so the token-reduction feature is simply dead on Windows |
| `hooks/lib/paths.ts` | — | MINOR | **reference** — the correct portable pattern to copy |

No `afplay`/`osascript`/`notify-send` in the hook tree — notifications route through the Pulse HTTP server (`localhost:31337/notify`), so they are platform-neutral at the hook layer (they just need Pulse running).

### PAI tools + bin

| File | Lines | Severity | Assumption |
|------|-------|----------|------------|
| `TOOLS/pai.ts` | 185, 471, 480 | BLOCKER | `readlink`, `brew upgrade bun`, `bash -c "curl \| bash"` |
| `TOOLS/algorithm.ts` | 835, 1317, 1430, 1496 | BLOCKER | spawns bare `claude` (no shell/PATHEXT) — core driver |
| `TOOLS/Inference.ts` | 137 | BLOCKER | `spawn('claude', args)` — core inference path |
| `TOOLS/ForgeProgress.ts` | 65, 225 | BLOCKER | hardcodes `~/.bun/bin/codex` POSIX path, no `.exe`/`.cmd`. **Note:** contrary to the field report, this release has no PATHEXT candidate list here |
| `TOOLS/AnvilProgress.ts` | 64 | BLOCKER | `homeDir()` throws if `HOME` unset |
| `TOOLS/HealthSnapshot.ts` | 7-8 | BLOCKER | macOS iCloud path `~/Library/Mobile Documents/com~apple~CloudDocs/` |
| `TOOLS/SecretScan.ts` | 60 | MAJOR | `trufflehog` bare exec |
| `TOOLS/{DocCheck,ReferenceCheck,CostTracker,KnowledgeHarvester}.ts` | various | MAJOR | `git`/`rg` via `execSync` with `2>/dev/null` / `;` / `\|\| true` POSIX idioms |
| `TOOLS/PreviewMarkdown.ts` | 59 | MINOR | macOS `open` |
| `bin/llcli/llcli.ts` | — | MINOR | clean — `homedir()` + `fetch`, no work needed |

### Installer + settings — mostly already cross-platform

| File | Lines | Severity | Assumption |
|------|-------|----------|------------|
| `settings.json` | 95, 370 | BLOCKER | `ContextReduction.hook.sh` + `statusline-command.sh` — bare `.sh`, no interpreter; Windows has no `/bin/bash` |
| `settings.json` | hook command lines | BLOCKER | every `*.hook.ts` is a bare path with no `bun`/`bun.exe` prefix; relies on shebang + exec bit |
| `PAI-Install/engine/detect.ts` | 32-90, 353-391 | MINOR | **already handled** — reports `win32`, PATHEXT/PATH scanner, `USERNAME` fallback, darwin-gated `defaults` |
| `PAI-Install/engine/actions.ts` | 854-1642 | MINOR | **already handled** — winget guidance, `install-pulse-autostart.ps1`, bun-symlink/alias skipped on win32 |
| `install.ps1` | whole | MINOR | **already handled** — native Windows bootstrap → `main.ts --mode cli` |
| `install.sh` | 84-291 | MINOR | **already handled** — maps MINGW/MSYS/CYGWIN to `windows`, skips zsh/symlink steps |
| `PAI-Install/engine/validate.ts` | 60-66 | MINOR | smoke test runs hook via `process.execPath` (bun directly), so it would PASS even though Claude Code's shebang-based hook invocation FAILS — masks the settings.json breakage above |
| `Tools/validate-protected.ts` | 69 | MAJOR | `git` via bare `execSync`, no PATHEXT (maintainer pre-commit tool) |
| `Tools/BackupRestore.ts` | 136-179 | MINOR | `startsWith("/")` misreads a Windows `C:\` path as relative |

A subtle trap worth keeping: `validate.ts`'s smoke test invokes a hook through `process.execPath` (the bun binary), so it passes — but Claude Code on Windows launches hooks via the bare command string in `settings.json`, which has no interpreter. The installer can report success on a system where every hook silently fails to launch.

### Skills

Zero files in the skills tree contain any `process.platform`/`win32` check — no OS branching exists. Worst skills:

| File | Lines | Severity | Assumption |
|------|-------|----------|------------|
| `AudioEditor/Tools/Transcribe.ts` | 40-49, 71 | BLOCKER | `which` detection + `--device-id mps` + bare `whisper` |
| `Webdesign/Tools/{DriveClaudeDesign,VerifyDesign}.ts` | 18, 33 | BLOCKER | `which interceptor` gate → `exit 127` |
| `Prompting/Tools/RenderTemplate.ts` (×2) | 180 | BLOCKER | `Bun.spawnSync(['ls', dir])` — trivial fix to `readdirSync` |
| `Evals/Graders/CodeBased/{BinaryTests,StaticAnalysis}.ts` | 33, 29 | BLOCKER | `cd && timeout` GNU coreutil |
| `Art/Tools/*` | various | MAJOR | `~/.local/bin/rembg`, `${HOME}/Downloads`, `HOME!`, bare `magick` |
| `Interceptor/SKILL.md`, `Research/Workflows/Fabric.md` | — | MINOR | macOS-only install docs (`launchctl`, `/opt/homebrew`, `pbpaste`) |

**Scope caveat:** the `Security/WebAssessment/BugBountyTool` literal-`~/.claude` bug (and the Security/Scraping/Media skills generally) is **not in the v5.0.0 release tree** — those exist only as global skills. The fix the field report describes was applied to `Packs/Security/.../config.ts` and the live tree; it cannot be verified from the release snapshot. The recon toolchain bugs above are in `Packs/Security/`, which is in scope.

## Already handled (Windows coverage that exists)

Worth knowing so it is not re-done:
- **Installer engine** — `detect.ts`, `actions.ts`, `install.ps1`, `install.sh` all have committed `win32` branches (OS detection, tool resolution via PATHEXT, Pulse autostart, Git guidance, skipping Unix-only steps).
- **Daemon autostart** — `PULSE/start-pulse-hidden.ps1` + `install-pulse-autostart.ps1` + Startup-folder VBS replace launchd/systemd.
- **Hook interpreter prefixes (live tree — verified 2026-06-30)** — the live `settings.json` already prefixes every PAI `*.hook.ts` with `"$HOME/.bun/bin/bun.exe"` and uses explicit `node`/`bash` for GSD hooks. This is the back-port source for the release snapshot, which still ships bare paths.
- **`voice.ts` Windows audio (live tree — verified 2026-06-30)** — the live `PAI/PULSE/VoiceServer/voice.ts` has a real `win32` branch (`powershell.exe -File play-mp3.ps1`/`play-wav.ps1`), a Piper TTS provider, `tmpdir()` instead of `/tmp`, and an `osascript` notification that early-returns off-darwin. `play-mp3.ps1`, `play-wav.ps1`, and `piper/` are present. Suitable as-is; the fix is to back-port it into the release.
- **Reference patterns to copy** — `TOOLS/algorithm.ts:58`, `PULSE/pulse.ts:24`, `skills/Agents/Tools/ComposeAgent.ts:37` show the correct `HOME ?? USERPROFILE ?? homedir()` chain (verified live). **Not `hooks/lib/paths.ts`** — it uses bare `os.homedir()` and is not an exemplar of the env-var-first chain. `hooks/handlers/UpdateCounts.ts` shows the correct Keychain-vs-disk credential branch.

## Top files to analyze further (priority order)

1. **`PULSE/VoiceServer/voice.ts`** — core voice/audio engine. **Release snapshot has zero Windows path; the live tree is already fixed (verified 2026-06-30).** The work is a straight back-port of the live tree's Piper + `play-mp3.ps1`/`play-wav.ps1` + off-darwin notify early-return into the release — not new design. (ElevenLabs TTS itself is portable `fetch`; only local playback + notify were broken.)
2. **`settings.json`** — every hook command and the statusline are bare `.ts`/`.sh` paths with no interpreter. Decide whether Windows needs explicit `bun.exe`/`node` prefixes (the live tree has them) and how to handle the two `.sh` entries. Highest blast radius: breaks every Bash/Write/Edit/Read hook including the security pipeline.
3. **HOME-resolution sweep** — one shared helper propagated to the ~70 files in cross-cutting blocker #1. Largest category, mechanical, low risk.
4. **`TOOLS/pai.ts`, `TOOLS/algorithm.ts`, `TOOLS/Inference.ts`** — the main CLI and the core algorithm/inference drivers spawn bare `claude`/`readlink`/`brew`/`bash`. If the Windows `claude` launcher is `claude.cmd`, bare `spawn` without `shell:true` fails with ENOENT. Load-bearing runtime paths.
5. **`hooks/lib/tab-setter.ts`** — densest single-file blocker cluster (kitty/kitten/cmux, `/tmp/kitty-$USER`, `jq`). Needs a `win32` early-out or a Windows-terminal strategy.
6. **`PULSE/setup.ts` and `PULSE/lib.ts`** — installer `/etc/hosts`/`mkcert`/launchd and the `bash -c` check-runner; decide Windows install + check-execution strategy.
7. **`AudioEditor/Tools/{Transcribe,Edit}.ts`, `Art/Tools/*`, `Webdesign/Tools/*`, `Evals/Graders/CodeBased/*`, `Prompting/Tools/RenderTemplate.ts`** — skill-level external-binary and `which`/`ls`/`timeout` shellouts. `RenderTemplate.ts` is a one-line `readdirSync` fix; the rest need binary-resolution + tool-availability decisions.
8. **`Packs/Security/Recon/Tools/*` + `bounty.sh`, `Packs/Art/Tools/*`, `Packs/AudioEditor/Tools/*`** — same patterns in the active pack sources; remember the `Packs/Utilities/` and `Packs/Media/` duplicates.
9. **`Tools/validate-protected.ts`, `Tools/BackupRestore.ts`** — maintainer utilities; lower priority but fail on Windows if used.

## Recommended sequencing

The cheapest high-coverage path: (a) land the shared `HOME` helper and `os.tmpdir()` substitution first — it clears the bulk of the MAJOR/BLOCKER count across every area with near-zero behavioral risk; (b) fix `settings.json` interpreter prefixes, since without that no hook runs at all on a native install; (c) back-port `voice.ts`; (d) then work the skill/tool external-binary findings, which need per-tool availability decisions rather than a single sweep.
