/**
 * PAI Pulse — Assistant (Digital Assistant) Module
 *
 * The DA subsystem keystone. `pulse.ts` fully wires this module (import gate,
 * health aggregation, startup call, /assistant/* route dispatch, shutdown) — it
 * just needed the file. This is the "Action" layer of SPQA and the AS1
 * proactivity primitive: the one place the OS's proxy-self becomes visible.
 *
 * Contract (HARD — matches pulse.ts call-sites, do not drift):
 *   startAssistant(daConfig, enabledJobs): void          // pulse.ts:386
 *   handleAssistantRequest(req, pathname): Promise<Response|null>  // :439
 *   assistantHealth(): { status, [k]: unknown }          // :302
 *   stopAssistant?(): void                               // :566
 *
 * Serves /assistant/{health,identity,personality,tasks,diary,opinions,avatar}
 * plus POST/DELETE tasks and PATCH personality/traits. Response shapes match the
 * frontend interfaces in Observability/src/app/assistant/page.tsx EXACTLY —
 * the shipped frontend is the authoritative contract.
 *
 * Identity source of truth: _registry.yaml (primary:) → PAI/USER/DA/<primary>/.
 * Reuses the shared task store (./store) and the heartbeat (./heartbeat) rather
 * than duplicating their read paths.
 */

import { join } from "path"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import YAML from "yaml"
import {
  readTasks,
  appendTask,
  mutateTasks,
  approveTask,
  type ScheduledTask,
} from "./store"
import { runHeartbeat, type HeartbeatDecision } from "./heartbeat"

// Portable HOME — HOME (Git Bash) → USERPROFILE (Windows autostart) → homedir.
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir()
const PAI_DIR = join(HOME, ".claude", "PAI")
const DA_DIR = join(PAI_DIR, "USER", "DA")
const REGISTRY_PATH = join(DA_DIR, "_registry.yaml")

// ── Module State ──

interface DaConfig {
  enabled: boolean
  primary?: string
  heartbeat_schedule?: string
  heartbeat_model?: string
  heartbeat_cost_ceiling?: number
  [k: string]: unknown
}

let startedAt = 0
let primaryDA = "kai"
let daConfig: DaConfig = { enabled: false }
let enabledJobs: Array<{ name: string; schedule: string; enabled: boolean }> = []
let lastHeartbeat: string | null = null
let lastHeartbeatDecision: HeartbeatDecision | null = null
let identityLoadError: string | null = null

// ── DA identity types (from DA_IDENTITY.yaml) ──

interface RawIdentity {
  core?: {
    name?: string
    full_name?: string
    display_name?: string
    color?: string
    role?: string
    origin_story?: string
  }
  voice?: { provider?: string; main?: { voice_id?: string } }
  personality?: {
    base_description?: string
    traits?: Record<string, number>
    anchors?: Array<{ name: string; description: string }>
    preferences?: {
      what_i_love?: string[]
      what_i_dislike?: string[]
      working_style?: string[]
      intellectual_interests?: string[]
    }
  }
  companion?: { name: string; species: string; personality: string } | null
  writing?: { style?: string; avoid?: string[]; prefer?: string[] }
  relationship?: { principal?: string; dynamic?: string; interaction_style?: string }
  autonomy?: { can_initiate?: string[]; must_ask?: string[]; cost_ceiling_per_action?: number }
}

// ── Path helpers (keyed off the loaded primary) ──

function daDir(): string {
  return join(DA_DIR, primaryDA)
}
function identityPath(): string {
  return join(daDir(), "DA_IDENTITY.yaml")
}
function avatarPath(): string {
  return join(daDir(), "avatar.png")
}

function parsePrimary(registryText: string): string {
  const m = registryText.match(/^primary:\s*(\S+)/m)
  return m?.[1] ?? "kai"
}

