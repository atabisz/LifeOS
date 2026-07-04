#!/usr/bin/env bun
/**
 * lifeos-normalize — the path/token transform at the heart of the upstream-sync
 * channel. The public LifeOS release renamed the framework root PAI/ -> LifeOS/
 * and the env prefix PAI_ -> LIFEOS_. A maintainer whose live tree stays PAI/-
 * shaped (because it is the build SOURCE for releases) must rewrite those tokens
 * on every ingest so ported files resolve against the live tree instead of a
 * nonexistent ~/.claude/LifeOS dir.
 *
 * WHY THIS IS NOT A GLOBAL sed (Cato-flagged, verified against the v6 payload):
 * the token `LifeOS`/`LIFEOS` appears in THREE unrelated roles and only two of
 * them may be rewritten:
 *   1. PATH / ENV (rewrite)   — `/LIFEOS/…`, quoted `'LifeOS'` array segments in
 *                               join() calls, `LIFEOS_*` env vars, the
 *                               `LIFEOS_SYSTEM_PROMPT.md` filename. These are
 *                               runtime filesystem constants; leaving them breaks
 *                               resolution SILENTLY (empty dashboards, not errors).
 *   2. BRAND PROSE (keep)     — "LifeOS is the Life Operating System". Rewriting
 *                               it corrupts docs and UI titles.
 *   3. SERVICE / ASSET (keep) — `com.lifeos.*` plist/launchd ids, `lifeos-logo`,
 *                               `useLifeosEvents`. Rewriting breaks service names
 *                               and import paths.
 *
 * DOCTRINE: transform only the UNAMBIGUOUS role-1 tokens. Every other `LifeOS`
 * occurrence is EMITTED AS A FLAG for human review — never blindly rewritten.
 * The channel is audit-not-auto; a silent wrong transform is worse than a flag.
 *
 * Pure + deterministic (no clock, no rng, no fs in the core). READ-ONLY: returns
 * a new string + a flag list; never writes. Independently testable — run
 * `bun scripts/lifeos-normalize.ts --self-test`.
 */

export type Flag = {
  line: number; // 1-indexed
  col: number; // 1-indexed
  token: string; // the matched text
  reason: string; // why it was flagged, not auto-transformed
  context: string; // the source line, trimmed
};

export type NormalizeResult = {
  text: string; // transformed content
  rewrites: number; // count of applied token rewrites
  masked: number; // count of high-entropy secret values redacted
  flags: Flag[]; // ambiguous occurrences left for human review
};

/**
 * Secret-masking pass. The public release payload ships high-entropy values that
 * ggshield's "Generic High Entropy Secret" detector flags (verified: an Eight Sleep
 * APP_CLIENT_SECRET, ElevenLabs *_voice_id values, a Daemon filter token, nuclei-
 * template example strings). The vendored baseline is DIFF-ONLY — never executed —
 * so redacting these is safe and lets the pin commit clean without SKIP=ggshield.
 *
 * CRITICAL: masking lives inside normalize() so it applies to BOTH the committed
 * pin AND the on-the-fly release comparison — masked-vs-unmasked would otherwise
 * manufacture false diffs. It is DETERMINISTIC (same value → same placeholder), so
 * a masked value never shows as a spurious change across a v6→v7 diff.
 *
 * Heuristic mirrors ggshield's generic detector: a QUOTED literal of ≥32 chars
 * drawn purely from the secret alphabet [A-Za-z0-9+/=_-] (no spaces, no natural
 * language). This catches all four flagged shapes and rarely over-masks — few
 * legitimate 32+ char unbroken alphanumeric literals exist outside secrets/hashes/ids.
 * Over-masking in a diff-only pin costs nothing; a leaked secret costs a lot.
 */
