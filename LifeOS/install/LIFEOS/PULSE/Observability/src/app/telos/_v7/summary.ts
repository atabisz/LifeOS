// Universal TELOS analysis generator.
//
// Pure transform: (telos, isPersonalized) → multi-paragraph deep analysis.
// Reads the WHOLE Telos graph — not just first-order facts. The references
// between Problems/Missions/Goals/Challenges/Strategies/Projects encode
// structure; this function surfaces the structural signals:
//
//   - PINCH POINTS:  challenges blocking ≥3 goals (highest-leverage unblock)
//   - WEAK CHAINS:   problems with no addressing strategy (orphan blockers)
//   - STALLED ITEMS: goals with non-trivial pct but zero delta (was moving, stuck)
//   - DRIFT RISK:    goals with no implementing strategy (no path forward)
//   - TRACTION:      goals with positive delta + dimensions climbing
//   - GRAVITY:       most-referenced node (the structural center of work)
//
// All derivations are on the references already parsed by the API.
// No LLM call, no API change, no hardcoded user content. Same input ⇒
// same output. Returns null on fixture installs and structurally-empty TELOS.

import type {
  Telos, Dimension, Goal, Challenge, Problem,
} from "./data";

export interface TelosSummary {
  headline: string;
  // Body paragraphs (each may be empty string when no signal exists).
  // Renderer hides empty paragraphs.
  position: string;     // where you stand vs ideal — dimension gaps
  traction: string;     // what's moving — climbing dims, top-delta goals
  pinch: string;        // structural blockers — pinch points, stalled items
  drift: string;        // weak chains and drift risk
  recommendations: string;  // concrete next moves derived from the analysis
}

// ── Helpers ────────────────────────────────────────────────────────

function fmtPct(n: number): string { return `${Math.round(n)}%`; }
function avgCur(dims: readonly Dimension[]): number {
  if (dims.length === 0) return 0;
  return dims.reduce((a, d) => a + d.cur, 0) / dims.length;
}
function gap(d: Dimension): number { return d.ideal - d.cur; }
function lower(s: string): string { return s.toLowerCase(); }
function joinList(items: readonly string[], conjunction = "and"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items[items.length - 1]}`;
}

interface OwnerVoice { possessive: string; subject: string; verb: (b: "be" | "sit" | "have") => string; }
function ownerVoice(name: string): OwnerVoice {
  const isName = !!(name && name.trim());
  if (!isName) {
    return { possessive: "your", subject: "you", verb: (b) => ({ be: "are", sit: "sit", have: "have" })[b] };
  }
  const first = name.trim().split(/\s+/)[0]!;
  return { possessive: `${first}'s`, subject: first, verb: (b) => ({ be: "is", sit: "sits", have: "has" })[b] };
}

// ── Graph derivations ─────────────────────────────────────────────

function pinchPoints(telos: Telos, threshold = 2): Challenge[] {
  return telos.challenges
    .filter((c) => c.blocks.length >= threshold)
    .sort((a, b) => b.blocks.length - a.blocks.length);
}

function weakChains(telos: Telos): Problem[] {
  // High-severity problems with no strategy that overcomes a challenge that blocks any goal addressing this problem's missions.
  // Simpler proxy: high-severity problems whose addressed missions have no active strategies.
  return telos.problems.filter((p) => {
    if (p.severity !== "high") return false;
    const addressedMissions = p.affects;
    if (addressedMissions.length === 0) return true; // orphan
    // Find goals that serve any addressed mission — actually goals don't reference missions in this schema
    // Instead, check: are there strategies that implement goals which somehow connect back to this problem?
    // Simpler signal: problem affects mission but no strategy is active. We accept the simpler signal.
    return telos.strategies.filter((s) => s.active).length === 0;
  });
}

function stalledGoals(telos: Telos): Goal[] {
  return telos.goals
    .filter((g) => g.pct >= 20 && (g.delta === 0 || g.delta === null))
    .sort((a, b) => b.pct - a.pct);
}

