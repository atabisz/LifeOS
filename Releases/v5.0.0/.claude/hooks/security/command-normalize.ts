/**
 * command-normalize — shared command normalization for security inspectors.
 *
 * Strips leading environment-variable scaffolding so that pattern matching sees
 * the real command. Two bypass forms are handled:
 *   1. Assignment prefix:  FOO=bar BAZ="x y" rm -rf /   → rm -rf /
 *   2. `env` binary form:  env FOO=bar rm -rf /          → rm -rf /
 *                          /usr/bin/env -i FOO=1 rm ...  → rm ...
 *
 * Without this, an anchored blocked pattern like `^rm\s+-rf` is trivially
 * evaded by prefixing a no-op assignment or the `env` launcher. Discovered via
 * PAIUpgrade report #3; the assignment form was already handled inline in
 * PatternInspector, the `env`-binary form was the residual gap.
 *
 * SAFETY: the `env`-binary strip uses a lookahead requiring a real command to
 * follow, so a bare `env` / `printenv` (a credential-dump that SHOULD alert) is
 * never stripped away. Fixed-point loop handles `env FOO=bar cmd` (needs two
 * passes: strip `env`, then the assignment).
 */

const ASSIGNMENT_PREFIX = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]*)\s+)+/;
// `env` (optionally path-qualified) + only dash-flags, optionally terminated by
// the `--` end-of-options marker, when a real command token follows.
//
// IMPORTANT: this deliberately does NOT consume a flag's *argument* (e.g. the
// NAME in `-u NAME`). The previous form `(?:\s+-\S+(?:\s+[A-Za-z_]\w*)?)*` tried
// to, and could swallow the command itself — `env -- rm -rf /` stripped down to
// just `/`, which then evaded the recursive-delete block (Forge audit HIGH-1).
// Leaving a flag's argument token behind is harmless: it can't help an attacker
// reach a `rm`/`curl` pattern (those are substring-matched), and an outbound
// tool after it is still exposed to EgressInspector.
// `env -S "<cmd>"` string-splitting is intentionally out of scope (not stripped).
const ENV_BINARY_PREFIX = /^\s*(?:\S*\/)?env\b(?:\s+--?[A-Za-z][\w-]*)*(?:\s+--)?\s+(?=[A-Za-z_./])/;

// Git global options that sit BETWEEN `git` and the subcommand, e.g.
// `git -C /repo clean -fd` or `git -c k=v --git-dir=/r/.git reset --hard`.
// Without hoisting these away, an anchored pattern like `git\s+clean` is
// trivially evaded by inserting `-C <dir>` before the subcommand — the same
// scaffolding-hides-the-command bypass class as the env prefix. Discovered via
// Cato cross-vendor audit; it also defeated the pre-existing `git reset --hard`
// (alert) and `git filter-repo` (BLOCKED) patterns, so this single
// normalization repairs every git pattern at once.
//
// APPROACH (grammar-based, NOT an option allowlist — that was bypassable):
// git's grammar is `git [global-options] <subcommand> [args]`, and every global
// option starts with `-`. So the subcommand is the FIRST token that does not
// start with `-`. We strip the leading `git` + every run of dash-prefixed
// tokens until that first non-dash token, which is the subcommand. This is
// allowlist-free, so unlisted options (`--config-env`, `--super-prefix`,
// `--attr-source`, …) cannot bypass it.
//
// CRITICAL — never consume the subcommand as an option's argument. The earlier
// allowlist form did `(-C|-c)(\s+\S+)` and ate `reset` in `git -C reset --hard`
// → `git --hard`, manufacturing a benign-looking command (the same `env -- rm`
// over-strip class). This form only ever consumes tokens that THEMSELVES start
// with `-`, plus the attached-arg part of an option (`-C/path`, `--git-dir=x`,
// `-c k=v`). A space-separated arg that does not start with `-` is left in
// place: worst case the subcommand pattern still sees `git <arg> <subcommand>`,
// which fails safe (no destructive pattern matches a stray path token, and the
// real subcommand remains visible to substring-matched patterns).
//
// `-c key=val` / `-C <dir>`: the value either is attached (`-c k=v`, `-C/p`) and
// consumed with the token, or is a separate token. For `-c k=v` the value `k=v`
// contains `=` (never a bare subcommand); for `-C <dir>` a space-separated dir
// like `/repo` does not start with `-`, so we deliberately do NOT consume it —
// it is left as `git /repo clean -fd`, and `git\s+clean` still matches via the
// non-anchored substring search. Failing to strip a path is safe; eating the
// subcommand is not.
// Git global options that take a separate-token argument. When hoisting we must
// consume the option AND its arg so the arg can't be misread as the subcommand —
// but NEVER consume an arg that is itself a known git subcommand (fail-safe
// against the `git -C reset --hard` over-strip class: if someone's arg literally
// looks like a destructive subcommand, leave it so the pattern still fires).
const GIT_ARG_TAKING_OPTS = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace',
  '--super-prefix', '--config-env', '--attr-source', '--exec-path',
]);
// Destructive git subcommands we must never strip away as an option's argument.
const GIT_DESTRUCTIVE_SUBCOMMANDS = new Set([
  'clean', 'reset', 'checkout', 'restore', 'stash', 'commit',
  'push', 'rebase', 'filter-repo', 'filter-branch', 'rm', 'gc',
]);

