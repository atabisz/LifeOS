/**
 * change-detection.ts - Utilities for detecting LifeOS system changes
 *
 * Parses transcripts for file modification tool_use blocks and categorizes
 * changes to determine if background integrity maintenance is needed.
 */

import { readFileSync, existsSync } from 'fs';
import { join, relative, basename, isAbsolute } from 'path';
import { getLifeosDir } from './paths';

// ============================================================================
// Types
// ============================================================================

export interface FileChange {
  tool: 'Write' | 'Edit' | 'MultiEdit';
  path: string;
  category: ChangeCategory | null;
  isPhilosophical: boolean;
  isStructural: boolean;
}

export type ChangeCategory =
  | 'skill'
  | 'hook'
  | 'workflow'
  | 'config'
  | 'core-system'
  | 'memory-system'
  | 'documentation';

export type SignificanceLabel = 'trivial' | 'minor' | 'moderate' | 'major' | 'critical';

export type ChangeType =
  | 'skill_update'
  | 'structure_change'
  | 'doc_update'
  | 'hook_update'
  | 'workflow_update'
  | 'config_update'
  | 'tool_update'
  | 'multi_area';

export interface IntegrityState {
  last_run: string;
  last_changes_hash: string;
  cooldown_until: string | null;
}

// ============================================================================
// Path Constants
// ============================================================================

const LIFEOS_DIR = getLifeosDir();
const STATE_FILE = join(LIFEOS_DIR, 'MEMORY', 'STATE', 'integrity-state.json');

// The core system docs — the files that define how a LifeOS subsystem behaves.
//
// Matched against the LIFEOS-RELATIVE form, which isCoreSystemDoc derives before
// testing. Both rules are ^-anchored, so there is exactly one accepted shape per
// population and no substring can drift in:
//
//   1. DOCUMENTATION/[Subsystem/]<Name>System*.md — the canonical set.
//      DOCUMENTATION/ alone is NOT the rule: IsaFormat.md, LifeOsThesis.md and
//      PulseMetadata.md live there too and are ordinary 'documentation'. The
//      basename family is what makes it a subsystem contract.
//   2. <NAME>System*.md at depth 1 — the root-level constitutional docs
//      (LIFEOS_SYSTEM_PROMPT.md), with no separator permitted.
//
// Deliberately NOT a *System*.md basename test applied to the raw input. That
// form-based rule sweeps the 238 skills/Fabric/Patterns/*/system.md prompt files,
// none of which are system docs. What keeps the match honest is that
// isCoreSystemDoc rejects anything not under LIFEOS_DIR *before* the pattern
// runs, so rule 2 can be a bare-basename rule without becoming a basename sweep.
//
// This replaces a dead anchor. The original keyed on a `PAI/` path segment; the
// 2026-07-05 rename deleted that directory, so it matched nothing — and it sat
// inside the skills/ branch of categorizeChange, where no core doc can reach it
// anyway. The lesson is in the derivation, not the pattern: normalizeToRelativePath
// STRIPS the LIFEOS_DIR prefix, so the funnel emits `DOCUMENTATION/Hooks/HookSystem.md`
// with no framework segment at all. Derive one canonical shape, then anchor on it.
// Never guess the caller's prefix.
const CORE_SYSTEM_DOC_PATTERN = new RegExp(
  [
    // 1. canonical subsystem docs, at DOCUMENTATION/ depth 1 or 2.
    //    [Ss]ystem, not System: DaSubsystem.md spells it lowercase. Case-relaxing
    //    the basename is safe HERE only because the DOCUMENTATION/ anchor sits
    //    inside a proven-LIFEOS-relative path, which excludes the Fabric prompts.
    '^DOCUMENTATION/(?:[^/]+/)?[A-Za-z]*[Ss]ystem[A-Za-z]*\\.md$',
    // 2. root-level docs, depth 1 only — no separator may appear. The capital S
    //    in (?:SYSTEM|System) is what keeps a lowercase `system.md` out even if
    //    one ever landed at LIFEOS depth 1.
    '^[A-Za-z_]*(?:SYSTEM|System)[A-Za-z_]*\\.md$',
  ].join('|'),
);