/** Read + parse the primary DA identity yaml. Returns null (and sets identityLoadError) on failure. */
function loadIdentity(): RawIdentity | null {
  try {
    const path = identityPath()
    if (!existsSync(path)) {
      identityLoadError = `identity file not found: ${path}`
      return null
    }
    // Sync read — identity is tiny and read per request; keeps handlers sync.
    const raw = readFileSync(path, "utf-8") as string
    const parsed = YAML.parse(raw) as RawIdentity
    identityLoadError = null
    return parsed
  } catch (err) {
    identityLoadError = `identity parse error: ${String(err)}`
    return null
  }
}

// ── Autonomy gate (SAFETY SURFACE — enforced, not merely displayed) ──
//
// Miessler: "the autonomy.must_ask list is enforced at the module level." An
// action that falls under must_ask MUST NOT auto-fire — it requires the
// principal's confirmation. This is the Human > Tech guardrail in code.

/** Map a task/heartbeat action to a coarse autonomy category. Conservative. */
export function classifyAction(action: { type: string; channel?: string }): string {
  if (action.type === "script") return "modify code"      // scripts can mutate/delete
  if (action.type === "prompt") return "spend money"       // an LLM prompt spends budget
  if (action.type === "notify") {
    // Notifying the principal on their OWN local channel is can_initiate.
    // Anything that can reach others is must_ask. ntfy is deliberately EXCLUDED
    // from the principal allowlist: ntfy topics are publicly subscribable, so a
    // notify to ntfy can reach others (Cato audit 2026-07-03). Only voice/local
    // (the machine in front of the principal) count as principal-only.
    if (action.channel && !["voice", "local"].includes(action.channel)) {
      return "send messages to others"
    }
    return "send_notification"
  }
  return action.type
}

/**
 * True if this action needs the principal's confirmation before it may fire.
 * Fail-safe: if the category is not explicitly on can_initiate, treat as must_ask.
 */
export function requiresConfirmation(
  action: { type: string; channel?: string },
  autonomy: { can_initiate?: string[]; must_ask?: string[] },
): boolean {
  const category = classifyAction(action)
  const canInitiate = autonomy.can_initiate ?? []
  const mustAsk = autonomy.must_ask ?? []
  if (mustAsk.some((m) => category.includes(m) || m.includes(category))) return true
  if (canInitiate.includes(category)) return false
  // Unknown category → fail safe → require confirmation.
  return true
}

// ── Response builders (shapes MUST match page.tsx interfaces) ──

const DEFAULT_PREFERENCES = {
  what_i_love: [] as string[],
  what_i_dislike: [] as string[],
  working_style: [] as string[],
  intellectual_interests: [] as string[],
}

function buildIdentityResponse(id: RawIdentity): Record<string, unknown> {
  const c = id.core ?? {}
  return {
    name: c.name ?? primaryDA,
    full_name: c.full_name ?? c.name ?? primaryDA,
    display_name: c.display_name ?? (c.name ?? primaryDA).toUpperCase(),
    color: c.color ?? "#3B82F6",
    role: c.role ?? "",
    origin_story: (c.origin_story ?? "").trim(),
    has_avatar: existsSync(avatarPath()),
    principal: id.relationship?.principal ?? "",
    uptime_ms: startedAt ? Date.now() - startedAt : 0,
  }
}

function buildPersonalityResponse(id: RawIdentity): Record<string, unknown> {
  const p = id.personality ?? {}
  // Synthesize the keys the frontend hard-dereferences (page.tsx:497/508/518) so
  // a THIN identity file (garry lacks preferences/anchors/companion) can't crash
  // the Personality tab. Load-bearing, not polish.
  const prefs = p.preferences ?? {}
  return {
    base_description: (p.base_description ?? "").trim(),
    traits: p.traits ?? {},
    anchors: p.anchors ?? [],
    preferences: {
      what_i_love: prefs.what_i_love ?? DEFAULT_PREFERENCES.what_i_love,
      what_i_dislike: prefs.what_i_dislike ?? DEFAULT_PREFERENCES.what_i_dislike,
      working_style: prefs.working_style ?? DEFAULT_PREFERENCES.working_style,
      intellectual_interests: prefs.intellectual_interests ?? DEFAULT_PREFERENCES.intellectual_interests,
    },
    companion: id.companion ?? null,
    relationship: {
      dynamic: id.relationship?.dynamic ?? "peers",
      interaction_style: (id.relationship?.interaction_style ?? "").trim(),
    },
    autonomy: {
      can_initiate: id.autonomy?.can_initiate ?? [],
      must_ask: id.autonomy?.must_ask ?? [],
    },
    writing: {
      style: (id.writing?.style ?? "").trim(),
      avoid: id.writing?.avoid ?? [],
      prefer: id.writing?.prefer ?? [],
    },
    // Voice: surface the provider honestly; do NOT fabricate a voice_id.
    // Garry's voice_id is "" — return {provider} only, or null if no provider.
    voice: id.voice?.provider ? { provider: id.voice.provider } : null,
  }
}

