#!/usr/bin/env bun
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

type Args = { apply: boolean; only?: string; release?: string; prune: boolean; selfTest: boolean; help: boolean };
type Action = "add" | "change" | "unchanged";
type Entry = { relPath: string; srcAbs: string; destAbs: string; action: Action; bytes: Buffer };
type ScanResult = { hit: boolean; pattern?: string };

const ALLOW_DIRS = [
  "hooks/",
  "PAI/PULSE/",
  "PAI/TOOLS/",
  "PAI/ALGORITHM/",
  "PAI/DOCUMENTATION/",
  "PAI/PAI-Install/",
  "skills/",
  "commands/",
  "agents/",
];
const ALLOW_FILES = new Set(["settings.json", "CLAUDE.md", "PAI/PAI_SYSTEM_PROMPT.md"]);
const KNOWN_BINARY_EXTS = new Set([
  ".mp3",
  ".wav",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".pdf",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".onnx",
  ".bin",
  ".zip",
  ".gz",
]);
const USERNAME = path.basename(os.homedir());
const UTF8 = new TextDecoder("utf-8", { fatal: true });

function usage(): string {
  return [
    "Usage: bun scripts/build-release.ts [--apply] [--only <subpath>] [--release <path>] [--prune] [--self-test] [--help]",
    "Default mode is DRY-RUN and writes nothing.",
  ].join("\n");
}

function fail(message: string): never {
  throw new Error(message);
}

