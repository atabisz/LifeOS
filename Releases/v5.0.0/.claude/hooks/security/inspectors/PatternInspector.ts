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

function matchesPathPattern(filePath: string, pattern: string): boolean {
  const expandedPattern = expandTilde(pattern);
  const normalizedPath = resolve(expandTilde(filePath));

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
