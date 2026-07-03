---
name: DelegationReference
description: Comprehensive delegation and agent parallelization patterns. Reference material extracted from SKILL.md for on-demand loading.
created: 2025-12-17
extracted_from: SKILL.md lines 535-627
---

# Delegation & Parallelization Reference

**Quick reference in SKILL.md** → For full details, see this file

---

## 🤝 Delegation & Parallelization (Always Active)

**WHENEVER A TASK CAN BE PARALLELIZED, USE MULTIPLE AGENTS!**

### Model Selection for Agents (CRITICAL FOR SPEED)

**The Agent tool has a `model` parameter - USE IT.**

**Resuming agents:** To continue a previously spawned agent, use `SendMessage({to: agentId})`. This auto-resumes stopped background agents. Do NOT use `Agent(resume=...)` — the `resume` parameter no longer exists.

Agents default to inheriting the parent model (often Opus). This is SLOW for simple tasks. Each inference with 30K+ context takes 5-15 seconds on Opus. A simple 10-tool-call task = 1-2+ minutes of pure thinking time.

**Model Selection Matrix:**

| Task Type | Model | Why |
|-----------|-------|-----|
| Deep reasoning, complex architecture, strategic decisions | `opus` | Maximum intelligence needed |
| Standard implementation, moderate complexity, most coding | `sonnet` | Good balance of speed + capability |
| Simple lookups, file reads, quick checks, parallel grunt work | `haiku` | 10-20x faster, sufficient intelligence |

**Examples:**

```typescript
// WRONG - defaults to Opus, takes minutes
Agent({ prompt: "Check if blue bar exists on website", subagent_type: "general-purpose" })

// RIGHT - Haiku for simple visual check
Agent({ prompt: "Check if blue bar exists on website", subagent_type: "general-purpose", model: "haiku" })

// RIGHT - Sonnet for standard coding task
Agent({ prompt: "Implement the login form validation", subagent_type: "Engineer", model: "sonnet" })

// RIGHT - Opus for complex architectural planning
Agent({ prompt: "Design the distributed caching strategy", subagent_type: "Architect", model: "opus" })
```

**Rule of Thumb:**
- If it's grunt work or verification → `haiku`
- If it's implementation or research → `sonnet`
- If it requires deep strategic thinking → `opus` (or let it default)

**Parallel tasks especially benefit from haiku** - launching 5 haiku agents is faster AND cheaper than 1 Opus agent doing sequential work.

### Agent Types

**Default for parallel work: Custom agents via Agents skill (ComposeAgent).**

Use the Agents skill to compose task-specific agents with unique traits, voices, and expertise:
- Use a SINGLE message with MULTIPLE Agent tool calls
- Each agent gets FULL CONTEXT and DETAILED INSTRUCTIONS via ComposeAgent prompt
- Launch as many as needed (no artificial limit)
- **ALWAYS launch a spotcheck agent after parallel work completes**

**Agent routing by task type:**
- **Research tasks** → Use the Research skill (has dedicated researcher agents)
- **Code implementation** → Use Engineer agents (`subagent_type: "Engineer"`)
- **Architecture/design** → Use Architect agents (`subagent_type: "Architect"`)
- **Everything else** → Use Agents skill → ComposeAgent → `subagent_type: "general-purpose"`

### 🚨 AGENT ROUTING (Always Active)

**Three Agent Systems — preference order:**

| Priority | User Says | System | Tool | What Happens |
|----------|-----------|--------|------|-------------|
| **1. DEFAULT** | "parallel work", "agents", "team", "swarm", or Algorithm selects delegation | **Agent Teams** | `Agent` (spawn teammates) → `TaskCreate` (shared list) → `SendMessage` (coordinate by id/name). Teams implicit under `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; `TeamCreate`/`TeamDelete` removed in CC v2.1.178 | Persistent teammates, shared task list, peer messaging, task dependencies |
| **2. EXPLICIT** | "**custom agents**", "spin up **custom** agents" | **Custom Agents** (ComposeAgent) | `Skill("Agents")` → `Agent(subagent_type="general-purpose", prompt=<composed>)` | Unique personalities, voices, one-shot parallel work |
| **3. UNATTENDED** | "run overnight", "long-running", "CI trigger", or task exceeds session lifetime | **Managed Agents** (Anthropic cloud API) | `Skill("claude-api")` to build workflows | Durable sessions, sandboxed containers, vault credentials, $0.08/session-hour |

**These are three distinct systems:**
- **Agent Teams** = persistent local teammates with shared task lists, messaging, and multi-turn coordination. DEFAULT for all parallel work. Teams are implicit (one per session) under `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; spawn via `Agent`, coordinate via `TaskCreate`/`SendMessage`. The standalone `TeamCreate`/`TeamDelete` tools were removed in CC v2.1.178.
- **Custom Agents** = one-shot parallel workers with unique identities via ComposeAgent. ONLY when {{PRINCIPAL_NAME}} explicitly says "custom agents".
- **Managed Agents** = cloud-hosted agents with durable sessions that survive disconnects. For unattended/overnight work only.

