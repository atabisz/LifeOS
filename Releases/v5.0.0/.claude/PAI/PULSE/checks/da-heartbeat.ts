#!/usr/bin/env bun
/**
 * DA Heartbeat — Script-type cron job (every 30 min, heartbeat_schedule).
 *
 * The AS1 proactivity primitive's cron entrypoint. Thin by design: it calls
 * `triggerHeartbeat()` from the Assistant module (which owns Layer 1 context
 * gather + Layer 2 Haiku eval via Inference.ts + the autonomy dispatch gate)
 * and surfaces the decision. It does NOT re-implement any heartbeat logic —
 * the module already defaults to NO_ACTION, skips Layer 2 on empty context,
 * routes through Inference.ts (never `claude --bare`), and enforces the cost
 * ceiling.
 *
 * The module boots via startAssistant() in the daemon; when this script runs as
 * a standalone cron process, we boot it the same way so config + primary DA
 * resolve. Then triggerHeartbeat gates its own `notify` dispatch.
 *
 * Output: the decision message when it dispatched, else NO_ACTION (sentinel →
 * cron loop stays silent). The module has already dispatched a can_initiate
 * notify to voice; printing the message lets the cron `output` target echo it too.
 */

import { startAssistant, triggerHeartbeat } from "../Assistant/module"

async function main() {
  // Boot with the DA config the daemon uses. The module reads _registry.yaml
  // for the primary; the toml keys here mirror PULSE.toml [da] defaults so a
  // standalone run behaves like the in-daemon call.
  startAssistant(
    {
      enabled: true,
      heartbeat_model: process.env.DA_HEARTBEAT_MODEL ?? "fast",
      heartbeat_cost_ceiling: Number(process.env.DA_HEARTBEAT_CEILING ?? "0.10"),
    },
    [],
  )

  const decision = await triggerHeartbeat()

  // NO_ACTION (or a gated/undispatched notify) → sentinel keeps the cron silent.
  if (decision.action === "NO_ACTION" || !decision.message) {
    console.log("NO_ACTION")
    return
  }
  console.log(decision.message)
}

main().catch((err) => {
  console.error(`da-heartbeat error: ${err}`)
  console.log("NO_ACTION")
})
