/**
 * UpdateCounts.ts - Update the counts cache with fresh system counts
 *
 * PURPOSE:
 * Updates PAI/MEMORY/STATE/counts-cache.json at the end of each session.
 * Banner and statusline then read from that cache (instant, no execution).
 *
 * ARCHITECTURE:
 * SessionEnd hook → UpdateCounts → MEMORY/STATE/counts-cache.json
 * Session start → Banner reads the cache (instant)
 * Session start → Statusline reads the cache (instant)
 *
 * This design ensures:
 * - No spawning/execution at session start
 * - Counts are always available (no waiting)
 * - Single source of truth in counts-cache.json
 *
 * WHY A SEPARATE CACHE (not settings.json): counts mutate every session
 * (sessions, ratings, signals, updatedAt …). Writing them into the tracked
 * settings.json made every machine's working tree drift, forcing a stash
 * before every git pull. MEMORY/STATE/ is gitignored, so the cache stays
 * machine-local and settings.json no longer churns. Readers fall back to a
 * legacy settings.counts block (if present) then 0, so the split is safe.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { getPaiDir, getSettingsPath, getClaudeDir } from '../lib/paths';


interface Counts {
  skills: number;
  skillsPublic: number;
  skillsPrivate: number;
  workflows: number;
  hooks: number;
  signals: number;
  files: number;
  work: number;
  sessions: number;
  research: number;
  ratings: number;
  updatedAt: string;
}

/**
 * Count files matching criteria recursively
 */
function countFilesRecursive(dir: string, extension?: string): number {
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countFilesRecursive(fullPath, extension);
      } else if (entry.isFile()) {
        if (!extension || entry.name.endsWith(extension)) {
          count++;
        }
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }
  return count;
}

/**
 * Count .md files inside any Workflows directory
 */
function countWorkflowFiles(dir: string): number {
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === 'workflows') {
          count += countFilesRecursive(fullPath, '.md');
        } else {
          count += countWorkflowFiles(fullPath);
        }
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }
  return count;
}

/**
 * Count skills (directories with SKILL.md file)
 * Returns total, public (no _ prefix), and private (_ prefix)
 */
function countSkills(_paiDir: string): { total: number; pub: number; priv: number } {
  let pub = 0;
  let priv = 0;
  const skillsDir = join(getClaudeDir(), 'skills');
  try {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      const isDir = entry.isDirectory() ||
        (entry.isSymbolicLink() && statSync(join(skillsDir, entry.name)).isDirectory());
      if (isDir) {
        const skillFile = join(skillsDir, entry.name, 'SKILL.md');
        if (existsSync(skillFile)) {
          if (entry.name.startsWith('_')) priv++;
          else pub++;
        }
      }
    }
  } catch {
    // skills directory doesn't exist
  }
  return { total: pub + priv, pub, priv };
}

/**
 * Count active hooks: unique commands registered under `hooks.<event>[].hooks[].command`
 * in settings.json. Dormant `.hook.ts` files on disk that aren't wired to any event do
 * NOT count — only what Claude Code will actually fire.
 */
function countHooks(_paiDir: string): number {
  const settingsPath = getSettingsPath();
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const events = settings.hooks ?? {};
    const unique = new Set<string>();
    for (const matchers of Object.values(events)) {
      if (!Array.isArray(matchers)) continue;
      for (const matcher of matchers) {
        const list = (matcher as { hooks?: unknown }).hooks;
        if (!Array.isArray(list)) continue;
        for (const h of list) {
          const cmd = (h as { command?: unknown }).command;
          if (typeof cmd === 'string' && cmd.length > 0) unique.add(cmd);
        }
      }
    }
    return unique.size;
  } catch {
    return 0;
  }
}

/**
 * Count non-empty lines in a JSONL file (signals = rating entries)
 */