/**
 * Strip leading env-var scaffolding (assignments and the `env` launcher), hoist
 * away git global options, AND remove shell quoting/escaping so pattern matching
 * sees the command as the shell would execute it. Idempotent and
 * order-independent via a fixed-point loop.
 *
 * Order within the loop: prefix/git strips run on the still-quoted text (they
 * rely on quotes to bound assignment values like `FOO="x y"`), then
 * `stripShellQuoting` removes the quote/escape characters last so the residual
 * is the executed token text the patterns expect.
 */
export function stripEnvVarPrefix(command: string): string {
  let prev: string;
  let cur = command;
  do {
    prev = cur;
    cur = cur.replace(ASSIGNMENT_PREFIX, '');
    cur = cur.replace(ENV_BINARY_PREFIX, '');
    cur = hoistGitGlobalOptions(cur);
  } while (cur !== prev);
  return cur;
}

/**
 * Command-position views of a Bash command, for dual-clause pattern matching
 * that closes shell-quote/escape evasion WITHOUT fabricating false matches on
 * quoted argument data (e.g. `git commit -m "… rm -rf / …"`).
 *
 * Returns:
 *   - `normalized`: env/git-stripped but NOT dequoted — the historical view.
 *     Patterns matched against this preserve ALL prior behavior exactly (paths
 *     like `/proc/…`, pipe-to-shell, credential strings — all still match
 *     anywhere). This clause can only KEEP existing matches, never lose them.
 *   - `segments`: the command fully dequoted (quotes/escapes removed) and split
 *     into simple-command pieces at top-level operators (`;`, `|`, `&`, `&&`,
 *     `||`, newline, subshell parens). A command-invocation pattern is matched
 *     ANCHORED at a segment start, so a quote-evaded command (`"rm" -rf /` →
 *     `rm -rf /`) is caught because `rm` lands in command position — while a
 *     destructive string sitting INSIDE an argument (`echo rm -rf /`, `grep
 *     "rm -rf /"`) is NOT, because the segment's command word is `echo`/`grep`.
 *
 * The matcher denies/alerts if EITHER the normalized view matches anywhere OR a
 * segment matches anchored. OR-of-clauses means evasion coverage is purely
 * additive over the historical behavior.
 */
