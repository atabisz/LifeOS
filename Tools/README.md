<p align="center">
  <img src="utilities-icon.png" alt="PAI Utilities" width="128">
</p>

# Utilities

> **FOR AI AGENTS:** This directory contains tools for maintaining PAI installations.

---

## Contents

### validate-protected.ts

**Public-file sentinel**

Checks that the repository's protected public files still identify themselves as this project, still exist on disk, and carry no secrets, PII, or private paths. The file list, the accepted identity strings, and the sensitive-content patterns all live in `.pai-protected.json` — a rebrand or a new protected doc is a manifest edit, not a code edit.

```bash
bun validate-protected.ts            # check every protected file
bun validate-protected.ts --staged   # check staged files only (forbidden dirs + sensitive content)
```

Run in CI by `.github/workflows/repo-gates.yml`. It is **not** wired into a git pre-commit hook — the only pre-commit hook on this machine is ggshield's secret scan.

### validate-payload-json.ts

**Payload shape gate**

`LifeOS/install/settings.system.json` and `LifeOS/install/hooks/hooks.json` decide the shape of every install: the first becomes `~/.claude/settings.json`, the second is merged into it. This gate checks both parse, asserts the invariants that make them composable (only `hooks.json` may carry a `hooks` key; every hook entry is either a `command` with a non-empty string or an HTTP hook), prints the shape it verified, and parse-checks every other tracked JSON file in the repo. `tsconfig.json` is parsed as JSONC, since TypeScript permits comments there.

```bash
bun validate-payload-json.ts              # check the payload
bun validate-payload-json.ts --self-test  # prove the gate can go RED
bun validate-payload-json.ts --quiet      # violations only
```

Run in CI by `.github/workflows/repo-gates.yml`, self-test first.

### BackupRestore.ts

**Backup and Restore**

Create and restore backups of PAI installations.

```bash
bun BackupRestore.ts backup                    # Create timestamped backup
bun BackupRestore.ts backup --name "pre-v3"    # Named backup
bun BackupRestore.ts list                      # List backups
bun BackupRestore.ts restore <backup-name>     # Restore
```

---

## Quick Reference

| File | Purpose | Run in CI |
|------|---------|-----------|
| validate-protected.ts | Protected public files: project identity, existence, no sensitive data | yes |
| validate-payload-json.ts | `settings.system.json` + `hooks.json` parse and shape | yes |
| smoke-hook-launch.ts | Every wired hook can actually be launched by the OS | yes (3 OS legs) |
| lint-portable-paths.ts | Hardcoded `$HOME`/`/tmp` paths that break on Windows | not yet |
| BackupRestore.ts | Backup and restore installations | no |

---

*Part of the [PAI (Personal AI Infrastructure)](https://github.com/danielmiessler/PAI) project.*
