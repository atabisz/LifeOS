/**
 * DA Delegation — primary → worker (multi-DA, Component 7).
 *
 * Miessler's hierarchy: "I just talk to Kai… a whole army of agents" [S6];
 * "Agents become like processes on a computer wielded by a Program. We only see
 * the Program" [S2]. So delegation is STRICTLY hierarchical:
 *   principal ↔ primary DA ↔ worker DA(s)
 * The principal talks only to the primary. A worker runs a delegated task and
 * returns its result BACK THROUGH the primary — it never opens a direct
 * principal-facing channel. Its `must_ask` (which includes `send_notification`)
 * is the encoded form of that constraint.
 *
 * This is the delegation PRIMITIVE (a callable function), not an autonomous
 * scheduler: the primary calls delegateToWorker(); nothing cron-fires it.
 *
 * The worker's own DA_IDENTITY.yaml supplies the system-prompt context, so the
 * worker "is" its personality. Execution goes through Inference.ts (subscription
 * OAuth) — NEVER `claude --bare`.
 */

import { join } from "path"
import { readFileSync, existsSync } from "fs"
import { homedir } from "os"
import YAML from "yaml"

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir()
const PAI_DIR = join(HOME, ".claude", "PAI")
const DA_DIR = join(PAI_DIR, "USER", "DA")
const REGISTRY_PATH = join(DA_DIR, "_registry.yaml")
const INFERENCE_TS = join(PAI_DIR, "TOOLS", "Inference.ts")

interface RegistryDA {
  role?: "primary" | "worker" | "specialist"
  enabled?: boolean
  channels?: string[]
}
interface Registry {
  primary?: string
  das?: Record<string, RegistryDA>
}

export interface DelegationResult {
  ok: boolean
  worker: string
  result?: string        // the worker's output, returned to the PRIMARY (the caller)
  reason?: "unknown_worker" | "not_a_worker" | "disabled" | "is_primary" | "exec_failed"
}

function loadRegistry(): Registry {
  try {
    if (!existsSync(REGISTRY_PATH)) return {}
    return (YAML.parse(readFileSync(REGISTRY_PATH, "utf-8")) as Registry) ?? {}
  } catch { return {} }
}

interface WorkerIdentity {
  core?: { name?: string; role?: string; origin_story?: string }
  personality?: { base_description?: string }
  autonomy?: { can_initiate?: string[]; must_ask?: string[] }
}

function loadWorkerIdentity(name: string): WorkerIdentity | null {
  try {
    const p = join(DA_DIR, name, "DA_IDENTITY.yaml")
    if (!existsSync(p)) return null
    return (YAML.parse(readFileSync(p, "utf-8")) as WorkerIdentity) ?? null
  } catch { return null }
}

/**
 * Validate that `name` is a delegatable worker: it exists in the registry, has
 * role `worker`, is enabled, and is NOT the primary. Returns a reason on failure.
 * Exported for tests.
 */
export function validateWorker(name: string, reg: Registry = loadRegistry()): { ok: true } | { ok: false; reason: DelegationResult["reason"] } {
  const das = reg.das ?? {}
  const entry = das[name]
  if (!entry) return { ok: false, reason: "unknown_worker" }
  if (name === reg.primary) return { ok: false, reason: "is_primary" }
  if (entry.role !== "worker") return { ok: false, reason: "not_a_worker" }
  if (entry.enabled === false) return { ok: false, reason: "disabled" }
  return { ok: true }
}

/**
 * Build the worker's system prompt from its identity + the hierarchy contract.
 * The prompt PINS the worker's autonomy: it returns results to the primary and
 * must NOT attempt to notify or message the principal directly. Exported for tests.
 */
export function buildWorkerSystemPrompt(name: string, id: WorkerIdentity | null): string {
  const core = id?.core ?? {}
  const mustAsk = id?.autonomy?.must_ask ?? []
  return [
    `You are ${core.name ?? name}, a background WORKER digital assistant.`,
    core.role ? `Role: ${core.role}` : "",
    id?.personality?.base_description ? `Personality: ${id.personality.base_description.trim()}` : "",
    core.origin_story ? core.origin_story.trim() : "",
    "",
    "HIERARCHY CONTRACT (non-negotiable): You do NOT talk to the principal directly.",
    "You receive a delegated task from the PRIMARY DA and return your result to it.",
    mustAsk.length ? `You MUST NOT autonomously: ${mustAsk.join(", ")}. Route anything requiring those through the primary.` : "",
    "Return only the work product — do not attempt to notify, message, or alert anyone.",
  ].filter(Boolean).join("\n")
}

/**
 * Delegate `task` to the named worker DA. Runs the worker (its identity as the
 * system prompt) via Inference.ts and returns the result TO THE CALLER (the
 * primary). Never opens a principal-facing channel — results flow back up the
 * hierarchy. `spawn` is injectable for tests.
 */
export async function delegateToWorker(
  workerName: string,
  task: string,
  opts: { level?: "fast" | "standard" | "smart"; spawn?: (sys: string, user: string) => Promise<string> } = {},
): Promise<DelegationResult> {
  const reg = loadRegistry()
  const v = validateWorker(workerName, reg)
  if (!v.ok) return { ok: false, worker: workerName, reason: v.reason }

  const id = loadWorkerIdentity(workerName)
  const systemPrompt = buildWorkerSystemPrompt(workerName, id)

  const spawn = opts.spawn ?? defaultSpawn(opts.level ?? "standard")
  try {
    const result = await spawn(systemPrompt, task)
    // Result is RETURNED to the primary (the caller) — not dispatched anywhere.
    return { ok: true, worker: workerName, result: result.trim() }
  } catch {
    return { ok: false, worker: workerName, reason: "exec_failed" }
  }
}

/**
 * Default worker execution: Inference.ts at the given level. OAuth, never --bare.
 *
 * HARD no-notify enforcement (advisor 2026-07-04): the worker runs as a pure
 * text-completion call — Inference.ts invokes the model with NO tools (its
 * `--tools ''` default when no images), so the worker has NO notification /
 * fetch / dispatch channel. The no-notify contract is enforced STRUCTURALLY by
 * capability absence, not by the prompt asking nicely. The worker's ONLY egress
 * is its stdout string, which delegateToWorker RETURNS to the caller (the
 * primary) — it is never dispatched to a principal channel. buildWorkerSystemPrompt's
 * "do not notify" text is belt-and-suspenders on top of that structural gate.
 */
function defaultSpawn(level: string): (sys: string, user: string) => Promise<string> {
  return async (systemPrompt: string, userPrompt: string) => {
    const proc = Bun.spawn(["bun", INFERENCE_TS, "--level", level, systemPrompt, userPrompt], {
      stdout: "pipe", stderr: "pipe", env: { ...process.env },
    })
    const timer = setTimeout(() => proc.kill(), 90_000)
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited
    clearTimeout(timer)
    if (code !== 0) {
      const err = await new Response(proc.stderr).text()
      throw new Error(`Inference.ts exited ${code}: ${err.slice(0, 200)}`)
    }
    return out.trim()
  }
}
