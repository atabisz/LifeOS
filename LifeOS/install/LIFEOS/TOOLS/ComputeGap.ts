#!/usr/bin/env bun
// Normalize env path vars Claude Code may inject unexpanded — literal $HOME/${HOME}
// in LIFEOS_DIR/LIFEOS_CONFIG_DIR/PROJECTS_DIR resolves to a shadow dir (#1404 / PR #1451, author jbmml).
for (const __k of ["LIFEOS_DIR", "LIFEOS_CONFIG_DIR", "PROJECTS_DIR"]) {
  const __v = process.env[__k];
  if (__v && /^\$\{?HOME\}?(\/|$)/.test(__v)) process.env[__k] = __v.replace(/^\$\{?HOME\}?/, process.env.HOME ?? "~");
}


/**
 * ComputeGap — computed view of Current→Ideal delta per dimension.
 *
 * Per plan §15.2: GAP is a computed view, not a stored directory. This tool reads
 * IDEAL_STATE/<dimension>.md and CURRENT_STATE/<matching>.md + USER/HEALTH/FINANCES/
 * and emits a structured gap report on stdout. Appends a JSONL log entry to
 * MEMORY/OBSERVABILITY/gap-history.jsonl for weekly trend tracking.
 *
 * Dimensions: health, money, freedom are metric (computable gaps).
 * Relationships, creative, rhythms are narrative (surfaced as reminders, not gaps).
 *
 * Uses Haiku via LIFEOS/TOOLS/Inference.ts for the metric-extraction step. ~$0.01/run.
 *
 * Usage:
 *   bun ComputeGap.ts                       All metric dimensions
 *   bun ComputeGap.ts --dimension health    Single dimension
 *   bun ComputeGap.ts --json                JSON output
 *   bun ComputeGap.ts --log                 Append to gap-history.jsonl
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { inference } from "./Inference";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
const LIFEOS_DIR = process.env.LIFEOS_DIR || join(HOME, ".claude", "LIFEOS");
const IDEAL_DIR = join(LIFEOS_DIR, "USER", "TELOS", "IDEAL_STATE");
const CURRENT_DIR = join(LIFEOS_DIR, "USER", "TELOS", "CURRENT_STATE");
const HEALTH_DIR = join(LIFEOS_DIR, "USER", "HEALTH");
const FINANCES_DIR = join(LIFEOS_DIR, "USER", "FINANCES");
const HISTORY_FILE = join(LIFEOS_DIR, "MEMORY", "OBSERVABILITY", "gap-history.jsonl");

const METRIC_DIMENSIONS = ["health", "money", "freedom"] as const;
type MetricDimension = (typeof METRIC_DIMENSIONS)[number];

type GapEntry = {
  metric: string;
  current: string | number | null;
  target: string | number | null;
  direction: "above" | "below" | "at" | "unknown";
  severity: "critical" | "warning" | "info" | "none";
  note?: string;
};

type DimensionGap = {
  dimension: string;
  entries: GapEntry[];
  summary: string;
  timestamp: string;
};

function readIf(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

// Mirror of UpdateLifeosState.ts::readFrontmatterType — reads the leading `---`
// block and returns a lowercased `type:` value, or null if absent.
function readFrontmatterType(content: string): string | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;
  const m = content.slice(3, end).match(/^type:\s*(.+?)\s*$/m);
  return m ? m[1].replace(/^["']|["']$/g, "").trim().toLowerCase() : null;
}

const DIRECTIONS = ["above", "below", "at", "unknown"] as const;
const SEVERITIES = ["critical", "warning", "info", "none"] as const;
type Direction = (typeof DIRECTIONS)[number];
type Severity = (typeof SEVERITIES)[number];

function coerceScalar(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  return null;
}

// Return the first present, non-empty value among a set of candidate keys.
// Haiku-tier models reason well but do NOT reliably obey a strict key schema —
// they emit natural variants (gap_narrative, priority, current_status, ideal_row).
// Rather than fight that with ever-longer prompts, accept the aliases here.
function pick(r: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")) return v;
  }
  return undefined;
}

// Map a free-text priority/severity token onto the GapEntry severity enum.
function normSeverity(v: unknown): Severity | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (SEVERITIES.includes(s as Severity)) return s as Severity;
  if (s === "high" || s === "urgent" || s === "severe") return "critical";
  if (s === "medium" || s === "moderate" || s === "med") return "warning";
  if (s === "low" || s === "minor" || s === "trivial") return "info";
  return null;
}

// Map a direction token or a status label onto the direction enum.
function normDirection(v: unknown): Direction | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (DIRECTIONS.includes(s as Direction)) return s as Direction;
  // A status label implies direction: missing/partial are below the target.
  if (s === "missing" || s === "partial" || s === "behind" || s === "under") return "below";
  if (s === "have" || s === "met" || s === "done") return "at";
  return null;
}

// Given a status label, derive a default severity when the model gave none.
function severityFromStatus(status: unknown): Severity {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (s === "missing") return "critical";
  if (s === "partial") return "warning";
  return "info";
}

// Validate + normalize a single untrusted model entry into a GapEntry, or null to drop.
// Alias-tolerant: accepts the model's natural key variants and derives missing
// direction/severity from the status. Drops fully-"have" items (no gap).
function validateEntry(raw: unknown): GapEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const metric = coerceScalar(pick(r, ["metric", "name", "item", "ideal_row"]));
  const metricStr = typeof metric === "string" ? metric.trim() : metric != null ? String(metric) : "";
  if (!metricStr) return null;

  // The status label (own key or embedded in a "current" alias) drives filtering + defaults.
  const statusRaw = pick(r, ["status", "current_status", "state"]);
  const statusStr = typeof statusRaw === "string" ? statusRaw.trim().toLowerCase() : "";
  // Drop fully-satisfied items — a gap engine reports gaps, not wins.
  if (statusStr === "have" || statusStr === "met" || statusStr === "done") return null;

  const direction: Direction =
    normDirection(pick(r, ["direction", "trend"])) ?? normDirection(statusRaw) ?? "unknown";

  const severity: Severity =
    normSeverity(pick(r, ["severity", "priority", "importance"])) ??
    (statusStr ? severityFromStatus(statusStr) : "info");

  // current: prefer an explicit current value; fall back to the status label as the signal.
  const currentVal = coerceScalar(pick(r, ["current", "current_value", "current_status", "status", "state"]));
  const target = coerceScalar(pick(r, ["target", "goal", "ideal", "target_value"]));
  const note = coerceScalar(pick(r, ["note", "gap_description", "gap_narrative", "next", "blocker_or_next", "action"]));

  const entry: GapEntry = {
    metric: metricStr,
    current: currentVal,
    target,
    direction,
    severity,
  };
  if (typeof note === "string" && note.trim()) entry.note = note.trim();
  return entry;
}

function fallbackGap(dim: string, reason: string): DimensionGap {
  return {
    dimension: dim,
    entries: [
      {
        metric: `${dim.toUpperCase()} gap extraction`,
        current: "unavailable",
        target: "semantic gap",
        direction: "unknown",
        severity: "info",
        note: `Haiku extraction failed or returned no valid entries; showing no computed gap. ${reason}`,
      },
    ],
    summary: "1 gap(s).",
    timestamp: new Date().toISOString(),
  };
}

const SYSTEM_PROMPT =
  "You are a life-state gap analyzer. You compare a person's CURRENT reality against " +
  "their IDEAL target for one life dimension and extract concrete, per-metric gaps. " +
  "The IDEAL block is prose describing the desired state, often with specific targets " +
  "(e.g. 'three 90-minute rides per week', 'no more than 2 meetings a day'). The CURRENT " +
  "block lists items with a 'status: have|partial|missing' label. For each CURRENT item " +
  "that is NOT fully 'have', emit one gap: set \"metric\" to the item's short name; set " +
  '"target" to the concrete target you find in the IDEAL prose for that item (a number/phrase, ' +
  'not null, whenever the IDEAL states one); set "current" to a short phrase describing where ' +
  "they are now (use the status — 'missing' → not started, 'partial' → partially there — plus " +
  'any detail in the row); set "direction" to how CURRENT sits vs TARGET ("below" when short of ' +
  'the target, "at" when met, "above" when exceeding, "unknown" only if truly indeterminable); ' +
  'set "severity" by how far off and how important ("critical" for a fully-missing high-stakes ' +
  'item, "warning" for partial or moderately-off, "info" for minor); add a one-line "note" naming ' +
  "the concrete next action to close the gap when the IDEAL prose implies one. Skip items that are " +
  'fully "have" (no gap). Return STRICT JSON ONLY — a JSON array, no prose, no markdown fences. ' +
  'Each element: {"metric": string, "current": string|number|null, "target": string|number|null, ' +
  '"direction": "above"|"below"|"at"|"unknown", "severity": "critical"|"warning"|"info"|"none", ' +
  '"note"?: string}. If there are no non-"have" items, return an empty array [].';

// Shared Haiku-powered extractor for a metric dimension.
async function extractGap(dim: MetricDimension): Promise<DimensionGap> {
  const upper = dim.toUpperCase();
  const ideal = readIf(join(IDEAL_DIR, `${upper}.md`)) || "";
  const current = readIf(join(CURRENT_DIR, `${upper}.md`)) || "";

  const userPrompt =
    `Dimension: ${dim}\n\n` +
    `=== IDEAL STATE (target) ===\n${ideal || "(none provided)"}\n\n` +
    `=== CURRENT STATE (reality) ===\n${current || "(none provided)"}\n\n` +
    "Extract the per-metric gaps as the specified JSON array.";

  let result: Awaited<ReturnType<typeof inference>>;
  try {
    result = await inference({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      level: "low",
      expectJson: true,
      timeout: 20000,
    });
  } catch (err) {
    return fallbackGap(dim, err instanceof Error ? err.message : String(err));
  }

  if (!result.success) {
    return fallbackGap(dim, result.error || "inference returned success=false");
  }

  // Prefer the pre-parsed envelope; fall back to parsing raw output.
  let payload: unknown = result.parsed;
  if (payload === undefined) {
    try {
      payload = JSON.parse(result.output);
    } catch {
      return fallbackGap(dim, "model output was not valid JSON");
    }
  }

  // Accept either a bare array or an object wrapping an array.
  const arr: unknown = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>).entries ??
        (payload as Record<string, unknown>).gaps
      : undefined;

  if (!Array.isArray(arr)) {
    return fallbackGap(dim, "model output did not contain a gap array");
  }

  const entries = arr
    .map(validateEntry)
    .filter((e): e is GapEntry => e !== null);

  if (entries.length === 0 && arr.length > 0) {
    return fallbackGap(dim, "no returned entries were valid");
  }

  return {
    dimension: dim,
    entries,
    summary: entries.length === 0 ? "No gaps detected." : `${entries.length} gap(s).`,
    timestamp: new Date().toISOString(),
  };
}

async function computeMoney(): Promise<DimensionGap> {
  // Respect the opt-out frontmatter on IDEAL_STATE/MONEY.md — skip Haiku entirely.
  const idealRaw = readIf(join(IDEAL_DIR, "MONEY.md")) || "";
  if (readFrontmatterType(idealRaw) === "opt-out") {
    return {
      dimension: "money",
      entries: [],
      summary: "Opted out.",
      timestamp: new Date().toISOString(),
    };
  }
  return extractGap("money");
}

async function computeDimension(dim: MetricDimension): Promise<DimensionGap> {
  switch (dim) {
    case "health":
      return extractGap("health");
    case "money":
      return computeMoney();
    case "freedom":
      return extractGap("freedom");
  }
}

function logEntry(gap: DimensionGap): void {
  const dir = dirname(HISTORY_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(HISTORY_FILE, JSON.stringify(gap) + "\n");
}

function formatHuman(gaps: DimensionGap[]): string {
  const lines: string[] = ["═══ Current → Ideal Gap ═══", ""];
  for (const g of gaps) {
    lines.push(`## ${g.dimension.toUpperCase()}`);
    if (g.entries.length === 0) {
      lines.push("  ✅ No gaps.");
    } else {
      for (const e of g.entries) {
        const icon = e.severity === "critical" ? "🔴" : e.severity === "warning" ? "🟡" : "🔵";
        lines.push(`  ${icon} ${e.metric}: ${e.current}  →  ${e.target}`);
        if (e.note) lines.push(`      ${e.note}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ─── Main ───

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dimIdx = args.indexOf("--dimension");
  const dims: MetricDimension[] =
    dimIdx === -1
      ? [...METRIC_DIMENSIONS]
      : ([args[dimIdx + 1]].filter((d): d is MetricDimension =>
          METRIC_DIMENSIONS.includes(d as MetricDimension)
        ) as MetricDimension[]);

  if (dims.length === 0) {
    console.error(`Invalid dimension. Choose from: ${METRIC_DIMENSIONS.join(", ")}`);
    process.exit(1);
  }

  const gaps = await Promise.all(dims.map(computeDimension));

  if (args.includes("--log")) {
    gaps.forEach(logEntry);
  }

  if (args.includes("--json")) {
    console.log(JSON.stringify(gaps, null, 2));
  } else {
    console.log(formatHuman(gaps));
  }
}

main().catch((err) => {
  console.error("ComputeGap failed:", err);
  process.exit(1);
});
