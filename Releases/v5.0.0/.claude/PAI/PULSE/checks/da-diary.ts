#!/usr/bin/env bun
/**
 * DA Diary Writer — Script-type cron job (nightly, diary_schedule 0 23 * * *).
 *
 * Writes the DA's daily diary entry. Implements the "context that knows you"
 * intent [S5] — mines the SAME signal stream the memory system already captures
 * (ratings + completed work), not a separate one. Cadence is PAI's own
 * concretization (DaSubsystem.md), NOT Miessler-quoted.
 *
 * Reads:
 *   - MEMORY/LEARNING/SIGNALS/ratings.jsonl  (today's ratings → mood + avg_rating)
 *   - MEMORY/STATE/work.json                 (today's sessions → interaction_count, topics)
 * Writes:
 *   - USER/DA/<primary>/diary.jsonl          (one DiaryEntry per day, idempotent)
 *
 * The DiaryEntry schema matches DAGrowth.ts + the /assistant/diary endpoint EXACTLY.
 * Summarization (topics/notable_moments/learning) goes through Inference.ts
 * (Haiku), NEVER `claude --bare`. Idempotent per day: a re-run replaces today's
 * entry rather than duplicating it.
 *
 * Output: NO_ACTION (the diary is silent — it writes a file, it doesn't notify).
 */

import { join } from "path"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { homedir } from "os"

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir()
const PAI = join(HOME, ".claude", "PAI")
const REGISTRY = join(PAI, "USER", "DA", "_registry.yaml")
const RATINGS = join(PAI, "MEMORY", "LEARNING", "SIGNALS", "ratings.jsonl")
const WORK_JSON = join(PAI, "MEMORY", "STATE", "work.json")
const INFERENCE_TS = join(PAI, "TOOLS", "Inference.ts")

// Matches DAGrowth.ts DiaryEntry + /assistant/diary contract.
interface DiaryEntry {
  date: string
  interaction_count: number
  topics: string[]
  mood: "positive" | "neutral" | "frustrated"
  avg_rating: number
  notable_moments: string[]
  learning: string | null
}

function primaryDA(): string {
  try {
    const m = readFileSync(REGISTRY, "utf-8").match(/^primary:\s*(\S+)/m)
    return m?.[1] ?? "kai"
  } catch { return "kai" }
}

function todayStr(now: Date): string {
  // UTC date, so it matches the .slice(0,10) of the UTC ISO timestamps in
  // ratings.jsonl and work.json.sessions[].started. A local-tz "today" vs a
  // UTC-sliced timestamp mis-buckets everything near midnight (found live
  // 2026-07-04: local AEST date was a day ahead of the UTC timestamps).
  return now.toISOString().slice(0, 10)
}

function readJsonl<T>(path: string): T[] {
  try {
    if (!existsSync(path)) return []
    return readFileSync(path, "utf-8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T)
  } catch { return [] }
}

/** Layer-2 summary via Inference.ts (Haiku). Never `claude --bare`. Returns null on failure. */
async function summarize(ratings: Array<{ sentiment_summary?: string }>, topics: string[]): Promise<{ notable: string[]; learning: string | null } | null> {
  const material = JSON.stringify({
    topics,
    sentiments: ratings.map((r) => r.sentiment_summary).filter(Boolean).slice(0, 10),
  })
  const sys = "You are a DA writing a terse daily diary. Given today's topics and interaction sentiments, respond with ONLY compact JSON: " +
    '{"notable_moments":[string up to 3],"learning":string|null}. notable_moments are 1-sentence highlights; learning is one thing you learned about the principal today, or null.'
  try {
    const proc = Bun.spawn(["bun", INFERENCE_TS, "--level", "fast", sys, material], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
    const out = await new Response(proc.stdout).text()
    if ((await proc.exited) !== 0) return null
    const m = out.match(/\{[\s\S]*\}/)
    if (!m) return null
    const obj = JSON.parse(m[0]) as { notable_moments?: string[]; learning?: string | null }
    return { notable: (obj.notable_moments ?? []).slice(0, 3), learning: obj.learning ?? null }
  } catch { return null }
}

async function main() {
  const now = new Date()
  const today = todayStr(now)

  // Today's ratings.
  const allRatings = readJsonl<{ timestamp?: string; rating?: number; sentiment_summary?: string }>(RATINGS)
  const todays = allRatings.filter((r) => (r.timestamp ?? "").slice(0, 10) === today && typeof r.rating === "number")
  const avg = todays.length ? todays.reduce((s, r) => s + (r.rating ?? 0), 0) / todays.length : 0
  const mood: DiaryEntry["mood"] = avg === 0 ? "neutral" : avg >= 7 ? "positive" : avg <= 3 ? "frustrated" : "neutral"

  // Today's sessions → interaction_count + topics.
  let interaction_count = 0
  const topics: string[] = []
  try {
    if (existsSync(WORK_JSON)) {
      const work = JSON.parse(readFileSync(WORK_JSON, "utf-8")) as { sessions?: Record<string, { task?: string; sessionName?: string; started?: string }> }
      for (const s of Object.values(work.sessions ?? {})) {
        if ((s.started ?? "").slice(0, 10) === today) {
          interaction_count++
          const topic = s.sessionName ?? s.task
          if (topic && !topics.includes(topic)) topics.push(topic.slice(0, 60))
        }
      }
    }
  } catch { /* work.json optional */ }

  // Nothing happened today → no diary entry (don't write empty noise).
  if (interaction_count === 0 && todays.length === 0) {
    console.log("NO_ACTION")
    return
  }

  const summary = await summarize(todays, topics.slice(0, 5))
  const entry: DiaryEntry = {
    date: today,
    interaction_count,
    topics: topics.slice(0, 8),
    mood,
    avg_rating: Number(avg.toFixed(1)),
    notable_moments: summary?.notable ?? [],
    learning: summary?.learning ?? null,
  }

  // Idempotent per day: drop any existing entry for `today`, append the new one.
  const diaryPath = join(PAI, "USER", "DA", primaryDA(), "diary.jsonl")
  const existing = readJsonl<DiaryEntry>(diaryPath).filter((e) => e.date !== today)
  const content = [...existing, entry].map((e) => JSON.stringify(e)).join("\n") + "\n"
  writeFileSync(diaryPath, content)

  console.log("NO_ACTION") // diary is silent — it writes, it doesn't notify
}

main().catch((err) => {
  console.error(`da-diary error: ${err}`)
  console.log("NO_ACTION")
})
