#!/usr/bin/env bun
/**
 * UpdatePaiState — Writes LIFEOS_STATE.json with per-dimension pct scores read by
 * the statusline (PAI/LIFEOS_StatusLine.sh) STATE strip and the Pulse TELOS
 * dashboard rings.
 *
 * Pct semantics (v2 — honest "articulation / setup %", not a life-progress score):
 *   - If `CURRENT_STATE/<DIM>.md` exists with `status: have|partial|missing`
 *     rows, pct = (have + 0.5 × partial) / total × 100 — real coverage.
 *   - Else score the IDEAL_STATE file by its frontmatter `type:` + authored SUBSTANCE:
 *       · type: opt-out    → pct null  ("deliberately not tracked", a choice not a gap)
 *       · type: north-star → pct null  (directional/aspirational, not scored by design)
 *       · type: target     → pct = min(100, sections×20 + bullets×8), clamped
 *         i.e. reward populated structure. A vague/empty file scores LOW; a rich one HIGH.
 *   - This REPLACES the old `100 − TBD×10`, which perversely (a) scored a vague
 *     empty file 100% and (b) LOWERED the score when you honestly flagged a gap
 *     with "TBD". pct here means "how fully articulated", surfaced in the UI as a
 *     "setup %", NOT "how close to ideal" — that's real-coverage (CURRENT_STATE) or
 *     a future gap engine.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "os";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
const PAI_DIR = process.env.PAI_DIR || join(HOME, ".claude", "PAI");
const IDEAL_DIR = join(PAI_DIR, "USER", "TELOS", "IDEAL_STATE");
const CURRENT_DIR = join(PAI_DIR, "USER", "TELOS", "CURRENT_STATE");
const STATE_FILE = join(PAI_DIR, "USER", "TELOS", "LIFEOS_STATE.json");

const DIMENSIONS = [
  { id: "health",         file: "HEALTH.md" },
  { id: "money",          file: "MONEY.md" },
  { id: "freedom",        file: "FREEDOM.md" },
  { id: "creative",       file: "CREATIVE.md" },
  { id: "relationships",  file: "RELATIONSHIPS.md" },
  { id: "rhythms",        file: "RHYTHMS.md" },
  { id: "infrastructure", file: "INFRASTRUCTURE.md" },
] as const;

type DimensionId = (typeof DIMENSIONS)[number]["id"];

interface DimensionState {
  pct: number | null;
  tbd_count: number;
  last_updated: string | null;
  source_file: string;
}

interface PaiState {
  generated_at: string;
  dimensions: Record<DimensionId, DimensionState>;
}

function readFrontmatterDate(content: string): string | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;
  const fm = content.slice(3, end);
  const m = fm.match(/^last_updated:\s*(.+?)\s*$/m);
  return m ? m[1].replace(/^["']|["']$/g, "") : null;
}

function computeFromCurrent(file: string): DimensionState | null {
  const path = join(CURRENT_DIR, file);
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf-8");
  const have    = (content.match(/\bstatus:\s*have\b/g)    || []).length;
  const partial = (content.match(/\bstatus:\s*partial\b/g) || []).length;
  const missing = (content.match(/\bstatus:\s*missing\b/g) || []).length;
  const total = have + partial + missing;
  if (total === 0) return null;
  const pct = Math.round(((have + 0.5 * partial) / total) * 100);
  return {
    pct,
    tbd_count: missing,
    last_updated: readFrontmatterDate(content),
    source_file: `CURRENT_STATE/${file}`,
  };
}

// Read the `type:` frontmatter field (target | north-star | opt-out | …).
function readFrontmatterType(content: string): string | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;
  const m = content.slice(3, end).match(/^type:\s*(.+?)\s*$/m);
  return m ? m[1].replace(/^["']|["']$/g, "").trim().toLowerCase() : null;
}

function computeFromIdeal(file: string): DimensionState {
  const path = join(IDEAL_DIR, file);
  if (!existsSync(path)) {
    // No file at all → unmeasured (not "0%/failing"). The reader/UI renders null
    // as "not tracked", never a misleading zero.
    return { pct: null, tbd_count: 0, last_updated: null, source_file: file };
  }
  const content = readFileSync(path, "utf-8");
  const type = readFrontmatterType(content);
  const last_updated = readFrontmatterDate(content);
  // tbd_count is still surfaced for information, but NO LONGER drives the score
  // (flagging a gap must never lower "how well articulated this is").
  const tbd_count = (content.match(/\bTBD\b/g) || []).length;

  // Deliberate opt-out or a directional north-star are NOT scored — a choice,
  // not an unfilled gap. pct null → UI shows "not tracked".
  if (type === "opt-out" || type === "north-star") {
    return { pct: null, tbd_count, last_updated, source_file: `IDEAL_STATE/${file}` };
  }

  // type: target (or unspecified) → score by authored SUBSTANCE: populated
  // `## ` sections and `- ` bullets. Weights leave headroom so a fully-set-up
  // file lands ~80 (not auto-100) and 100 means exceptional depth — the number
  // discriminates instead of pegging at the ceiling. A vague/near-empty file
  // scores low. (e.g. 5 sections + 6 bullets = 50+30 = 80.)
  const sections = (content.match(/^##\s+/gm) || []).length;
  const bullets  = (content.match(/^\s*[-*]\s+/gm) || []).length;
  const pct = Math.max(0, Math.min(100, sections * 10 + bullets * 5));
  return { pct, tbd_count, last_updated, source_file: `IDEAL_STATE/${file}` };
}

function computeState(file: string): DimensionState {
  return computeFromCurrent(file) ?? computeFromIdeal(file);
}

function build(): PaiState {
  const dimensions = {} as Record<DimensionId, DimensionState>;
  for (const d of DIMENSIONS) {
    dimensions[d.id] = computeState(d.file);
  }
  return {
    generated_at: new Date().toISOString(),
    dimensions,
  };
}

function main(): void {
  const state = build();
  const dir = dirname(STATE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Atomic write (temp + rename): the dashboard reader and DerivedSync poll this
  // file; a mid-write interruption must not expose a half-written, unparseable JSON.
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  renameSync(tmp, STATE_FILE);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(state, null, 2));
  } else {
    console.log(`LIFEOS_STATE.json updated: ${STATE_FILE}`);
    for (const d of DIMENSIONS) {
      const s = state.dimensions[d.id];
      const pctStr = s.pct === null ? "—" : `${s.pct}%`;
      console.log(`  ${d.id.padEnd(14)} ${pctStr.padStart(5)}  (${s.tbd_count} TBDs, updated ${s.last_updated ?? "unknown"})`);
    }
  }
}

main();
