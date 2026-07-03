/**
 * DA Scheduled-Task Store — shared read/write for the JSONL task file.
 *
 * Single source of truth for the DA task store. Extracted so BOTH
 * `PAI/TOOLS/DASchedule.ts` (the CLI) and `Assistant/module.ts` (the daemon
 * endpoints) read/write the SAME file via the SAME path expression. Before this
 * extraction the CLI used `join(PAI_DIR, "Pulse", ...)` and the daemon dir is
 * `join(PAI_DIR, "PULSE", ...)`; identical on Windows (case-insensitive FS) but
 * TWO different directories on Linux — the exact divergent-copy bug the
 * auto-extract-shared-helper rule exists to prevent. One path, one store.
 */

import { join } from "path"
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, closeSync, unlinkSync } from "fs"
import { homedir } from "os"

// Portable HOME: HOME (Git Bash) → USERPROFILE (native Windows autostart, where
// HOME is unset) → os.homedir(). Never a bare "~". Mirrors pulse.ts / lib.ts.
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir()
const PAI_DIR = join(HOME, ".claude", "PAI")

// Canonical DA runtime dir. Uses "Pulse" to match the on-disk data DASchedule
// already writes; on Windows this === pulse.ts's "PULSE/state". One expression
// shared by both consumers = no cross-platform divergence.
//
// PAI_DA_STATE_DIR overrides the dir (evaluated at import) so tests can point at
// a throwaway temp dir and never touch the live store (Forge N5). Set it in the
// test COMMAND (before process start), not in test source — module consts are
// import-time. Unset in normal operation → the canonical live path.
export const TASKS_DIR = process.env.PAI_DA_STATE_DIR
  ? process.env.PAI_DA_STATE_DIR
  : join(PAI_DIR, "Pulse", "state", "da")
export const TASKS_PATH = join(TASKS_DIR, "scheduled-tasks.jsonl")
export const LOCK_PATH = join(TASKS_DIR, "scheduled-tasks.lock")

export interface ScheduledTask {
  id: string
  created_at: string
  created_by: string
  description: string
  schedule: {
    type: "once" | "recurring"
    at?: string
    cron?: string
    until?: string
  }
  action: {
    type: "notify" | "prompt" | "script"
    message?: string
    channel?: string
    prompt?: string
    model?: string
    command?: string
  }
  // "pending_approval" = a must_ask action queued but NOT runnable; the fire-executor
  // iterating "active" tasks skips it (fail-closed autonomy gate). See module.ts.
  // "failed" = a terminal error state so an erroring action neither re-fires forever
  // nor silently blocks the queue (Cato audit 2026-07-04 → A1.4).
  status: "active" | "completed" | "cancelled" | "pending_approval" | "failed"
  // Belt-and-braces autonomy fields (set by module.ts handleTaskCreate; the
  // fire-executor's truth table pivots on them). `requires_confirmation` is true
  // for must_ask actions; `confirmed` flips true only when the principal approves.
  // An active task with requires_confirmation && !confirmed MUST be skipped at fire time.
  requires_confirmation?: boolean
  confirmed?: boolean
  last_fired?: string
  fire_count: number
}

export function ensureDir(): void {
  if (!existsSync(TASKS_DIR)) {
    mkdirSync(TASKS_DIR, { recursive: true })
  }
}

export function readTasks(): ScheduledTask[] {
  // Parse line-by-line and SKIP bad lines rather than returning [] on the first
  // parse error. A single corrupt/partial line (disk hiccup, torn write) must
  // NOT zero the in-memory view — because the next write would then serialize
  // that empty view and annihilate every queued task (Forge audit C7). Good
  // lines survive; the bad line is dropped on the next write.
  try {
    if (!existsSync(TASKS_PATH)) return []
    const out: ScheduledTask[] = []
    for (const line of readFileSync(TASKS_PATH, "utf-8").split("\n")) {
      const t = line.trim()
      if (!t) continue
      try { out.push(JSON.parse(t) as ScheduledTask) } catch { /* skip corrupt line, keep the rest */ }
    }
    return out
  } catch {
    // Whole-file read failure (permissions, missing) → empty is the only option,
    // but callers that WRITE must guard against clobbering on a read failure.
    return []
  }
}

// ── Cross-writer lock ──
//
// The store is a file-based read-modify-write JSONL. Multiple writers exist:
// the HTTP handler (POST /assistant/tasks) runs concurrently with the cron
// loop, and the cron check-scripts (da-tasks, da-growth) run as separate
// processes that can overlap manual runs. Without serialization, last-writer-
// wins can drop a status update or double-fire (Cato audit 2026-07-04 → R1.9).
//
// A lockfile (exclusive-create `wx`) is the least-code primitive that works
// across processes AND the single-process HTTP+cron case. Stale locks (a
// crashed holder) are reclaimed after LOCK_STALE_MS. This is advisory: every
// mutation path goes through withLock, so honoring it is a code invariant.

const LOCK_STALE_MS = 30_000
const LOCK_RETRY_MS = 25
const LOCK_MAX_WAIT_MS = 5_000

