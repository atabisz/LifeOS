/**
 * Parser for the DA's `opinions.yaml`, which `/assistant/opinions` serves as a raw string.
 *
 * Why this is a module rather than a regex in the page: the inline parse it replaces read
 * `position:` with `/position:\s*"?([^"\n]+)"?/`, which stops at the first newline. A
 * `position:` is a plain multi-line YAML scalar whenever the writer wraps it onto continuation
 * lines at a deeper indent, so everything past the first line never reached the DOM and the card
 * ended mid-sentence. Extracting it is also what makes it probeable: this app has no test runner,
 * so the fixtures are exercised by importing this file from `bun -e` and diffing against
 * `Bun.YAML.parse`, which is the oracle. Bun.YAML is server-side only and there is no `yaml`
 * package in this app's dependencies, hence a hand parse rather than a real one.
 *
 * Scope: a YAML sequence of flat maps under one top-level key. That is the whole shape of this
 * file. Nested maps, anchors, flow collections and multi-document streams are NOT handled — if
 * the writer ever emits those, the endpoint should return parsed JSON instead (the better fix; it
 * needs a Pulse envelope change and a daemon restart).
 */

export interface Opinion {
  topic: string;
  position: string;
  confidence: number;
  source?: string;
  evidence_count?: string;
  first_observed?: string;
  last_confirmed?: string;
}

/** `|`, `>`, with an optional chomping indicator. Explicit indentation digits are not supported. */
const BLOCK_HEADER = /^([|>])([-+]?)$/;
const KEY_LINE = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/;

type Style = "plain" | "literal" | "folded";

/**
 * Parse a YAML sequence of flat maps into plain records.
 *
 * Continuation is decided by INDENTATION — any line indented deeper than its key — not by a
 * blocklist of the sibling keys we happen to know about. A "not one of the known keys" test
 * breaks silently the first time the writer adds a field, and it is easy to get wrong: a
 * regex lookahead written to size this bug backtracked over its own whitespace and swallowed
 * `confidence:`, overstating the loss several-fold until a real parser contradicted it.
 */
export function parseYamlMapSequence(raw: string): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = [];
  let cur: Record<string, string> | null = null;

  // The open scalar being accumulated, if any.
  let key: string | null = null;
  let keyIndent = 0;
  let style: Style = "plain";
  let chomp = "";
  let buf: string[] = [];

  const indentOf = (line: string) => line.length - line.trimStart().length;

  // `style` is only ever reassigned inside openKey/flush, so in THIS scope the compiler narrows it
  // to its initializer and calls a `style === "literal"` test unreachable (TS2367) even though it
  // is reached at runtime. Reading it back through a function crosses a function boundary, which
  // is where narrowing resets — the declared type is what a caller sees.
  const currentStyle = (): Style => style;

  const flush = () => {
    if (cur && key) cur[key] = joinScalar(buf, style, chomp);
    key = null;
    buf = [];
    style = "plain";
    chomp = "";
  };

  const openKey = (line: string, indent: number) => {
    const m = line.trim().match(KEY_LINE);
    if (!m) return;
    key = m[1];
    keyIndent = indent;
    const value = m[2];
    const block = value.match(BLOCK_HEADER);
    if (block) {
      style = block[1] === "|" ? "literal" : "folded";
      chomp = block[2];
      buf = [];
    } else {
      style = "plain";
      // "" when the key has no inline value; the continuation lines then carry the whole scalar,
      // and the empty entry is dropped by joinScalar rather than folding into a leading space.
      buf = [value];
    }
  };

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const indent = indentOf(line);
    const inScalar = key !== null;

    // A blank line inside a block scalar is content; anywhere else it is separation. It never
    // closes an open scalar, because a plain scalar may resume after it.
    if (trimmed === "") {
      if (inScalar) buf.push("");
      continue;
    }

    // Deeper than its key ⇒ continuation. Checked BEFORE the comment test, because inside a
    // block scalar a `#` line is text, not a comment.
    if (inScalar && indent > keyIndent) {
      buf.push(currentStyle() === "plain" ? trimmed : line);
      continue;
    }

    if (trimmed.startsWith("#")) continue;

    flush();

    if (trimmed.startsWith("- ") || trimmed === "-") {
      if (cur) items.push(cur);
      cur = {};
      const rest = trimmed.slice(1).trimStart();
      // `- topic: X` — the key's own column is where `topic` starts, not where `-` does.
      if (rest) openKey(rest, indent + (trimmed.length - trimmed.slice(1).trimStart().length));
      continue;
    }

    // A top-level key with no open item is the sequence's own name (`opinions:`) — ignored.
    if (cur) openKey(line, indent);
  }

  flush();
  if (cur) items.push(cur);
  return items;
}

/** Fold accumulated continuation lines into one scalar, honouring block style and chomping. */
function joinScalar(lines: string[], style: Style, chomp: string): string {
  if (style === "plain") {
    const text = lines.filter((l) => l !== "").join(" ").trim();
    return unquote(text);
  }

  // Block scalars keep their own relative indentation, so dedent by the least-indented content
  // line rather than by a fixed amount.
  const content = lines.map((l) => l.replace(/\s+$/, ""));
  const base = Math.min(
    ...content.filter((l) => l.trim() !== "").map((l) => l.length - l.trimStart().length),
    Infinity,
  );
  const dedented = content.map((l) => (l.trim() === "" ? "" : l.slice(base === Infinity ? 0 : base)));

  while (dedented.length && dedented[dedented.length - 1] === "") dedented.pop();

  const body = style === "literal" ? dedented.join("\n") : foldParagraphs(dedented);
  if (chomp === "-") return body;
  return body + "\n"; // clip and keep both end in a newline; only `+` would retain more
}

/** `>` folds line breaks within a paragraph to spaces and keeps blank lines as breaks. */
function foldParagraphs(lines: string[]): string {
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "") {
      out += "\n";
      continue;
    }
    if (i > 0 && lines[i - 1] !== "") out += " ";
    out += lines[i];
  }
  return out;
}

/** Strip surrounding quotes and apply the escapes each quoting style defines. */
function unquote(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

/**
 * Opinions in file order, keeping only rows that carry the two fields the card renders.
 * Confidence is coerced here so the caller never has to think about the raw string.
 */
export function parseOpinions(raw: string): Opinion[] {
  return parseYamlMapSequence(raw)
    .filter((row) => row.topic || row.position)
    .map((row) => ({
      ...row,
      topic: row.topic ?? "",
      position: row.position ?? "",
      confidence: Number.parseFloat(row.confidence ?? "0") || 0,
    }));
}
