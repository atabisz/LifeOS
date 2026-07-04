#!/usr/bin/env bun
/**
 * CrossVendorAudit.ts — Cato's audit tool
 *
 * Bundles ISA + artifacts + tool-activity tail + Advisor verdict, pipes to
 * codex exec (GPT-5.5 read-only), parses JSON response, appends to
 * MEMORY/VERIFICATION/cato-findings.jsonl, emits parsed JSON to stdout.
 *
 * Usage:
 *   bun CrossVendorAudit.ts --slug <slug> --advisor-verdict "<text>"
 *
 * Algorithm v3.27 Rule 2a. E4/E5 VERIFY phase only.
 */

import { spawn, spawnSync } from "node:child_process";
import { readFile, writeFile, readdir, appendFile, mkdir, stat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOME = homedir();
const PAI_DIR = join(HOME, ".claude", "PAI");
const WORK_DIR = join(PAI_DIR, "MEMORY", "WORK");
const FINDINGS_LOG = join(PAI_DIR, "MEMORY", "VERIFICATION", "cato-findings.jsonl");
const TOOL_ACTIVITY_LOG = join(PAI_DIR, "MEMORY", "OBSERVABILITY", "tool-activity.jsonl");
// Codex binary. On Windows the installed binary is `codex.exe` (a bare
// extensionless path fails BOTH existsSync and spawn), so probe the real
// per-OS filenames and fall back to PATH resolution. On macOS/Linux the bare
// `~/.bun/bin/codex` still resolves first, so this is a no-op there.
function resolveCodexBin(): string | null {
  const candidates =
    process.platform === "win32"
      ? [
          join(HOME, ".bun", "bin", "codex.exe"),
          join(HOME, ".bun", "bin", "codex.cmd"),
          join(HOME, ".bun", "bin", "codex"),
        ]
      : [join(HOME, ".bun", "bin", "codex")];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Fall back to PATH (covers npm-global installs, e.g. AppData\Roaming\npm\codex).
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["codex"], {
    encoding: "utf8",
  });
  if (probe.status === 0) {
    const first = (probe.stdout || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first && existsSync(first)) return first;
  }
  return null;
}

const CODEX_BIN = resolveCodexBin();

const BUNDLE_TOKEN_CAP = 80_000;
const CHARS_PER_TOKEN = 4; // rough estimate for bundle sizing
const BUNDLE_CHAR_CAP = BUNDLE_TOKEN_CAP * CHARS_PER_TOKEN;
// Codex runs an agentic audit (it shells out to git/rg to verify claims against
// the tree), which lands at 80-110s wall-clock for a real audit — right at the
// edge of the old 120s cap, causing variance-driven timeouts even when the model
// is healthy and the bundle is small. 300s gives headroom for the agentic phase.
// Diagnosed 2026-06-24: a trivial codex call returns in ~15s, an 8KB audit bundle
// returned a full verdict in 104s; the cap, not bundle size or model speed, was
// the binding constraint. See MEMORY/WORK/crossvendoraudit-timeout-fix/ISA.md.
const CODEX_TIMEOUT_MS = 300_000;
const TOOL_ACTIVITY_TAIL_LINES = 200;
const ARTIFACT_PER_FILE_CAP = 30_000 * CHARS_PER_TOKEN;

const AUDIT_PROMPT = `You are Cato, an independent cross-vendor auditor. The executor (Claude Sonnet) and reviewer (Claude Opus via the Advisor) have already signed off on this work. Your job is to find what THEY missed — specifically Anthropic-family blind spots they share (format conventions, API contract readings, RLHF preferences, constitutional biases).

Audit this ISA against its ISC criteria. For each criterion:
 1. Is there concrete evidence of completion in the artifacts?
 2. Is the evidence consistent with the stated claim?
 3. Are there failure modes the same-family reviewers would share that are present here?

Signal over noise. If the Advisor was right and there is nothing to flag, say so explicitly with "agrees_with_advisor": "yes" and "findings": []. Do not manufacture concerns. Your credibility depends on surfacing real Anthropic-family blind spots, not on inflating finding counts.

Output ONLY this JSON on one line, no markdown, no prose, no preamble:

{"verdict":"pass|concerns|fail","criticality":"high|medium|low","findings":[{"severity":"critical|warning|info","isc_ref":"ISC-N or null","issue":"...","evidence":"..."}],"blind_spots_surfaced":["..."],"agrees_with_advisor":"yes|no|partial","model_used":"gpt-5.5","tokens_used":0}`;