// Paths that are excluded from integrity checks
const EXCLUDED_PATHS = [
  'MEMORY/WORK/',
  'MEMORY/LEARNING/',
  'MEMORY/STATE/',
  'Plans/',
  'projects/',
  '.git/',
  'node_modules/',
  'ShellSnapshots/',
];

// High-priority paths that always warrant documentation
const HIGH_PRIORITY_PATHS = [
  'LIFEOS/',
  'PAISYSTEMARCHITECTURE.md',
  'SKILLSYSTEM.md',
  'MEMORYSYSTEM.md',
  'THEHOOKSYSTEM.md',
  'THEDELEGATIONSYSTEM.md',
  'THENOTIFICATIONSYSTEM.md',
  'settings.json',
];

// Philosophical/architectural patterns in paths
const PHILOSOPHICAL_PATTERNS = [
  /PAI\//i,
  /ARCHITECTURE/i,
  /PRINCIPLES/i,
  /FOUNDING/i,
  /IDENTITY/i,
];

// Structural change patterns
const STRUCTURAL_PATTERNS = [
  /\/SKILL\.md$/i,           // Skill definitions
  /\/Workflows\//i,          // Workflow routing
  /settings\.json$/i,        // Configuration
  /frontmatter/i,            // Metadata changes
];

// ============================================================================
// Transcript Parsing
// ============================================================================

/**
 * Parse tool_use blocks from a transcript that modify files.
 * Extracts Write, Edit, and MultiEdit operations.
 */
export function parseToolUseBlocks(transcriptPath: string): FileChange[] {
  try {
    if (!existsSync(transcriptPath)) {
      console.error('[ChangeDetection] Transcript not found:', transcriptPath);
      return [];
    }

    const content = readFileSync(transcriptPath, 'utf-8');
    const lines = content.trim().split('\n');
    const changes: FileChange[] = [];
    const seenPaths = new Set<string>();

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);

        // Look for assistant messages with tool_use
        if (entry.type === 'assistant' && entry.message?.content) {
          const contentArray = Array.isArray(entry.message.content)
            ? entry.message.content
            : [];

          for (const block of contentArray) {
            if (block.type !== 'tool_use') continue;

            const toolName = block.name;
            const input = block.input || {};

            // Handle Write, Edit, MultiEdit tools
            if (toolName === 'Write' && input.file_path) {
              const path = normalizeToRelativePath(input.file_path);
              if (!seenPaths.has(path)) {
                seenPaths.add(path);
                changes.push(createFileChange('Write', path));
              }
            } else if (toolName === 'Edit' && input.file_path) {
              const path = normalizeToRelativePath(input.file_path);
              if (!seenPaths.has(path)) {
                seenPaths.add(path);
                changes.push(createFileChange('Edit', path));
              }
            } else if (toolName === 'MultiEdit' && input.edits) {
              for (const edit of input.edits) {
                if (edit.file_path) {
                  const path = normalizeToRelativePath(edit.file_path);
                  if (!seenPaths.has(path)) {
                    seenPaths.add(path);
                    changes.push(createFileChange('Edit', path));
                  }
                }
              }
            }
          }
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    return changes;
  } catch (error) {
    console.error('[ChangeDetection] Error parsing transcript:', error);
    return [];
  }
}

/**
 * Normalize an absolute path to relative (to LIFEOS_DIR).
 */
function normalizeToRelativePath(absolutePath: string): string {
  if (absolutePath.startsWith(LIFEOS_DIR)) {
    return relative(LIFEOS_DIR, absolutePath);
  }
  return absolutePath;
}

/**
 * Reduce a path to its LIFEOS-relative, forward-slashed form, or null when it
 * does not lie under LIFEOS_DIR.
 *
 * `path.relative` handles the separator and drive-letter-case differences for us;
 * what it does NOT do is tell us the child escaped the parent, so the `..` and
 * absolute-result tests are load-bearing. Without them a sibling directory whose
 * name merely starts with the parent's (`…/LIFEOSEXTRA/HookSystem.md`) would
 * resolve to a plausible-looking relative path and match the pattern.
 */
