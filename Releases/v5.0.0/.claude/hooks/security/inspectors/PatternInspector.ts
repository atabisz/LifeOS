import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';
import type { Inspector, InspectionContext, InspectionResult } from '../types';
import { ALLOW, deny, requireApproval, alert } from '../types';
import { paiPath } from '../../lib/paths';
import { stripEnvVarPrefix, commandPositionViews } from '../command-normalize';

// ── Types ──

interface PatternEntry {
  pattern: string;
  reason: string;
}

interface PatternsConfig {
  version: string;
  philosophy: { mode: string; principle: string };
  bash: {
    trusted: PatternEntry[];
    blocked: PatternEntry[];
    confirm: PatternEntry[];
    alert: PatternEntry[];
  };
  paths: {
    zeroAccess: string[];
    alertAccess: string[];
    confirmAccess: string[];
    readOnly: string[];
    confirmWrite: string[];
    noDelete: string[];
  };
  projects: Record<string, unknown>;
}

type FileAction = 'read' | 'write' | 'delete';

// ── Pattern Loading ──

const USER_PATTERNS_PATH = paiPath('USER', 'SECURITY', 'PATTERNS.yaml');
const SYSTEM_PATTERNS_PATH = paiPath('DOCUMENTATION', 'Security', 'Patterns.example.yaml');

let patternsCache: PatternsConfig | null = null;

function loadPatterns(): PatternsConfig | null {
  if (patternsCache) return patternsCache;

  let patternsPath: string | null = null;
  if (existsSync(USER_PATTERNS_PATH)) {
    patternsPath = USER_PATTERNS_PATH;
  } else if (existsSync(SYSTEM_PATTERNS_PATH)) {
    patternsPath = SYSTEM_PATTERNS_PATH;
  }

  if (!patternsPath) return null;

  try {
    const content = readFileSync(patternsPath, 'utf-8');
    patternsCache = parseYaml(content) as PatternsConfig;
    return patternsCache;
  } catch {
    return null;
  }
}

// Command normalization is provided by the shared `command-normalize` module
// (fixed-point strip of assignment prefixes AND the `env` binary launcher) so
// PatternInspector and EgressInspector can never diverge. The previous inline
// copy here only handled assignment prefixes, so `env FOO=bar rm -rf /` slipped
// past the recursive-delete block.

// ── Pattern Matching ──

function matchesBashPattern(command: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(command);
  } catch {
    return command.toLowerCase().includes(pattern.toLowerCase());
  }
}

// Dual-clause match (closes shell-quote/escape evasion without fabricating false
// positives on quoted argument data). A pattern matches if EITHER:
//   1. it matches the historical `normalized` view ANYWHERE (preserves every
//      prior match exactly — this clause can only keep behavior, never lose it), OR
//   2. it matches a fully-dequoted command SEGMENT anchored at the segment start
//      (so `"rm" -rf /` → `rm -rf /` is caught in command position, while
//      `echo rm -rf /` / `grep "rm -rf /"` is NOT — the segment's command word
//      is echo/grep, and an anchored match won't fire mid-segment).
// The anchored clause prepends `^\s*` to the pattern. A pattern already starting
// with `^` is used as-is against the segment.
function matchesBashViews(
  views: { normalized: string; segments: string[] },
  pattern: string
): boolean {
  if (matchesBashPattern(views.normalized, pattern)) return true;
  const anchored = pattern.startsWith('^') ? pattern : `^\\s*${pattern}`;
  for (const seg of views.segments) {
    if (matchesBashPattern(seg, anchored)) return true;
  }
  return false;
}

function expandTilde(p: string): string {
  return p.startsWith('~') ? p.replace('~', homedir()) : p;
}

