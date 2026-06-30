# Running LifeOS (PAI) natively on Windows

What it actually took to get LifeOS running on Windows 11 - Pulse daemon, voice, hooks, and all. This is a field report from a working install, not a plan. Every file cited here was verified on the live machine.

## The starting point: officially unsupported

Upstream ships macOS/Linux only. Two facts set the baseline:

- The installer refused to run. At the time of this field report, [Releases/v5.0.0/.claude/install.sh](../Releases/v5.0.0/.claude/install.sh) did `OS="$(uname -s)"` and `case`-matched only `Darwin` and `Linux` - anything else hit `error "Unsupported platform: $OS"; exit 1`. On this box `uname -s` returns `MINGW64_NT-10.0-26200`, so the bootstrap aborted before it copied a single file. **This is no longer true** - see [The installer now supports Windows](#the-installer-now-supports-windows-2026-06-30) below.
- The project says so. [PLATFORM.md](../PLATFORM.md) lists Windows as "❌ Not Supported" and files the whole topic under "Community contributions welcome."

So the native Windows install **on this machine** was not produced by the installer. The `.claude` tree was placed by hand and then adapted at seven specific seams - each one a Unix assumption that breaks on Windows. The rest of this document walks those seams in dependency order: shell and PATH first (everything else needs a working shell), then runtime resolution, hooks, the daemon, and finally voice and audio. The installer changes that make a *fresh* Windows install reproducible without the hand-placement are documented separately in [The installer now supports Windows](#the-installer-now-supports-windows-2026-06-30).

Toolchain present on the machine (all on `PATH` for Git Bash):

| Tool | Version |
|------|---------|
| Bun | 1.3.14 (at `%USERPROFILE%\.bun\bin\bun.exe`) |
| Git | 2.54.0.windows.1 (provides Git Bash + `cygpath`) |
| Claude Code | 2.1.196 |
| Node | v24.18.0 (at `C:\Program Files\nodejs\node.exe`) |

The install is git-tracked to `danielmiessler/LifeOS` and runs PAI 5.0.0 / Algorithm v6.4.9.

## Seam 1: shell and PATH

Claude Code spawns hooks through bash. On Windows that bash inherits the Windows-format `PATH` - semicolon-separated, backslashes - which POSIX bash cannot parse, so `git`, `ls`, `node` all come back "command not found."

The fix is a one-time conversion sourced on every non-interactive bash launch. [~/.claude/bash-env.sh](file:///C:/Users/AlexTabisz/.claude/bash-env.sh) detects a Windows-shaped `PATH` (contains `;` or `\`) and rewrites it through Git's `cygpath.exe`:

```bash
case "$PATH" in
  *\;* | *\\* )
    __cygpath="/c/Program Files/Git/usr/bin/cygpath.exe"
    if [ -x "$__cygpath" ]; then
      __posix_path="$("$__cygpath" -p "$PATH" 2>/dev/null)"
      [ -n "$__posix_path" ] && export PATH="/usr/bin:$__posix_path"
    fi ;;
esac
```

It is idempotent by construction: after conversion there is no `;` or `\` left, so re-sourcing is a no-op. The shim is wired in through the `env` block of [~/.claude/settings.json](file:///C:/Users/AlexTabisz/.claude/settings.json), line 6:

```json
"BASH_ENV": "$HOME/.claude/bash-env.sh",
```

`BASH_ENV` is the standard bash mechanism for "source this before every non-interactive script," which is exactly when hooks run.

## Seam 2: runtime resolution

On Unix the hooks rely on the `#!/usr/bin/env bun` shebang. Windows does not honor shebangs, so the hook commands in `settings.json` name the interpreter explicitly and pass the script as an argument:

- TypeScript hooks run through Bun by absolute path - `"$HOME/.bun/bin/bun.exe" "$HOME/.claude/hooks/SessionMeta.hook.ts"` (settings.json line 159; the same pattern repeats for every `.hook.ts`).
- JavaScript hooks run through Node, invoked by bare name - `node "$HOME/.claude/hooks/gsd-check-update.js"` (settings.json line 151). This originally named Node by absolute path (`C:/Program Files/nodejs/node.exe`); it was de-hardcoded on 2026-06-30 (see Technical debt).

`$HOME` is expanded at hook-execution time, so the Bun path stays portable across users. The bare `node` invocation depends on `node` resolving on the converted `PATH` from seam 1 - which it does, because Git Bash's `cygpath` conversion places `C:\Program Files\nodejs` on the POSIX `PATH` (verified: `which node` returns `/c/Program Files/nodejs/node`).

A related pattern shows up wherever code shells out to a sibling tool: on Windows a bare name like `codex` or `fallow` will not resolve, because Node's executable check does not apply `PATHEXT`. So the cross-platform helpers try a candidate list. `ForgeProgress.ts` builds `[".exe", ".cmd", ".bat", ""]` candidates when `process.platform === "win32"`, and the get-shit-done `fallow-runner.cjs` does the same. The npm-invoking workers (`gsd-check-update-worker.js`, `shell-command-projection.cjs`) set `shell: process.platform === 'win32'` so `child_process` routes through `cmd.exe` and resolves `npm.cmd` via `PATHEXT`.

## Seam 3: hooks

With seams 1 and 2 in place, hooks "just run" - there is no Windows-specific hook framework. The adaptation is entirely in *how they are invoked* (explicit interpreter + bash PATH conversion above), not in the hook code. One behavioral difference worth recording: credential lookup. On macOS the system reads the OAuth token from Keychain; on Windows that branch is skipped and the code falls through to reading `~/.claude/.credentials.json` from disk (`hooks/handlers/UpdateCounts.ts`).

## Seam 4: the daemon (replacing launchd/systemd)

Upstream registers Pulse as a macOS `launchd` service (`com.pai.pulse`) or a Linux `systemd` user service. Windows has neither. The replacement is a login-triggered, windowless, orphaned background process.

The autostart entry is a script in the Startup folder: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PAI-Pulse.vbs`, verified present. It delegates to the canonical launcher [~/.claude/PAI/PULSE/start-pulse-hidden.vbs](file:///C:/Users/AlexTabisz/.claude/PAI/PULSE/start-pulse-hidden.vbs), with [start-pulse-hidden.ps1](file:///C:/Users/AlexTabisz/.claude/PAI/PULSE/start-pulse-hidden.ps1) as a PowerShell-native alternative. Both do the same three things: health-check the port so a restart is idempotent, kill any stale instance, then launch Bun detached so the daemon outlives the launcher.

Why VBS and PowerShell rather than the obvious Task Scheduler entry? The voice server's [AUTOSTART-README.md](file:///C:/Users/AlexTabisz/.claude/VoiceServer/AUTOSTART-README.md) records the answer directly: on this Intune-managed corporate machine, `schtasks` (Task Scheduler) is admin-denied, `mshta` is blocked, and at one point GUI Windows Script Host threw "not enough memory resources." `Start-Process -WindowStyle Hidden` (PowerShell) and `wscript` (VBS) were the only windowless, no-admin paths that worked. This is the single most install-specific constraint in the whole port - it is a property of the locked-down machine, not of Windows in general.

The orphaning pattern matters. The old approach (`start /MIN`) made the server a window-owned child, so closing the Claude terminal killed it. `Start-Process -WindowStyle Hidden` launches with no console and no taskbar button, then the launcher returns immediately - the process is reparented away from any terminal and survives.

## Seam 5: voice/TTS (Piper instead of ElevenLabs)

Upstream's voice is ElevenLabs - a cloud API needing a key and network. This install pins **Piper**, a local, offline neural TTS, so voice works with no API dependency. The pin is one line in [~/.claude/PAI/PULSE/PULSE.toml](file:///C:/Users/AlexTabisz/.claude/PAI/PULSE/PULSE.toml):

```toml
[voice]
enabled = true
tts_provider = "piper"
piper_binary = "${USERPROFILE}/.claude/VoiceServer/piper-bin/piper/piper.exe"
piper_voice_model = "${USERPROFILE}/.claude/VoiceServer/piper-voices/en_US-amy-medium/en_US-amy-medium.onnx"
```

`${USERPROFILE}` is resolved at load time, so the config stays portable. The assets are real and verified on disk: `piper.exe` under `VoiceServer/piper-bin/piper/`, and the `en_US-amy-medium` voice model under `VoiceServer/piper-voices/`. The live Pulse health endpoint reports `voice_system: Piper`, `tts_provider: piper`.

Synthesis path, in [PAI/PULSE/VoiceServer/voice.ts](file:///C:/Users/AlexTabisz/.claude/PAI/PULSE/VoiceServer/voice.ts): `generateAndPlayPiper()` spawns `piper.exe --model <onnx> --output_file <wav> --quiet`, writes the text to the binary's stdin, and then plays the WAV (seam 6). An ElevenLabs key still exists in `~/.claude/.env` as `ELEVENLABS_API_KEY` and serves only as an unused fallback - Piper is pinned, so the cloud path is never taken.

## Seam 6: audio playback

macOS plays audio with `afplay`; Linux with `paplay`/`aplay`/`ffplay`. Windows has none of those, so `voice.ts` adds explicit `win32` branches that shell out to PowerShell helper scripts:

- MP3 (the ElevenLabs path) - voice.ts lines 366-376 spawn `powershell.exe ... -File play-mp3.ps1`, which uses the Media Control Interface (`winmm.dll` `mciSendString`).
- WAV (the Piper path) - voice.ts lines 439-447 spawn `powershell.exe ... -File play-wav.ps1`, which uses `System.Media.SoundPlayer.PlaySync()`.

Both helpers, [play-mp3.ps1](file:///C:/Users/AlexTabisz/.claude/PAI/PULSE/VoiceServer/play-mp3.ps1) and [play-wav.ps1](file:///C:/Users/AlexTabisz/.claude/PAI/PULSE/VoiceServer/play-wav.ps1), are present. The branch structure is clean - each platform gets its native player - and volume is intentionally a no-op on Windows (set it in the system mixer).

## Seam 7: the batch entry points

For interactive use there are batch launchers at the install root. [~/.claude/start-pai.bat](file:///C:/Users/AlexTabisz/.claude/start-pai.bat) loads `.env`, health-checks Pulse on its port, starts it hidden if it is down, then `cd /d %USERPROFILE%\.claude` and `call claude`. `stop-pai.bat` stops Pulse. These are the convenience front door; the Startup-folder VBS (seam 4) is what keeps Pulse alive across logins independent of any terminal.

These two launchers were realigned to Pulse on 2026-06-30. Before that they targeted the retired standalone voice server on port 8888 - now superseded by Pulse on 31337 (seams 4-5) - which made them dead weight at best and dangerous at worst:

- `start-pai.bat` health-checked `http://localhost:8888/health` and, if down, started `VoiceServer\server.ts` minimized; it also sourced `%USERPROFILE%\.config\PAI\.env`, a path that does not exist on this machine (the real env file is `~/.claude/.env`). Both were silent no-ops. It now health-checks `http://localhost:31337/api/pulse/health`, starts Pulse via the canonical hidden launcher [start-pulse-hidden.ps1](file:///C:/Users/AlexTabisz/.claude/PAI/PULSE/start-pulse-hidden.ps1) if down, and loads `~/.claude/.env`.
- `stop-pai.bat` ran `taskkill /F /IM bun.exe /T`. Because Pulse *is* a `bun.exe` process, that command killed the live Pulse daemon and every other Bun process on the box - not a "voice server" that no longer exists. It now resolves the PID bound to `:31337` (`netstat -ano | findstr :31337`) and issues a port-scoped `taskkill /F /PID <pid>`, matching the cleaner PowerShell `stop-voice.ps1` pattern.

## How to verify it is working

Real probes, run on this machine:

```bash
# Pulse daemon alive (returns JSON with voice_system: Piper)
curl -s http://localhost:31337/api/pulse/health

# Voice notification (returns {"status":"success","message":"Notification sent"})
curl -s -X POST http://localhost:31337/notify \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello from Windows","voice_enabled":true}'
```

Both return success against the running install.

## Technical debt and known issues

Documented honestly so a future re-install or an upstream PR knows where the rough edges are. A 2026-06-30 cleanup pass resolved five of these on the live machine; the resolved items are kept here (struck through) for history rather than deleted.

- **~~Literal `~` home-dir fallback.~~** ~~Across the Pulse, `PAI/TOOLS`, and `skills/Agents` TypeScript, ~20 files resolved the home directory as `process.env.HOME ?? "~"` (or `|| "~"`). On Windows `HOME` is set in Git Bash but unset in the native login/autostart context, so the literal `"~"` fallback fired and `path.join("~", ".claude", ...)` produced a *relative* path. The first `mkdir`/`Bun.write` then materialized a stray `~` directory under the process cwd.~~ **Resolved 2026-06-30** - confirmed by a fossil directory `C:\Users\AlexTabisz\~\.claude\PAI\PULSE\state` (empty, created 2026-05-14 by an older `pulse.ts` since fixed). The fossil was deleted, and every site now uses the canonical `process.env.HOME ?? process.env.USERPROFILE ?? homedir()` pattern already at `PAI/PULSE/pulse.ts:24` - 11 files in the live tree, 12 in the repo (`Releases/v5.0.0`, which still had the bug in `pulse.ts` itself). Files: `PULSE/{lib,run-job,setup,pulse-unified,pulse-old}.ts`, `PULSE/modules/wiki.ts`, `PULSE/VoiceServer/voice.ts`, `PAI/TOOLS/{algorithm,DAGrowth,DASchedule}.ts`, `skills/Agents/Tools/ComposeAgent.ts` (+ `PULSE/pulse.ts` in the repo). All parse clean under `bun build`; runtime-verified that with `HOME` unset the path now resolves to an absolute `%USERPROFILE%`-rooted location.
- **~~Hardcoded Node path.~~** ~~`settings.json` names `C:/Program Files/nodejs/node.exe` directly. It breaks if Node lives elsewhere; a `PATH`/env lookup would be more portable.~~ **Resolved 2026-06-30** - all six `gsd-*.js` hook commands now invoke `node` by bare name, resolved through the seam-1 `PATH` (see Seam 2). The six `.ts` hooks that run through `$HOME/.bun/bin/bun.exe` were already portable and were left unchanged.
- **Dual launcher ecosystem.** Pulse has both a VBS and a PowerShell launcher doing the same job. This is deliberate (the Intune machine's WSH reliability is uncertain), but it is two things to maintain. *(Kept by design - not changed.)*
- **~~Coarse stop.~~** ~~`stop-pai.bat` uses `taskkill /F /IM bun.exe`, which kills every Bun process, not just the voice server.~~ **Resolved 2026-06-30** - this was more than coarse: with Pulse running as `bun.exe`, the command killed the live Pulse daemon and every Bun process. `stop-pai.bat` is now port-scoped to `:31337` (see Seam 7).
- **~~Installer has no win32 case.~~** ~~`PAI/PAI-Install/engine/detect.ts` defaults unknown platforms to `"linux"` rather than detecting `win32` - fine here because the install was placed by hand, but it means the upstream installer still cannot do this natively.~~ **Resolved 2026-06-30** - the installer's detection engine, bootstrap, and daemon step were made cross-platform. See [The installer now supports Windows](#the-installer-now-supports-windows-2026-06-30).

Two formerly-stale documents, both addressed on 2026-06-30:

- **~~The "31337 returns 404" note is out of date.~~** `VoiceServer/AUTOSTART-README.md` warned that `:31337/notify` was served by the dashboard and 404'd. `POST http://localhost:31337/notify` returns `{"status":"success","message":"Notification sent"}` - Pulse owns that route and voice works on 31337. **Corrected 2026-06-30**: that note was rewritten to describe the working 31337 path; the rest of the file (which documents the still-present 8888 launcher scripts) was left intact.
- **~~README-WINDOWS.md is a v4.0.3 relic.~~** The `~/.claude/README-WINDOWS.md` quick-start said "PAI Version 4.0.3, Algorithm v3.7.0, Voice Port 8888," contradicting the live PAI 5.0.0 / Algorithm v6.4.9 / voice-on-31337 system on every fact. **Deleted 2026-06-30** (it had zero references anywhere in the tree; this `docs/windows-install.md` is the authoritative account).

> **Note on scope.** Most edits above were made in the live `~/.claude` tree (git-tracked to `atabisz/claude-config`) and were left uncommitted pending review at the time of writing. The literal-`~` fallback fix is the exception: it was applied to *both* the live tree and the repo source under `Releases/v5.0.0/.claude` (this repo, `atabisz/Personal_AI_Infrastructure`), since the bug shipped in the release snapshot too. This document is the repo-side record of what changed.

## The installer now supports Windows (2026-06-30)

The seven seams above describe a *hand-placed* install. A separate pass made the **installer itself** cross-platform, so a fresh Windows install no longer requires placing `.claude` by hand. The goal was one install base for Windows/macOS/Linux with OS and tool paths always auto-detected - additive Windows branches only, with every existing macOS/Linux path left byte-for-byte unchanged. All paths below are under `Releases/v5.0.0/.claude/`.

**Detection engine** ([PAI/PAI-Install/engine/detect.ts](../Releases/v5.0.0/.claude/PAI/PAI-Install/engine/detect.ts), [types.ts](../Releases/v5.0.0/.claude/PAI/PAI-Install/engine/types.ts)). The platform contract widened from `"darwin" | "linux"` to add `"win32"`. `detectOS` now reports Windows (via the `os` module, not a shelled `uname`). `detectTool` resolves binaries through a fresh PATHEXT scanner on Windows (`which` isn't reliable there) - the same `.exe`/`.cmd`/`.bat` candidate idea seam 2 documents, lifted into the installer. `detectShell` falls back to `ComSpec`, `detectPrincipal` adds the `USERNAME` env var, and the key scan now includes `~/.claude/.env`. Verified on this machine: detection reports `platform: win32`, `name: Windows (Windows 11 Enterprise)`, and resolves bun/git/node/claude to real `.exe` paths.

**Bootstrap** ([install.sh](../Releases/v5.0.0/.claude/install.sh), [install.ps1](../Releases/v5.0.0/.claude/install.ps1)). `install.sh` now matches `MINGW*|MSYS*|CYGWIN*` as a `windows` platform instead of `exit 1`, skips the Unix-only bun-symlink/`.zshenv` block (seam 1's PATH conversion covers bun reachability on Windows), and ends with a Windows-appropriate launch hint instead of `exec zsh`. A new `install.ps1` is the native entry point for Windows users without Git Bash - it resolves/installs Bun and hands off to the same TypeScript wizard (`main.ts --mode cli`), so there's genuinely one install base.

**Daemon step** ([PAI/PAI-Install/engine/actions.ts](../Releases/v5.0.0/.claude/PAI/PAI-Install/engine/actions.ts), [PAI/PULSE/install-pulse-autostart.ps1](../Releases/v5.0.0/.claude/PAI/PULSE/install-pulse-autostart.ps1), [start-pulse-hidden.ps1](../Releases/v5.0.0/.claude/PAI/PULSE/start-pulse-hidden.ps1)). The wizard's Pulse-install step is launchd-specific on macOS (`bash manage.sh install` -> `~/Library/LaunchAgents`). On Windows it now spawns `install-pulse-autostart.ps1`, the direct counterpart to `manage.sh install`: it writes a per-user Startup-folder `PAI-Pulse.vbs` (the `.vbs` -> hidden-PowerShell -> `start-pulse-hidden.ps1` indirection is the no-console-flash autostart pattern from seam 4), starts Pulse, and health-checks `:31337`. It exits 0 only when Pulse actually binds, so the wizard trusts its exit code exactly like the macOS path. The Windows launchers ship in the release bundle (previously they lived only in the live tree) and are path-portable via `$PSScriptRoot`.

Two Windows-specific lessons from building these, worth recording because they bite silently:

- **PowerShell 5.1 + UTF-8-without-BOM.** Login scripts must be 7-bit ASCII. PS 5.1 reads a no-BOM UTF-8 file as the ANSI codepage, so box-drawing characters and em-dashes mangle into bytes that derail the parser - a script that "looks fine" fails to parse at login. A tokenizer check passes where full `-File` parsing fails, so verify with `[Language.Parser]::ParseFile`, not `PSParser.Tokenize`.
- **`Invoke-WebRequest` vs localhost health-checks.** On this Intune machine `Invoke-WebRequest http://localhost:31337` takes ~2.4s per call (WPAD proxy auto-discovery + progress rendering) even though curl returns in milliseconds - enough to blow a 2s timeout and falsely report Pulse down. The autostart installer uses a raw `HttpWebRequest` with `Proxy = $null` (~30ms), the curl-equivalent path.

Scope: these are repo-source edits under `Releases/v5.0.0/.claude` (this repo, `atabisz/Personal_AI_Infrastructure`), left uncommitted pending review. The daemon installer was tested end-to-end on this machine through the exact `child_process.spawn` path the wizard uses - registers autostart, confirms `:31337`, returns success - with the live Startup entry backed up and restored unchanged around each run.

## The core insight

Porting LifeOS to Windows was not a thousand scattered patches - it was seven named seams where a Unix-only system meets Windows. Five of them (shell/PATH, runtime resolution, daemon autostart, audio playback, process model) are generic to *any* Unix daemon moving to Windows; only two (the Piper-for-ElevenLabs voice swap and the hook-invocation wiring) are PAI-specific. The single hardest constraint was not the operating system at all - it was the corporate Intune lockdown that forced VBS/PowerShell autostart because Task Scheduler was admin-denied.