function lifeosRelative(inputPath: string): string | null {
  const absolutePath = isAbsolute(inputPath) ? inputPath : join(LIFEOS_DIR, inputPath);
  const rel = relative(LIFEOS_DIR, absolutePath);
  if (rel === '') return '';
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(/[\\/]/).join('/');
}

/**
 * True when the path is one of the core system docs.
 *
 * Extracted so ONE rule serves categorizeChange and generateDescriptiveTitle. The
 * dead pattern this replaces was pasted at three sites, which is how the category
 * and the title could have drifted apart.
 *
 * Two accepted inputs, because two exist in production: the LIFEOS-relative form
 * the transcript funnel emits (`DOCUMENTATION/Hooks/HookSystem.md`), and an
 * absolute path as a direct caller supplies it. Containment is enforced here
 * rather than being inherited from the caller — see the note at categorizeChange's
 * root check for why relying on that would be unsafe.
 */
function isCoreSystemDoc(path: string): boolean {
  const rel = lifeosRelative(path);
  if (rel === null) return false;
  return CORE_SYSTEM_DOC_PATTERN.test(rel);
}

/**
 * Create a FileChange object with categorization.
 */
function createFileChange(tool: 'Write' | 'Edit', path: string): FileChange {
  return {
    tool,
    path,
    category: categorizeChange(path),
    isPhilosophical: isPhilosophicalPath(path),
    isStructural: isStructuralPath(path),
  };
}

// ============================================================================
// Change Categorization
// ============================================================================

/**
 * Categorize a file path by its location in the LifeOS system.
 */
export function categorizeChange(path: string): ChangeCategory | null {
  // Check exclusions first
  for (const excluded of EXCLUDED_PATHS) {
    if (path.includes(excluded)) {
      return null;
    }
  }

  // Check if path is within LifeOS directory, via the same helper isCoreSystemDoc
  // uses — one containment rule, not two.
  //
  // This site used to read `path.startsWith('/') ? path : join(LIFEOS_DIR, path)`
  // followed by a raw `startsWith(LIFEOS_DIR)` test. The POSIX literal was false
  // for a Windows absolute path like `D:\other\x.md`, so such a path was join()ed
  // onto LIFEOS_DIR and then trivially satisfied its own prefix check: on Windows
  // every path on every drive read as in-tree, and the check was decorative.
  //
  // Fixing the is-absolute test makes the containment check load-bearing, which
  // exposed the second half of the defect: a raw prefix `startsWith` also admits
  // a SIBLING whose name merely begins with the parent's (`…/LIFEOSEXTRA/x.md`).
  // lifeosRelative already handles both — it derives the relative form and
  // rejects the `..`/absolute escapes a prefix test cannot see. The census this
  // narrowing was owed is in the ISA: the only category change is out-of-tree
  // absolute input, which now returns null instead of a bogus category.
  if (lifeosRelative(path) === null) {
    return null;
  }
  const absolutePath = isAbsolute(path) ? path : join(LIFEOS_DIR, path);

  // Core system docs are tested FIRST, ahead of every location branch. The test
  // used to sit inside the skills/ branch below, where no core doc can reach it —
  // so even with a working pattern, categorizeChange could not emit 'core-system'.
  // Hoisting is provably non-conflicting: every path the pattern matches is a
  // LIFEOS/*.md or LIFEOS/DOCUMENTATION/**.md file, and none of those lie under
  // skills/, hooks/ or MEMORY/. Top position also means a future branch cannot
  // silently steal a core doc back.
  if (isCoreSystemDoc(path)) return 'core-system';

  // Categorize by path pattern
  if (path.includes('skills/')) {
    // Exclude personal/private skills (prefixed with _ by convention)
    const skillMatch = path.match(/skills\/(_[^/]+)/);
    if (skillMatch) return null;
    if (path.includes('/Workflows/')) return 'workflow';
    return 'skill';
  }

  if (path.includes('hooks/')) return 'hook';
  if (path.includes('MEMORY/SYSTEMUPDATES/')) return 'documentation';
  if (path.includes('MEMORY/')) return 'memory-system';
  if (path.endsWith('settings.json')) return 'config';
  if (path.endsWith('.md') && !path.includes('WORK/')) return 'documentation';

  return null;
}

/**
 * Check if a path represents philosophical/architectural content.
 */