// Whether the target filesystem folds case. Case-insensitivity is really a
// per-MOUNT property, not a per-OS one (Windows NTFS and macOS default APFS fold;
// APFS Case-Sensitive / HFSX Macs and most Linux ext4 do not; ext4 `casefold`,
// mounted NTFS/exFAT, and ciopfs make specific Linux mounts fold). Detecting it
// per-path is expensive and unreliable, so this uses a platform proxy with an
// explicit env-override escape-hatch:
//   - PAI_CASE_INSENSITIVE_FS = 1 | true  → force case-fold ON  (case-insensitive Linux mount)
//   - PAI_CASE_INSENSITIVE_FS = 0 | false → force case-fold OFF (case-SENSITIVE APFS/HFSX Mac)
//   - unset → default: win32 and darwin fold (their default filesystems are
//             case-insensitive); other POSIX (Linux) does not.
// Folding is ALWAYS fail-safe here: every `paths:` category is restrictive-direction
// (deny / alert / requireApproval — there is NO allow-direction path pattern, so the
// worst a fold can do is match MORE, i.e. be stricter). On a case-sensitive FS the
// only downside is over-blocking a genuinely differently-cased benign file; the env
// override restores exact-case matching for that rare case.
function foldsCase(): boolean {
  // win32 is ALWAYS case-folded: NTFS (and every default Windows volume) is
  // case-insensitive, and there is no supported case-sensitive Windows variant a
  // PAI install runs on — so a `=0` override here would only be misconfiguration
  // reopening the casing bypass. Clamp it: on win32, always fold (footgun closed;
  // Forge/GPT-5.4 cross-family concern 2026-07-02).
  if (process.platform === 'win32') return true;
  // On POSIX case-sensitivity is genuinely per-mount, so the override is a real
  // escape hatch (force ON for a case-insensitive Linux mount / force OFF for a
  // case-SENSITIVE APFS/HFSX Mac):
  //   PAI_CASE_INSENSITIVE_FS = 1 | true  → fold ON
  //   PAI_CASE_INSENSITIVE_FS = 0 | false → fold OFF
  //   unset → default: darwin folds (APFS default is case-insensitive), other POSIX does not.
  const override = process.env.PAI_CASE_INSENSITIVE_FS;
  if (override !== undefined && override !== '') {
    return override === '1' || override.toLowerCase() === 'true';
  }
  return process.platform === 'darwin';
}

// Canonicalize a path/pattern before compare, closing two filesystem-equivalence
// mismatches that otherwise let references bypass the `paths:` controls:
//   1. Separators (win32 ONLY). resolve() yields all-backslash on Windows
//      (`C:\Users\example\.ssh\id_ed25519`) while the tilde-expanded PATTERNS.yaml
//      pattern is mixed-separator (`C:\Users\example/.ssh/id_*`) and the glob regex
//      uses `[^/]*` + literal `/`, so neither `===` nor the glob ever matched. Folded
//      win32-only because backslash is a legal filename char on POSIX — folding it
//      there would corrupt real names.
//   2. Case (any case-insensitive FS, per foldsCase()). On such a mount
//      `~/.SSH/ID_ED25519` is the SAME file as `~/.ssh/id_ed25519`, but a
//      case-SENSITIVE regex/`===` let an uppercase reference bypass a lowercase deny
//      pattern — the same MAJOR bypass class the win32 separator bug was, on a second
//      axis. This originally shipped win32-only (2026-07-02); the macOS/Linux residual
//      is closed here by keying case-folding on foldsCase() rather than the OS.
// Both `expandedPattern` and `normalizedPath` pass through this, so the fold is
// symmetric and matching semantics are otherwise unchanged.
function toCanonicalPath(p: string): string {
  let out = p;
  if (process.platform === 'win32') out = out.replace(/\\/g, '/');  // separators: win32 only
  if (foldsCase()) out = out.toLowerCase();                          // case: case-insensitive FS
  return out;
}