**Additional routing by task type:**

| User Says | What to Use | Why |
|-------------|-------------|-----|
| "research X", "investigate Y" | **Research skill** | Dedicated researcher agents |
| Code implementation tasks | **Engineer** agent | Specialized for TDD/code |
| Architecture/design tasks | **Architect** agent | Specialized for system design |

**For Agent Teams (default):**
1. Ensure `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set — every session then has one implicit team (the standalone `TeamCreate`/`TeamDelete` tools were removed in CC v2.1.178; `team_name` is now ignored)
2. `TaskCreate` for each work item (with dependencies if needed)
3. Spawn teammates via `Agent` with a `name` parameter
4. Teammates self-claim tasks, `SendMessage` each other (by id or name), go idle between rounds

**For Custom Agents (only when explicitly requested):**
1. Invoke Agents skill → ComposeAgent for EACH agent with different trait combinations
2. Launch with composed prompt as `subagent_type: "general-purpose"`
3. Each agent gets a personality-matched ElevenLabs voice

**For research specifically:** Use the Research skill, which has dedicated researcher agents (ClaudeResearcher, GeminiResearcher, etc.)

**Reference:** Agents skill (`~/.claude/skills/Agents/SKILL.md`) | Managed Agents: https://www.anthropic.com/engineering/managed-agents

**Full Context Requirements:**
When delegating, ALWAYS include:
1. WHY this task matters (business context)
2. WHAT the current state is (existing implementation)
3. EXACTLY what to do (precise actions, file paths, patterns)
4. SUCCESS CRITERIA (what output should look like)
5. TIMING SCOPE (fast|standard|deep) — controls agent output verbosity

### Timing Scope in Agent Prompts

Every agent prompt MUST include a `## Scope` section that matches the validated timing tier from the Algorithm's THINK phase. This prevents agents from over-producing on simple tasks or under-delivering on complex ones.

**Timing + Model Selection:**

| Timing | Model | Agent Output | Example |
|--------|-------|-------------|---------|
| **fast** | `haiku` | <500 words, direct answer | "Check if server is running" |
| **standard** | `sonnet` | <1500 words, focused work | "Implement login validation" |
| **deep** | `opus` | No limit, thorough analysis | "Comprehensive security audit" |

**Examples:**

```typescript
// FAST — simple check, haiku model, minimal output
Agent({
  prompt: `Check if the auth middleware exports are correct.
## Scope
Timing: FAST — direct answer only.
- Under 500 words
- Answer the question, report the result, done`,
  subagent_type: "Explore",
  model: "haiku"
})

// STANDARD — typical implementation work
Agent({
  prompt: `Implement input validation for the login form.
## Scope
Timing: STANDARD — focused implementation.
- Under 1500 words
- Stay on task, deliver the work, verify it works`,
  subagent_type: "Engineer",
  model: "sonnet"
})

// DEEP — comprehensive analysis
Agent({
  prompt: `Perform a thorough security review of all auth flows.
## Scope
Timing: DEEP — comprehensive analysis.
- No word limit
- Explore alternatives, consider edge cases
- Thorough verification and documentation`,
  subagent_type: "Silas",
  model: "opus"
})
```

---

## Async Primitives — When to Use What

Three primitives for non-blocking work. Pick the right one:

| Primitive | Tool | Token Cost | Notification | Use When |
|-----------|------|-----------|--------------|----------|
| **One-shot wait** | `Bash(run_in_background)` | Zero until done | On exit (success/fail) | Build, deploy, test suite, any command you just need to finish |
| **Event stream** | `Monitor` | Zero between events | Per stdout line | Log tailing, CI status polling, file watching, deploy streaming |
| **AI work** | `Agent(run_in_background)` | Full agent cost | On completion | Research, implementation, analysis — work requiring reasoning |

**Decision flow:**
1. Does it need AI reasoning? → `Agent(run_in_background)`
2. Do you need events as they happen? → `Monitor`
3. Just need to know when it's done? → `Bash(run_in_background)`

**Monitor vs Pulse:** Monitor is an in-session watcher — lives and dies with the conversation. Pulse is the out-of-process daemon that runs 24/7. Use Monitor for session-scoped watching (deploy logs, CI). Use Pulse for persistent monitoring (Telegram, iMessage, cron checks).

**Monitor guidelines:**
- Always use `grep --line-buffered` in pipes — without it, pipe buffering delays events by minutes
- Poll intervals: 30s+ for remote APIs (rate limits), 0.5-1s for local checks
- Handle transient failures in poll loops (`curl ... || true`)
- Only stdout triggers notifications — stderr goes to output file (readable via Read)
- Set `persistent: true` for session-length watches (PR monitoring, log tails)
- Use `TaskStop` to cancel a monitor early
- Selective filters only — never pipe raw logs. Monitors producing too many events get auto-stopped.

