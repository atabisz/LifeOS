# PAI Platform Compatibility Status

This document tracks all platform-specific code and dependencies across PAI, providing a roadmap for cross-platform support.

**Last Updated:** 2026-07-02
**Maintainer:** Community contributions welcome

---

## Platform Support Matrix

| Platform | Status | Notes |
|----------|--------|-------|
| **macOS** | ✅ Fully Supported | Primary development platform |
| **Linux** | ✅ Fully Supported | Ubuntu/Debian tested, other distros via community |
| **Windows** | ✅ Supported | Verified on Windows 11 + `windows-latest` CI (hook launch parity, `0 LAUNCH-FAIL`). Requires Git Bash + Bun; some optional heavy binaries (ffmpeg, whisper, magick) degrade gracefully with a warning if absent. Newer than mac/Linux — see item 22 for the details of what landed. |

---

## Known Platform-Specific Issues (22 Total)

### ✅ FIXED (PR #XXX - Linux Compatibility Fixes)

**Critical Blockers:**
1. ✅ `sed -i ''` syntax (macOS BSD vs GNU sed)
   - **File:** Voice system INSTALL.md
   - **Fix:** Platform-aware sed with USERNAME fallback
   - **Status:** Fixed with conditional `uname -s` detection

2. ✅ `/opt/homebrew/bin` hardcoded in PATH
   - **Files:** `pai-observability-server/src/Observability/manage.sh:8`, `pai-observability-server.md:1316`
   - **Fix:** Conditional PATH based on directory existence
   - **Status:** Fixed with `[ -d "/opt/homebrew/bin" ]` check

**Auto-Start Feature Parity:**
3. ✅ LaunchAgent plist only (no Linux alternative)
   - **File:** Voice system INSTALL.md Step 9
   - **Fix:** Added systemd user service for Linux
   - **Status:** Linux now has full auto-start support

4. ✅ launchctl commands (macOS-only daemon management)
   - **Context:** Part of LaunchAgent system
   - **Fix:** systemd equivalent provided for Linux
   - **Status:** Platform-specific but both supported

5. ✅ ~/Library/LaunchAgents path (macOS directory structure)
   - **Context:** Part of LaunchAgent system
   - **Fix:** Linux uses `~/.config/systemd/user`
   - **Status:** Platform-specific but both supported

**Documentation:**
6. ✅ VERIFY.md misleading "requires modifications" warning
   - **File:** Voice system VERIFY.md
   - **Fix:** Updated to reflect Linux is fully supported
   - **Status:** Documentation now accurate

6a. ✅ `Pulse` vs `PULSE` directory casing mismatch
   - **Files:** `Releases/v5.0.0/.claude/PAI/PULSE/{run-job,lib,setup,pulse-unified}.ts`,
     `PULSE/modules/{imessage,user-index}.ts`, `PULSE/Performance/cost-aggregator.ts`,
     `PULSE/checks/{notification-governor,poller-meta-monitor,github-work}.ts`,
     `PULSE/Observability/observability.ts` (11 files, 14 occurrences)
   - **Issue:** Source referenced `~/.claude/PAI/Pulse/...` but directory on disk is `PULSE`. Worked on macOS APFS (case-insensitive default) but broke on Linux ext4 and case-sensitive APFS — config and state lookups silently missed.
   - **Fix:** Aligned all `path.join(...)` literals to `"PULSE"`.
   - **Tested:** Linux (Ubuntu, runtime-verified). Behavior unchanged on case-insensitive filesystems (macOS default, NTFS).

---

### 📋 ALREADY HANDLED (No Action Needed)