function acquireLock(): boolean {
  ensureDir()
  try {
    // wx = exclusive create; throws EEXIST if the lock is held.
    const fd = openSync(LOCK_PATH, "wx")
    writeFileSync(fd, String(process.pid))
    closeSync(fd)
    return true
  } catch {
    // Reclaim a stale lock (holder crashed without releasing).
    try {
      const age = Date.now() - statMtimeMs(LOCK_PATH)
      if (age > LOCK_STALE_MS) {
        unlinkSync(LOCK_PATH)
        return acquireLock()
      }
    } catch { /* lock vanished between check and stat — retry */ }
    return false
  }
}

function statMtimeMs(path: string): number {
  // Local import avoids widening the top-level import for one call.
  const { statSync } = require("fs") as typeof import("fs")
  return statSync(path).mtimeMs
}

function releaseLock(): void {
  try { unlinkSync(LOCK_PATH) } catch { /* already gone */ }
}

export class LockTimeoutError extends Error {
  constructor() { super("store lock acquisition timed out") }
}

/**
 * Run `fn` under the store lock: acquire the lock, read the CURRENT tasks
 * (inside the lock — so `fn` decides on fresh state), let `fn` mutate the array,
 * then write atomically, then release. `fn` MUST base every decision on the
 * `tasks` argument it receives here, NOT on a snapshot read before the lock —
 * that is the whole point of the critical section (Forge audit C1/C2).
 *
 * Fail-CLOSED on timeout: if the lock can't be acquired within LOCK_MAX_WAIT_MS
 * it THROWS `LockTimeoutError` rather than proceeding lock-free. A dropped write
 * is safer than a silent lost-update (Forge audit C3). Callers treat a throw as
 * "skip this mutation, try next cycle".
 */
export function mutateTasks<T>(fn: (tasks: ScheduledTask[]) => { tasks: ScheduledTask[]; result: T }): T {
  const deadline = Date.now() + LOCK_MAX_WAIT_MS
  let locked = false
  while (Date.now() < deadline) {
    if (acquireLock()) { locked = true; break }
    // Synchronous sleep — check-scripts are short-lived CLI processes, and the
    // HTTP handler path holds the lock only for a file rewrite (sub-ms).
    Bun.sleepSync(LOCK_RETRY_MS)
  }
  if (!locked) throw new LockTimeoutError() // fail closed — never write lock-free
  try {
    const tasks = readTasks()
    const { tasks: next, result } = fn(tasks)
    _writeTasksUnlocked(next)
    return result
  } finally {
    releaseLock()
  }
}

function _writeTasksUnlocked(tasks: ScheduledTask[]): void {
  ensureDir()
  const content = tasks.map((t) => JSON.stringify(t)).join("\n") + "\n"
  writeFileSync(TASKS_PATH, content)
}

export function writeTasks(tasks: ScheduledTask[]): void {
  mutateTasks(() => ({ tasks, result: undefined }))
}

export function appendTask(task: ScheduledTask): void {
  mutateTasks((tasks) => ({ tasks: [...tasks, task], result: undefined }))
}

/** Outcome of an approve attempt — discriminates the caller's HTTP/CLI response. */
export type ApproveOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "not_found" | "not_pending" | "ambiguous" }

/**
 * Approve a `pending_approval` task: promote it to `active` + `confirmed:true`
 * so the fire-executor's `active + requires_confirmation + confirmed → FIRE`
 * row becomes reachable. This is a CONSENT action — the gate the whole autonomy
 * contract protects — so it runs INSIDE the store lock, is id-validated, and
 * ONLY ever promotes an EXISTING `pending_approval` task. It never fabricates an
 * active must_ask task and never touches a task in any other status.
 */
export function approveTask(id: string): ApproveOutcome {
  // Guard empty/blank id AT THE STORE LEVEL — this function is exported and
  // called directly (CLI, tests), not only via the HTTP handler. An empty id
  // would `startsWith("")`-match every task and promote tasks[0] when exactly
  // one exists (Forge audit — mirrors the previously-fixed DELETE-trailing-slash
  // class). Don't rely on every caller guarding.
  if (!id.trim()) return { ok: false, reason: "not_found" }
  return mutateTasks((tasks) => {
    const exact = tasks.find((t) => t.id === id)
    const prefix = tasks.filter((t) => t.id.startsWith(id))
    const match = exact ?? (prefix.length === 1 ? prefix[0] : undefined)
    if (!match) {
      return { tasks, result: { ok: false, reason: prefix.length > 1 ? "ambiguous" : "not_found" } as ApproveOutcome }
    }
    if (match.status !== "pending_approval") {
      // Refuse to promote anything not awaiting approval — can't fabricate a
      // runnable must_ask task out of an active/cancelled/completed one.
      return { tasks, result: { ok: false, reason: "not_pending" } as ApproveOutcome }
    }
    // Defense-in-depth: only a task that ACTUALLY requires confirmation should be
    // promotable via approve. The create path guarantees pending_approval ⟹
    // requires_confirmation, but a hand-edited/imported row might not — don't
    // trust the invariant, re-check it (Forge N4).
    if (match.requires_confirmation !== true) {
      return { tasks, result: { ok: false, reason: "not_pending" } as ApproveOutcome }
    }
    match.status = "active"
    match.confirmed = true
    return { tasks, result: { ok: true, id: match.id } as ApproveOutcome }
  })
}