function normalizeRel(input: string, flagName: string): string {
  if (!input.trim()) fail(`${flagName} requires a non-empty relative path.\n${usage()}`);
  if (path.isAbsolute(input)) fail(`${flagName} must be relative to .claude.\n${usage()}`);
  const normalized = path.posix.normalize(input.replace(/\\/g, "/").replace(/^\.\//, ""));
  if (normalized === "." || normalized === "") fail(`${flagName} requires a non-empty relative path.\n${usage()}`);
  if (normalized === ".." || normalized.startsWith("../")) fail(`${flagName} cannot escape .claude.\n${usage()}`);
  return normalized.replace(/\/+$/, "");
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, prune: false, selfTest: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--prune") args.prune = true;
    else if (arg === "--self-test") args.selfTest = true;
    else if (arg === "--help") args.help = true;
    else if (arg === "--only") {
      const value = argv[i + 1];
      if (!value) fail(`Missing value for --only.\n${usage()}`);
      args.only = normalizeRel(value, "--only");
      i += 1;
    } else if (arg === "--release") {
      const value = argv[i + 1];
      if (!value) fail(`Missing value for --release.\n${usage()}`);
      args.release = path.resolve(value);
      i += 1;
    } else {
      fail(`Unknown argument: ${arg}\n${usage()}`);
    }
  }
  return args;
}

function relWithin(relPath: string, scope?: string): boolean {
  return !scope || relPath === scope || relPath.startsWith(`${scope}/`);
}

function scopesIntersect(left: string, right?: string): boolean {
  return !right || relWithin(left, right) || relWithin(right, left);
}

function isAllowed(relPath: string): boolean {
  if (ALLOW_FILES.has(relPath)) return true;
  return ALLOW_DIRS.some((prefix) => relPath.startsWith(prefix));
}

function isDenied(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  const base = path.posix.basename(lower);
  const segments = lower.split("/");
  if (lower === "pai/user" || lower.startsWith("pai/user/")) return true;
  if (lower === "pai/memory" || lower.startsWith("pai/memory/")) return true;
  if (base === "settings.local.json" || base === ".checkpoint-state.json") return true;
  if (base === ".env" || base.startsWith(".env") || base.endsWith(".env")) return true;
  if (base.endsWith(".key") || base.endsWith(".pem")) return true;
  if (base.includes("secret") || base.includes("credential")) return true;
  return segments.some((segment) =>
    [".git", "node_modules", "projects", "test-results", "pai_updates", "pai_backups", ".pai-sync-history"].includes(segment),
  );
}

// A directory entry that is a symlink/junction/reparse point is NEVER followed or copied
// (Cato 3): the denylist checks path STRINGS, but readdir/stat FOLLOW links, so an
// allowlisted link pointing into PAI/USER or PAI/MEMORY would leak.
//
// lstat().isSymbolicLink() alone is NOT enough on Windows — directory JUNCTIONS and mount
// points are reparse points that Node reports as plain directories (Cato re-audit finding 3).
// So we ALSO enforce realpath containment: the entry's resolved real target must stay under
// the root's resolved real path. A junction/symlink escaping the tree resolves elsewhere and
// is refused. Unresolvable → refuse. This one check subsumes symlinks, junctions, and `..`.
function isSymlink(abs: string): boolean {
  try { return lstatSync(abs).isSymbolicLink(); } catch { return true; } // unreadable → refuse
}
function escapesRoot(abs: string, root: string): boolean {
  try {
    return !isUnder(realpathSync(abs), realpathSync(root));
  } catch {
    return true; // unresolvable (broken link, race) → refuse, fail-closed
  }
}

function walkAllowlisted(root: string, only?: string): string[] {
  const out = new Set<string>();
  const visit = (dirAbs: string, dirRel: string): void => {
    for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
      const childRel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      const normalized = childRel.replace(/\\/g, "/");
      if (!scopesIntersect(normalized, only)) continue;
      const childAbs = path.join(dirAbs, entry.name);
      // Refuse links AND junctions/reparse points: string-check + realpath containment.
      if (entry.isSymbolicLink() || isSymlink(childAbs) || escapesRoot(childAbs, root)) continue;
      if (entry.isDirectory()) visit(childAbs, normalized);
      else if (entry.isFile()) {
        if (relWithin(normalized, only) && isAllowed(normalized) && !isDenied(normalized)) out.add(normalized);
      } else {
        // No action: non-file, non-directory entries are intentionally ignored.
      }
    }
  };

  for (const prefix of ALLOW_DIRS) {
    const relDir = prefix.slice(0, -1);
    if (!scopesIntersect(relDir, only)) continue;
    const absDir = path.join(root, ...relDir.split("/"));
    if (existsSync(absDir) && !isSymlink(absDir) && !escapesRoot(absDir, root) && statSync(absDir).isDirectory()) visit(absDir, relDir);
    else {
      // No action: missing, linked, or out-of-tree allowlisted directories are skipped.
    }
  }
  for (const relFile of ALLOW_FILES) {
    if (!scopesIntersect(relFile, only)) continue;
    const absFile = path.join(root, ...relFile.split("/"));
    if (existsSync(absFile) && !isSymlink(absFile) && !escapesRoot(absFile, root) && statSync(absFile).isFile() && !isDenied(relFile)) out.add(relFile);
    else {
      // No action: missing, linked, or out-of-tree allowlisted files are skipped.
    }
  }
  return [...out].sort();
}

function filterGitIgnored(sourceRoot: string, relPaths: string[]): Set<string> {
  if (relPaths.length === 0) return new Set();
  const result = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: sourceRoot,
    input: relPaths.join("\n"),
    encoding: "utf8",
  });
  if (result.error) return new Set();
  if (result.status === 0 || result.status === 1) {
    const ignored = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\\/g, "/"))
      .filter(Boolean);
    return new Set(ignored);
  }
  return new Set();
}

function resolveRepoRoot(): string {
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dir, encoding: "utf8" });
  if (git.status === 0 && git.stdout.trim()) return path.resolve(git.stdout.trim());
  return path.dirname(import.meta.dir);
}

function parseVersion(name: string): number[] | null {
  if (!/^v\d+(?:\.\d+)*$/.test(name)) return null;
  return name.slice(1).split(".").map((part) => Number(part));
}