function matchesPathPattern(filePath: string, pattern: string): boolean {
  const expandedPattern = toCanonicalPath(expandTilde(pattern));
  const normalizedPath = toCanonicalPath(resolve(expandTilde(filePath)));

  if (pattern.includes('*')) {
    let regexStr = expandedPattern
      .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
      .replace(/\*/g, '<<<SINGLESTAR>>>')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/<<<DOUBLESTAR>>>/g, '.*')
      .replace(/<<<SINGLESTAR>>>/g, '[^/]*');
    try {
      return new RegExp(`^${regexStr}$`).test(normalizedPath);
    } catch {
      return false;
    }
  }

  return normalizedPath === expandedPattern ||
    normalizedPath.startsWith(expandedPattern.endsWith('/') ? expandedPattern : expandedPattern + '/');
}

// ── Action Detection ──

function getFileAction(toolName: string): FileAction | null {
  switch (toolName) {
    case 'Read': return 'read';
    case 'Write': return 'write';
    case 'Edit': return 'write';
    case 'MultiEdit': return 'write';
    default: return null;
  }
}

function extractFilePath(input: Record<string, unknown> | string): string {
  if (typeof input === 'string') return input;
  return (input?.file_path as string) || '';
}

function extractCommand(input: Record<string, unknown> | string): string {
  if (typeof input === 'string') return input;
  return (input?.command as string) || '';
}

// ── Inspection Logic ──

function inspectBash(command: string, config: PatternsConfig): InspectionResult {
  const views = commandPositionViews(command);
  if (!views.normalized) return ALLOW;

  // Trusted is matched on the historical view only — trusting a dequoted segment
  // could let a crafted arg trip a trusted allow; keep trust conservative.
  for (const p of (config.bash.trusted || [])) {
    if (matchesBashPattern(views.normalized, p.pattern)) return ALLOW;
  }

  for (const p of (config.bash.blocked || [])) {
    if (matchesBashViews(views, p.pattern)) return deny(p.reason);
  }

  for (const p of (config.bash.confirm || [])) {
    if (matchesBashViews(views, p.pattern)) return requireApproval(p.reason);
  }

  for (const p of (config.bash.alert || [])) {
    if (matchesBashViews(views, p.pattern)) return alert(p.reason);
  }

  return ALLOW;
}

function inspectPath(filePath: string, action: FileAction, config: PatternsConfig): InspectionResult {
  const normalized = resolve(expandTilde(filePath));

  for (const p of (config.paths.zeroAccess || [])) {
    if (matchesPathPattern(normalized, p)) return deny(`Zero access path: ${p}`);
  }

  for (const p of (config.paths.alertAccess || [])) {
    if (matchesPathPattern(normalized, p)) return alert(`Env file access logged: ${p}`);
  }

  for (const p of (config.paths.confirmAccess || [])) {
    if (matchesPathPattern(normalized, p)) return requireApproval(`Sensitive file access requires confirmation: ${p}`);
  }

  if (action === 'write') {
    for (const p of (config.paths.readOnly || [])) {
      if (matchesPathPattern(normalized, p)) return deny(`Read-only path: ${p}`);
    }

    for (const p of (config.paths.confirmWrite || [])) {
      if (matchesPathPattern(normalized, p)) return requireApproval(`Writing to protected file requires confirmation: ${p}`);
    }
  }

  if (action === 'delete') {
    for (const p of (config.paths.noDelete || [])) {
      if (matchesPathPattern(normalized, p)) return deny(`Cannot delete protected path: ${p}`);
    }
  }

  return ALLOW;
}

// ── Inspector Implementation ──

class PatternInspector implements Inspector {
  name = 'PatternInspector';
  priority = 100;

  inspect(ctx: InspectionContext): InspectionResult {
    const config = loadPatterns();
    if (!config) return deny('CRITICAL: Security patterns file missing — fail-closed');

    if (ctx.toolName === 'Bash') {
      const command = extractCommand(ctx.toolInput);
      return inspectBash(command, config);
    }

    const fileAction = getFileAction(ctx.toolName);
    if (fileAction) {
      const filePath = extractFilePath(ctx.toolInput);
      if (!filePath) return ALLOW;
      return inspectPath(filePath, fileAction, config);
    }

    return ALLOW;
  }
}

export function createPatternInspector(): Inspector {
  return new PatternInspector();
}
