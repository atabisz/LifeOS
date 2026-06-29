# Running LifeOS (PAI) natively on Windows

What it actually took to get LifeOS running on Windows 11 - Pulse daemon, voice, hooks, and all. This is a field report from a working install, not a plan. Every file cited here was verified on the live machine.

## The starting point: officially unsupported

Upstream ships macOS/Linux only. Two facts set the baseline:

- The installer refuses to run. [Releases/v5.0.0/.claude/install.sh](../Releases/v5.0.0/.claude/install.sh) does `OS="$(uname -s)"` and `case` matches only `Darwin` and `Linux` - anything else hits `error "Unsupported platform: $OS"; exit 1`. On this box `uname -s` returns `MINGW64_NT-10.0-26200`, so the bootstrap aborts before it copies a single file.
- The project says so. [PLATFORM.md](../PLATFORM.md) lists Windows as "❌ Not Supported" and files the whole topic under "Community contributions welcome."

So the native Windows install was not produced by the installer. The `.claude` tree was placed by hand and then adapted at seven specific seams - each one a Unix assumption that breaks on Windows. The rest of this document walks those seams in dependency order: shell and PATH first (everything else needs a working shell), then runtime resolution, hooks, the daemon, and finally voice and audio.

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
- JavaScript hooks run through Node by absolute path - `"C:/Program Files/nodejs/node.exe" "$HOME/.claude/hooks/gsd-check-update.js"` (settings.json line 151).

`$HOME` is expanded at hook-execution time, so the Bun path stays portable across users. The Node path is hardcoded to the default Program Files location (see Technical debt).

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

For interactive use there are batch launchers at the install root. [~/.claude/start-pai.bat](file:///C:/Users/AlexTabisz/.claude/start-pai.bat) loads `.env`, health-checks the voice server on its port, starts it minimized if it is down (`start "PAI Voice Server" /MIN "%USERPROFILE%\.bun\bin\bun.exe" run ...VoiceServer\server.ts`), then `cd /d %USERPROFILE%\.claude` and `call claude`. `stop-pai.bat` stops the server. These are the convenience front door; the Startup-folder VBS (seam 4) is what keeps Pulse alive across logins independent of any terminal.

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

Documented honestly so a future re-install or an upstream PR knows where the rough edges are:

- **Hardcoded Node path.** `settings.json` names `C:/Program Files/nodejs/node.exe` directly. It breaks if Node lives elsewhere; a `PATH`/env lookup would be more portable.
- **Dual launcher ecosystem.** Pulse has both a VBS and a PowerShell launcher doing the same job. This is deliberate (the Intune machine's WSH reliability is uncertain), but it is two things to maintain.
- **Coarse stop.** `stop-pai.bat` uses `taskkill /F /IM bun.exe`, which kills every Bun process, not just the voice server. The PowerShell stop scripts are port-scoped and cleaner.
- **Installer has no win32 case.** `PAI/PAI-Install/engine/detect.ts` defaults unknown platforms to `"linux"` rather than detecting `win32` - fine here because the install was placed by hand, but it means the upstream installer still cannot do this natively.

Two stale documents to ignore or fix:

- **The "31337 returns 404" note is out of date.** `VoiceServer/AUTOSTART-README.md` warns that `:31337/notify` is served by the dashboard and 404s. As of this report, `POST http://localhost:31337/notify` returns `{"status":"success","message":"Notification sent"}` - Pulse now owns that route and voice works on 31337. The standalone voice server on 8888 described in that file is a separate, older path.
- **README-WINDOWS.md is a v4.0.3 relic.** The `~/.claude/README-WINDOWS.md` quick-start says "PAI Version 4.0.3, Algorithm v3.7.0, Voice Port 8888." The live system is PAI 5.0.0 / Algorithm v6.4.9 with voice on 31337. Treat it as historical.

## The core insight

Porting LifeOS to Windows was not a thousand scattered patches - it was seven named seams where a Unix-only system meets Windows. Five of them (shell/PATH, runtime resolution, daemon autostart, audio playback, process model) are generic to *any* Unix daemon moving to Windows; only two (the Piper-for-ElevenLabs voice swap and the hook-invocation wiring) are PAI-specific. The single hardest constraint was not the operating system at all - it was the corporate Intune lockdown that forced VBS/PowerShell autostart because Task Scheduler was admin-denied.