---

## Sub-Agent Nesting Depth Policy

As of Claude Code v2.1.172, sub-agents can spawn their own sub-agents up to **5 levels deep**. This turns delegation from a flat orchestrator→worker fan-out into a tree — and a tree has a new failure mode the flat model never had: cost and latency compound multiplicatively per level, and a runaway recursive delegation can fan out far faster than you notice.

**PAI rule of thumb:**

- **Default to depth 1** — the primary delegates to workers; workers do the work and return. This covers the overwhelming majority of parallel tasks.
- **Depth 2 is the practical ceiling** for normal work: a coordinator agent that itself spawns a small bounded set of specialists (e.g. a research lead spawning per-source researchers). Name the fan-out width explicitly in the parent's prompt so it can't balloon.
- **Depths 3–5 require an explicit, bounded reason** — a genuine recursive decomposition where each level provably shrinks the problem (e.g. a migration that splits by module, then by file). Never spawn deep "just in case." Every level past 2 multiplies token cost and wall-clock; a 5-deep tree with width 3 is 243 leaf agents.
- **Bound every level.** A parent that delegates must state how many children it may spawn. Unbounded recursion is the runaway mode; the 5-level platform limit is a backstop, not a budget.
- **Prefer width over depth.** A single primary spawning 10 parallel workers (depth 1, width 10) is cheaper, faster, and far easier to reason about than a 4-level chain. Flatten when you can.

When in doubt, keep delegation shallow and wide. Depth is for problems that are genuinely recursive, not for problems that are merely large.

## Consuming Agent Output

Nesting depth governs the cost of *spawning*. This section governs the cost of *consuming* — the half of delegation that quietly dominates the bill. When a worker returns, the conductor has to pull its output back into context, and the naive move (read the worker's full transcript) is the single biggest avoidable token cost in a delegation: it collapses the conductor's prompt cache and re-pays for reasoning the conductor never needed to see.

Four rules, cheapest-first:

- **Digest, not transcript.** A worker's value is its conclusion, not its scratch work. Have it return a structured digest — verdict + findings + a pointer to the artifact (diff, file path, output file) — and consume that. When you control the prompt, specify the digest shape up front ("return: verdict, ≤5 findings each with file:line, and the path to your diff"). Reading the raw `tasks/<id>.output` transcript into the conductor is the anti-pattern this rule exists to kill.
- **Review the diff, not the tree.** For a code-producing agent (Forge, Anvil, Engineer), read what *changed* — `git diff`, the named files — not a fresh read of the whole repository. The diff is the unit of review; the tree is context you already had.
- **Batch the delegation.** One agent call that does N related things and returns one digest beats N round-trips that each re-pay context setup. Bundle related asks into a single well-scoped delegation.
- **Delegate the write.** When the artifact is file content, let the worker write the files (in a worktree, or directly) and return paths + a digest. The conductor then spends zero tokens regenerating content it only needs to verify — it reads the diff, not the generated bytes.

**Why this matters (cost basis).** Published A/B measurements on conductor/executor delegation (e.g. the `antigravity-for-claude-code` pattern) show the digest-not-raw discipline is the dominant lever — collapsing cache-read by consuming a digest instead of the full executor output drove roughly −27% cost vs. a solo high-effort run and −64% vs. solo max-effort *at equal output quality*. (Reported figures are cost-weighted USD estimates at the authors' Vertex rates over a small eval (3/3 quality parity); the source flags them as approximate and rate-dependent, so treat the direction as the signal, not the exact percentages.) The savings come almost entirely from what the conductor refuses to read back, not from the delegation itself. This is consumption discipline, not a delegation floor: it changes neither *whether* to delegate (see the Async Primitives table and the Algorithm's Delegation Gate) nor *how many* workers to spawn (the tier delegation floors) — only how cheaply each result re-enters context.

## Knowledge Archive Access

Delegated agents can query the **Knowledge Archive** (`~/.claude/PAI/MEMORY/KNOWLEDGE/`) for accumulated knowledge organized by 4 entity types: People (human beings), Companies (organizations), Ideas (insights/theses/analyses), Research (longer-form research notes). Topic is a tag, not a domain. Managed by Algorithm LEARN phase (direct writes), `PAI/TOOLS/KnowledgeHarvester.ts` (validation/maintenance), and the `/knowledge` skill. Include archive query instructions in agent prompts when the task benefits from prior research or domain context.

---

**See Also:**
- `~/.claude/PAI/DOCUMENTATION/PAISystemArchitecture.md` — Master architecture reference (system-of-systems)
- SKILL.md > Delegation (Quick Reference) - Condensed trigger table
- Workflows/Delegation.md - Operational delegation procedures
- Workflows/BackgroundDelegation.md - Background agent patterns
- skills/Agents/SKILL.md - Custom agent creation system