function compareVersionDesc(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const delta = (b[i] ?? 0) - (a[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function resolveDestRoot(repoRoot: string, override?: string): string {
  if (override) return override;
  const releasesRoot = path.join(repoRoot, "Releases");
  if (!existsSync(releasesRoot) || !statSync(releasesRoot).isDirectory()) fail(`No Releases directory found at ${releasesRoot}.`);
  const candidates = readdirSync(releasesRoot)
    .map((name) => ({ name, version: parseVersion(name), abs: path.join(releasesRoot, name, ".claude") }))
    .filter((entry) => entry.version && existsSync(entry.abs) && statSync(entry.abs).isDirectory())
    .sort((left, right) => compareVersionDesc(left.version as number[], right.version as number[]));
  if (candidates.length === 0) fail(`No release .claude directory found under ${releasesRoot}.`);
  return candidates[0].abs;
}

// Containment guard (Cato 5): the destination MUST be a `.claude` dir under
// <repoRoot>/Releases/, and MUST NOT overlap the source tree. Without this, a
// `--release <arbitrary path> --apply --prune` could delete files anywhere — the
// "one-way live→release, never destructive elsewhere" guarantee lived only in comments.
function realOrSelf(p: string): string {
  try { return realpathSync(p); } catch { return path.resolve(p); }
}
function isUnder(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
function assertDestSafe(repoRoot: string, sourceRoot: string, destRoot: string, prune: boolean): void {
  const releasesRoot = realOrSelf(path.join(repoRoot, "Releases"));
  const dest = realOrSelf(destRoot);
  const src = realOrSelf(sourceRoot);
  if (!isUnder(dest, releasesRoot)) {
    fail(`Refusing: destination ${destRoot} is not under ${releasesRoot}. --release must point inside Releases/.`);
  }
  if (path.basename(dest) !== ".claude") {
    fail(`Refusing: destination ${destRoot} must be a ".claude" directory (got "${path.basename(dest)}").`);
  }
  if (dest === src || isUnder(dest, src) || isUnder(src, dest)) {
    fail(`Refusing: destination and source overlap (dest=${dest}, source=${src}). This must be one-way live→release.`);
  }
  if (prune && !existsSync(path.join(dest, "..", ".."))) {
    fail(`Refusing --prune: destination parent looks wrong (${destRoot}).`);
  }
}

function isKnownBinary(relPath: string): boolean {
  return KNOWN_BINARY_EXTS.has(path.posix.extname(relPath).toLowerCase());
}

function scanBytes(relPath: string, buf: Buffer): ScanResult {
  // FAIL-CLOSED: "can't cleanly decode" must never mean "safe" (Cato 1a). Binary-ext
  // or NUL-containing files are still scanned — as latin1 over the raw bytes, which
  // surfaces any ASCII-range secret/username embedded in a binary or after a stray NUL.
  // A single 0x00 can no longer disable scanning for a whole file.
  const hasNul = buf.includes(0);
  const isBinary = isKnownBinary(relPath) || hasNul;
  let text: string;
  if (isBinary) {
    text = buf.toString("latin1");
    // Cato re-audit 1a: latin1 leaves NULs in place, so an interleaved-NUL UTF-16 file
    // (common on Windows) hides `A\0K\0I\0A...` from every regex. Also scan a NUL-STRIPPED
    // projection so the underlying ASCII run (and username) is contiguous and matchable.
    if (hasNul) text += "\n" + buf.toString("latin1").replace(/\0/g, "");
  } else {
    try {
      text = UTF8.decode(buf);
    } catch {
      // Undecodable-but-not-flagged-binary: still scan as latin1 rather than trust it.
      text = buf.toString("latin1");
    }
  }
  const patterns: Array<[string, RegExp]> = [
    [`username:${USERNAME}`, new RegExp(escapeRegExp(USERNAME), "i")],
    // Real API keys start at a token boundary and are long. A word boundary drops the
    // "task-notification" substring class (…ta|sk-notification…); the 20-char floor drops
    // short standalone words like "sk-notification". Real sk-ant-/sk-proj-/OpenAI keys pass.
    ["sk-token", /\bsk-[A-Za-z0-9_-]{20,}/],
    // Real embedded PEM key: BEGIN marker + ≥40 chars of body + END. A bare
    // "-----BEGIN ... PRIVATE KEY-----" regex/doc mention (no key material) does not match.
    ["private-key", /-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]{40,}?-----END/i],
  ];
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) return { hit: true, pattern: label };
  }
  // Named-secret assignment: only fire when the QUOTED value looks like a real
  // credential, not env-var-handling code (API_KEY=")) {), a var-name flag
  // (OPENAI_API_KEY_OPTIN), or a placeholder (your_key, sk-ant-...). See looksLikeRealSecret.
  const secretAssign = /(api[_-]?key|secret|password|token)\s*[:=]\s*['"]([^'"]{8,})['"]/gi;
  for (const m of text.matchAll(secretAssign)) {
    if (looksLikeRealSecret(m[2])) return { hit: true, pattern: "named-secret" };
  }
  // HARD-FAIL (Cato 4): a user-home path naming a real person — the current user OR anyone
  // else — is PII and blocks the release. Placeholders (<name>, ${USER}) and a small
  // reviewed set of well-known teaching examples are the only exemptions.
  const pathHit = findRealUserPath(text);
  if (pathHit) return { hit: true, pattern: pathHit };
  return { hit: false };
}

// A quoted assignment value is a real secret only if it has key-like entropy and is
// not an obvious placeholder. Kills the false-positive class: env-var-handling snippets,
// var-name flags (OPENAI_API_KEY_OPTIN), and docs (your_key / <key> / sk-ant-...).
const PLACEHOLDER_VALUE = /^(your|my|the|example|test|dummy|fake|placeholder|xxx+|<|\$\{|%|\.\.\.|changeme|redacted|none|null|env\.)/i;

// NAME-INTENT model (Cato re-audit 1b): the assignment already matched a high-risk NAME
// (password/secret/api_key/token). That name signals intent, so we FAIL CLOSED on the value
// unless it is provably a non-secret. We only clear a value that is: a placeholder, a bare
// env-var-NAME reference, or an obvious code fragment. This catches short (12–15 char),
// low-entropy-by-construction, and all-alpha keys that an entropy floor let through —
// while still passing the real false-positive classes (docs placeholders, env-handling code).
function looksLikeRealSecret(value: string): boolean {
  const v = value.trim();
  if (v.length < 8) return false;                   // too short to be a credential of concern
  if (PLACEHOLDER_VALUE.test(v)) return false;      // your_key, <key>, ${X}, %X%, sk-ant-..., env.X
  // A known key prefix with a real body is unambiguously a secret.
  if (/^(sk|pk|xoxb|xoxp|ghp|gho|AKIA|AIza)[-_]?[A-Za-z0-9]{16,}/.test(v)) return true;
  // Code fragment, not a literal value: real secret values never contain code punctuation or
  // newlines. Rejects captures like `")) {\n envContent = ...` WITHOUT rejecting space-
  // separated passphrases (a diceware value has spaces but no code punctuation).
  if (/[)(}{;=]|\r|\n|\/\//.test(v)) return false;
  // A bare ENV_VAR_NAME reference (SCREAMING_SNAKE with an underscore, e.g. OPENAI_API_KEY) is
  // a variable name, not its value.
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(v)) return false;
  // Survived every non-secret filter under a high-risk name ⇒ treat as a secret (fail-closed).
  return true;
}

// Vetted teaching-example / system home-dir segments allowed through the hard user-path gate.
// Cato re-audit 4: common REAL given names (john, jane, admin) were dropped — they collide
// with real people and would launder actual PII. Kept: the upstream author's documented
// example (`daniel`) and non-personal system/CI account names that are never a private
// individual (root, ubuntu, kali, vagrant, ec2-user, runner). Add here only after review.
const REVIEWED_EXAMPLE_NAMES = new Set([
  "daniel", "kali", "ubuntu", "root", "vagrant", "ec2-user", "runner",
]);

const PLACEHOLDER_SEGMENTS = new Set([
  "user", "users", "username", "you", "yourname", "your-name", "name",
  "home", "me", "someone", "example", "test", "foo", "bar",
]);

// Returns a pattern label if the text contains a user-home path whose first segment
// looks like a real account name (not a template placeholder or generic example).
function findRealUserPath(text: string): string | null {
  const matchers: Array<[string, RegExp]> = [
    ["windows-user-path", /[A-Za-z]:[\\/]Users[\\/]([^\\/\r\n\t ]+)/gi],
    ["unc-user-path", /\\\\[^\\/\r\n\t ]+\\Users\\([^\\/\r\n\t ]+)/gi], // \\server\Users\alice
    ["unix-user-path", /\/(?:Users|home)\/([^\/\r\n\t ]+)/gi],
  ];
  for (const [label, re] of matchers) {
    for (const m of text.matchAll(re)) {
      const seg = m[1];
      if (/^[<${%]/.test(seg)) continue; // <name>, ${USER}, %USERNAME%
      const lower = seg.toLowerCase();
      if (PLACEHOLDER_SEGMENTS.has(lower)) continue;
      if (REVIEWED_EXAMPLE_NAMES.has(lower)) continue; // vetted public teaching examples
      return label;
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function displayPath(relPath: string, only?: string): string {
  if (!only) return relPath;
  if (relPath === only) return path.posix.basename(relPath);
  if (relPath.startsWith(`${only}/`)) return relPath.slice(only.length + 1);
  return relPath;
}

function decodeForDiff(relPath: string, buf: Buffer | null): string[] | null {
  if (!buf || isKnownBinary(relPath) || buf.includes(0)) return null;
  try {
    return UTF8.decode(buf).split(/\r?\n/);
  } catch {
    return null;
  }
}

function renderDiff(relPath: string, before: Buffer | null, after: Buffer): string[] {
  const right = decodeForDiff(relPath, after);
  if (!right) return ["  diff: binary content skipped"];
  // Add case: no prior dest bytes, so every line of the new file is added.
  if (!before) {
    const added = right.slice(0, 60).map((line) => `  + ${line}`);
    if (right.length > 60) added.push("  diff: truncated");
    return added.length > 0 ? added : ["  diff: empty file"];
  }
  const left = decodeForDiff(relPath, before);
  if (!left) return ["  diff: binary content skipped"];
  if (left.length + right.length > 400 || left.length * right.length > 20000) return ["  diff: omitted for large file"];
  const dp: number[][] = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      i += 1;
      j += 1;
    } else if (j === right.length || (i < left.length && dp[i + 1][j] >= dp[i][j + 1])) {
      lines.push(`  - ${left[i]}`);
      i += 1;
    } else {
      lines.push(`  + ${right[j]}`);
      j += 1;
    }
    if (lines.length >= 60) {
      lines.push("  diff: truncated");
      break;
    }
  }
  return lines.length > 0 ? lines : ["  diff: no line changes"];
}

function stageEntries(sourceRoot: string, destRoot: string, relPaths: string[]): Entry[] {
  return relPaths.map((relPath) => {
    const srcAbs = path.join(sourceRoot, ...relPath.split("/"));
    const destAbs = path.join(destRoot, ...relPath.split("/"));
    const bytes = readFileSync(srcAbs);
    let action: Action = "add";
    if (existsSync(destAbs)) {
      if (!statSync(destAbs).isFile()) fail(`Destination path is not a file: ${destAbs}`);
      const current = readFileSync(destAbs);
      action = Buffer.compare(current, bytes) === 0 ? "unchanged" : "change";
    } else {
      // No action: missing destination file remains an add.
    }
    return { relPath, srcAbs, destAbs, action, bytes };
  });
}

function collectPruneTargets(destRoot: string, sourceRelPaths: Set<string>, only?: string): string[] {
  return walkAllowlisted(destRoot, only).filter((relPath) => !sourceRelPaths.has(relPath));
}

function runSelfTest(): number {
  const seeded = Buffer.from("C:\\Users\\AlexTabisz\\secret", "utf8");
  const runtime = Buffer.from(`user=${USERNAME}`, "utf8");
  const seededHit = scanBytes("self-test.txt", seeded).hit;
  const runtimeHit = scanBytes("runtime-user.txt", runtime).hit;
  if (seededHit && runtimeHit) {
    console.log("PASS");
    return 0;
  }
  console.error("FAIL");
  return 1;
}

function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (args.selfTest) return runSelfTest();

  console.error("WARN: SOURCE is the live/uncommitted working tree and may contain half-edited code.");
  const sourceRoot = process.env.PAI_DIR ? path.resolve(process.env.PAI_DIR) : path.join(os.homedir(), ".claude");
  const repoRoot = resolveRepoRoot();
  const destRoot = resolveDestRoot(repoRoot, args.release);
  assertDestSafe(repoRoot, sourceRoot, destRoot, args.prune);
  const sourceCandidates = walkAllowlisted(sourceRoot, args.only);
  const ignored = filterGitIgnored(sourceRoot, sourceCandidates);
  const relPaths = sourceCandidates.filter((relPath) => !ignored.has(relPath));
  const entries = stageEntries(sourceRoot, destRoot, relPaths);

  for (const entry of entries) {
    try {
      const scan = scanBytes(entry.relPath, entry.bytes);
      if (scan.hit) {
        console.error(`SCAN-FAIL ${entry.relPath} pattern=${scan.pattern}`);
        return 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "scan-error";
      console.error(`SCAN-FAIL ${entry.relPath} pattern=${message}`);
      return 1;
    }
  }

  const pruneTargets = args.prune ? collectPruneTargets(destRoot, new Set(relPaths), args.only) : [];
  console.log(args.apply ? "APPLY (writing files)" : "DRY-RUN (no files written) — pass --apply to write");
  let adds = 0;
  let changes = 0;
  let unchanged = 0;
  for (const entry of entries) {
    if (entry.action === "add") adds += 1;
    else if (entry.action === "change") changes += 1;
    else unchanged += 1;
    if (entry.action === "unchanged") continue;
    console.log(`${entry.action}: ${displayPath(entry.relPath, args.only)}`);
    const before = existsSync(entry.destAbs) && statSync(entry.destAbs).isFile() ? readFileSync(entry.destAbs) : null;
    for (const line of renderDiff(entry.relPath, before, entry.bytes)) console.log(line);
  }
  if (args.prune) {
    for (const relPath of pruneTargets) console.log(`delete: ${displayPath(relPath, args.only)}`);
  } else {
    // No action: deletion is intentionally disabled unless --prune is supplied.
  }
  console.log(`summary add=${adds} change=${changes} unchanged=${unchanged}${args.prune ? ` delete=${pruneTargets.length}` : ""}`);

  if (!args.apply) return 0;
  for (const entry of entries) {
    if (entry.action === "unchanged") continue;
    mkdirSync(path.dirname(entry.destAbs), { recursive: true });
    // Write-path containment (Cato re-audit 5b): the resolved parent dir must stay under the
    // validated destRoot, so a junction under .claude can't redirect a write outside the tree.
    if (escapesRoot(path.dirname(entry.destAbs), destRoot)) {
      console.error(`SKIP write (escapes dest): ${entry.relPath}`);
      continue;
    }
    writeFileSync(entry.destAbs, entry.bytes);
  }
  if (args.prune) {
    for (const relPath of pruneTargets) {
      const target = path.join(destRoot, ...relPath.split("/"));
      if (escapesRoot(path.dirname(target), destRoot)) { // never unlink through a junction
        console.error(`SKIP prune (escapes dest): ${relPath}`);
        continue;
      }
      unlinkSync(target);
    }
  } else {
    // No action: prune writes are intentionally skipped.
  }
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