interface Args {
  slug: string;
  advisorVerdict: string;
}

interface CatoResponse {
  verdict: "pass" | "concerns" | "fail" | "skipped" | "error";
  criticality?: "high" | "medium" | "low";
  findings?: Array<{ severity: string; isc_ref: string | null; issue: string; evidence: string }>;
  blind_spots_surfaced?: string[];
  agrees_with_advisor?: "yes" | "no" | "partial";
  model_used?: string;
  tokens_used?: number;
  cost_usd_est?: number;
  reason?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--slug") args.slug = argv[++i];
    else if (argv[i] === "--advisor-verdict") args.advisorVerdict = argv[++i];
  }
  if (!args.slug) throw new Error("--slug required");
  if (!args.advisorVerdict) args.advisorVerdict = "(not provided)";
  return args as Args;
}

async function readISA(slug: string): Promise<string> {
  // Read order: ISA.md (canonical, v4.1.0+) → PRD.md (legacy alias, retired at v4.2.0).
  const dir = join(WORK_DIR, slug);
  const isaPath = join(dir, "ISA.md");
  const legacyPath = join(dir, "PRD.md");
  const path = existsSync(isaPath) ? isaPath : existsSync(legacyPath) ? legacyPath : null;
  if (!path) throw new Error(`ISA not found in ${dir} (tried ISA.md and legacy PRD.md)`);
  return await readFile(path, "utf8");
}