// ── Task aggregation ──

interface UnifiedTask {
  name: string
  schedule: string
  status: string
  source: "da" | "pulse" | "claude-code"
  details?: Record<string, unknown>
}

function buildTasksResponse(): Record<string, unknown> {
  const daTasks = readTasks()
  const daUnified: UnifiedTask[] = daTasks.map((t) => ({
    name: t.description,
    schedule: t.schedule.type === "once" ? `once @ ${t.schedule.at ?? "?"}` : `cron: ${t.schedule.cron ?? "?"}`,
    status: t.status,
    source: "da",
    details: { id: t.id, action: t.action, fire_count: t.fire_count },
  }))

  const pulseUnified: UnifiedTask[] = enabledJobs.map((j) => ({
    name: j.name,
    schedule: j.schedule,
    status: j.enabled ? "active" : "disabled",
    source: "pulse",
  }))

  // claude-code triggers: none surfaced yet — empty bucket keeps the shape stable.
  const ccUnified: UnifiedTask[] = []

  const tasks = [...daUnified, ...pulseUnified, ...ccUnified]
  return {
    tasks,
    count: tasks.length,
    by_source: {
      da: daUnified.length,
      pulse: pulseUnified.length,
      "claude-code": ccUnified.length,
    },
  }
}

// ── Diary / opinions ──

function todayStr(): string {
  // UTC date, matching the da-diary writer's DiaryEntry.date basis. countDiaryToday
  // does an EXACT date-string match, so writer and this counter MUST use the same
  // basis or diary_entries_today mis-counts near the day boundary (advisor
  // 2026-07-04). The writer buckets by UTC because its source timestamps
  // (ratings.jsonl, work.json.started) are UTC ISO.
  return new Date().toISOString().slice(0, 10)
}

function buildDiaryResponse(): Record<string, unknown> {
  const path = join(daDir(), "diary.jsonl")
  const entries: unknown[] = []
  try {
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf-8") as string
      for (const line of raw.split("\n")) {
        const t = line.trim()
        if (!t) continue
        try { entries.push(JSON.parse(t)) } catch { /* skip bad line */ }
      }
    }
  } catch { /* diary optional */ }
  // Envelope, NOT a bare array — page.tsx:596 reads .entries.length unguarded.
  return { entries }
}

function readOpinionsRaw(): string {
  const path = join(daDir(), "opinions.yaml")
  try {
    if (existsSync(path)) return readFileSync(path, "utf-8") as string
  } catch { /* opinions optional */ }
  return ""
}

function countDiaryToday(): number {
  const resp = buildDiaryResponse() as { entries: Array<{ date?: string }> }
  const today = todayStr()
  return resp.entries.filter((e) => e.date === today).length
}

function countOpinions(): number {
  return (readOpinionsRaw().match(/^\s*- topic:/gm) ?? []).length
}

// ── Health ──

export function assistantHealth(): { status: string; [k: string]: unknown } {
  const id = loadIdentity()
  const identity_loaded = id !== null
  return {
    // Honest degraded signal (plan §7) when identity is unreadable, so the
    // dashboard shows "backend unavailable" rather than a misleading empty-state.
    status: identity_loaded ? "ok" : "degraded",
    primary_da: primaryDA,
    identity_loaded,
    scheduled_tasks: readTasks().filter((t) => t.status === "active").length,
    last_heartbeat: lastHeartbeat,
    diary_entries_today: countDiaryToday(),
    opinions_count: countOpinions(),
    ...(identityLoadError ? { reason: identityLoadError } : {}),
  }
}

