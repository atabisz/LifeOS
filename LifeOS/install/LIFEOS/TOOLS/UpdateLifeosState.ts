#!/usr/bin/env bun
/**
 * UpdateLifeosState — Writes LIFEOS_STATE.json with per-dimension pct scores read by
 * the statusline (LIFEOS/LIFEOS_StatusLine.sh) STATE strip and the Pulse TELOS
 * dashboard rings.
 *
 * Pct semantics (v2 — honest "articulation / setup %", not a life-progress score):
 *   - If `CURRENT_STATE/<DIM>.md` exists with `status: have|partial|missing`
 *     rows, pct = (have + 0.5 × partial) / total × 100 — real coverage.
 *   - Else score the IDEAL_STATE file by frontmatter `type:` + authored SUBSTANCE:
 *       · type: opt-out / north-star → pct null (a choice/direction, not a gap → "not tracked")
 *       · type: target (or unset)    → pct = min(100, sections×10 + bullets×5)
 *     REPLACES the old `100 − TBD×10`, which scored a vague empty file 100% and
 *     LOWERED the score when you honestly flagged a gap with "TBD".
 *
 * The IDEAL path measures how fully the principal has ARTICULATED what "good"
 * looks like (a setup %); the CURRENT path measures whether reality matches it.
 *
 * Reads:  LIFEOS/USER/TELOS/IDEAL_STATE/<DIM>.md (target articulation)
 *         LIFEOS/USER/TELOS/CURRENT_STATE/<DIM>.md (actual coverage, when present)
 * Writes: LIFEOS/USER/TELOS/LIFEOS_STATE.json
 *
 * Template-style: works on any user's LifeOS install — no hardcoded paths,
 * no {{PRINCIPAL_NAME}}-specific names. Fresh installs land all dimensions at 0 until the
 * principal runs the IDEAL_STATE interview.
 *
 * Usage:
 *   bun ~/.claude/LIFEOS/TOOLS/UpdateLifeosState.ts
 *   bun ~/.claude/LIFEOS/TOOLS/UpdateLifeosState.ts --json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const HOME = process.env.HOME || "";
const LIFEOS_DIR = process.env.LIFEOS_DIR || join(HOME, ".claude", "LIFEOS");
const IDEAL_DIR = join(LIFEOS_DIR, "USER", "TELOS", "IDEAL_STATE");
const CURRENT_DIR = join(LIFEOS_DIR, "USER", "TELOS", "CURRENT_STATE");
const STATE_FILE = join(LIFEOS_DIR, "USER", "TELOS", "LIFEOS_STATE.json");

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
  velo: number | null;   // change in pct since the previous run (null until a prior point differs)
  mode: "coverage" | "setup" | null;   // coverage = real have/partial/missing rows; setup = IDEAL articulation %; null = not tracked
  tbd_count: number;
  last_updated: string | null;
  source_file: string;
}

// Bump when the pct FORMULA changes — velo is only meaningful across
// same-formula runs; readPriorPcts() suppresses velo when the stored version
// differs, so a formula change reads flat rather than a one-time artifact velo.
const SCORER_VERSION = "substance-v2-exclude-notscored";

interface LifeosState {
  generated_at: string;
  scorer_version: string;
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
    velo: null,   // filled by build() from prior-run delta
    mode: "coverage",   // real have/partial/missing rows → achievement toward ideal
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
    // No file → unmeasured (null), NOT 0%/failing. UI renders null as "not tracked".
    return { pct: null, velo: null, mode: null, tbd_count: 0, last_updated: null, source_file: file };
  }
  const content = readFileSync(path, "utf-8");
  const type = readFrontmatterType(content);
  const last_updated = readFrontmatterDate(content);
  // tbd_count is informational only — it NO LONGER drives the score (flagging a
  // gap must never lower "how well articulated this dimension is").
  const tbd_count = (content.match(/\bTBD\b/g) || []).length;

  // Deliberate opt-out / directional north-star are not scored (a choice, not a
  // gap) → pct null → "not tracked".
  if (type === "opt-out" || type === "north-star") {
    return { pct: null, velo: null, mode: null, tbd_count, last_updated, source_file: `IDEAL_STATE/${file}` };
  }

  // type: target (or unspecified) → score by authored SUBSTANCE (populated
  // sections + bullets). Headroom-tuned so a fully-set-up file lands ~80, not
  // auto-100; 100 = exceptional depth. Replaces the old `100 − TBD×10`, which
  // scored a vague empty file 100% and LOWERED the score for honestly flagging
  // a gap. pct = "how fully articulated" (a setup %), NOT "how close to ideal".
  // A section the author marked "not scored"/"aspirational" and its bullets are
  // EXCLUDED — counting them would inflate the score against the author's intent.
  const { sections, bullets } = countScorableSubstance(content);
  const pct = Math.max(0, Math.min(100, sections * 10 + bullets * 5));
  return { pct, velo: null, mode: "setup", tbd_count, last_updated, source_file: `IDEAL_STATE/${file}` };
}

// Count `## ` sections and their `- ` bullets, SKIPPING any section whose heading
// declares itself out of scope ("not scored" / "aspirational") and every bullet
// under it.
function countScorableSubstance(content: string): { sections: number; bullets: number } {
  // Exclude only when the heading carries the out-of-scope flag in a `(...)`
  // qualifier (e.g. "## North-star (aspirational, not scored)") — so a legit
  // "## Aspirations" heading isn't false-excluded by a bare substring match.
  const EXCLUDE = /\([^)]*\b(?:not\s+scored|aspirational)\b[^)]*\)/i;
  let sections = 0, bullets = 0, excluding = false;
  for (const line of content.split("\n")) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) { excluding = EXCLUDE.test(h[1]); if (!excluding) sections++; continue; }
    if (!excluding && /^\s*[-*]\s+/.test(line)) bullets++;
  }
  return { sections, bullets };
}

function computeState(file: string): DimensionState {
  return computeFromCurrent(file) ?? computeFromIdeal(file);
}

// Read prior LIFEOS_STATE.json → { dimId: prior_pct } for velo.
function readPriorPcts(): Record<string, number> {
  const out: Record<string, number> = {};
  if (!existsSync(STATE_FILE)) return out;
  try {
    const prev = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as {
      scorer_version?: string;
      dimensions?: Record<string, { pct?: number | null }>;
    };
    if (prev.scorer_version !== SCORER_VERSION) return out; // cross-formula → suppress velo
    for (const [id, d] of Object.entries(prev.dimensions ?? {})) {
      if (typeof d?.pct === "number") out[id] = d.pct;
    }
  } catch { /* corrupt prior → no velo basis */ }
  return out;
}

