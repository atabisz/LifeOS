#!/usr/bin/env bun
/**
 * PAI Portable-Paths Linter
 *
 * ERRORS (exit 1) on Windows-breaking path idioms in TypeScript sources:
 *   1. Bare `process.env.HOME` reads with NO fallback — `process.env.HOME!`
 *      (throws when unset) and `process.env.HOME || ''` / `?? ''` (collapses to
 *      a relative path). On native Windows HOME is unset (USERPROFILE is set),
 *      so these silently write to the wrong place or crash.
 *   2. Hardcoded POSIX temp literals — `/tmp/...` string literals. `/tmp` does
 *      not exist on Windows.
 *
 * The fix in both cases: import from `hooks/lib/portable.ts` — `home()` for the
 * env-var-first home chain, `tmp()` for the OS temp dir.
 *
 * This linter is the load-bearing guard that makes deferring the long-tail
 * HOME/tmp sweep (Windows support plan Step 3) safe: any NEW offender fails the
 * lint, so the debt cannot silently grow while the tail is worked down.
 *
 * Scans the WHOLE repo tree by default (Releases/, Packs/Utilities/,
 * Packs/Media/ duplicates, skills, hooks, tools) — not just one snapshot.
 *
 * Enforcement model (Windows support plan): the repo currently carries a large
 * long-tail of pre-existing offenders (Step 3 clears them). So by default this
 * linter runs in BASELINE mode: it fails only on offenses NOT in the recorded
 * baseline (`Tools/.portable-paths-baseline.json`) — i.e. any NEW offense a
 * change introduces. That makes it a real regression gate TODAY while the tail
 * is worked down. Once Step 3 drives the tree to zero, delete the baseline file
 * (or run `--strict`) and it becomes a zero-tolerance gate.
 *
 * Usage:
 *   bun Tools/lint-portable-paths.ts            # baseline mode: exit 1 only on NEW offenses
 *   bun Tools/lint-portable-paths.ts --strict   # zero-tolerance: exit 1 on ANY offense
 *   bun Tools/lint-portable-paths.ts --update-baseline   # record current offenses as the baseline
 *   bun Tools/lint-portable-paths.ts <dir>      # scan a specific subtree (still honors mode)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, relative, sep, basename } from 'path';

const REPO_ROOT = join(import.meta.dir, '..');
const BASELINE_PATH = join(import.meta.dir, '.portable-paths-baseline.json');

// A stable key for an offense — file + kind + the offending line text (NOT the
// line number, so unrelated edits above don't reshuffle the baseline).
function offenseKey(o: Offense): string {
  return `${o.file}::${o.kind}::${o.text}`;
}

// Colors for terminal output
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

// Directories never worth scanning (build output, deps, VCS, frozen snapshots).
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'out', 'dist', 'build', '.next', '.turbo',
  '.tmp', 'coverage', 'PAI_RELEASES',
]);

// Only these extensions carry the risk (JS/TS runtime code).
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);

// Files legitimately allowed to read the raw env vars / define the helpers.
// The shared helper module is the ONE place that reads HOME/USERPROFILE and
// calls os.tmpdir() on purpose — it must not flag itself.
const ALLOWLIST_BASENAMES = new Set([
  'portable.ts',            // the shared helper (hooks/lib/portable.ts)
  'lint-portable-paths.ts', // this linter's own doc/regex strings
]);

// A path is allowlisted if any path segment matches (handles both trees).
function isAllowlisted(absPath: string): boolean {
  if (ALLOWLIST_BASENAMES.has(basename(absPath))) return true;
  return false;
}

interface Offense {
  file: string;   // repo-relative
  line: number;
  kind: 'HOME' | 'TMP';
  text: string;
}

// Bare HOME with no fallback: `process.env.HOME!`, `process.env.HOME || ''|""`,
// `process.env.HOME ?? ''|""`. The correct chain (`process.env.HOME ??
// process.env.USERPROFILE ?? ...`) is NOT matched — it names USERPROFILE next.
const HOME_BANG = /process\.env\.HOME\s*!/;
const HOME_EMPTY_FALLBACK = /process\.env\.HOME\s*(\|\||\?\?)\s*(''|"")/;
// A HOME read whose very next non-space token is NOT a recognized non-empty
// fallback. Two fallbacks are Windows-safe and must NOT be flagged:
//   - `?? process.env.USERPROFILE`  (the env-var-first portable chain)
//   - `?? homedir()` / `|| os.homedir()`  (os.homedir() returns the USERPROFILE
//     dir on Windows, so it never collapses to a relative path — the portable.ts
//     helper itself ends in `?? homedir()`).
// This catches a bare `process.env.HOME` used directly in a join with no fallback.
const HOME_BARE = /process\.env\.HOME(?!\s*(\?\?|\|\|)\s*(process\.env\.USERPROFILE|(?:os\.)?homedir\s*\(\s*\)))(?!\s*[!])/;

// A truthiness guard (`if (process.env.HOME) ...`) proves the read on this line
// is non-empty before use — not a Windows-breaking bare read. A line carrying
// such a guard is skipped (the guarded value is safe by construction).
const HOME_GUARD = /if\s*\(\s*process\.env\.HOME\s*\)/;

// Hardcoded POSIX temp literal: '/tmp' or "/tmp" at a path boundary.
const TMP_LITERAL = /['"]\/tmp(\/|['"])/;

function scanFile(absPath: string): Offense[] {
  const offenses: Offense[] = [];
  let content: string;
  try {
    content = readFileSync(absPath, 'utf-8');
  } catch {
    return offenses; // binary / unreadable — skip
  }
  const relPath = relative(REPO_ROOT, absPath).split(sep).join('/');
  const lines = content.split('\n');

  lines.forEach((lineText, idx) => {
    // Skip comment lines — doc references to the pattern are not offenses.
    const trimmed = lineText.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;

    // A truthiness guard on the same line (`if (process.env.HOME) return process.env.HOME`)
    // proves the read is non-empty — not a Windows-breaking bare read. Skip HOME checks
    // for this line (the TMP check below still runs).
    const homeGuarded = HOME_GUARD.test(lineText);

    if (!homeGuarded && (HOME_BANG.test(lineText) || HOME_EMPTY_FALLBACK.test(lineText))) {
      offenses.push({ file: relPath, line: idx + 1, kind: 'HOME', text: trimmed.slice(0, 80) });
    } else if (!homeGuarded && HOME_BARE.test(lineText)) {
      offenses.push({ file: relPath, line: idx + 1, kind: 'HOME', text: trimmed.slice(0, 80) });
    }
    if (TMP_LITERAL.test(lineText)) {
      offenses.push({ file: relPath, line: idx + 1, kind: 'TMP', text: trimmed.slice(0, 80) });
    }
  });

  return offenses;
}

function walk(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      const ext = dot >= 0 ? entry.name.slice(dot) : '';
      if (SCAN_EXTS.has(ext)) out.push(join(dir, entry.name));
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const updateBaseline = args.includes('--update-baseline');
  const rootArg = args.find(a => !a.startsWith('-'));
  const scanRoot = rootArg ? join(process.cwd(), rootArg) : REPO_ROOT;

  console.log(`\n${BLUE}🪟 PAI Portable-Paths Linter${RESET}`);
  console.log('='.repeat(60));
  const mode = updateBaseline ? 'update-baseline' : strict ? 'strict' : 'baseline';
  console.log(`Scanning: ${scanRoot}   ${YELLOW}[mode: ${mode}]${RESET}\n`);

  const files: string[] = [];
  walk(scanRoot, files);

  const allOffenses: Offense[] = [];
  let scanned = 0;
  for (const f of files) {
    if (isAllowlisted(f)) continue;
    scanned++;
    allOffenses.push(...scanFile(f));
  }

  // --update-baseline: record every current offense key and exit 0.
  if (updateBaseline) {
    const keys = allOffenses.map(offenseKey).sort();
    writeFileSync(BASELINE_PATH, JSON.stringify({ _docs: 'Pre-existing portable-path offenders (Windows support plan Step 3 clears these). The linter fails only on offenses NOT in this list. Delete this file once the tree is clean to switch to zero-tolerance.', count: keys.length, keys }, null, 2) + '\n');
    console.log(`${GREEN}✅ Baseline updated: ${keys.length} known offense(s) recorded to ${relative(REPO_ROOT, BASELINE_PATH).split(sep).join('/')}.${RESET}\n`);
    process.exit(0);
  }

  // Load baseline (unless --strict).
  let baseline = new Set<string>();
  if (!strict && existsSync(BASELINE_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
      baseline = new Set<string>(parsed.keys ?? []);
    } catch {
      console.log(`${YELLOW}⚠ Baseline file unreadable — treating all offenses as new.${RESET}\n`);
    }
  }

  // In baseline mode, only NEW offenses (not in baseline) fail the gate.
  const gatingOffenses = strict ? allOffenses : allOffenses.filter(o => !baseline.has(offenseKey(o)));

  if (allOffenses.length === 0) {
    console.log(`${GREEN}✅ No bare process.env.HOME or /tmp literals found (${scanned} files scanned).${RESET}\n`);
    process.exit(0);
  }

  if (gatingOffenses.length === 0) {
    // Offenses exist but all are baselined.
    console.log(`${GREEN}✅ No NEW portable-path offenses (${allOffenses.length} pre-existing, all baselined; ${scanned} files scanned).${RESET}`);
    console.log(`${YELLOW}   Long tail tracked for Windows support plan Step 3. Run --strict to see all.${RESET}\n`);
    process.exit(0);
  }

  // Group gating offenses by file for readable output.
  const byFile = new Map<string, Offense[]>();
  for (const o of gatingOffenses) {
    (byFile.get(o.file) ?? byFile.set(o.file, []).get(o.file)!).push(o);
  }

  const homeCount = gatingOffenses.filter(o => o.kind === 'HOME').length;
  const tmpCount = gatingOffenses.filter(o => o.kind === 'TMP').length;
  const label = strict ? 'portable-path offense(s)' : 'NEW portable-path offense(s)';

  console.log(`${RED}🚫 ${gatingOffenses.length} ${label} in ${byFile.size} file(s)${RESET}`);
  console.log(`${YELLOW}   ${homeCount} bare HOME · ${tmpCount} /tmp literal(s)${strict ? '' : ` (of ${allOffenses.length} total; rest baselined)`}${RESET}\n`);

  for (const [file, offenses] of byFile) {
    console.log(`${RED}❌${RESET} ${file}`);
    for (const o of offenses) {
      console.log(`   ${RED}→${RESET} L${o.line} [${o.kind}] ${o.text}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\n${RED}🚫 LINT FAILED${RESET}\n`);
  console.log('These idioms break on native Windows. Fix each one:');
  console.log(`  ${YELLOW}process.env.HOME! / || '' / ?? ''${RESET}  →  import { home } from '<hooks/lib>/portable'; home()`);
  console.log(`  ${YELLOW}'/tmp/...'${RESET}                          →  import { tmp } from '<hooks/lib>/portable'; join(tmp(), ...)`);
  console.log('\nIf a use is genuinely legitimate (defines the helper), add its');
  console.log('basename to ALLOWLIST_BASENAMES in Tools/lint-portable-paths.ts.');
  if (!strict) console.log('If this is a KNOWN pre-existing offense, run --update-baseline (Step 3 work only).');
  console.log('');
  process.exit(1);
}

main();