// ── Trait PATCH (bounded drift) ──

const MAX_TRAIT_DRIFT = 5 // points per update (per-update guard; monthly aggregate is the growth engine's job)

async function handleTraitPatch(req: Request): Promise<Response> {
  let body: Record<string, number>
  try {
    body = (await req.json()) as Record<string, number>
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 })
  }
  const id = loadIdentity()
  if (!id) return Response.json({ error: "identity unreadable" }, { status: 503 })

  const traits = id.personality?.traits ?? {}
  for (const [name, value] of Object.entries(body)) {
    if (typeof value !== "number" || value < 0 || value > 100) {
      return Response.json({ error: `invalid trait value for ${name}` }, { status: 400 })
    }
    const current = traits[name] ?? 50
    if (Math.abs(value - current) > MAX_TRAIT_DRIFT) {
      return Response.json(
        { error: `trait "${name}" change ${Math.abs(value - current)} exceeds max drift ${MAX_TRAIT_DRIFT}/update`, current, requested: value },
        { status: 422 },
      )
    }
  }

  // Apply + persist. Re-read raw yaml to preserve comments where possible; the
  // yaml lib round-trips values. Update only the traits map.
  try {
    const rawText = readFileSync(identityPath(), "utf-8") as string
    const doc = YAML.parseDocument(rawText)
    for (const [name, value] of Object.entries(body)) {
      doc.setIn(["personality", "traits", name], value)
    }
    writeFileSync(identityPath(), String(doc), "utf-8")
  } catch (err) {
    return Response.json({ error: `write failed: ${String(err)}` }, { status: 500 })
  }
  return Response.json({ ok: true, updated: Object.keys(body) })
}

// ── Task POST / DELETE ──

async function handleTaskCreate(req: Request): Promise<Response> {
  let body: {
    description?: string
    schedule?: { type?: string; at?: string; cron?: string; until?: string }
    action?: { type?: string; message?: string; channel?: string; prompt?: string; model?: string; command?: string }
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 })
  }
  if (!body.description?.trim()) {
    return Response.json({ error: "description required" }, { status: 400 })
  }

  const action = {
    type: (body.action?.type as ScheduledTask["action"]["type"]) ?? "notify",
    message: body.action?.message ?? body.description.trim(),
    channel: body.action?.channel ?? "voice",
    prompt: body.action?.prompt,
    model: body.action?.model,
    command: body.action?.command,
  }

  // SAFETY: an autonomously-created task whose action falls under must_ask may be
  // STORED (the principal is creating it via the dashboard, so creation is
  // consented) but must be flagged so the fire path can gate it. We record the
  // confirmation requirement on the task; the heartbeat/fire path honors it.
  const id = loadIdentity()
  const needsConfirm = id ? requiresConfirmation(action, id.autonomy ?? {}) : true

  // One-time-task normalization: the UI omits `schedule` for one-time tasks
  // (page.tsx:372 sends schedule: undefined). DASchedule's ScheduledTask expects
  // {type:'once'|'recurring', at?, cron?}. Map undefined → {type:'once', at:now}.
  let schedule: ScheduledTask["schedule"]
  if (!body.schedule || (!body.schedule.cron && !body.schedule.at)) {
    schedule = { type: "once", at: new Date().toISOString() }
  } else if (body.schedule.cron) {
    schedule = { type: "recurring", cron: body.schedule.cron, until: body.schedule.until }
  } else {
    schedule = { type: "once", at: body.schedule.at }
  }

  // SAFETY (advisor guardrail, 2026-07-03): a must_ask task lands INERT-BY-DEFAULT
  // — status "pending_approval", not "active". A future fire-executor iterates
  // runnable ("active") tasks, so anything pending is skipped unless it actively
  // opts in. This fails CLOSED: forgetting to read the flag can't auto-fire a
  // must_ask action, because it was never marked runnable in the first place.
  const task: ScheduledTask = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    created_by: primaryDA,
    description: body.description.trim(),
    schedule,
    action,
    status: needsConfirm ? ("pending_approval" as ScheduledTask["status"]) : "active",
    fire_count: 0,
    ...(needsConfirm ? ({ requires_confirmation: true } as Record<string, unknown>) : {}),
  }
  appendTask(task)
  return Response.json({ ok: true, id: task.id, status: task.status, requires_confirmation: needsConfirm })
}

