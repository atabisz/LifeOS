#!/usr/bin/env bun
/**
 * SymbolCensus.ts — Read-only census of a TS/JS symbol's occurrences by KIND.
 *
 * A grep name-count of "0 external importers" is NOT proof a symbol is dead: it
 * can still be live via union-type membership, internal references, or test-only
 * usage. This tool finds every candidate occurrence of a symbol (via ripgrep with
 * word-boundary matching) and classifies WHERE/HOW it appears — declaration,
 * import-export, type-position, value-position, test-file, comment-string — so a
 * human or the PAI Algorithm can decide if deletion is safe. It NEVER mutates any
 * file. It complements ReferenceCheck.ts (which validates path-references, not
 * symbol usage) rather than duplicating it.
 *
 * Usage:
 *   bun SymbolCensus.ts <symbol> [root]   # census; root defaults to cwd
 *   bun SymbolCensus.ts <symbol> --json   # structured JSON output
 *   bun SymbolCensus.ts <symbol> --quiet  # verdict line + issues only
 *   bun SymbolCensus.ts --help            # usage
 *
 * Exit codes:
 *   0 — successful census (any verdict — the verdict is data, not a failure)
 *   2 — operational error (rg missing, root unreadable, missing symbol arg)
 */

import { spawnSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { relative, resolve, sep } from 'path';

// ── Types ──

type Kind =
  | 'declaration'
  | 'import-export'
  | 'type-position'
  | 'value-position'
  | 'test-file'
  | 'comment-string';

const ALL_KINDS: Kind[] = [
  'declaration',
  'import-export',
  'type-position',
  'value-position',
  'test-file',
  'comment-string',
];

type Verdict = 'LIKELY-SAFE-TO-REMOVE' | 'LIVE' | 'REVIEW';

interface Occurrence {
  file: string; // relative to resolved root
  absFile: string;
  line: number;
  kind: Kind;
  text: string; // trimmed line
}

interface Census {
  symbol: string;
  root: string;
  total: number;
  byKind: Record<Kind, number>;
  verdict: Verdict;
  rationale: string;
  occurrences: Array<Pick<Occurrence, 'file' | 'line' | 'kind' | 'text'>>;
}

// ── Arg parsing (manual, zero deps) ──

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`SymbolCensus — classify a TS/JS symbol's occurrences by kind (read-only)

Usage:
  bun SymbolCensus.ts <symbol> [root] [flags]            single-symbol census
  bun SymbolCensus.ts --symbols <a,b,c> [root] [flags]   batch census (whole-module prune)

Arguments:
  <symbol>           The identifier to census (single mode; required)
  --symbols <a,b,c>  Comma-separated identifiers (batch mode; emits a keep/cut table)
  [root]             Directory to scan (default: current working directory)

Flags:
  --json       Structured JSON output (parseable by JSON.parse). Batch mode emits
               { root, symbols, bySymbol: { <symbol>: Census } }.
  --quiet      Single: verdict line only. Batch: keep/cut table + summary, no detail.
  --help, -h   This message

Batch mode runs the SAME classifier and verdict per symbol as single mode, so a
symbol's verdict is identical either way. It is read-only and fails safe — any
verdict other than LIKELY-SAFE-TO-REMOVE means keep the symbol.

Kinds:
  declaration    line declares the symbol (function/class/interface/type/enum/const/let/var)
  import-export   import binding or re-export of the symbol
  type-position   used in a type context (annotation, generics, extends, union, as)
  value-position  runtime use (call, new, member, index, argument, assignment)
  test-file       occurrence in a *.test/*.spec file or __tests__/ dir (by path)
  comment-string  occurrence inside a comment or string/template literal

Verdicts:
  LIVE                    any value/type-position use outside the declaration file
  LIKELY-SAFE-TO-REMOVE   only the declaration (or zero occurrences) remain
  REVIEW                  anything in between (test-only, same-file, ambiguous)

Exit codes: 0 successful census (any verdict), 2 operational error`);
  process.exit(0);
}

const jsonOutput = args.includes('--json');
const quiet = args.includes('--quiet');

function fail(message: string): never {
  console.error(`SymbolCensus: ${message}`);
  process.exit(2);
}

