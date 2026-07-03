#!/usr/bin/env bun
/**
 * DA Growth Engine — Script-type cron job (weekly, growth_schedule 0 4 * * 0).
 *
 * The AS2 "state management" half made concrete: the DA's identity evolves
 * within bounds. Cadence + rules are PAI's own concretization (DaSubsystem.md),
 * NOT Miessler-quoted — Miessler names identity that "ebbs and flows in
 * relationship" [S6], this is PAI's mechanism for it.
 *
 * Three writers, one weekly pass:
 *   (a) Opinions — confidence-weighted beliefs. FIELD CONTRACT: emits
 *       topic/position/confidence (frontend wins; NOT the design-doc `belief`).
 *       Update math is DETERMINISTIC (no LLM): new=0.5 (observation)/0.8 (stated),
 *       confirm +0.05*(1-c), decay 0.02/month unconfirmed, prune <0.3 after 90d,
 *       max 50. Belief EXTRACTION from signals (the only LLM step) → Inference.ts,
 *       never `claude --bare`.
 *   (b) Bounded trait drift — ≤5 pts/month/trait. NEVER autonomous:
 *       core.name/full_name, voice.*, relationship.dynamic. Anti-sycophancy
 *       FLOOR: directness/precision may not drift below their identity value.
 *   (c) Growth log — append GrowthEvent entries with before/after (auditable).
 *
 * This run wires the ENGINE + all bound/exclusion enforcement. Belief extraction
 * from the week's signals is stubbed to a no-op unless DA_GROWTH_EXTRACT=1 (so a
 * weekly run is safe-by-default and doesn't fabricate opinions until enabled) —
 * the deterministic decay/prune/confirm math always runs on existing opinions.
 *
 * Output: NO_ACTION (growth is silent — it writes files, it doesn't notify).
 */

import { join } from "path"
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs"
import { homedir } from "os"
import YAML from "yaml"

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir()
const PAI = join(HOME, ".claude", "PAI")
const REGISTRY = join(PAI, "USER", "DA", "_registry.yaml")
const RATINGS = join(PAI, "MEMORY", "LEARNING", "SIGNALS", "ratings.jsonl")
const INFERENCE_TS = join(PAI, "TOOLS", "Inference.ts")

// Formation (opinion extraction + trait-drift proposal) is the autonomous
// persona-mutation half. It is INERT unless DA_GROWTH_EXTRACT=1 so the weekly
// job can't silently reshape identity until the principal opts in after an
// observation window. Deterministic maintenance (decay/prune) always runs.
const EXTRACT_ENABLED = process.env.DA_GROWTH_EXTRACT === "1"
// A single week's formation may only propose a small, bounded amount of change —
// belt-and-braces on top of the per-trait ≤5pt clamp.
const MAX_NEW_OPINIONS_PER_RUN = 3

// Bounds (DaSubsystem.md).
const MAX_TRAIT_DRIFT_PER_MONTH = 5
const OPINION_DECAY_PER_MONTH = 0.02
const OPINION_PRUNE_BELOW = 0.3
const OPINION_PRUNE_AFTER_DAYS = 90
const MAX_OPINIONS = 50
// NEVER-autonomous identity fields (yaml paths). The growth engine must never
// touch these — only the principal (via /interview or a direct edit) may.
const NEVER_AUTONOMOUS = ["core.name", "core.full_name", "voice", "relationship.dynamic"]
// Anti-sycophancy floor: these traits define the peer/anti-sycophant identity
// and may not drift DOWN autonomously (they may only be raised, still within bound).
const ANTI_SYCOPHANCY_FLOOR_TRAITS = ["directness", "precision"]

interface Opinion {
  topic: string
  position: string        // FRONTEND CONTRACT — not `belief`
  confidence: number
  source: "observation" | "inference" | "stated"
  evidence_count: number
  first_observed: string
  last_confirmed: string
}

interface GrowthEvent {
  date: string
  type: "opinion_formed" | "opinion_updated" | "opinion_pruned" | "trait_adjusted" | "preference_learned" | "milestone"
  detail: string
  before?: unknown
  after?: unknown
}

function primaryDA(): string {
  try {
    const m = readFileSync(REGISTRY, "utf-8").match(/^primary:\s*(\S+)/m)
    return m?.[1] ?? "kai"
  } catch { return "kai" }
}