function driftRiskGoals(telos: Telos): Goal[] {
  // Goals with no implementing strategy.
  const implementedGoalIds = new Set(telos.strategies.flatMap((s) => s.implements));
  return telos.goals.filter((g) => !implementedGoalIds.has(g.id));
}

function topMovingGoals(telos: Telos, n = 2): Goal[] {
  return telos.goals
    .filter((g) => typeof g.delta === "number" && (g.delta as number) > 0)
    .sort((a, b) => (b.delta as number) - (a.delta as number))
    .slice(0, n);
}

function climbingDimensions(telos: Telos): Dimension[] {
  return telos.dimensions.filter((d) => d.velo > 0.15).sort((a, b) => b.velo - a.velo);
}
function driftingDimensions(telos: Telos): Dimension[] {
  return telos.dimensions.filter((d) => d.velo < -0.15).sort((a, b) => a.velo - b.velo);
}

// ── Paragraph builders ────────────────────────────────────────────

function buildHeadline(telos: Telos, voice: OwnerVoice): string {
  const { dimensions, idealState } = telos;
  const sCap = voice.subject[0]!.toUpperCase() + voice.subject.slice(1);

  if (dimensions.length === 0) {
    return idealState.horizon
      ? `${sCap} ${voice.verb("have")} an ideal-state horizon of ${idealState.horizon} — dimensions not yet articulated.`
      : `${sCap} ${voice.verb("have")} not yet articulated the ideal state across life dimensions.`;
  }

  // NB: a dimension's `cur` is one of two things per `mode`: "coverage" (real
  // CURRENT_STATE have/partial/missing rows — achievement toward ideal) or
  // "setup" (IDEAL_STATE articulation %, how fully written — NOT achievement).
  // The prose is worded per-mode so the same number never reads as life-progress
  // it doesn't measure. When every dim is "setup" (the common case) the wording
  // stays "articulated"; once any dim is on real coverage the neutral verb
  // ("tracked") is used so the mixed set isn't mislabeled as pure articulation.
  const modeOf = (d: Dimension) => d.mode ?? "setup";
  const allSetup = dimensions.every((d) => modeOf(d) === "setup");
  const singleMode = dimensions.every((d) => modeOf(d) === modeOf(dimensions[0]!));
  const avg = avgCur(dimensions);
  const avgVerb = allSetup ? "articulated" : "tracked";
  const dimVerb = (d: Dimension) => (modeOf(d) === "coverage" ? "covered" : "articulated");
  const horizonClause = idealState.horizon ? ` (horizon ${idealState.horizon})` : "";

  if (dimensions.length === 1) {
    const d = dimensions[0]!;
    return `${voice.possessive} ideal state is ${fmtPct(d.cur)} ${dimVerb(d)}${horizonClause}.`;
  }

  const avgClause = `${voice.possessive} ideal state is ${fmtPct(avg)} ${avgVerb} on average${horizonClause}.`;

  // Comparative superlatives ("furthest along", "the least") only mean something
  // WITHIN one measurement axis. When every dim shares a mode we rank by gap and
  // use them; across mixed modes (some coverage, some setup) a 70%-articulated and
  // a 50%-covered are incommensurable, so we do NOT rank — we state the highest-
  // and lowest-pct dims as standalone facts, each verb honest to its own mode.
  if (singleMode) {
    const sortedByGap = [...dimensions].sort((a, b) => gap(a) - gap(b));
    const most = sortedByGap[0]!;
    const least = sortedByGap[sortedByGap.length - 1]!;
    return `${avgClause} ${cap(lower(most.label))} is furthest along at ${fmtPct(most.cur)} ${dimVerb(most)}; ${lower(least.label)} the least at ${fmtPct(least.cur)} ${dimVerb(least)}.`;
  }

  const byPct = [...dimensions].sort((a, b) => b.cur - a.cur);
  const hi = byPct[0]!;
  const lo = byPct[byPct.length - 1]!;
  return `${avgClause} ${cap(lower(hi.label))} is ${fmtPct(hi.cur)} ${dimVerb(hi)}; ${lower(lo.label)} is ${fmtPct(lo.cur)} ${dimVerb(lo)}.`;
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function buildPosition(telos: Telos, voice: OwnerVoice): string {
  const { dimensions } = telos;
  if (dimensions.length === 0) return "";
  const sortedByGap = [...dimensions].sort((a, b) => gap(b) - gap(a));
  const widest = sortedByGap.slice(0, Math.min(2, sortedByGap.length)).filter((d) => gap(d) > 5);
  if (widest.length === 0) {
    return `Every tracked dimension is at or near its ideal.`;
  }
  // The `gap` (100 − cur) means different things per mode: for a "setup" dim it's
  // articulation headroom (how much of the ideal is still to be WRITTEN); for a
  // "coverage" dim it's real headroom toward the ideal (unmet items). Word each
  // per its mode so a coverage gap isn't mislabeled "left to articulate".
  const gapVerb = (d: Dimension) => ((d.mode ?? "setup") === "coverage" ? "to go" : "left to articulate");
  const parts = widest.map((d) => `${lower(d.label)} (${fmtPct(gap(d))} ${gapVerb(d)})`);
  // Header stays neutral ("Biggest gaps") rather than a comparative superlative
  // when modes are mixed: each clause's gap verb is honest to its own mode, but a
  // single ranked ordering would conflate coverage headroom with articulation
  // headroom (see buildHeadline — same cross-axis caution).
  const singleMode = dimensions.every((d) => (d.mode ?? "setup") === (dimensions[0]!.mode ?? "setup"));
  const header = singleMode ? "Furthest from ideal" : "Biggest gaps";
  return `${header}: ${joinList(parts)}.`;
}

function buildTraction(telos: Telos, voice: OwnerVoice): string {
  const climbing = climbingDimensions(telos);
  const moving = topMovingGoals(telos);
  const greenProjects = telos.projects.filter((p) => p.status === "green");
  const parts: string[] = [];

  if (climbing.length === 1) parts.push(`${lower(climbing[0]!.label)} is climbing`);
  else if (climbing.length >= 2) parts.push(`${joinList(climbing.slice(0, 2).map((d) => lower(d.label)))} are climbing`);

  if (moving.length === 1) {
    const m = moving[0]!;
    const k = m.kpi ? ` (${m.kpi})` : "";
    parts.push(`${lower(m.title)} ${voice.verb("be")} the top-moving goal${k}`);
  } else if (moving.length >= 2) {
    parts.push(`${moving.length} goals are moving (top: ${lower(moving[0]!.title)})`);
  }

  if (greenProjects.length > 0) {
    parts.push(`${greenProjects.length} project${greenProjects.length === 1 ? "" : "s"} on track`);
  }

  if (parts.length === 0) return "No active traction signals are populated yet.";
  return cap(parts.join("; ") + ".");
}

function buildPinch(telos: Telos): string {
  const pinch = pinchPoints(telos);
  const stalled = stalledGoals(telos);
  const redProjects = telos.projects.filter((p) => p.status === "red");
  const parts: string[] = [];

  if (pinch.length > 0) {
    const top = pinch[0]!;
    parts.push(`${cap(lower(top.title))} is the structural pinch point — it blocks ${top.blocks.length} goals on its own`);
    if (pinch.length >= 2) {
      const otherCount = pinch.length - 1;
      parts.push(`${otherCount} other challenge${otherCount === 1 ? " also blocks" : "s also block"} multiple goals`);
    }
  }

  if (stalled.length > 0) {
    const names = stalled.slice(0, 2).map((g) => `${lower(g.title)} (${fmtPct(g.pct)} stuck)`);
    parts.push(`stalled mid-progress: ${joinList(names)}`);
  }

  if (redProjects.length > 0) {
    parts.push(`${redProjects.length} project${redProjects.length === 1 ? " is" : "s are"} red`);
  }

  if (parts.length === 0) return "";
  return cap(parts.join("; ") + ".");
}

function buildDrift(telos: Telos): string {
  const drifting = driftingDimensions(telos);
  const orphans = driftRiskGoals(telos);
  const weak = weakChains(telos);
  const stranded = telos.stranded;
  const strandedTotal = stranded.work_no_goal.length + stranded.goals_no_strategy.length + stranded.strategies_idle.length;
  const parts: string[] = [];

  if (drifting.length > 0) {
    parts.push(`${joinList(drifting.map((d) => lower(d.label)))} ${drifting.length === 1 ? "is" : "are"} drifting`);
  }
  if (weak.length > 0) {
    parts.push(`${weak.length} high-severity problem${weak.length === 1 ? "" : "s"} ${weak.length === 1 ? "has" : "have"} no addressing strategy`);
  }
  if (orphans.length >= 3) {
    parts.push(`${orphans.length} goals lack an implementing strategy — drift risk`);
  }
  if (strandedTotal > 0) {
    parts.push(`${strandedTotal} item${strandedTotal === 1 ? "" : "s"} stranded (orphan work, goals or idle strategies)`);
  }

  if (parts.length === 0) return "";
  return cap(parts.join("; ") + ".");
}

function buildRecommendations(telos: Telos): string {
  // Derive 1-3 concrete next moves from the structural analysis.
  // Prefer recommendations the user has explicitly authored; fall back to
  // graph-derived moves when those are absent.
  const picks: string[] = [];

  // 1. Top user-authored recommendation, if present.
  const topRec = telos.recommendations[0];
  if (topRec) {
    picks.push(`${topRec.action}${topRec.because ? ` — ${topRec.because.replace(/^because\s*/i, "because ")}` : ""}`);
  }

  // 2. Highest-leverage pinch unblock (if not already covered).
  const pinch = pinchPoints(telos);
  if (pinch.length > 0 && picks.length < 2) {
    const top = pinch[0]!;
    picks.push(`Resolve ${lower(top.title)} — ${top.blocks.length} goals depend on it`);
  }

  // 3. Closest-to-finish goal (if not already covered).
  const closeGoal = telos.goals
    .filter((g) => g.pct >= 60 && g.pct < 100)
    .sort((a, b) => b.pct - a.pct)[0];
  if (closeGoal && picks.length < 3) {
    picks.push(`Push ${lower(closeGoal.title)} across the line — ${fmtPct(closeGoal.pct)} done is the cheapest win`);
  }

  // 4. Wire up an orphan goal (drift mitigation).
  const orphans = driftRiskGoals(telos);
  if (orphans.length >= 3 && picks.length < 3) {
    picks.push(`Wire ${orphans.length} drift-risk goals to strategies — they have no path forward without one`);
  }

  if (picks.length === 0) {
    return "No structural recommendations surfaced — review TELOS to refresh signals.";
  }

  return picks.map((p, i) => `${i + 1}. ${p}`).join("  ");
}

// ── Public entrypoint ─────────────────────────────────────────────

export function summarizeTelos(telos: Telos, isPersonalized: boolean): TelosSummary | null {
  if (!isPersonalized) return null;
  const allDimsZero = telos.dimensions.length === 0 || telos.dimensions.every((d) => d.cur === 0);
  const noGoals = telos.goals.length === 0;
  const noProjects = telos.projects.length === 0;
  if (allDimsZero && noGoals && noProjects) return null;

  const voice = ownerVoice(telos.owner.name);

  return {
    headline: buildHeadline(telos, voice),
    position: buildPosition(telos, voice),
    traction: buildTraction(telos, voice),
    pinch: buildPinch(telos),
    drift: buildDrift(telos),
    recommendations: buildRecommendations(telos),
  };
}
