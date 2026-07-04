#!/usr/bin/env bun
/**
 * VersionDiff — Update step 2. Read-only comparison of the LifeOS version this
 * skill payload SHIPS against the version already INSTALLED on the machine, so
 * the Update workflow can early-exit "already current" instead of always doing
 * the full re-overlay.
 *
 *   - payload version:   `install/LifeOS/VERSION` (relative to the skill root) —
 *                        the version the running skill was fetched from.
 *   - installed version: `<configRoot>/LIFEOS/VERSION` — written by DeployCore on
 *                        the prior install.
 *
 * Verdicts:
 *   - installed marker ABSENT  → "needs-upgrade" (a pre-6 / 5.x tree has no marker)
 *   - installed == payload     → "already-current"
 *   - installed != payload     → "needs-upgrade"
 *
 * configRoot resolution mirrors DeployCore.ts exactly (`--config-root` flag →
 * `CLAUDE_CONFIG_DIR` env → `~/.claude`, home via `process.env.HOME || homedir()`)
 * so the two tools always agree on the same tree, and so a POSIX-shell HOME on
 * Windows (git-bash) resolves correctly.
 *
 * READ-ONLY and non-destructive. Exits 0 ALWAYS — detection never "fails"; the
 * Update workflow branches on the `verdict` field. All paths go through `join`,
 * so it is correct on Windows and POSIX alike.
 *
 * Usage:
 *   bun VersionDiff.ts [--config-root <dir>] [--skill-root <dir>]
 *   (emits a single JSON object, jq-pipeable)
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Verdict = "already-current" | "needs-upgrade";

function arg(a: string[], flag: string): string | undefined {
  const i = a.indexOf(flag);
  return i >= 0 && a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : undefined;
}

/** Read + trim a VERSION file; null if absent or unreadable. Trim so a trailing
 *  newline (which most editors add) never reads as a version difference. */
function readVersion(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

function main(): void {
  const a = process.argv.slice(2);
  const home = process.env.HOME || homedir();
  const configRoot = arg(a, "--config-root") || process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const skillRoot = arg(a, "--skill-root") || join(import.meta.dir, "..");

  const payloadVersionPath = join(skillRoot, "install", "LifeOS", "VERSION");
  const installedVersionPath = join(configRoot, "LIFEOS", "VERSION");

  const payload = readVersion(payloadVersionPath);
  const installed = readVersion(installedVersionPath);

  // Verdict: no installed marker OR a mismatch → needs upgrade; equal → current.
  const verdict: Verdict =
    installed !== null && payload !== null && installed === payload ? "already-current" : "needs-upgrade";

  const reason =
    installed === null
      ? "no installed marker (pre-6 tree) — needs upgrade"
      : payload === null
        ? "payload VERSION missing — cannot confirm current, treating as needs upgrade"
        : installed === payload
          ? "installed matches payload — already current"
          : "installed differs from payload — needs upgrade";

  console.log(
    JSON.stringify(
      {
        verdict,
        reason,
        payloadVersion: payload,
        installedVersion: installed,
        payloadVersionPath,
        installedVersionPath,
        configRoot,
      },
      null,
      2,
    ),
  );
  // Exit 0 always — the workflow decides on the data.
  process.exit(0);
}

main();
