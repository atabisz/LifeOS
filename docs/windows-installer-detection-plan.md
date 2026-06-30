# Plan: cross-platform detection core for the PAI installer

Goal: one install base for Windows, macOS, and Linux, with OS and tool paths always auto-detected. This plan covers the foundation — the installer's detection layer — so that `detectSystem()` returns correct results on all three platforms and the engine code that consumes it compiles and behaves correctly when the platform is `win32`.

Out of scope for this task (separate follow-on, see "Next phase" below): the bootstrap `install.sh` Windows path, a Windows entry point, and the zsh post-install handoff. Detection is independently testable without those — `detectSystem()` can be called directly with bun.

## Why detection first

`detect.ts` is the literal subject of the goal ("OS and tool paths always auto detected"). It is pure TypeScript — deterministic and testable in isolation, no install side effects. Today it is structurally Unix-only and silently misdetects Windows as Linux. Fixing it is a self-contained, reviewable unit that the rest of the installer builds on.

## Target

All paths under `Releases/v5.0.0/.claude/PAI/PAI-Install/`. This is the canonical installer in this repo (`atabisz/Personal_AI_Infrastructure` fork). Do not touch the live `~/.claude` tree.

## Changes

### 1. Type contract — `engine/types.ts`

- Line 10: change `platform: "darwin" | "linux"` to `platform: "darwin" | "linux" | "win32"`.
- This is the contract change that makes the rest type-check. After editing, every `switch`/`if` on `os.platform` that assumed two values must handle the third — the compiler will flag exhaustiveness gaps if any exist; resolve them per the branches below.

### 2. Detection core — `engine/detect.ts`

Make each detector platform-aware. Use `process.platform` as the single source of truth (it returns `"win32"` on Windows).

- **`detectOS` (line 24).** Replace the forced `darwin ? darwin : linux` ternary with a three-way map: `darwin` → macOS, `win32` → Windows, else `linux`. For Windows, populate `version`/`name` from `os.release()` and a "Windows" label (use the `os` module — `release()` and optionally `version()` — not a shelled `uname`). Keep the existing macOS `sw_vers` and Linux `/etc/os-release` paths unchanged.
- **`detectTool` (line 55).** Replace the bare `which ${name}` with a cross-platform resolver:
  - On non-Windows: keep `which ${name}` (unchanged behaviour).
  - On Windows: do not rely on `which` (not guaranteed) or on `where` alone. Resolve by scanning `PATH` entries for `name` + each `PATHEXT` candidate. Implement a helper that, given a bare tool name, tries `[".exe", ".cmd", ".bat", ".com", ""]` (drive the list from `process.env.PATHEXT` when present, falling back to that literal list) against each directory in `process.env.PATH` (split on `;`), returning the first hit via `existsSync`. This mirrors the documented `ForgeProgress.ts` pattern (the doc cites `[".exe",".cmd",".bat",""]`); implement it fresh here since the v5.0.0 snapshot does not contain that helper. Version extraction (the regex on `--version` output) stays as-is.
- **`detectShell` (line 44).** `$SHELL` is unset on Windows. Fall back to `process.env.ComSpec` (cmd.exe) on Windows; keep `$SHELL || "/bin/sh"` elsewhere. Guard the `${shellPath} --version` call so it does not error on `cmd.exe` (cmd has no `--version`); it is fine for `version` to be empty on Windows.
- **`detectPrincipal` (line 296).** `username` falls back through `$USER`/`$LOGNAME` — add `process.env.USERNAME` (the Windows variable) to that chain. Leave git config name/email as-is (cross-platform already). The macOS `dscl` branch is correctly guarded by `process.platform === "darwin"`; leave it.
- **`scanApiKeys` (line 115).** Add `~/.claude/.env` to the candidate list — the doc establishes this as the real env-file location on the live Windows install, and it is harmless on Unix. Keep the existing rc-file candidates.
- **`brew` detection (lines 351–353).** `which brew` returns null on Windows (correct: brew absent), so behaviour is already right, but it shells `which` twice. Leave functional behaviour unchanged; if you route brew through the same resolver helper for consistency, that is acceptable but optional — do not change the result.
- **`detectVoice` (line 329).** Already guarded `process.platform !== "darwin"` → returns undefined off macOS. Leave it; a Windows voice probe is not in scope.

### 3. Engine consumers — `engine/actions.ts`

- **`runPrerequisites` Git install (line 839).** The current `if darwin … else // Linux` falls through to `sudo apt-get`/`yum` for any non-darwin platform — which would run Unix package managers on Windows. Add an explicit `win32` branch before the Linux `else`: emit a message telling the user to install Git for Windows (or via `winget install Git.Git`) rather than attempting a package-manager install. Do not attempt automated install on Windows.
- **Bun unzip check (line 864).** Already gated `=== "linux"` — correct, no change needed.
- **rc-file handling (lines ~165 and ~1526).** These hardcode `.zshrc`/`.bashrc` for the `pai` alias and PATH export. On Windows there is no zsh/bash login profile in the same sense. For this task, guard these so they do not run (or no-op cleanly) when `platform === "win32"` — do not write a `.zshrc` on Windows. A proper Windows alias mechanism is part of the bootstrap follow-on, not this task; a clean skip is the correct behaviour here. Leave the macOS/Linux paths unchanged.

### 4. Validation — `engine/validate.ts`

- **`.zshrc` alias check (lines 250–262).** This reports "alias not configured" by reading `~/.zshrc`. On Windows that file will not exist, producing a misleading failed check. Guard the check so on `win32` it is skipped or reported as not-applicable (non-critical) rather than failed. Keep the macOS/Linux behaviour identical.

## Constraints

- bun, never npm/npx. TypeScript only.
- No hardcoded user paths — use `homedir()`, `process.env`, `join()`. Never `${HOME}/.`-style literals.
- Do not regress macOS or Linux. Every existing Unix code path must behave exactly as before; Windows is purely additive branches.
- Do not commit. Leave changes in the working tree for review unless explicitly told otherwise.

## Verification (required before reporting done)

1. **Type-check.** From the installer dir, run a type-check with bun (e.g. `bunx tsc --noEmit` against the installer's tsconfig, or `bun build` of `main.ts`). It must pass with zero errors — the `"win32"` union addition must be fully handled.
2. **Detection smoke test on this machine (Windows).** Run a one-off that imports and calls `detectSystem()` and prints the result, e.g.:
   `bun -e "import('./engine/detect.ts').then(m => console.log(JSON.stringify(m.detectSystem(), null, 2)))"` from the installer dir.
   Confirm: `os.platform === "win32"`, `os.name` mentions Windows, `tools.bun`/`tools.git`/`tools.node` each resolve to a real `.exe` path (bun and git and node are on PATH on this box), `shell` is populated (ComSpec), `principal.username` is non-empty.
3. **Report the actual JSON** from step 2 in the summary, plus the type-check result. If any tool fails to resolve, say so — do not claim success on an unverified probe.

## Next phase (not this task)

Bootstrap reachability so the detection core can actually run during a Windows install:
- `install.sh` line 90 — a `MINGW*`/`MSYS*`/`CYGWIN*` case (Git Bash reports `MINGW64_NT-…`) instead of `exit 1`.
- A Windows-native entry point (`.ps1`/`.cmd`) that does not depend on Git Bash being present.
- The post-install handoff (line 275 `exec zsh -i -c '… pai'`) needs a non-zsh path on Windows.