async function readArtifacts(slug: string, isa: string): Promise<string> {
  // Extract file paths referenced in ISA ## Decisions section.
  const decisionsMatch = isa.match(/## Decisions\n([\s\S]*?)(?=\n## |\n---|\n*$)/);
  if (!decisionsMatch) return "(no ## Decisions section found)";

  const decisions = decisionsMatch[1];
  const pathPattern = /`([~/][^\s`]+\.(?:ts|md|json|yaml|yml|tsx|jsx|js|txt))`/g;
  const paths = new Set<string>();
  let match;
  while ((match = pathPattern.exec(decisions))) {
    let p = match[1];
    if (p.startsWith("~/")) p = join(HOME, p.slice(2));
    paths.add(resolve(p));
  }

  if (paths.size === 0) return "(no file references found in ## Decisions)";

  const chunks: string[] = [];
  let totalChars = 0;
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const stats = await stat(p);
    if (!stats.isFile()) continue;
    let content = await readFile(p, "utf8");
    if (content.length > ARTIFACT_PER_FILE_CAP) {
      content = content.slice(0, ARTIFACT_PER_FILE_CAP) + "\n[TRUNCATED]";
    }
    const block = `--- FILE: ${p} ---\n${content}\n`;
    if (totalChars + block.length > BUNDLE_CHAR_CAP / 2) break; // reserve half for other sections
    chunks.push(block);
    totalChars += block.length;
  }
  return chunks.length > 0 ? chunks.join("\n") : "(no readable artifacts found)";
}

async function readToolActivityTail(slug: string): Promise<string> {
  if (!existsSync(TOOL_ACTIVITY_LOG)) return "(tool-activity.jsonl not found)";
  const content = await readFile(TOOL_ACTIVITY_LOG, "utf8");
  const lines = content.trim().split("\n");
  const recent = lines.slice(-500); // look at last 500 lines total
  const filtered = recent.filter((l) => l.includes(slug)).slice(-TOOL_ACTIVITY_TAIL_LINES);
  return filtered.length > 0 ? filtered.join("\n") : "(no tool-activity lines for this slug)";
}

function assembleBundle(isa: string, artifacts: string, toolTail: string, advisorVerdict: string): string {
  let bundle = [
    "===== ISA =====",
    isa,
    "",
    "===== OUTPUT ARTIFACTS =====",
    artifacts,
    "",
    "===== TOOL ACTIVITY TAIL =====",
    toolTail,
    "",
    "===== ADVISOR VERDICT =====",
    advisorVerdict,
    "",
    "===== AUDIT INSTRUCTIONS =====",
    AUDIT_PROMPT,
  ].join("\n");

  // If over cap, drop tool-tail first, then trim artifacts.
  if (bundle.length > BUNDLE_CHAR_CAP) {
    bundle = [
      "===== ISA =====",
      isa,
      "",
      "===== OUTPUT ARTIFACTS =====",
      artifacts,
      "",
      "===== TOOL ACTIVITY TAIL =====",
      "(dropped — bundle size cap)",
      "",
      "===== ADVISOR VERDICT =====",
      advisorVerdict,
      "",
      "===== AUDIT INSTRUCTIONS =====",
      AUDIT_PROMPT,
    ].join("\n");
  }
  if (bundle.length > BUNDLE_CHAR_CAP) {
    const overshoot = bundle.length - BUNDLE_CHAR_CAP;
    const trimmed = artifacts.slice(0, Math.max(0, artifacts.length - overshoot - 100));
    bundle = [
      "===== ISA =====",
      isa,
      "",
      "===== OUTPUT ARTIFACTS (trimmed) =====",
      trimmed + "\n[TRUNCATED - bundle size cap]",
      "",
      "===== TOOL ACTIVITY TAIL =====",
      "(dropped — bundle size cap)",
      "",
      "===== ADVISOR VERDICT =====",
      advisorVerdict,
      "",
      "===== AUDIT INSTRUCTIONS =====",
      AUDIT_PROMPT,
    ].join("\n");
  }
  return bundle;
}

// Unique per-invocation temp path for codex's --output-last-message file.
// pid + a monotonic counter avoids collision across concurrent/repeat runs
// (ISC-5). No Date.now()/random needed — pid+counter is deterministic-enough.
let __codexOutSeq = 0;
function codexOutPath(): string {
  return join(tmpdir(), `cato-codex-last-${process.pid}-${++__codexOutSeq}.txt`);
}

function invokeCodex(
  codexBin: string,
  bundle: string
): Promise<{ stdout: string; stderr: string; code: number | null; outFile: string }> {
  return new Promise((resolvePromise) => {
    // A .cmd/.bat shim (npm-global installs ship one) cannot be launched by
    // CreateProcess directly — spawn needs shell:true for it, else it throws.
    // .exe / bare binaries launch directly (no shell) as before. Args are fixed
    // literals and the bundle is piped via stdin, so shell:true is injection-safe.
    const useShell = /\.(cmd|bat)$/i.test(codexBin);
    const command = useShell ? `"${codexBin}"` : codexBin;
    const outFile = codexOutPath();
    // Capture the model's FINAL message from -o <file> — NOT scraped stdout.
    // Scraping stdout broke on Windows: codex's console renderer repaints lines
    // with \r/ANSI escapes that append (not overwrite) when piped, so the greedy
    // verdict regex matched a polluted, duplicated, truncated span and JSON.parse
    // failed or returned a mangled object. -o writes only the final message to a
    // file deterministically. --skip-git-repo-check: codex 0.142.4 rejects a
    // non-git cwd without it (exit 1). --color never: don't animate into the pipe.
    const proc = spawn(
      command,
      [
        "exec",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--color",
        "never",
        "--model",
        "gpt-5.5",
        "-o",
        outFile,
        "-",
      ],
      { stdio: ["pipe", "pipe", "pipe"], shell: useShell }
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (r: { stdout: string; stderr: string; code: number | null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ ...r, outFile });
    };
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      finish({ stdout, stderr: stderr + `\n[TIMEOUT after ${CODEX_TIMEOUT_MS / 1000}s]`, code: 124 });
    }, CODEX_TIMEOUT_MS);

    // Without this handler a spawn failure (bad path, non-launchable shim) becomes
    // an unhandled reject that crashes main into a noisy {"verdict":"error"};
    // degrade to a skip-shaped exit code instead.
    proc.on("error", (err) => {
      finish({ stdout, stderr: stderr + `\n[SPAWN ERROR: ${err.message}]`, code: 127 });
    });
    proc.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    proc.on("close", (code) => finish({ stdout, stderr, code }));
    proc.stdin.write(bundle);
    proc.stdin.end();
  });
}

// Strip ANSI escape sequences and carriage returns. Codex's renderer repaints
// with \x1b[...m / \x1b[2K / \r; when piped, those get appended not overwritten,
// so they pollute the buffer mid-JSON. Applied only to the SCRAPED-STDOUT fallback
// path — the -o file is already clean, but stripping it too is harmless.
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
}

// Find the LAST balanced top-level {...} object, scanning right-to-left. The old
// greedy /\{[\s\S]*"verdict"[\s\S]*\}/ matched from the first "{" (often a repainted
// intermediate fragment) to the last "}", spanning duplicated/truncated repaints —
// it "matched" but failed to parse. This returns a single well-formed object even
// when the verdict JSON itself contains nested {} or escape-looking strings.
function lastBalancedObject(s: string): string | null {
  let end = s.lastIndexOf("}");
  while (end >= 0) {
    let depth = 0;
    let inStr = false;
    for (let i = end; i >= 0; i--) {
      const c = s[i];
      if (inStr) {
        if (c === '"') {
          let b = 0;
          let j = i - 1;
          while (j >= 0 && s[j] === "\\") {
            b++;
            j--;
          }
          if (b % 2 === 0) inStr = false;
        }
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === "}") depth++;
      else if (c === "{") {
        depth--;
        if (depth === 0) {
          const candidate = s.slice(i, end + 1);
          if (candidate.includes('"verdict"')) return candidate;
          break; // this object had no verdict — try the next "}" to its left
        }
      }
    }
    end = s.lastIndexOf("}", end - 1);
  }
  return null;
}

function extractJSON(raw: string): CatoResponse {
  // Codex CLI wraps output with session metadata (and, on the stdout path, repaint
  // noise). Sanitize, then extract the last balanced verdict object.
  const cleaned = stripAnsi(raw);
  const candidate = lastBalancedObject(cleaned);
  if (!candidate) {
    return { verdict: "skipped", reason: "no JSON in codex output" };
  }
  try {
    return JSON.parse(candidate) as CatoResponse;
  } catch (err) {
    return { verdict: "skipped", reason: `parse error: ${(err as Error).message}` };
  }
}

function estimateCost(tokens: number): number {
  // GPT-5 class rough: $0.015/1K combined. Conservative.
  return +(tokens * 0.000015).toFixed(4);
}

async function appendFinding(slug: string, advisorVerdict: string, response: CatoResponse, tier: string): Promise<void> {
  await mkdir(join(PAI_DIR, "MEMORY", "VERIFICATION"), { recursive: true });
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    slug,
    tier,
    advisor_verdict: advisorVerdict.slice(0, 200),
    cato_verdict: response.verdict,
    criticality: response.criticality ?? null,
    unique_findings_count: response.findings?.length ?? 0,
    agrees_with_advisor: response.agrees_with_advisor ?? null,
    tokens: response.tokens_used ?? 0,
    cost_usd: response.cost_usd_est ?? estimateCost(response.tokens_used ?? 0),
    skipped: response.verdict === "skipped",
    reason: response.reason ?? null,
  });
  await appendFile(FINDINGS_LOG, line + "\n", "utf8");
}

function extractTier(isa: string): string {
  const m = isa.match(/^effort:\s*(\w+)/m);
  return m ? m[1] : "unknown";
}

async function main() {
  let args: Args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error(JSON.stringify({ verdict: "error", reason: (err as Error).message }));
    process.exit(2);
  }

  if (!CODEX_BIN) {
    const resp = { verdict: "skipped" as const, reason: "codex CLI not installed" };
    await appendFinding(args.slug, args.advisorVerdict, resp, "unknown");
    console.log(JSON.stringify(resp));
    process.exit(0);
  }

  let isa: string;
  try {
    isa = await readISA(args.slug);
  } catch (err) {
    const resp = { verdict: "error" as const, reason: (err as Error).message };
    console.log(JSON.stringify(resp));
    process.exit(1);
  }

  const tier = extractTier(isa);
  const [artifacts, toolTail] = await Promise.all([
    readArtifacts(args.slug, isa),
    readToolActivityTail(args.slug),
  ]);
  const bundle = assembleBundle(isa, artifacts, toolTail, args.advisorVerdict);

  const { stdout, stderr, code, outFile } = await invokeCodex(CODEX_BIN, bundle);
  // Best-effort cleanup of the -o temp file once we've read it (ISC-6, never throws).
  const cleanupOutFile = async () => {
    try {
      await unlink(outFile);
    } catch {
      /* file may not exist (spawn error / timeout before write) — ignore */
    }
  };

  if (code === 124) {
    await cleanupOutFile();
    const resp = { verdict: "skipped" as const, reason: `codex timeout at ${CODEX_TIMEOUT_MS / 1000}s` };
    await appendFinding(args.slug, args.advisorVerdict, resp, tier);
    console.log(JSON.stringify(resp));
    return;
  }
  if (code !== 0) {
    await cleanupOutFile();
    const resp = { verdict: "skipped" as const, reason: `codex exit ${code}: ${stderr.slice(0, 200)}` };
    await appendFinding(args.slug, args.advisorVerdict, resp, tier);
    console.log(JSON.stringify(resp));
    return;
  }

  // Prefer the -o final-message file (deterministic, no repaint noise). This is why
  // the Windows truncation is structurally impossible: the animation stream is no
  // longer the data channel. Fallback ladder (ISC-7): try the file → if it is
  // empty/unreadable OR present-but-unparseable, try sanitized stdout → only then
  // skip. A present-but-invalid file must NOT strand a good verdict sitting in
  // stdout (Advisor gap #2), so we parse the file and fall through on skip.
  let fileContent = "";
  try {
    if (existsSync(outFile)) {
      fileContent = (await readFile(outFile, "utf8")).trim();
    }
  } catch {
    /* unreadable — fileContent stays "" */
  }
  await cleanupOutFile();

  let parsed: CatoResponse;
  let capturedVia: string;
  const fromFile = fileContent.length > 0 ? extractJSON(fileContent) : null;
  if (fromFile && fromFile.verdict !== "skipped") {
    parsed = fromFile;
    capturedVia = "output-last-message";
  } else {
    parsed = extractJSON(stdout);
    capturedVia = "stdout-fallback";
  }
  if (parsed.verdict !== "skipped") {
    (parsed as CatoResponse & { captured_via?: string }).captured_via = capturedVia;
  }
  if (parsed.tokens_used && !parsed.cost_usd_est) {
    parsed.cost_usd_est = estimateCost(parsed.tokens_used);
  }
  await appendFinding(args.slug, args.advisorVerdict, parsed, tier);
  console.log(JSON.stringify(parsed));
}

// Exported for unit testing the extraction path against the REAL production
// functions (not a scratch copy) — Rule 1b target authenticity.
export { extractJSON, lastBalancedObject, stripAnsi };

if (import.meta.main) {
  main().catch(async (err) => {
    console.error(JSON.stringify({ verdict: "error", reason: err.message }));
    process.exit(1);
  });
}