function build(): LifeosState {
  // velo = change in pct since the PREVIOUS run. Null until a prior numeric pct
  // exists AND differs from now — so a first run, an unmeasured dim, or an
  // unchanged dim all read "flat/not tracked", never a fabricated trend.
  const prior = readPriorPcts();
  const dimensions = {} as Record<DimensionId, DimensionState>;
  for (const d of DIMENSIONS) {
    const s = computeState(d.file);
    if (typeof s.pct === "number" && typeof prior[d.id] === "number" && s.pct !== prior[d.id]) {
      s.velo = s.pct - prior[d.id];
    }
    dimensions[d.id] = s;
  }
  return {
    generated_at: new Date().toISOString(),
    scorer_version: SCORER_VERSION,
    dimensions,
  };
}

function main(): void {
  const state = build();
  const dir = dirname(STATE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(state, null, 2));
  } else {
    console.log(`LIFEOS_STATE.json updated: ${STATE_FILE}`);
    for (const d of DIMENSIONS) {
      const s = state.dimensions[d.id];
      const pctStr = s.pct === null ? "—" : `${s.pct}%`;
      const veloStr = s.velo === null ? "" : ` ${s.velo > 0 ? "+" : ""}${s.velo}`;
      console.log(`  ${d.id.padEnd(14)} ${pctStr.padStart(5)}${veloStr.padStart(4)}  (${s.tbd_count} TBDs, updated ${s.last_updated ?? "unknown"})`);
    }
  }
}

main();