function handleTaskDelete(id: string): Response {
  // Reject empty/blank id — otherwise the startsWith("") fallback would cancel
  // tasks[0] (Forge audit 2026-07-03: DELETE /assistant/tasks/ trailing slash).
  if (!id.trim()) return Response.json({ error: "task id required" }, { status: 400 })
  // Read-decide-AND-write all INSIDE the store lock (mutateTasks). The prior
  // read-unlocked → mutate stale → writeTasks(stale) path blindly clobbered any
  // fire-executor status write (last_fired/completed/failed) that landed in
  // between (Forge audit C4). The decision must be made on the same in-lock
  // snapshot that gets persisted.
  try {
    const outcome = mutateTasks((tasks) => {
      const exact = tasks.find((t) => t.id === id)
      // Prefix fallback only when UNAMBIGUOUS — a partial id matching >1 task
      // must not silently cancel the wrong one.
      const prefixMatches = tasks.filter((t) => t.id.startsWith(id))
      const match = exact ?? (prefixMatches.length === 1 ? prefixMatches[0] : undefined)
      if (!match) {
        return { tasks, result: { ok: false, ambiguous: prefixMatches.length > 1 } as const }
      }
      match.status = "cancelled"
      return { tasks, result: { ok: true, cancelled: match.id } as const }
    })
    if (!outcome.ok) {
      const status = outcome.ambiguous ? 409 : 404
      return Response.json({ error: outcome.ambiguous ? "ambiguous id" : "task not found" }, { status })
    }
    return Response.json({ ok: true, cancelled: outcome.cancelled })
  } catch {
    return Response.json({ error: "store busy, retry" }, { status: 503 })
  }
}

function handleTaskApprove(id: string): Response {
  // Consent action — promote a pending_approval must_ask task to active+confirmed
  // so the fire-executor can run it. The store's approveTask does the in-lock,
  // validated transition (only ever promotes an EXISTING pending_approval task).
  if (!id.trim()) return Response.json({ error: "task id required" }, { status: 400 })
  try {
    const outcome = approveTask(id)
    if (outcome.ok) return Response.json({ ok: true, approved: outcome.id, status: "active", confirmed: true })
    const status = outcome.reason === "not_found" ? 404 : outcome.reason === "ambiguous" ? 409 : 409
    const msg = outcome.reason === "not_found" ? "task not found"
      : outcome.reason === "ambiguous" ? "ambiguous id"
      : "task is not pending approval" // not_pending
    return Response.json({ error: msg }, { status })
  } catch {
    return Response.json({ error: "store busy, retry" }, { status: 503 })
  }
}

// ── Avatar ──

function handleAvatar(): Response {
  const path = avatarPath()
  if (!existsSync(path)) return new Response("no avatar", { status: 404 })
  return new Response(Bun.file(path))
}

// ── Public: startup / request / shutdown ──

export function startAssistant(cfg: DaConfig, jobs: Array<{ name: string; schedule: string; enabled: boolean }>): void {
  startedAt = Date.now()
  daConfig = cfg ?? { enabled: false }
  enabledJobs = jobs ?? []

  // Resolve the active DA from the registry (registry-as-truth), falling back to
  // the toml `primary` only if the registry is unreadable.
  try {
    if (existsSync(REGISTRY_PATH)) {
      primaryDA = parsePrimary(readFileSync(REGISTRY_PATH, "utf-8") as string)
    } else if (cfg?.primary) {
      primaryDA = cfg.primary
    }
  } catch {
    if (cfg?.primary) primaryDA = cfg.primary
  }

  // Warm the identity so a load error surfaces at startup, not first request.
  loadIdentity()
}