// Read the value of `--symbols <a,b,c>` if present (batch mode). The flag takes a
// single comma-separated value; whitespace is tolerated.
function readSymbolsFlag(): string[] | undefined {
  const idx = args.indexOf('--symbols');
  if (idx === -1) return undefined;
  const val = args[idx + 1];
  if (!val || val.startsWith('-')) {
    fail('--symbols requires a comma-separated list, e.g. --symbols Foo,Bar,Baz');
  }
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

const symbolsFlag = readSymbolsFlag();
const batchMode = symbolsFlag !== undefined;

// Positionals are non-flag args, EXCLUDING the value consumed by --symbols.
// Single mode: [symbol, root?]. Batch mode (--symbols): [root?] only — the
// symbols come from the flag, so positional parsing for single mode is unchanged.
const symbolsFlagIdx = args.indexOf('--symbols');
const positionals = args.filter((a, i) => {
  if (a.startsWith('-')) return false;
  if (symbolsFlagIdx !== -1 && i === symbolsFlagIdx + 1) return false; // the --symbols value
  return true;
});

const SYMBOL_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

let symbols: string[];
let rootArg: string | undefined;

if (batchMode) {
  symbols = symbolsFlag!;
  rootArg = positionals[0];
  if (symbols.length === 0) {
    fail('--symbols was empty after parsing. Provide a comma-separated list, e.g. --symbols Foo,Bar.');
  }
} else {
  const symbol = positionals[0];
  rootArg = positionals[1];
  if (!symbol) {
    fail('missing required <symbol> argument. Run with --help for usage.');
  }
  symbols = [symbol];
}

// Validate every symbol is a plausible JS/TS identifier — guards rg regex and
// prevents accidental flag-as-symbol confusion. A bad identifier in a batch list
// fails safe (clear error, exit 2) rather than being silently dropped.
for (const s of symbols) {
  if (!SYMBOL_RE.test(s)) {
    fail(`"${s}" is not a valid identifier — census expects ${batchMode ? 'a comma-separated list of symbol names' : 'a single symbol name'}.`);
  }
}

const root = resolve(rootArg || process.cwd());

if (!existsSync(root)) {
  fail(`root does not exist: ${root}`);
}
try {
  if (!statSync(root).isDirectory()) {
    fail(`root is not a directory: ${root}`);
  }
} catch (e: any) {
  fail(`root is unreadable: ${root} (${e?.message || e})`);
}

// ── ripgrep invocation (per-symbol) ──

interface RgMatchData {
  path: { text?: string };
  line_number: number;
  lines: { text?: string };
  submatches: Array<{ start: number; end: number }>;
}

interface RawMatch {
  absFile: string;
  line: number;
  lineText: string;
  /** Column (0-based byte offset into lineText) of the first submatch start. */
  matchCol: number;
}

// Run ripgrep for ONE symbol under `searchRoot` and return its raw matches.
// Word-boundary match, JSON line output, restricted to JS/TS family files. Args
// passed as an array (no shell) to avoid injection and Windows quoting issues;
// the identifier was validated as regex-safe by the caller. Operational errors
// (rg missing, root unreadable) call fail() and exit 2 — shared by single and
// batch modes so the fail-safe contract is identical.
function ripgrepMatches(sym: string, searchRoot: string): RawMatch[] {
  const rgArgs = [
    '--json',
    '--word-regexp',
    '--type-add',
    'jsts:*.{ts,tsx,js,jsx,mts,cts}',
    '--type',
    'jsts',
    '--',
    sym,
    searchRoot,
  ];

  const rg = spawnSync('rg', rgArgs, {
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });

  if (rg.error) {
    // ENOENT => rg not installed / not on PATH.
    if ((rg.error as NodeJS.ErrnoException).code === 'ENOENT') {
      fail('ripgrep (rg) was not found on PATH. Install ripgrep to run a census.');
    }
    fail(`failed to launch ripgrep: ${rg.error.message}`);
  }

  // rg exit semantics: 0 = matches found, 1 = no matches (NOT an error — a valid
  // census with zero occurrences), >=2 = operational error.
  if (typeof rg.status === 'number' && rg.status >= 2) {
    const stderr = (rg.stderr || '').trim();
    fail(`ripgrep failed (exit ${rg.status})${stderr ? `: ${stderr}` : ''}`);
  }

  const matches: RawMatch[] = [];
  for (const rawLine of (rg.stdout || '').split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    let evt: any;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      // Tolerate a malformed/partial line rather than crashing the census.
      continue;
    }
    if (!evt || evt.type !== 'match' || !evt.data) continue;
    const data = evt.data as RgMatchData;
    const absFile = data.path?.text;
    const lineText = data.lines?.text;
    if (typeof absFile !== 'string' || typeof lineText !== 'string') continue;
    const sub = Array.isArray(data.submatches) ? data.submatches[0] : undefined;
    matches.push({
      absFile,
      line: data.line_number,
      lineText: lineText.replace(/\r?\n$/, ''),
      matchCol: sub ? sub.start : lineText.indexOf(sym),
    });
  }
  return matches;
}

