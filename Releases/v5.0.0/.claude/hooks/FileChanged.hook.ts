#!/usr/bin/env bun
/**
 * FileChanged hook — fires when a file is modified.
 * Watches for changes to key PAI config files and triggers validation.
 */

import { readFileSync } from "fs";
import { paiPath } from './lib/paths';

// Read stdin via fd 0, not the path "/dev/stdin" — the latter is ENOENT on
// Windows (bun throws), which is why this hook crashed as an orphan. fd 0 is
// the same pattern the wired hooks (e.g. ISASync) use. Fail open on any parse error.
let input: any;
try {
  const raw = readFileSync(0, "utf-8");
  if (!raw.trim()) process.exit(0);
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}
const filePath: string = input?.toolInput?.file_path ?? input?.filePath ?? "";

// Key files that should trigger alerts when modified
const watchedPatterns = [
  /settings\.json$/,
  /settings\.local\.json$/,
  /CLAUDE\.md$/,
  /CONTEXT_ROUTING\.md$/,
  /Algorithm\/v[\d.]+\.md$/,
];

const isWatched = watchedPatterns.some((p) => p.test(filePath));

if (isWatched) {
  // Log the change for observability
  const logEntry = JSON.stringify({
    ts: new Date().toISOString(),
    event: "FileChanged",
    file: filePath,
  });

  const logPath = paiPath('MEMORY', 'SKILLS', 'execution.jsonl');
  const fs = await import("fs");
  fs.appendFileSync(logPath, logEntry + "\n");
}

// Always allow — this is observability, not a gate
process.exit(0);