function countRatingsLines(filePath: string): number {
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return 0;
    return readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * Count immediate subdirectories (depth 1)
 */
function countSubdirs(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

/**
 * Get all counts
 */
function getCounts(paiDir: string): Counts {
  const ratingsPath = join(paiDir, 'MEMORY/LEARNING/SIGNALS/ratings.jsonl');
  const sk = countSkills(paiDir);
  return {
    skills: sk.total,
    skillsPublic: sk.pub,
    skillsPrivate: sk.priv,
    workflows: countWorkflowFiles(join(getClaudeDir(), 'skills')),
    hooks: countHooks(paiDir),
    signals: countFilesRecursive(join(paiDir, 'MEMORY/LEARNING'), '.md'),
    files: countFilesRecursive(join(paiDir, 'PAI/USER')),
    work: countSubdirs(join(paiDir, 'MEMORY/WORK')),
    sessions: countFilesRecursive(join(paiDir, 'MEMORY'), '.jsonl'),
    research: countFilesRecursive(join(paiDir, 'MEMORY/RESEARCH'), '.md') +
              countFilesRecursive(join(paiDir, 'MEMORY/RESEARCH'), '.json'),
    ratings: countRatingsLines(ratingsPath),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Refresh usage cache from Anthropic OAuth API.
 * Called by stop hook so status line never needs to make this 700ms API call.
 */
async function refreshUsageCache(paiDir: string): Promise<void> {
  const usageCachePath = join(paiDir, 'MEMORY/STATE/usage-cache.json');

  try {
    // Extract OAuth token — macOS Keychain or Linux credentials file
    let credJson: string;
    if (process.platform === 'darwin') {
      credJson = execSync(
        'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: 'utf-8', timeout: 3000 }
      ).trim();
    } else {
      const credPath = join(process.env.HOME || '', '.claude', '.credentials.json');
      credJson = readFileSync(credPath, 'utf-8').trim();
    }

    const parsed = JSON.parse(credJson);
    const token = parsed?.claudeAiOauth?.accessToken;
    if (!token) return;

    const resp = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(3000),
    });

    if (!resp.ok) return;
    const data = await resp.json() as Record<string, unknown>;
    if (!data?.five_hour) return;

    // Fetch API workspace cost if admin key is available
    const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY;
    if (adminKey) {
      try {
        const now = new Date();
        const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00Z`;
        const costResp = await fetch(
          `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${startOfMonth}`,
          {
            headers: {
              'x-api-key': adminKey,
              'anthropic-version': '2023-06-01',
            },
            signal: AbortSignal.timeout(5000),
          }
        );
        if (costResp.ok) {
          const costData = await costResp.json() as any;
          // Sum all daily cost entries (amount is cents as decimal string)
          let totalCostCents = 0;
          if (Array.isArray(costData?.data)) {
            for (const day of costData.data) {
              if (Array.isArray(day?.results)) {
                for (const entry of day.results) {
                  totalCostCents += parseFloat(entry.amount || '0');
                }
              }
            }
          }
          (data as any).workspace_cost = {
            month_used_cents: Math.round(totalCostCents),
            updated_at: new Date().toISOString(),
          };
          console.error(`[UpdateCounts] Workspace cost: $${(totalCostCents / 100).toFixed(2)} this month`);
        }
      } catch {
        // Non-fatal — admin API unavailable
      }
    }

    writeFileSync(usageCachePath, JSON.stringify(data, null, 2) + '\n');
    console.error(`[UpdateCounts] Usage cache refreshed: 5H=${(data.five_hour as any)?.utilization}% 7D=${(data.seven_day as any)?.utilization}%`);
  } catch {
    // Non-fatal — status line falls back to stale cache
  }
}

/**
 * Handler called by UpdateCounts.hook.ts
 */
export async function handleUpdateCounts(): Promise<void> {
  const paiDir = getPaiDir();
  const countsCachePath = join(paiDir, 'MEMORY/STATE/counts-cache.json');

  try {
    // Run counts + usage refresh in parallel
    const [counts] = await Promise.all([
      Promise.resolve(getCounts(paiDir)),
      refreshUsageCache(paiDir),
    ]);

    // Write counts to the gitignored cache (NOT settings.json — see file header).
    mkdirSync(dirname(countsCachePath), { recursive: true });
    writeFileSync(countsCachePath, JSON.stringify(counts, null, 2) + '\n');
    console.error(`[UpdateCounts] Updated: SK:${counts.skillsPublic}pu/${counts.skillsPrivate}pv WF:${counts.workflows} HK:${counts.hooks} SIG:${counts.signals} F:${counts.files} W:${counts.work} SESS:${counts.sessions} RES:${counts.research} RAT:${counts.ratings}`);
  } catch (error) {
    console.error('[UpdateCounts] Failed to update counts:', error);
    // Non-fatal - don't throw, let other handlers continue
  }
}

// Allow running standalone to seed initial counts
if (import.meta.main) {
  handleUpdateCounts().then(() => process.exit(0));
}