const SECRET_LITERAL_RE = /(['"])([A-Za-z0-9+/=_-]{32,})\1/g;
const SECRET_MASK = "<REDACTED:high-entropy>";

export function maskSecrets(text: string): { text: string; masked: number } {
  let masked = 0;
  const out = text.replace(SECRET_LITERAL_RE, (_m, q: string) => {
    masked += 1;
    return `${q}${SECRET_MASK}${q}`;
  });
  return { text: out, masked };
}

/**
 * Ordered rewrite rules. Order matters: longest / most-specific first so a
 * broad rule never eats a token a specific rule should own. Each rule is
 * case-SENSITIVE by construction — we match the exact upper/mixed form that
 * denotes a path/env token, never the brand-prose form.
 */
type Rule = { re: RegExp; replace: string; label: string };

const REWRITE_RULES: Rule[] = [
  // Env var + system-prompt filename: the specific compound tokens first so the
  // generic LIFEOS_ prefix rule below doesn't split them.
  { re: /\bLIFEOS_SYSTEM_PROMPT\b/g, replace: "PAI_SYSTEM_PROMPT", label: "system-prompt token/filename" },
  { re: /\bLIFEOS_CONFIG_DIR\b/g, replace: "PAI_CONFIG_DIR", label: "env: config dir" },
  { re: /\bLIFEOS_CONFIG\b/g, replace: "PAI_CONFIG", label: "env: config" },
  { re: /\bLIFEOS_RELEASES\b/g, replace: "PAI_RELEASES", label: "env: releases" },
  { re: /\bLIFEOS_DIR\b/g, replace: "PAI_DIR", label: "env: dir" },
  // Any remaining ALL-CAPS LIFEOS_<WORD> env var -> PAI_<WORD>.
  { re: /\bLIFEOS_([A-Z][A-Z0-9_]*)/g, replace: "PAI_$1", label: "env: generic LIFEOS_ prefix" },
  // Path token: `/LIFEOS/` or a leading `LIFEOS/` inside a doc-relative ref.
  { re: /\bLIFEOS\//g, replace: "PAI/", label: "path: LIFEOS/ segment" },
  // Quoted path-array segment in join()/path calls: 'LifeOS' or "LifeOS" — the
  // mixed-case dir literal. Only inside quotes, so brand prose is untouched.
  { re: /(['"])LifeOS\1/g, replace: "$1PAI$1", label: "path: quoted 'LifeOS' dir segment" },
];

/** Occurrences we deliberately PRESERVE — matching one of these suppresses a flag. */
const PRESERVE_RES: { re: RegExp; why: string }[] = [
  { re: /com\.lifeos\./, why: "service/plist id (com.lifeos.*) — must not rename" },
  { re: /lifeos-[a-z0-9-]/, why: "asset/kebab id (lifeos-logo, etc.) — must not rename" },
  { re: /useLifeos|Lifeos[A-Z]/, why: "identifier/symbol — must not rename" },
];

/** After rewrites, any surviving `LifeOS`/`LIFEOS`/`lifeos` is ambiguous → flag. */
const RESIDUAL_RE = /LifeOS|LIFEOS|Lifeos|lifeos/g;

export function normalize(text: string): NormalizeResult {
  let rewrites = 0;
  let out = text;
  for (const rule of REWRITE_RULES) {
    out = out.replace(rule.re, (...m) => {
      rewrites += 1;
      // Build the replacement honoring $1 backrefs used in the rules above.
      const groups = m.slice(1, -2); // drop full-match head and (offset, whole) tail
      return rule.replace.replace(/\$(\d)/g, (_s, d) => groups[Number(d) - 1] ?? "");
    });
  }
  // Secret-masking pass — runs after token rewrites (they don't overlap: path/env
  // tokens are <32 chars or contain '/'). Applies to pin AND release comparison.
  const secretPass = maskSecrets(out);
  out = secretPass.text;
  const masked = secretPass.masked;
  // Flag residuals for human review, line/col located, preserve-list suppressed.
  const flags: Flag[] = [];
  const lines = out.split("\n");
  lines.forEach((lineText, i) => {
    let match: RegExpExecArray | null;
    RESIDUAL_RE.lastIndex = 0;
    while ((match = RESIDUAL_RE.exec(lineText)) !== null) {
      const token = match[0];
      const around = lineText.slice(Math.max(0, match.index - 12), match.index + token.length + 12);
      const preserved = PRESERVE_RES.find((p) => p.re.test(around));
      if (preserved) continue; // intentional keep — not a flag
      // Brand-prose heuristic: `LifeOS` bounded by spaces/word chars in a sentence.
      const reason = /^LifeOS$/.test(token)
        ? "mixed-case 'LifeOS' — brand prose (keep) OR an unquoted path (rewrite): review"
        : "residual LifeOS token after rewrite — review manually";
      flags.push({ line: i + 1, col: match.index + 1, token, reason, context: lineText.trim().slice(0, 120) });
    }
  });
  return { text: out, rewrites, masked, flags };
}

// ── Self-test ────────────────────────────────────────────────────────────────
function runSelfTest(): number {
  type Case = { name: string; in: string; wantText: string; wantRewrites: number; wantFlags: number; wantMasked?: number };
  const cases: Case[] = [
    {
      // Synthetic 64-char hex fixture (NOT a real credential) — proves a client-
      // secret-shaped literal is masked. Never embed a real payload secret here.
      name: "high-entropy client secret masked",
      in: 'const APP_CLIENT_SECRET = "' + "0".repeat(48) + 'deadbeefcafef00d";',
      wantText: 'const APP_CLIENT_SECRET = "<REDACTED:high-entropy>";',
      wantRewrites: 0,
      wantFlags: 0,
      wantMasked: 1,
    },
    {
      name: "short quoted string NOT masked (below 32-char floor)",
      in: 'const ua = "okhttp/4.9.3";',
      wantText: 'const ua = "okhttp/4.9.3";',
      wantRewrites: 0,
      wantFlags: 0,
      wantMasked: 0,
    },
    {
      name: "prose sentence with spaces NOT masked",
      in: '"This is a long human sentence that exceeds thirty-two characters easily."',
      wantText: '"This is a long human sentence that exceeds thirty-two characters easily."',
      wantRewrites: 0,
      wantFlags: 0,
      wantMasked: 0,
    },
    {
      name: "env var LIFEOS_DIR",
      in: "const d = process.env.LIFEOS_DIR",
      wantText: "const d = process.env.PAI_DIR",
      wantRewrites: 1,
      wantFlags: 0,
    },
    {
      name: "system prompt filename",
      in: "load LIFEOS_SYSTEM_PROMPT.md",
      wantText: "load PAI_SYSTEM_PROMPT.md",
      wantRewrites: 1,
      wantFlags: 0,
    },
    {
      name: "path LIFEOS/ segment",
      in: "see `LIFEOS/DOCUMENTATION/Foo.md`",
      wantText: "see `PAI/DOCUMENTATION/Foo.md`",
      wantRewrites: 1,
      wantFlags: 0,
    },
    {
      name: "quoted dir segment in join()",
      in: "join(HOME, '.claude', 'LifeOS', 'MEMORY')",
      wantText: "join(HOME, '.claude', 'PAI', 'MEMORY')",
      wantRewrites: 1,
      wantFlags: 0,
    },
    {
      name: "brand prose LifeOS is flagged, not rewritten",
      in: "LifeOS is the Life Operating System.",
      wantText: "LifeOS is the Life Operating System.",
      wantRewrites: 0,
      wantFlags: 1,
    },
    {
      name: "service id com.lifeos.* preserved, no flag",
      in: "label com.lifeos.pulse plist",
      wantText: "label com.lifeos.pulse plist",
      wantRewrites: 0,
      wantFlags: 0,
    },
    {
      name: "asset id lifeos-logo preserved, no flag",
      in: 'img src="lifeos-logo.svg"',
      wantText: 'img src="lifeos-logo.svg"',
      wantRewrites: 0,
      wantFlags: 0,
    },
    {
      name: "generic LIFEOS_ prefix env",
      in: "LIFEOS_STATE=1",
      wantText: "PAI_STATE=1",
      wantRewrites: 1,
      wantFlags: 0,
    },
  ];
  let pass = 0;
  for (const c of cases) {
    const r = normalize(c.in);
    const maskedOk = c.wantMasked === undefined || r.masked === c.wantMasked;
    const ok = r.text === c.wantText && r.rewrites === c.wantRewrites && r.flags.length === c.wantFlags && maskedOk;
    if (ok) {
      pass += 1;
    } else {
      console.error(`FAIL ${c.name}`);
      console.error(`  in:    ${JSON.stringify(c.in)}`);
      console.error(`  want:  text=${JSON.stringify(c.wantText)} rewrites=${c.wantRewrites} flags=${c.wantFlags} masked=${c.wantMasked ?? "-"}`);
      console.error(`  got:   text=${JSON.stringify(r.text)} rewrites=${r.rewrites} flags=${r.flags.length} masked=${r.masked}`);
    }
  }
  console.log(`${pass}/${cases.length} passed`);
  return pass === cases.length ? 0 : 1;
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  if (a.includes("--self-test")) {
    process.exit(runSelfTest());
  }
  // CLI: normalize a file's content to stdout, flags to stderr. READ-ONLY.
  const file = a.find((x) => !x.startsWith("--"));
  if (!file) {
    console.error("usage: bun scripts/lifeos-normalize.ts <file> | --self-test");
    process.exit(2);
  }
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(file, "utf8");
  const r = normalize(src);
  process.stdout.write(r.text);
  for (const f of r.flags) console.error(`FLAG ${file}:${f.line}:${f.col} "${f.token}" — ${f.reason}`);
  console.error(`[${file}] rewrites=${r.rewrites} masked=${r.masked} flags=${r.flags.length}`);
}
