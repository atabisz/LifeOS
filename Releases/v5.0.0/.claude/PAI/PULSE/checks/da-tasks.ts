#!/usr/bin/env bun
/**
 * DA Scheduled-Task Fire-Executor — Script-type cron job (every minute).
 *
 * SPQA's ACTION layer made real: the ACTUATION PRIMITIVE the AS2 "Full Agent
 * orchestration" is built on — not the orchestration rung itself.
 *
 * SAFETY (correctness-critical — cross-family audited, Forge FAIL→fixed). The
 * fire-decision truth table:
 *
 *   status            | requires_confirmation | confirmed | → decision
 *   ------------------|-----------------------|-----------|-----------
 *   active            | false/undef           | —         | FIRE
 *   active            | true                  | true      | FIRE
 *   active            | true                  | false     | SKIP  (unconfirmed must_ask)
 *   pending_approval  | any                   | any       | SKIP  (never fire)
 *   completed/cancelled/failed | any          | any       | SKIP
 *
 * CONCURRENCY (Forge C1/C2/C5): the fire decision is re-validated INSIDE the
 * store lock and the task is CLAIMED (last_fired/completed written) BEFORE
 * dispatch. So a concurrent manual+cron run, or a DELETE landing mid-cycle,
 * cannot double-fire or fire-after-cancel — only the claimer dispatches, and it
 * claims against fresh in-lock state. Claim-before-dispatch makes a once-task
 * at-most-once across a crash (it's already `completed` when the retry looks);
 * a recurring task records `last_fired` before dispatch so a crash won't
 * re-fire it inside the same minute.
 *
 * POISON-PILL SAFETY (Forge C6): matchesCron THROWS on a malformed cron; each
 * task's due-check is wrapped so one bad `cron` string can't abort the whole
 * cycle (which would silently starve every other task forever).
 *
 * Output: dispatched notification text, or NO_ACTION (sentinel → cron silent).
 */

import { join } from "path"
import { homedir } from "os"
import { readTasks, mutateTasks, LockTimeoutError, type ScheduledTask } from "../Assistant/store"
import { matchesCron } from "../lib"

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir()
const PAI_DIR = join(HOME, ".claude", "PAI")
const INFERENCE_TS = join(PAI_DIR, "TOOLS", "Inference.ts")

const MAX_FIRES_PER_CYCLE = 10        // per-cycle cap → defer overflow (Cato A1.5)
const MAX_SPEND_PER_CYCLE = 0.10      // aggregate prompt spend per tick (USD)
const PROMPT_COST_ESTIMATE = 0.001
const DISPATCH_TIMEOUT_MS = 30_000    // bound a hung action so it can't stall the cron loop (Forge C8)

/** Coarse must_ask re-classification at fire time (defense-in-depth). Exported for tests (N6). */
export function isMustAsk(t: ScheduledTask): boolean {
  if (t.requires_confirmation && !t.confirmed) return true
  const a = t.action
  if (a.type === "script") return true // modify-code class
  if (a.type === "notify" && a.channel && !["voice", "local"].includes(a.channel)) return true // reaches others
  return false
}

/** Due check. Wrapped by callers so a throwing (malformed) cron can't abort the cycle. Exported for tests. */
export function isDueNow(t: ScheduledTask, now: Date): boolean {
  if (t.schedule.type === "once") {
    return !!t.schedule.at && new Date(t.schedule.at).getTime() <= now.getTime()
  }
  if (!t.schedule.cron) return false
  if (t.schedule.until && new Date(t.schedule.until).getTime() < now.getTime()) return false
  if (!matchesCron(t.schedule.cron, now)) return false // may THROW on malformed cron — caller guards
  if (t.last_fired) {
    const firedMin = Math.floor(new Date(t.last_fired).getTime() / 60_000)
    if (Math.floor(now.getTime() / 60_000) <= firedMin) return false
  }
  return true
}

/** Full fire predicate. Never throws (guards the cron parse). Exported for tests (N6). */
export function willFire(t: ScheduledTask, now: Date): boolean {
  if (t.status !== "active") return false
  if (t.requires_confirmation && !t.confirmed) return false
  if (isMustAsk(t)) return false
  try {
    return isDueNow(t, now)
  } catch {
    // Malformed cron (or bad date) → treat as not-due for THIS task only; the
    // rest of the cycle proceeds. Poison-pill containment (Forge C6).
    return false
  }
}