export async function handleAssistantRequest(req: Request, pathname: string): Promise<Response | null> {
  const method = req.method

  // GET /assistant/health
  if (method === "GET" && pathname === "/assistant/health") {
    return Response.json(assistantHealth())
  }

  // GET /assistant/identity
  if (method === "GET" && pathname === "/assistant/identity") {
    const id = loadIdentity()
    if (!id) return Response.json({ error: identityLoadError ?? "identity unreadable" }, { status: 503 })
    return Response.json(buildIdentityResponse(id))
  }

  // GET /assistant/personality
  if (method === "GET" && pathname === "/assistant/personality") {
    const id = loadIdentity()
    if (!id) return Response.json({ error: identityLoadError ?? "identity unreadable" }, { status: 503 })
    return Response.json(buildPersonalityResponse(id))
  }

  // PATCH /assistant/personality/traits
  if (method === "PATCH" && pathname === "/assistant/personality/traits") {
    return handleTraitPatch(req)
  }

  // GET/POST /assistant/tasks
  if (pathname === "/assistant/tasks") {
    if (method === "GET") return Response.json(buildTasksResponse())
    if (method === "POST") return handleTaskCreate(req)
  }

  // POST /assistant/tasks/:id/approve — promote a pending_approval task to
  // active+confirmed so it can fire. Ordered BEFORE the generic DELETE
  // /assistant/tasks/ check (both match startsWith("/assistant/tasks/")).
  if (method === "POST" && pathname.startsWith("/assistant/tasks/") && pathname.endsWith("/approve")) {
    const id = decodeURIComponent(pathname.slice("/assistant/tasks/".length, -"/approve".length))
    return handleTaskApprove(id)
  }

  // DELETE /assistant/tasks/:id
  if (method === "DELETE" && pathname.startsWith("/assistant/tasks/")) {
    const id = decodeURIComponent(pathname.slice("/assistant/tasks/".length))
    return handleTaskDelete(id)
  }

  // GET /assistant/diary  → { entries: [...] } envelope
  if (method === "GET" && pathname === "/assistant/diary") {
    return Response.json(buildDiaryResponse())
  }

  // GET /assistant/opinions → { raw: string } envelope
  if (method === "GET" && pathname === "/assistant/opinions") {
    return Response.json({ raw: readOpinionsRaw() })
  }

  // GET /assistant/avatar → bytes or 404
  if (method === "GET" && pathname === "/assistant/avatar") {
    return handleAvatar()
  }

  // Not an assistant route we serve → fall through (pulse.ts returns null path).
  return null
}

export function stopAssistant(): void {
  // No long-running resources to release (heartbeat is cron-driven, not a loop).
  startedAt = 0
}

// ── Heartbeat trigger (called by a cron job or on-demand) ──
// Exposed so a Pulse cron job or a test can drive the AS1 proactivity primitive.
// The dispatch of a `notify` decision is gated by the autonomy contract.

export async function triggerHeartbeat(now?: Date): Promise<HeartbeatDecision> {
  const ceiling = typeof daConfig.heartbeat_cost_ceiling === "number" ? daConfig.heartbeat_cost_ceiling : 0.10
  const model = typeof daConfig.heartbeat_model === "string" ? daConfig.heartbeat_model : "fast"
  const { decision } = await runHeartbeat({ costCeiling: ceiling, model, now })
  lastHeartbeat = new Date().toISOString()
  lastHeartbeatDecision = decision

  // Autonomy gate: a heartbeat that wants to `notify` fires only if that action
  // is auto-allowed. A notify to the principal's own voice channel is
  // can_initiate; anything else waits for confirmation (must_ask).
  if (decision.action === "notify" && decision.message) {
    const id = loadIdentity()
    const gated = id ? requiresConfirmation({ type: "notify", channel: "voice" }, id.autonomy ?? {}) : true
    if (!gated) {
      try {
        await fetch("http://localhost:31337/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: decision.message.slice(0, 500) }),
          signal: AbortSignal.timeout(10_000),
        })
      } catch { /* dispatch best-effort */ }
    }
  }
  return decision
}