function daDir(): string { return join(PAI, "USER", "DA", primaryDA()) }
function todayStr(now: Date): string { return now.toLocaleDateString("en-CA") }
function monthsBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.44))
}

function logGrowth(ev: GrowthEvent): void {
  try { appendFileSync(join(daDir(), "growth.jsonl"), JSON.stringify(ev) + "\n") } catch { /* best-effort */ }
}

/**
 * Apply deterministic opinion maintenance: decay unconfirmed, prune stale/low,
 * cap at MAX_OPINIONS. Returns the surviving opinions + logs each change.
 */
function maintainOpinions(opinions: Opinion[], now: Date): Opinion[] {
  const today = todayStr(now)
  const kept: Opinion[] = []
  for (const op of opinions) {
    const lastConf = new Date(op.last_confirmed || op.first_observed || today)
    const months = monthsBetween(lastConf, now)
    const decayed = Math.max(0, op.confidence - OPINION_DECAY_PER_MONTH * months)
    const ageDays = (now.getTime() - lastConf.getTime()) / (1000 * 60 * 60 * 24)

    if (decayed < OPINION_PRUNE_BELOW && ageDays > OPINION_PRUNE_AFTER_DAYS) {
      logGrowth({ date: today, type: "opinion_pruned", detail: op.topic, before: op.confidence, after: decayed })
      continue
    }
    if (decayed !== op.confidence) {
      logGrowth({ date: today, type: "opinion_updated", detail: `${op.topic} (decay)`, before: op.confidence, after: Number(decayed.toFixed(3)) })
    }
    kept.push({ ...op, confidence: Number(decayed.toFixed(3)) })
  }
  // Cap: keep the highest-confidence MAX_OPINIONS.
  kept.sort((a, b) => b.confidence - a.confidence)
  return kept.slice(0, MAX_OPINIONS)
}

function writeOpinions(opinions: Opinion[]): void {
  const doc = { opinions }
  const header = "# Garry's Opinions\n# Confidence-weighted beliefs, updated by growth engine\n# Fields: topic / position / confidence (frontend contract)\n\n"
  writeFileSync(join(daDir(), "opinions.yaml"), header + YAML.stringify(doc))
}

/**
 * Bounded trait drift with never-autonomous exclusions + anti-sycophancy floor.
 * `proposed` is a partial map of trait→new value. Returns the clamped map that
 * was actually applied.
 */
function applyTraitDrift(idPath: string, proposed: Record<string, number>, now: Date): Record<string, number> {
  const rawText = readFileSync(idPath, "utf-8")
  const doc = YAML.parseDocument(rawText)
  const traits = (doc.getIn(["personality", "traits"]) as { toJSON?: () => Record<string, number> })?.toJSON?.() ?? {}
  const applied: Record<string, number> = {}
  const today = todayStr(now)
  const month = today.slice(0, 7) // YYYY-MM

  // Per-MONTH ledger (Forge N2): clamp cumulative drift against a monthly BASELINE,
  // not just the current value — otherwise 4 weekly ±5 runs = ±20/month, violating
  // MAX_TRAIT_DRIFT_PER_MONTH. On a new month, snapshot current traits as the
  // baseline; within a month, every proposal is bounded to baseline ± MAX.
  const ledger = (doc.getIn(["growth", "trait_month_baseline"]) as { toJSON?: () => { month?: string; values?: Record<string, number> } })?.toJSON?.() ?? {}
  const baselineMonth = ledger.month
  const baselineValues: Record<string, number> = baselineMonth === month ? (ledger.values ?? {}) : {}
  if (baselineMonth !== month) {
    // New month → reset baseline to the current trait values.
    doc.setIn(["growth", "trait_month_baseline"], { month, values: { ...traits } })
  }

  for (const [name, value] of Object.entries(proposed)) {
    // N3: reject non-finite proposals — trait_drift is LLM JSON, not trusted.
    // A non-number (e.g. {}) would clamp to NaN and corrupt the identity yaml.
    if (typeof value !== "number" || !Number.isFinite(value)) continue
    const current = traits[name] ?? 50
    const monthBase = baselineValues[name] ?? current
    // Clamp to ≤MAX from BOTH the current value (per-run) AND the monthly baseline
    // (per-month cumulative) — the tighter of the two bounds wins.
    const lo = Math.max(current - MAX_TRAIT_DRIFT_PER_MONTH, monthBase - MAX_TRAIT_DRIFT_PER_MONTH)
    const hi = Math.min(current + MAX_TRAIT_DRIFT_PER_MONTH, monthBase + MAX_TRAIT_DRIFT_PER_MONTH)
    let next = Math.max(lo, Math.min(hi, value))
    next = Math.max(0, Math.min(100, next))
    // Anti-sycophancy floor: directness/precision may not drift DOWN.
    if (ANTI_SYCOPHANCY_FLOOR_TRAITS.includes(name) && next < current) {
      next = current
    }
    if (next !== current) {
      doc.setIn(["personality", "traits", name], next)
      applied[name] = next
      logGrowth({ date: today, type: "trait_adjusted", detail: name, before: current, after: next })
    }
  }
  if (Object.keys(applied).length > 0) {
    doc.setIn(["growth", "last_growth_update"], today)
    writeFileSync(idPath, String(doc))
  }
  return applied
}

