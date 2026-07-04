# Update — idempotent re-overlay after a version bump

Brings an existing install up to the current LifeOS version without touching the user's data. Safe to run repeatedly.

## Voice notification (first action)

```bash
curl -s -X POST http://localhost:31337/notify -H "Content-Type: application/json" \
  -d '{"message": "Running the Update workflow in the LifeOS skill to update your install"}' > /dev/null 2>&1 &
```

## Steps

1. **DetectEnv** — `bun Tools/DetectEnv.ts`. If `isDevTree` → STOP (the source repo updates itself via git, not this workflow).
2. **Version diff** — `bun Tools/VersionDiff.ts` compares the payload version (`install/LifeOS/VERSION`, shipped in this release) against the installed marker (`<configRoot>/LIFEOS/VERSION`, written by `DeployCore` on the prior install). Branches on the `verdict` field:
   - `installed` marker ABSENT → a pre-6 (5.x) tree with no marker → **needs upgrade**, proceed.
   - `installed` == payload → report **"already current"** and exit.
   - `installed` != payload → **needs upgrade**, proceed with the re-overlay.
3. **Re-overlay system (additive-only)** — `bun Tools/DeployCore.ts` (dry-run first, then `--apply`) re-copies the skills library and the `LIFEOS/` runtime via `copyMissing`, which ADDS only files absent at the destination and NEVER overwrites a populated one. This delivers genuinely new system files a version introduces (a new doc, a new tool) without touching anything already present. **Existing system files are not modified by Update** — content changes to a file that already exists (an updated CLAUDE routing table, a revised system prompt) are NOT delivered here; that path is a backup + re-install (see the caveat below).
4. **Re-merge hooks** — `bun Tools/InstallHooks.ts` (idempotent): adds new hook entries, leaves existing ones, never duplicates (normalized-command dedup). Backs up `settings.json` first.
5. **Scaffold new USER templates only** — `bun Tools/ScaffoldUser.ts` copyMissing: adds any NEW template files introduced by the version, never overwrites the user's existing files.
6. **Re-activate imports** — `bun Tools/ActivateImports.ts` for any newly-shipped identity import lines.
7. **Verify** — two evidence classes (hooks fire + imports resolve), same as Setup step 9.

## Rule
Update is **additive and non-destructive**. It adds new system files and merges hooks/imports; it does not overwrite existing system files or user data, never removes user customizations, never deletes hooks the user added. **For content changes to system files that already exist, back up `<configRoot>` and re-install** — Update cannot re-write an existing file (its only copy primitive, `copyMissing`, writes strictly when the destination is absent). This keeps a 5.x → 6.0.0 upgrade safe: a personalized `CLAUDE.md` is never clobbered.