**Audio Playback (Fixed in PR #285 - Google TTS):**
17. ✅ afplay calls conditionally executed
    - **File:** Voice server source
    - **Status:** Runtime platform detection via `process.platform`
    - **Implementation:** macOS uses afplay, Linux auto-detects mpg123/mpv/snap

18. ✅ Linux audio player auto-detection
    - **Status:** Fully implemented with graceful fallbacks
    - **Priority:** mpg123 → mpv → snap/mpv → warn user

19. ✅ Cross-platform notifications
    - **macOS:** osascript (native notification center)
    - **Linux:** notify-send (libnotify)
    - **Status:** Both fully implemented

20. ✅ process.platform checks
    - **Status:** Correct pattern throughout codebase
    - **Note:** Needs Windows support added (future work)

21. ✅ Bun runtime
    - **Status:** Cross-platform, no issues
    - **Installation:** Works on macOS, Linux, Windows

---

### 🔮 MINOR ISSUES (Low Priority)

**Documentation Inconsistencies:**
7. 🔮 Platform check mentions paplay but code doesn't use it
   - **File:** Voice system INSTALL.md platform check
   - **Impact:** Minor - doesn't block functionality
   - **Fix:** Either add paplay support or remove from docs
   - **Priority:** Low - mpg123/mpv work fine

8. 🔮 /Users/ hardcoded paths in examples
   - **Files:** Various documentation showing macOS examples
   - **Impact:** Documentation only, not actual code
   - **Fix:** Use generic paths like `$HOME` in examples
   - **Priority:** Low - users can adapt examples

**macOS-Specific Features (Can't Test Without macOS):**
9-14. 🔮 LaunchAgent plist internals (6 specific property keys)
    - **Context:** macOS-only format
    - **Status:** Not applicable to Linux
    - **Priority:** Low - macOS functionality works

15. 🔮 osascript for notifications
    - **Status:** Already has notify-send fallback
    - **Priority:** Low - both platforms supported

16. 🔮 ~/Library/Logs for logging
    - **Status:** Already uses `~/.config/pai` on Linux
    - **Priority:** Low - platform-appropriate paths used

---

### ✅ WINDOWS SUPPORT LANDED (2026-07-02)

22. ✅ Windows support implemented and CI-verified
    - **Audio:** MCI playback via PowerShell helpers (`PULSE/VoiceServer/play-mp3.ps1`, `play-wav.ps1`); `voice.ts` has a `process.platform === "win32"` branch.
    - **Auto-start:** `PULSE/start-pulse-hidden.vbs` starts the Pulse daemon hidden at logon (the Windows equivalent of the LaunchAgent/systemd unit).
    - **Shell scripts / hooks:** the installer normalizes each hook's interpreter per-OS at config-generation time (`PAI-Install/engine/actions.ts` `normalizePaiHookCommands` — Windows adds a `bun.exe`/`bash` prefix; mac/Linux is a byte-identical no-op). Claude Code launches hooks through Git Bash `sh`, which is required on Windows.
    - **CI:** `.github/workflows/windows-smoke.yml` runs the hook launch-parity smoke test on `windows-latest`; the first live run is green (`0 LAUNCH-FAIL`).
    - **How it was done:** see the field report [WINDOWS-INSTALL.md](docs/WINDOWS-INSTALL.md) and the implementation plan [WINDOWS-SUPPORT-PLAN.md](docs/WINDOWS-SUPPORT-PLAN.md).

    **Remaining gaps (community contributions welcome):**
    - **Notifications:** no native Windows Toast integration yet (voice + Pulse dashboard work; toast is the open item).
    - **Optional heavy binaries** (ffmpeg, whisper, magick, GNU `timeout`) degrade gracefully with a warning rather than being bundled — install them for full media/eval functionality.
    - **Breadth of testing:** verified on Windows 11 + `windows-latest` CI; older Windows and diverse toolchains are still community-tested.

---

## Platform Detection Patterns

**Recommended pattern (used throughout PAI):**

```bash
# Shell scripts
OS_TYPE="$(uname -s)"
if [ "$OS_TYPE" = "Darwin" ]; then
  # macOS-specific code
elif [ "$OS_TYPE" = "Linux" ]; then
  # Linux-specific code
else
  echo "Unsupported platform: $OS_TYPE"
fi
```

```typescript
// TypeScript/Bun code
if (process.platform === 'darwin') {
  // macOS-specific code
} else if (process.platform === 'linux') {
  // Linux-specific code
} else if (process.platform === 'win32') {
  // Windows-specific code (future)
}
```

**Anti-patterns to avoid:**
- Hardcoding paths that only exist on one platform
- Assuming package manager locations (Homebrew, apt, etc.)
- Using platform-specific syntax without detection (sed -i '', etc.)
- Skipping platform checks in documentation examples

---

## Testing Requirements

Contributors fixing platform issues should:

1. **Test on target platform** - Don't submit untested code
2. **Document limitations** - Be honest about what you couldn't test
3. **Follow PAI principles** - Simple, transparent, UNIX philosophy
4. **Maintain backward compatibility** - Don't break existing platforms
5. **Add to this document** - Update the inventory with your fixes

**Current test coverage:**
- macOS: Tested by Daniel Miessler
- Linux (Ubuntu/WSL2): Tested by contributors
- Linux (other distros): Community testing
- Windows (11): Tested — live install + `windows-latest` CI hook launch-parity (`0 LAUNCH-FAIL`); older Windows community-tested

---

## Future Work

**High Priority:**
- Windows native Toast notification support (audio playback ✅ and auto-start ✅ landed 2026-07-02 — see item 22)

**Medium Priority:**
- Test on non-Ubuntu Linux distros (Fedora, Arch, etc.)
- Improve error messages for missing dependencies
- Add platform compatibility checks to installation

**Low Priority:**
- Support for alternative package managers
- Docker/container deployment guide
- Automated multi-platform testing (CI/CD)

---

## How to Report Platform Issues

1. Check this document to see if the issue is already known
2. Test on a clean installation (not your dev environment)
3. Open a GitHub issue with:
   - Platform details (OS, version, package manager)
   - Error message or unexpected behavior
   - Steps to reproduce
   - Proposed solution (if you have one)

**Before submitting:** Try to fix it yourself! PAI is community-driven.

---

## Contribution Guidelines

When contributing platform fixes:

1. **Fix what you can test** - Don't guess, verify
2. **Document what you can't** - Be honest about limitations
3. **Keep it simple** - Follow PAI's UNIX philosophy
4. **Stay transparent** - No magic abstractions
5. **Add tests** - At minimum, manual verification steps

**Good PR example:** "feat: Add systemd auto-start for Linux (tested on Ubuntu 24.04)"

**Bad PR example:** "feat: Universal auto-start abstraction framework for all platforms"

---

## Credits

**Platform compatibility work by:**
- Daniel Miessler - Original PAI implementation (macOS focus)
- PR #285 - Google Cloud TTS provider, Linux audio support
- PR #XXX - Linux compatibility fixes (sed, PATH, systemd)
- Community contributors - Testing and bug reports

Want your name here? Contribute a platform fix!