function isPhilosophicalPath(path: string): boolean {
  for (const pattern of PHILOSOPHICAL_PATTERNS) {
    if (pattern.test(path)) return true;
  }
  for (const highPriority of HIGH_PRIORITY_PATHS) {
    if (path.includes(highPriority)) return true;
  }
  return false;
}

/**
 * Check if a path represents structural content (SKILL.md, workflows, config).
 */
function isStructuralPath(path: string): boolean {
  for (const pattern of STRUCTURAL_PATTERNS) {
    if (pattern.test(path)) return true;
  }
  return false;
}

// ============================================================================
// Significance Detection
// ============================================================================

/**
 * Determine if changes are significant enough to warrant background integrity check.
 */
export function isSignificantChange(changes: FileChange[]): boolean {
  // Filter to only LifeOS system changes
  const systemChanges = changes.filter(c => c.category !== null);

  if (systemChanges.length === 0) return false;

  // Always significant if philosophical or structural changes
  if (systemChanges.some(c => c.isPhilosophical || c.isStructural)) {
    return true;
  }

  // Significant if multiple files in same domain
  const categories = new Set(systemChanges.map(c => c.category));
  if (categories.size >= 1 && systemChanges.length >= 2) {
    return true;
  }

  // Significant if any skill, hook, or core-system change
  const importantCategories: ChangeCategory[] = ['skill', 'hook', 'core-system', 'workflow'];
  if (systemChanges.some(c => importantCategories.includes(c.category!))) {
    return true;
  }

  return false;
}

/**
 * Check if changes warrant documentation.
 * UPDATED: Lower thresholds for more granular, frequent documentation.
 * Philosophy: File system is cheap, more signal is valuable.
 */
export function shouldDocumentChanges(changes: FileChange[]): boolean {
  const systemChanges = changes.filter(c => c.category !== null);

  // No changes to document
  if (systemChanges.length === 0) return false;

  // Always document philosophical or structural changes
  if (systemChanges.some(c => c.isPhilosophical || c.isStructural)) {
    return true;
  }

  // Document ANY skill, hook, workflow, core-system, or config change
  const importantCategories: ChangeCategory[] = ['skill', 'hook', 'workflow', 'core-system', 'config'];
  if (systemChanges.some(c => c.category && importantCategories.includes(c.category))) {
    return true;
  }

  // Document if 2+ files changed (lowered from 3+)
  if (systemChanges.length >= 2) {
    return true;
  }

  // Document new file creation in system areas
  const newFiles = systemChanges.filter(c => c.tool === 'Write');
  if (newFiles.length > 0) return true;

  // Document any tool file changes (.ts in Tools/)
  if (systemChanges.some(c => c.path.includes('/Tools/') && c.path.endsWith('.ts'))) {
    return true;
  }

  return false;
}

// ============================================================================
// Throttling
// ============================================================================

// Reduced from 5 to 2 minutes for more frequent documentation updates
const COOLDOWN_MINUTES = 2;

/**
 * Read the current integrity state.
 */