export function commandPositionViews(command: string): { normalized: string; segments: string[] } {
  const normalized = stripEnvVarPrefix(command);
  // Segment on UNQUOTED operators first, THEN dequote each piece. Splitting
  // after a global dequote (the previous approach) was wrong: an operator that
  // lived INSIDE quotes (`echo "a; rm -rf /"`) is inert DATA, but dequoting
  // first turned it into a false split point and fabricated a `rm -rf /`
  // segment → false deny. By splitting on operators that are unquoted in the
  // ORIGINAL command, quoted operators stay inside their segment as data.
  const rawSegments = splitOnUnquotedOperators(command);
  const segments: string[] = [];
  for (const raw of rawSegments) {
    // Dequote the segment, strip env/git scaffolding, then peel leading shell
    // syntax that sits before the command word so the anchor lands on the verb:
    // a `{`/`(` group opener, a shell keyword (then/do/else/elif), or a benign
    // wrapper (time/command/nice/builtin/exec). NOTE: `eval`/`sh -c`/`bash -c`
    // string-argument unwrapping is deliberately NOT done — that requires
    // parsing an arbitrary string as a nested command (a shell). Those remain a
    // documented residual (pre-existing; they bypass the committed patterns too).
    let seg = stripEnvVarPrefix(stripShellQuoting(raw)).trim();
    let prev = '';
    while (seg !== prev) {
      prev = seg;
      seg = seg.replace(/^[{(]\s*/, '');
      seg = seg.replace(/^(?:then|do|else|elif|if|while|until|fi|done)\s+/i, '');
      seg = seg.replace(/^(?:time|command|builtin|exec|nice(?:\s+-n\s+\d+)?)\s+/i, '');
    }
    if (seg) segments.push(seg);
  }
  return { normalized, segments };
}

/**
 * Split a command into simple-command pieces at TOP-LEVEL (unquoted, non-escaped)
 * shell operators `;` `|` `&` `&&` `||` newline and group parens/braces, while
 * leaving operators that appear inside single/double quotes intact (they are
 * data, not syntax). Returns the raw (still-quoted) pieces; the caller dequotes
 * each. A char scanner tracks quote state so `echo "a; b"` stays one piece.
 *
 * Bounded at MAX_SEGMENTS pieces: a pathological deeply-nested `$( … )` produces
 * O(n) boundaries (the scanner has no `$(`-awareness), so cap the work. Hitting
 * the cap can only REDUCE Clause-2 coverage for that one command; Clause 1
 * (anywhere-match on the full normalized string) is unaffected, so a destructive
 * command can't gain evasion by blowing past the cap — it just stops adding
 * segments. Fail-safe and DoS-bounded.
 */
const MAX_SEGMENTS = 256;
function splitOnUnquotedOperators(command: string): string[] {
  const pieces: string[] = [];
  let buf = '';
  let i = 0;
  const n = command.length;
  let quote: '"' | "'" | null = null;
  while (i < n) {
    if (pieces.length >= MAX_SEGMENTS) break;
    const ch = command[i];
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < n) { buf += command[i + 1]; i += 2; continue; }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; i++; continue; }
    if (ch === '\\' && i + 1 < n) { buf += ch + command[i + 1]; i += 2; continue; }
    // Unquoted operator → boundary.
    if (ch === ';' || ch === '\n' || ch === '|' || ch === '&' || ch === '(' || ch === ')' || ch === '{' || ch === '}') {
      if (buf.trim()) pieces.push(buf);
      buf = '';
      i++;
      // consume a doubled && / ||
      if ((ch === '&' || ch === '|') && command[i] === ch) i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) pieces.push(buf);
  return pieces;
}

/**
 * Remove shell quoting/escaping that the shell would strip before executing, so
 * a word spelled `r"m"`, `"rm"`, `'rm'`, or `r\m` collapses to the literal
 * `rm` the patterns match. Consumed by both inspectors' dequote paths:
 * PatternInspector via `commandPositionViews` (per-segment, command-position),
 * EgressInspector via a direct `stripShellQuoting` call (anywhere, by its egress
 * threat model). It is NOT folded into `stripEnvVarPrefix` — the prefix/git
 * strips need quotes intact to bound assignment values like `FOO="x y"`.
 *
 * SCOPE (deliberately NOT a shell parser — see ISA shell-dequote-normalization):
 *   - "…"  double quotes: removed; contents kept literally EXCEPT a `$(`, backtick,
 *     or `${`/`$word` inside is left with its `$`/substitution intact (we do not
 *     evaluate expansions). Inside double quotes only `\"`, `\\`, `` \` ``, `\$`
 *     are escapes; other backslashes are literal (bash rule).
 *   - '…'  single quotes: removed; contents 100% literal (no escapes inside).
 *   - \x   backslash escape (outside quotes): the backslash is removed, x becomes
 *     literal. `\<newline>` line-continuation collapses to nothing.
 *   - $'…' / $"…" : the OPENING `$` makes these special (ANSI-C / locale). We do
 *     NOT decode them — left verbatim — so we never mis-decode an escape we don't
 *     fully model. (Conservative: leaving them means the pattern still sees the
 *     word if it's literal, and we never fabricate/erase via a wrong decode.)
 *   - $(…), `…`, $VAR, ${…} : NEVER touched (expansion/substitution out of scope).
 *
 * FAIL-SAFE: operators and spacing outside quotes are preserved (so `&&`, `|`,
 * `;`, redirections survive). An unterminated quote is treated as quoting to
 * end-of-string (bash would error, but we must not erase the command — we keep
 * the remaining chars literally). The function never returns empty for a
 * non-empty input unless the input was only quote characters.
 */
export function stripShellQuoting(command: string): string {
  let out = '';
  let i = 0;
  const n = command.length;
  while (i < n) {
    const ch = command[i];

    // Preserve $-forms we don't decode: $'…', $"…", $(…), ${…}, $VAR.
    // Copy the `$` and the following sigil verbatim and let the normal scanner
    // resume AFTER it, so the inner quote of $'…'/$"…" is not treated as a
    // plain quote to strip.
    if (ch === '$' && i + 1 < n) {
      const next = command[i + 1];
      if (next === "'" || next === '"') {
        // $'…' or $"…": copy `$` + the quote, then copy literally until the
        // matching close quote (kept verbatim — not decoded).
        out += ch + next;
        i += 2;
        while (i < n && command[i] !== next) { out += command[i]; i++; }
        if (i < n) { out += command[i]; i++; } // closing quote (if present)
        continue;
      }
      if (next === '(' || next === '{') {
        // $(…) / ${…}: copy `$` and let the scanner copy the rest verbatim;
        // quotes inside a substitution are out of scope, but to stay simple and
        // safe we just copy the `$` and continue (the `(`/`{` is copied next).
        out += ch;
        i++;
        continue;
      }
      // $VAR — copy `$`, continue (the var name chars are copied as normal).
      out += ch;
      i++;
      continue;
    }

    // Backtick command substitution: out of scope, copy verbatim through the
    // closing backtick so an inner quote isn't mistaken for a plain quote.
    if (ch === '`') {
      out += ch;
      i++;
      while (i < n && command[i] !== '`') { out += command[i]; i++; }
      if (i < n) { out += command[i]; i++; }
      continue;
    }

    // Single quotes: everything literal until the next single quote; the quote
    // chars themselves are dropped.
    if (ch === "'") {
      i++; // skip opening '
      while (i < n && command[i] !== "'") { out += command[i]; i++; }
      if (i < n) i++; // skip closing ' (if present; if absent, EOF — fail-safe)
      continue;
    }

    // Double quotes: drop the quote chars; inside, only \" \\ \` \$ are escapes
    // (the backslash is removed, the next char kept); other chars literal,
    // including a `$` which we leave so an inner expansion stays intact.
    if (ch === '"') {
      i++; // skip opening "
      while (i < n && command[i] !== '"') {
        if (command[i] === '\\' && i + 1 < n && '"\\`$'.includes(command[i + 1])) {
          out += command[i + 1];
          i += 2;
        } else {
          out += command[i];
          i++;
        }
      }
      if (i < n) i++; // skip closing " (if present)
      continue;
    }

    // Backslash escape outside quotes: drop the backslash, keep the next char
    // literally. A trailing backslash (line continuation / dangling) is dropped.
    if (ch === '\\') {
      if (i + 1 < n) { out += command[i + 1]; i += 2; }
      else { i++; } // dangling backslash — drop it
      continue;
    }

    // Ordinary char (operators, spaces, word chars) — copy verbatim.
    out += ch;
    i++;
  }
  return out;
}

/**
 * If the command is `git <global-options...> <subcommand> ...`, rewrite it to
 * `git <subcommand> ...` so anchored `git\s+<verb>` patterns match. Uses git's
 * real grammar — every global option starts with `-`, the subcommand is the
 * first token that doesn't — so it is allowlist-FREE for the bypass class:
 * any unknown dash-option (`--config-env`, `--super-prefix`, attached `-C/path`,
 * …) is consumed because it starts with `-`.
 *
 * Two careful cases:
 *   - An attached arg (`--git-dir=x`, `-C/path`) lives in the same token, so the
 *     plain dash-token rule consumes it.
 *   - A separate-token arg (`-C /repo`, `-c k=v`) must be consumed WITH the
 *     option, else the path/value would be read as the subcommand. We consume it
 *     ONLY for known arg-taking options, and NEVER when that arg is itself a
 *     destructive subcommand (guards the `git -C reset --hard` over-strip class:
 *     we leave `reset` so its pattern still fires — fail safe over fail open).
 *
 * Returns the command unchanged if it isn't a git invocation or has no leading
 * options.
 */
function hoistGitGlobalOptions(command: string): string {
  const lead = command.match(/^(\s*)git(\b.*)?$/s);
  if (!lead || lead[2] === undefined) return command;
  // Tokenize the part after `git`, keeping quoted spans intact.
  const after = lead[2];
  const tokens = after.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  let i = 0;
  let consumedAny = false;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (!tok.startsWith('-')) break; // first non-dash token = subcommand → stop
    // Bare arg-taking option with a separate-token arg.
    if (GIT_ARG_TAKING_OPTS.has(tok) && i + 1 < tokens.length) {
      // Strip surrounding quotes before the destructive-subcommand check — the
      // tokenizer preserves quotes, so `-C "reset"` arrives as the literal token
      // `"reset"`. Without unquoting, the guard misses and the quoted subcommand
      // gets swallowed (`git -C "reset" --hard` → `git`), re-opening the F1
      // over-strip class through quoting. Caught by Cato execution, round 2.
      const arg = tokens[i + 1].replace(/^(["'])(.*)\1$/, '$2');
      // Fail-safe: do NOT swallow an arg that is itself a destructive subcommand.
      // Drop the option but KEEP the subcommand — and write it back UNQUOTED so
      // the anchored `git\s+<verb>` pattern matches (a surviving `"reset"` token
      // would slip past `git\s+reset`). Caught by Cato execution, round 2.
      if (GIT_DESTRUCTIVE_SUBCOMMANDS.has(arg)) { tokens[i + 1] = arg; i += 1; consumedAny = true; continue; }
      i += 2; consumedAny = true; continue;
    }
    i += 1; consumedAny = true; // attached-arg or boolean option → consume self
  }
  if (!consumedAny) return command;
  const remaining = tokens.slice(i).join(' ');
  return lead[1] + 'git' + (remaining ? ' ' + remaining : '');
}

// Bash's built-in pseudo-device network primitive. `> /dev/tcp/HOST/PORT` (or
// /dev/udp/) opens a raw socket WITHOUT curl/wget/nc, so the outbound-tool
// regexes in EgressInspector never see it. Discovered via PAIUpgrade report #8
// (Thread 0b gap).
//
// Anchored to a redirection operator (`>`, `>>`, `<`, `<>`, with an optional
// leading fd number like `3<>`), because that's the ONLY way bash actually
// opens the socket. Matching the bare substring anywhere produced false
// positives on URLs/paths like `curl https://x/dev/tcp/host/443` (Forge MEDIUM-2).
const RAW_SOCKET_EGRESS = /(?:\d*\s*(?:>>?|<>?|<)\s*)\/dev\/(?:tcp|udp)\/[^/\s]+\/\d+/i;

/**
 * True if the command opens a raw TCP/UDP socket via bash's /dev/tcp//dev/udp
 * pseudo-device — a credential-exfiltration channel that bypasses the
 * outbound-tool (curl/wget/nc) detectors entirely.
 */
export function hasRawSocketEgress(command: string): boolean {
  return RAW_SOCKET_EGRESS.test(command);
}