/** Dispatch a task's action, bounded by a timeout. Returns text + failed flag. */
async function dispatchAction(t: ScheduledTask): Promise<{ text: string | null; failed: boolean }> {
  const a = t.action
  try {
    if (a.type === "notify") {
      return { text: a.message ?? t.description, failed: false }
    }
    if (a.type === "prompt") {
      // NEVER `claude --bare` — OAuth subscription via Inference.ts.
      const proc = Bun.spawn(["bun", INFERENCE_TS, "--level", a.model ?? "fast", a.prompt ?? t.description], {
        stdout: "pipe", stderr: "pipe", env: { ...process.env },
      })
      const timer = setTimeout(() => proc.kill(), DISPATCH_TIMEOUT_MS)
      const out = await new Response(proc.stdout).text()
      const code = await proc.exited
      clearTimeout(timer)
      if (code !== 0) return { text: null, failed: true }
      return { text: out.trim() || null, failed: false }
    }
    if (a.type === "script" && a.command) {
      // Reached only for a non-must_ask script (rare; still gated at select time).
      const proc = Bun.spawn(["bash", "-lc", a.command], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
      const timer = setTimeout(() => proc.kill(), DISPATCH_TIMEOUT_MS)
      const out = await new Response(proc.stdout).text()
      const code = await proc.exited
      clearTimeout(timer)
      if (code !== 0) return { text: null, failed: true }
      return { text: out.trim() || null, failed: false }
    }
  } catch {
    return { text: null, failed: true }
  }
  return { text: null, failed: false }
}

/**
 * Atomically CLAIM a task for firing: inside the store lock, re-validate it is
 * STILL fireable against fresh state, then record last_fired/fire_count (and
 * flip once→completed) BEFORE returning. Returns the claimed task snapshot, or
 * null if it was no longer fireable (cancelled/completed/already-fired by a
 * concurrent run). Claim-before-dispatch → no double-fire, no fire-after-cancel.
 */
function claimForFire(id: string, now: Date): ScheduledTask | null {
  try {
    return mutateTasks((tasks) => {
      const t = tasks.find((x) => x.id === id)
      if (!t || !willFire(t, now)) return { tasks, result: null } // re-validate in-lock
      t.last_fired = now.toISOString()
      t.fire_count = (t.fire_count ?? 0) + 1
      if (t.schedule.type === "once") t.status = "completed"
      // snapshot the claimed task for the caller to dispatch from
      return { tasks, result: { ...t } as ScheduledTask }
    })
  } catch (err) {
    if (err instanceof LockTimeoutError) return null // couldn't claim → skip this cycle
    throw err
  }
}

/** Record a failed dispatch: recurring stays active (transient), once→failed terminal (Forge N2). */
function recordFailure(id: string): void {
  try {
    mutateTasks((tasks) => {
      const t = tasks.find((x) => x.id === id)
      if (t && t.schedule.type === "once") t.status = "failed"
      // recurring: leave active + the last_fired we set (won't re-fire this minute);
      // a one-off transient error must not permanently brick a daily task.
      return { tasks, result: undefined }
    })
  } catch { /* best-effort */ }
}

async function main() {
  const now = new Date()

  // Candidate selection is a cheap pre-filter on an unlocked read; the AUTHORITATIVE
  // decision is re-made inside claimForFire's lock, so a stale candidate is harmless.
  const candidates = readTasks().filter((t) => willFire(t, now))
  if (candidates.length === 0) {
    console.log("NO_ACTION")
    return
  }

  const dispatched: string[] = []
  let fires = 0
  let spend = 0

  for (const c of candidates) {
    if (fires >= MAX_FIRES_PER_CYCLE) break
    if (c.action.type === "prompt" && spend + PROMPT_COST_ESTIMATE > MAX_SPEND_PER_CYCLE) continue

    // CLAIM inside the lock (re-validates + writes last_fired BEFORE dispatch).
    const claimed = claimForFire(c.id, now)
    if (!claimed) continue // cancelled/completed/already-claimed by a concurrent run

    fires++
    if (claimed.action.type === "prompt") spend += PROMPT_COST_ESTIMATE

    const { text, failed } = await dispatchAction(claimed)
    if (failed) {
      recordFailure(claimed.id)
    } else if (text) {
      dispatched.push(text)
    }
  }

  console.log(dispatched.length > 0 ? dispatched.join("\n") : "NO_ACTION")
}

main().catch((err) => {
  console.error(`da-tasks error: ${err}`)
  console.log("NO_ACTION")
})