export function readIntegrityState(): IntegrityState | null {
  try {
    if (!existsSync(STATE_FILE)) return null;
    const content = readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Check if we're within the cooldown period.
 */
export function isInCooldown(): boolean {
  const state = readIntegrityState();
  if (!state?.cooldown_until) return false;

  const cooldownUntil = new Date(state.cooldown_until);
  return new Date() < cooldownUntil;
}

/**
 * Generate a hash of changes for deduplication.
 */
export function hashChanges(changes: FileChange[]): string {
  const sorted = changes
    .map(c => `${c.tool}:${c.path}`)
    .sort()
    .join('|');

  // Simple hash
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const char = sorted.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

/**
 * Check if changes are duplicates of the last run.
 */
export function isDuplicateRun(changes: FileChange[]): boolean {
  const state = readIntegrityState();
  if (!state?.last_changes_hash) return false;

  const currentHash = hashChanges(changes);
  return currentHash === state.last_changes_hash;
}

/**
 * Get the cooldown end time.
 */
export function getCooldownEndTime(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() + COOLDOWN_MINUTES);
  return now.toISOString();
}

// ============================================================================
// Significance and Change Type Determination
// ============================================================================

/**
 * Determine the significance label based on change characteristics.
 */
export function determineSignificance(changes: FileChange[]): SignificanceLabel {
  const count = changes.length;
  const hasStructural = changes.some(c => c.isStructural);
  const hasPhilosophical = changes.some(c => c.isPhilosophical);
  const hasNewFiles = changes.some(c => c.tool === 'Write');

  const categories = new Set(changes.map(c => c.category).filter(Boolean));
  const hasCoreSystem = changes.some(c => c.category === 'core-system');
  const hasHooks = changes.some(c => c.category === 'hook');
  const hasSkills = changes.some(c => c.category === 'skill');

  // Critical: breaking changes, major restructuring
  if (hasStructural && hasPhilosophical && count >= 5) {
    return 'critical';
  }

  // Major: new skills/workflows, architectural decisions
  if (hasNewFiles && (hasStructural || hasPhilosophical)) {
    return 'major';
  }
  if (hasCoreSystem || (categories.size >= 3)) {
    return 'major';
  }
  if (hasHooks && count >= 3) {
    return 'major';
  }

  // Moderate: multi-file updates, small features
  if (count >= 3 || categories.size >= 2) {
    return 'moderate';
  }
  if (hasSkills && count >= 2) {
    return 'moderate';
  }

  // Minor: single file doc updates
  if (count === 1 && !hasStructural && !hasPhilosophical) {
    return 'minor';
  }

  // Trivial: only if very small doc changes
  if (count === 1 && changes[0].category === 'documentation') {
    return 'trivial';
  }

  return 'minor';
}

/**
 * Determine the change type based on affected files.
 */
export function inferChangeType(changes: FileChange[]): ChangeType {
  const categories = changes.map(c => c.category).filter(Boolean);
  const uniqueCategories = new Set(categories);

  // Multi-area if touching 3+ categories
  if (uniqueCategories.size >= 3) {
    return 'multi_area';
  }

  // Single category cases
  if (uniqueCategories.size === 1) {
    const cat = [...uniqueCategories][0];
    switch (cat) {
      case 'skill': return changes.some(c => c.isStructural) ? 'structure_change' : 'skill_update';
      case 'hook': return 'hook_update';
      case 'workflow': return 'workflow_update';
      case 'config': return 'config_update';
      case 'core-system': return 'structure_change';
      case 'documentation': return 'doc_update';
      default: return 'skill_update';
    }
  }

  // Two categories - pick the more significant one
  if (uniqueCategories.has('hook')) return 'hook_update';
  if (uniqueCategories.has('skill')) return 'skill_update';
  if (uniqueCategories.has('workflow')) return 'workflow_update';
  if (uniqueCategories.has('config')) return 'config_update';

  return 'multi_area';
}

/**
 * Generate a descriptive 4-8 word title based on the changes.
 */
export function generateDescriptiveTitle(changes: FileChange[]): string {
  const paths = changes.map(c => c.path);

  // Extract skill names
  const skillNames = new Set<string>();
  for (const p of paths) {
    const match = p.match(/skills\/([^/]+)\//);
    if (match && match[1] !== 'LIFEOS') skillNames.add(match[1]);
  }

  // Detect file types
  const hasSkillMd = paths.some(p => p.endsWith('SKILL.md'));
  const hasWorkflows = paths.some(p => p.includes('/Workflows/'));
  const hasTools = paths.some(p => p.includes('/Tools/') && p.endsWith('.ts'));
  const hasHooks = paths.some(p => p.includes('hooks/'));
  const hasConfig = paths.some(p => p.endsWith('settings.json'));
  const hasCoreSystem = paths.some(p => isCoreSystemDoc(p));
  const hasCoreUser = paths.some(p => p.includes('LIFEOS/USER/'));

  // A shared topic word across 2+ filenames, for change sets none of the location
  // branches claim. Ranked below hasCoreSystem — see the branch comment below.
  const commonWords = extractCommonPatterns(
    paths.map(p => basename(p, '.md').replace(/\.ts$/, ''))
  );

  let title = '';

  // Single skill update
  if (skillNames.size === 1) {
    const skill = [...skillNames][0];
    if (hasSkillMd) {
      title = `${skill} Skill Definition Update`;
    } else if (hasWorkflows) {
      const workflowNames = paths
        .filter(p => p.includes('/Workflows/'))
        .map(p => basename(p, '.md'));
      if (workflowNames.length === 1) {
        title = `${skill} ${workflowNames[0]} Workflow Update`;
      } else {
        title = `${skill} Workflows Updated`;
      }
    } else if (hasTools) {
      const toolNames = paths
        .filter(p => p.includes('/Tools/'))
        .map(p => basename(p, '.ts'));
      if (toolNames.length === 1) {
        title = `${skill} ${toolNames[0]} Tool Update`;
      } else {
        title = `${skill} Tools Updated`;
      }
    } else {
      title = `${skill} Skill Files Updated`;
    }
  }
  // Multiple skills
  else if (skillNames.size > 1 && skillNames.size <= 3) {
    const skills = [...skillNames].slice(0, 3).join(' and ');
    title = `${skills} Skills Updated`;
  }
  // Core system changes. Tested BEFORE hasHooks: `DOCUMENTATION/Hooks/HookSystem.md`
  // satisfies the bare `hooks/` substring test below and was being titled as a
  // hook-code change. Core-system first also matches categorizeChange's precedence,
  // so the title and the category can never disagree about what the change was.
  else if (hasCoreSystem) {
    const docNames = paths
      .filter(p => isCoreSystemDoc(p))
      .map(p => basename(p, '.md'));
    if (docNames.length === 1) {
      title = `${docNames[0]} Documentation Updated`;
    } else {
      title = 'LifeOS System Documentation Updated';
    }
  }
  // Hook changes
  else if (hasHooks) {
    const hookNames = paths
      .filter(p => p.includes('hooks/'))
      .map(p => basename(p, '.ts').replace('.hook', ''));
    if (hookNames.length === 1) {
      title = `${hookNames[0]} Hook Updated`;
    } else if (hookNames.length <= 3) {
      title = `${hookNames.slice(0, 3).join(', ')} Hooks Updated`;
    } else {
      title = `Hook System Updates`;
    }
  }
  // Config changes
  else if (hasConfig) {
    title = 'System Configuration Updated';
  }
  // Core user changes
  else if (hasCoreUser) {
    const docNames = paths
      .filter(p => p.includes('LIFEOS/USER/'))
      .map(p => basename(p, '.md'));
    if (docNames.length === 1) {
      title = `${docNames[0]} User Config Updated`;
    } else {
      title = 'User Configuration Updated';
    }
  }
  // Shared topic word. Ranked BELOW hasCoreSystem deliberately: when a change set
  // is a pair of core docs, naming the document beats naming the word they happen
  // to share ('LifeOS System Documentation Updated' over 'System Updates'). Ranking
  // it higher degrades every core-doc pair to a generic word.
  else if (commonWords.length > 0) {
    title = `${commonWords.join(' ')} Updates`;
  }
  // Fallback
  else {
    const categories = new Set(changes.map(c => c.category).filter(Boolean));
    if (categories.size === 1) {
      const cat = [...categories][0];
      title = `${capitalize(cat || 'System')} Updates Applied`;
    } else {
      title = 'Multi-Area System Updates Applied';
    }
  }

  // Ensure 4-8 words
  const words = title.split(/\s+/);
  if (words.length < 4) {
    title = `LifeOS ${title}`;
  } else if (words.length > 8) {
    title = words.slice(0, 8).join(' ');
  }

  return title;
}

/**
 * Words appearing in 2+ of the given filenames, as title-cased topic words.
 * Splits camelCase/PascalCase and hyphen/underscore, ignores words of <=2 chars,
 * returns the 3 most frequent. Empty for a single file — a "shared" word needs
 * two names to be shared between.
 */
function extractCommonPatterns(names: string[]): string[] {
  if (names.length === 0) return [];

  const allWords = names.flatMap(n =>
    n.split(/(?=[A-Z])|[-_]/).filter(w => w.length > 2)
  );

  const freq = new Map<string, number>();
  for (const w of allWords) {
    const lower = w.toLowerCase();
    freq.set(lower, (freq.get(lower) || 0) + 1);
  }

  return [...freq.entries()]
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => capitalize(word));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