// ── Classification ──
//
// rg gives us only the matching line, not the surrounding file, so comment
// detection is line-local: `//` line comments, same-line `/* ... */` blocks, and
// string/template enclosure. Cross-line block comments opened on an earlier
// non-matching line are out of scope by design — this is the documented
// best-effort contract, and it never under-reports liveness.

const TEST_FILE_RE = /(\.test\.(ts|tsx|js|jsx|mts|cts)$|\.spec\.(ts|tsx|js|jsx|mts|cts)$)/;

function isTestFile(absFile: string): boolean {
  const norm = absFile.split(sep).join('/');
  if (TEST_FILE_RE.test(norm)) return true;
  if (/(^|\/)__tests__\//.test(norm)) return true;
  return false;
}

// Is the matched symbol occurrence inside a comment or string on this line?
// Best-effort, line-local:
//  - matched column lies at/after a `//` line comment, OR
//  - the match sits inside a same-line `/* ... */` block, OR
//  - the symbol token on this line is wrapped in quotes or backticks.
function isCommentOrString(lineText: string, matchCol: number): boolean {
  // Line comment: find a // that is not inside a string. Cheap heuristic — if a
  // // appears before the match column, treat the match as commented.
  const lineCommentIdx = findLineCommentStart(lineText);
  if (lineCommentIdx !== -1 && matchCol >= lineCommentIdx) return true;

  // Same-line block comment that encloses the match: `/* ... SYMBOL ... */`.
  const blockOpen = lineText.indexOf('/*');
  if (blockOpen !== -1 && matchCol > blockOpen) {
    const blockClose = lineText.indexOf('*/', blockOpen + 2);
    if (blockClose === -1 || matchCol < blockClose) return true;
  }

  // String/template wrap: the symbol token appears immediately inside quotes
  // or backticks. Scan each occurrence of the symbol and check enclosure.
  if (isInsideQuotes(lineText, matchCol)) return true;

  return false;
}

// Find the start index of a `//` line comment, skipping `//` that sit inside a
// string literal. Returns -1 if none.
function findLineCommentStart(line: string): number {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i];
    const prev = i > 0 ? line[i - 1] : '';
    if (prev === '\\') continue; // escaped char
    if (c === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    else if (c === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    else if (c === '`' && !inSingle && !inDouble) inBacktick = !inBacktick;
    else if (c === '/' && line[i + 1] === '/' && !inSingle && !inDouble && !inBacktick) {
      return i;
    }
  }
  return -1;
}

// Determine whether the byte offset `col` falls inside an open string/template
// literal on this line. Best-effort, single-line.
function isInsideQuotes(line: string, col: number): boolean {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (let i = 0; i < col && i < line.length; i++) {
    const c = line[i];
    const prev = i > 0 ? line[i - 1] : '';
    if (prev === '\\') continue;
    if (c === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    else if (c === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    else if (c === '`' && !inSingle && !inDouble) inBacktick = !inBacktick;
  }
  return inSingle || inDouble || inBacktick;
}

function isDeclaration(line: string, sym: string): boolean {
  const esc = escapeRegExp(sym);
  // function/class/interface/type/enum/const/let/var SYMBOL
  const declKeyword = new RegExp(
    `(?:^|[^\\w$])(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\*?|class|interface|type|enum|const|let|var)\\s+${esc}\\b`
  );
  if (declKeyword.test(line)) return true;
  return false;
}

function isImportExport(line: string): boolean {
  // The matched line uses an import/export keyword (binding or re-export). The
  // symbol presence is already guaranteed by rg's word-boundary match, so this
  // only confirms the import/export context. Declarations like
  // `export const Foo = ...` are caught earlier by isDeclaration; this branch is
  // for pure binding lines like `import { Foo } from '...'` or `export { Foo }`.
  return /\b(import|export)\b/.test(line);
}

// A `type X = ...` alias declaration line. Everything on the RHS is type context,
// so a symbol appearing there (e.g. the first union member `type S = Foo | string`)
// is type-position even though `= Foo` looks like a value assignment.
function isTypeAliasLine(line: string): boolean {
  return /^\s*(?:export\s+)?(?:default\s+)?type\s+\w+(?:<[^=]*>)?\s*=/.test(line);
}

function isTypePosition(line: string, sym: string): boolean {
  const esc = escapeRegExp(sym);
  // RHS of a `type X = ...` alias is type context. Guard against this BEING the
  // declaration of the symbol itself (`type Foo = ...`), which is a declaration.
  if (isTypeAliasLine(line) && !new RegExp(`\\btype\\s+${esc}\\b`).test(line)) return true;
  // Array type: `Foo[]` (possibly nested `Foo[][]`). Unambiguously a type — must
  // be checked before value-position so `RefHit[]` is not mistaken for indexing.
  if (new RegExp(`\\b${esc}(?:\\[\\])+`).test(line)) return true;
  // Union / intersection membership: `| Foo`, `& Foo`, or `Foo |`, `Foo &`
  if (new RegExp(`[|&]\\s*${esc}\\b`).test(line)) return true;
  if (new RegExp(`\\b${esc}\\s*[|&]`).test(line)) return true;
  // extends / implements
  if (new RegExp(`\\b(?:extends|implements)\\s+(?:[\\w$.,\\s]*\\b)?${esc}\\b`).test(line)) return true;
  // `as Foo`
  if (new RegExp(`\\bas\\s+${esc}\\b`).test(line)) return true;
  // Generic argument: `<Foo>`, `<Foo,`, `, Foo>`, `<...Foo...>`
  if (new RegExp(`<[^<>]*\\b${esc}\\b[^<>]*>`).test(line)) return true;
  // Type annotation `: Foo` (function return / variable / parameter type). The
  // symbol must sit right after a colon to count, avoiding object-literal keys.
  if (new RegExp(`:\\s*${esc}\\b`).test(line)) return true;
  return false;
}

function isValuePosition(line: string, sym: string): boolean {
  const esc = escapeRegExp(sym);
  // SYMBOL( call
  if (new RegExp(`\\b${esc}\\s*\\(`).test(line)) return true;
  // new SYMBOL
  if (new RegExp(`\\bnew\\s+${esc}\\b`).test(line)) return true;
  // SYMBOL. member access
  if (new RegExp(`\\b${esc}\\.`).test(line)) return true;
  // SYMBOL[ index access — but NOT the array type `SYMBOL[]`. Require a
  // non-`]` character inside the brackets so `Foo[i]` counts and `Foo[]` does not.
  if (new RegExp(`\\b${esc}\\[[^\\]]`).test(line)) return true;
  // Assigned as a value: `= SYMBOL` (not `=>`), or returned `return SYMBOL`
  if (new RegExp(`=\\s*${esc}\\b`).test(line) && !new RegExp(`${esc}\\s*=>`).test(line)) return true;
  if (new RegExp(`\\breturn\\s+${esc}\\b`).test(line)) return true;
  // Passed as an argument: `(SYMBOL` or `, SYMBOL` inside a call-ish context
  if (new RegExp(`[(,]\\s*${esc}\\s*[),]`).test(line)) return true;
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Classify a single occurrence into exactly one kind. Precedence:
//  1. test-file (by path) wins outright.
//  2. genuine comment/string-only occurrence => comment-string.
//  3. among live kinds, prefer the MORE LIVE classification (fail-safe):
//     value-position > type-position > declaration > import-export.
function classifyOccurrence(m: RawMatch, sym: string): Kind {
  if (isTestFile(m.absFile)) return 'test-file';

  if (isCommentOrString(m.lineText, m.matchCol)) return 'comment-string';

  const line = m.lineText;
  const decl = isDeclaration(line, sym);
  const value = isValuePosition(line, sym);
  const type = isTypePosition(line, sym);
  const impexp = isImportExport(line);

  // On a `type X = ...` alias line the RHS is unambiguously type context, so the
  // type signal wins over the value heuristic (`= Widget` is not an assignment).
  if (!decl && isTypeAliasLine(line) && type) return 'type-position';

  // Fail-safe: never under-report liveness. If both a type and value signal
  // exist on a non-declaration line, prefer value-position.
  if (!decl) {
    if (value) return 'value-position';
    if (type) return 'type-position';
  }

  // A declaration line that ALSO uses the symbol as a value (e.g.
  // `const Foo = makeFoo(Foo)`) is rare; the declaration intent dominates the
  // line, so classify as declaration. Pure import/export bindings are not
  // declarations.
  if (decl) return 'declaration';
  if (impexp) return 'import-export';

  // Fallbacks for occurrences with no strong signal (bare reference). Treat a
  // bare reference as value-position to remain on the live side of the ledger.
  if (type) return 'type-position';
  return 'value-position';
}

// ── Census pipeline (per-symbol) ──

// Run a full census for ONE symbol under `searchRoot`: ripgrep → classify →
// fail-safe verdict. Returns the Census plus the absFile-bearing occurrences for
// the human occurrence dump. Single-symbol and batch modes BOTH call this, so a
// symbol's verdict is identical regardless of how it was invoked (ISC-15).
function runCensus(sym: string, searchRoot: string): { census: Census; occurrences: Occurrence[] } {
  const rawMatches = ripgrepMatches(sym, searchRoot);

  const occurrences: Occurrence[] = rawMatches.map((m) => {
    const kind = classifyOccurrence(m, sym);
    return {
      file: relative(searchRoot, m.absFile) || m.absFile,
      absFile: m.absFile,
      line: m.line,
      kind,
      text: m.lineText.trim(),
    };
  });

  const byKind: Record<Kind, number> = {
    declaration: 0,
    'import-export': 0,
    'type-position': 0,
    'value-position': 0,
    'test-file': 0,
    'comment-string': 0,
  };
  for (const o of occurrences) byKind[o.kind]++;

  const declarationFiles = new Set(
    occurrences.filter((o) => o.kind === 'declaration').map((o) => o.absFile)
  );

  const { verdict, rationale } = computeVerdict(occurrences, byKind, declarationFiles);

  const census: Census = {
    symbol: sym,
    root: searchRoot,
    total: occurrences.length,
    byKind,
    verdict,
    rationale,
    occurrences: occurrences.map((o) => ({
      file: o.file,
      line: o.line,
      kind: o.kind,
      text: o.text,
    })),
  };
  return { census, occurrences };
}

// ── Verdict (fail-safe) ──

function computeVerdict(
  occurrences: Occurrence[],
  byKind: Record<Kind, number>,
  declarationFiles: Set<string>
): { verdict: Verdict; rationale: string } {
  if (occurrences.length === 0) {
    return {
      verdict: 'LIKELY-SAFE-TO-REMOVE',
      rationale: 'no occurrences found anywhere in the scanned tree',
    };
  }

  // LIVE (fail-safe): a value-position or type-position occurrence proves the
  // symbol carries weight. type-position is the KEY liveness signal — a symbol
  // used as a type (union member, annotation, generic arg) is load-bearing and
  // deleting it breaks compilation, REGARDLESS of which file it sits in. So any
  // value/type-position occurrence makes the symbol LIVE, whether external to
  // or inside the declaration file.
  const live = occurrences.find(
    (o) => o.kind === 'value-position' || o.kind === 'type-position'
  );
  if (live) {
    const external = !declarationFiles.has(live.absFile);
    return {
      verdict: 'LIVE',
      rationale: external
        ? `used in ${live.kind} outside its declaration file (${live.file}:${live.line})`
        : `used in ${live.kind} (${live.file}:${live.line}) — load-bearing type/value reference`,
    };
  }

  // LIKELY-SAFE-TO-REMOVE is the ONLY affirmative verdict and is held to a strict
  // bar — a regex classifier cannot see re-export barrels, namespace/aliased
  // imports, dynamic `import()`, or string-keyed/DI access, so an affirmative
  // green light must require that NOTHING beyond the declaration in its own file
  // exists. Specifically downgrades to REVIEW (never affirmative) when:
  //   - an import-export occurrence sits OUTSIDE the declaration file → re-export
  //     / external binding, a public surface that may be consumed indirectly.
  //   - a comment-string occurrence exists → could hide a dynamic-import key
  //     (`import("./m")["Symbol"]`) or a string-keyed/reflection reference.
  // Only import/export bindings INSIDE the declaration file (the `export` on the
  // declaration itself) are treated as part of the declaration.
  const externalImportExport = occurrences.some(
    (o) => o.kind === 'import-export' && !declarationFiles.has(o.absFile)
  );
  const anyCommentString = occurrences.some((o) => o.kind === 'comment-string');
  const onlyLocalDeclaration =
    !externalImportExport &&
    !anyCommentString &&
    occurrences.every(
      (o) =>
        o.kind === 'declaration' ||
        (o.kind === 'import-export' && declarationFiles.has(o.absFile))
    ) &&
    occurrences.some((o) => o.kind === 'declaration');
  if (onlyLocalDeclaration) {
    return {
      verdict: 'LIKELY-SAFE-TO-REMOVE',
      rationale:
        'only the declaration (and its own in-file export binding) remains — no external reference regex can see',
    };
  }

  // Everything in between: test-only, same-file internal references, re-export
  // barrels, comment/string mentions (possible dynamic-import keys), or ambiguity.
  // Regex cannot prove these are dead — fail safe to REVIEW, never affirmative.
  const reasons: string[] = [];
  if (externalImportExport) reasons.push('re-exported / imported in another file (possible barrel or indirect consumer)');
  if (anyCommentString) reasons.push('appears in a comment or string literal (possible dynamic-import or reflection key)');
  if (byKind['test-file'] > 0) reasons.push('referenced in test files only');
  return {
    verdict: 'REVIEW',
    rationale:
      (reasons.length ? reasons.join('; ') + ' — ' : '') +
      'no external value/type use, but regex cannot prove the symbol is dead; inspect before removing',
  };
}

// ── Output ──

// Render the full single-symbol report (human form) for one census result.
// Used by single mode and by batch mode's per-symbol detail sections, so the
// two modes share one renderer and cannot drift.
function printHumanCensus(census: Census, occurrences: Occurrence[]): void {
  console.log(`Symbol census: ${census.symbol}`);
  console.log(`Root:   ${census.root}`);
  console.log(`Total:  ${census.total} occurrence(s)`);
  console.log('');
  console.log('By kind:');
  for (const k of ALL_KINDS) {
    console.log(`  ${k.padEnd(15)} ${census.byKind[k]}`);
  }
  console.log('');
  console.log(`Verdict: ${census.verdict}`);
  console.log(`         ${census.rationale}`);
  if (census.total > 0) {
    console.log('');
    console.log('Occurrences:');
    for (const k of ALL_KINDS) {
      const group = occurrences.filter((o) => o.kind === k);
      if (group.length === 0) continue;
      console.log(`  [${k}]`);
      for (const o of group) {
        console.log(`    ${o.file}:${o.line}  ${o.text}`);
      }
    }
  }
}

if (!batchMode) {
  // ── Single-symbol mode (unchanged behavior, ISC-18) ──
  const { census, occurrences } = runCensus(symbols[0], root);
  if (jsonOutput) {
    console.log(JSON.stringify(census, null, 2));
  } else if (quiet) {
    console.log(`${census.verdict} — ${census.rationale}`);
  } else {
    printHumanCensus(census, occurrences);
  }
} else {
  // ── Batch mode (--symbols): one census per symbol, then a keep/cut table ──
  const results = symbols.map((s) => runCensus(s, root));

  if (jsonOutput) {
    // Object keyed by symbol, each value the single-symbol Census shape (ISC-14).
    const bySymbol: Record<string, Census> = {};
    for (const r of results) bySymbol[r.census.symbol] = r.census;
    console.log(JSON.stringify({ root, symbols, bySymbol }, null, 2));
  } else {
    // Keep/cut table — the whole-module prune view (ISC-13, ISC-17).
    const cut = results.filter((r) => r.census.verdict === 'LIKELY-SAFE-TO-REMOVE');
    const keep = results.filter((r) => r.census.verdict !== 'LIKELY-SAFE-TO-REMOVE');
    const nameWidth = Math.max(6, ...symbols.map((s) => s.length));

    console.log(`Batch symbol census — ${symbols.length} symbol(s)`);
    console.log(`Root: ${root}`);
    console.log('');
    console.log(`  ${'SYMBOL'.padEnd(nameWidth)}  ${'VERDICT'.padEnd(21)}  OCCURRENCES`);
    console.log(`  ${'-'.repeat(nameWidth)}  ${'-'.repeat(21)}  -----------`);
    for (const r of results) {
      console.log(
        `  ${r.census.symbol.padEnd(nameWidth)}  ${r.census.verdict.padEnd(21)}  ${r.census.total}`
      );
    }
    console.log('');
    console.log(`Keep/cut summary:`);
    console.log(`  CUT  (LIKELY-SAFE-TO-REMOVE): ${cut.length ? cut.map((r) => r.census.symbol).join(', ') : '(none)'}`);
    console.log(`  KEEP (LIVE / REVIEW):         ${keep.length ? keep.map((r) => r.census.symbol).join(', ') : '(none)'}`);
    if (quiet) {
      // --quiet stops at the table + summary; skip per-symbol detail dumps.
    } else {
      for (const r of results) {
        console.log('');
        console.log('────────────────────────────────────────');
        printHumanCensus(r.census, r.occurrences);
      }
    }
  }
}

process.exit(0);