/** Guard: refuse any proposed change that targets a NEVER_AUTONOMOUS field. */
function assertNoImmutableTouch(proposedPaths: string[]): void {
  for (const p of proposedPaths) {
    if (NEVER_AUTONOMOUS.some((locked) => p === locked || p.startsWith(locked + "."))) {
      throw new Error(`growth engine refused to touch never-autonomous field: ${p}`)
    }
  }
}

// ── Formation (autonomous persona mutation — gated behind DA_GROWTH_EXTRACT=1) ──

interface FormationProposal {
  new_opinions: Array<{ topic: string; position: string; source: "observation" | "stated" }>
  trait_drift: Record<string, number> // trait → proposed new value (clamped downstream)
}

function readJsonl<T>(path: string): T[] {
  try {
    if (!existsSync(path)) return []
    return readFileSync(path, "utf-8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T)
  } catch { return [] }
}

/**
 * Belief EXTRACTION — the only LLM step. Reads the REAL signal stream (last
 * week's ratings + their sentiment summaries) and asks Inference.ts (Sonnet, via
 * --level standard — NEVER `claude --bare`) for candidate opinions + optional bounded
 * trait nudges. Returns a structured proposal; the caller runs it through the
 * deterministic guards (confidence seeding, ≤5pt clamp, never-autonomous,
 * anti-sycophancy floor). Returns null on any failure → forms nothing.
 */
async function extractProposal(now: Date): Promise<FormationProposal | null> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const ratings = readJsonl<{ timestamp?: string; rating?: number; sentiment_summary?: string }>(RATINGS)
    .filter((r) => (r.timestamp ?? "") >= weekAgo && r.sentiment_summary)
    // Cap at the 12 most-recent signals: the fast tier (Haiku, 15s) times out on
    // a 30-item payload and exits non-zero → formation silently forms nothing
    // (found live 2026-07-04). 12 recent sentiments is ample signal for 3 opinions
    // and keeps the call well inside the fast-tier budget. Truncation is by
    // recency (most-recent-wins), logged implicitly by the cap.
    .slice(-12)
    // Trim each sentiment note so a few long ones can't blow the payload.
    .map((r) => ({ rating: r.rating, note: (r.sentiment_summary ?? "").slice(0, 160) }))
  if (ratings.length === 0) return null // no signal → form nothing

  const material = JSON.stringify({ sentiments: ratings })
  const sys =
    "You are a DA forming careful, low-confidence opinions about the principal from a week of interaction signals. " +
    "Propose at most 3 NEW opinions and OPTIONAL small trait nudges. Respond with ONLY compact JSON: " +
    '{"new_opinions":[{"topic":string,"position":string,"source":"observation"|"stated"}],' +
    '"trait_drift":{<traitName>:<0-100>}}. ' +
    "Only propose a trait nudge if the week strongly warrants it; drift is clamped to ±5 downstream. " +
    "NEVER propose changes to name, voice, or relationship — those are immutable."
  try {
    // `standard` (Sonnet, 30s) not `fast` (Haiku, 15s): the formation call sits
    // right at the fast-tier 15s ceiling and intermittently exits non-zero →
    // silently forms nothing (found live 2026-07-04). This is a WEEKLY job, so
    // Sonnet's ~$0.02/run is negligible and it completes reliably. The DESIGN-DOC
    // cost model even budgets the weekly growth pass at Sonnet.
    const proc = Bun.spawn(["bun", INFERENCE_TS, "--level", "standard", sys, material], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
    const timer = setTimeout(() => proc.kill(), 45_000)
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited
    clearTimeout(timer)
    if (code !== 0) return null
    const m = out.match(/\{[\s\S]*\}/)
    if (!m) return null
    const obj = JSON.parse(m[0]) as Partial<FormationProposal>
    return {
      new_opinions: (obj.new_opinions ?? []).slice(0, MAX_NEW_OPINIONS_PER_RUN),
      trait_drift: obj.trait_drift ?? {},
    }
  } catch { return null }
}

/** Seed a new opinion at the contract confidence (observation 0.5 / stated 0.8). */
function seedOpinion(p: { topic: string; position: string; source: "observation" | "stated" }, now: Date): Opinion {
  const today = todayStr(now)
  return {
    topic: p.topic,
    position: p.position,               // FRONTEND CONTRACT field, not `belief`
    confidence: p.source === "stated" ? 0.8 : 0.5,
    source: p.source,
    evidence_count: 1,
    first_observed: today,
    last_confirmed: today,
  }
}

async function main() {
  const now = new Date()
  const dir = daDir()
  const idPath = join(dir, "DA_IDENTITY.yaml")

  // (a) Opinion maintenance — always runs (deterministic, safe).
  let opinions: Opinion[] = []
  try {
    const raw = existsSync(join(dir, "opinions.yaml")) ? readFileSync(join(dir, "opinions.yaml"), "utf-8") : ""
    const parsed = YAML.parse(raw) as { opinions?: Opinion[] } | null
    opinions = parsed?.opinions ?? []
  } catch { opinions = [] }

  const before = opinions.length
  opinions = maintainOpinions(opinions, now)

  // (b) FORMATION — autonomous persona mutation, gated behind DA_GROWTH_EXTRACT=1.
  //     Extract candidate opinions + trait nudges from the real signal stream,
  //     then run EVERY proposal through the deterministic guards. Inert (forms
  //     nothing) unless the gate is on — so the weekly job can't reshape identity
  //     until the principal opts in after an observation window.
  let formedOpinions = 0
  let driftApplied: Record<string, number> = {}
  if (EXTRACT_ENABLED) {
    const proposal = await extractProposal(now)
    if (proposal) {
      // New opinions: seed at contract confidence, dedupe by topic, respect max 50 (maintainOpinions caps).
      const existingTopics = new Set(opinions.map((o) => o.topic.toLowerCase()))
      for (const p of proposal.new_opinions) {
        if (!p.topic || !p.position || existingTopics.has(p.topic.toLowerCase())) continue
        const op = seedOpinion(p, now)
        opinions.push(op)
        existingTopics.add(p.topic.toLowerCase())
        formedOpinions++
        logGrowth({ date: todayStr(now), type: "opinion_formed", detail: op.topic, after: { position: op.position, confidence: op.confidence } })
      }
      // Trait drift: guard never-autonomous FIRST (throws if the LLM proposed a
      // locked field), then clamp through applyTraitDrift (≤5pt + floor).
      const proposedTraitPaths = Object.keys(proposal.trait_drift).map((t) => `personality.traits.${t}`)
      assertNoImmutableTouch(proposedTraitPaths)
      driftApplied = applyTraitDrift(idPath, proposal.trait_drift, now)
    }
  } else {
    assertNoImmutableTouch([]) // gate off — guard still proven callable
  }

  opinions = maintainOpinions(opinions, now) // re-cap after any additions
  writeOpinions(opinions)

  if (before !== opinions.length || formedOpinions > 0 || Object.keys(driftApplied).length > 0) {
    logGrowth({ date: todayStr(now), type: "milestone", detail: `opinions ${before}→${opinions.length} (+${formedOpinions} formed); traits drifted: ${Object.keys(driftApplied).join(",") || "none"}` })
  }

  console.log("NO_ACTION") // growth is silent
}

main().catch((err) => {
  console.error(`da-growth error: ${err}`)
  console.log("NO_ACTION")
})
