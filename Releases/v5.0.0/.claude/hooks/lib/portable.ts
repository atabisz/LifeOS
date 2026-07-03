/**
 * Portable environment resolution — cross-platform HOME and temp-dir.
 *
 * Single source of truth for the env-var-first home-directory chain and the
 * OS temp directory. Import this instead of writing `process.env.HOME!` or a
 * hardcoded `/tmp` literal — those break on Windows:
 *   - `process.env.HOME!` throws when HOME is unset (native Windows login /
 *     autostart context sets USERPROFILE, not HOME).
 *   - `process.env.HOME || ""` collapses every PAI path to a relative/`/`-root,
 *     silently writing to the wrong place.
 *   - `/tmp` does not exist on Windows.
 *
 * Generalizes the correct inline chain already used at
 * `PAI/TOOLS/algorithm.ts:58`, `PAI/PULSE/pulse.ts:24`, and
 * `skills/Agents/Tools/ComposeAgent.ts:37`. NOTE: `hooks/lib/paths.ts` is NOT
 * the exemplar — it uses bare `os.homedir()` and never reads the env vars, so
 * it does not honor an explicitly-set HOME/USERPROFILE. This module does.
 */

import { homedir, tmpdir } from 'os';

/**
 * Resolve the home directory, env-var-first.
 * Priority: HOME (Unix, Git Bash) → USERPROFILE (native Windows) → os.homedir().
 * Never throws; os.homedir() is the guaranteed non-empty fallback.
 */
export function home(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

/**
 * Resolve the OS temp directory (Windows-safe replacement for a `/tmp` literal).
 * Honors an explicit TMPDIR/TEMP/TMP override before falling back to os.tmpdir().
 */
export function tmp(): string {
  return process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? tmpdir();
}
