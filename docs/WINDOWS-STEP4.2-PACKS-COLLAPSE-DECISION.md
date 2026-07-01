# Step 4.2 — Packs collapse: scoping memo (decision pending)

**Status:** scoped, not executed. Awaiting Alex's source-of-truth decision.
**Date:** 2026-07-02
**Context:** Windows-support plan Step 4.2 (`docs/WINDOWS-SUPPORT-PLAN.md`). This memo exists so the decision can be made with full detail; nothing in the tree was changed to produce it.

## The premise the plan corrected

The original plan called the bundle packs "the same un-DRY-source bug class," implying identical copies safe to blind-dedup. **That is wrong.** `Packs/Utilities/` and `Packs/Media/` are *bundle* packs that re-carry copies of standalone skills, and those copies are **divergent subsets**, not identical duplicates. A blind fold would drop the standalone-only files or freeze the drifted bundle content. This is a design decision, not a mechanical dedup.

## Measured divergence (live, 2026-07-02)

| Pair | only-in-standalone | only-in-bundle | differing | Shape |
|------|--------------------|----------------|-----------|-------|
| `Packs/Art/src` ↔ `Packs/Media/src/Art` | 8 | 0 | 26 | bundle is a strict, older **subset** |
| `Packs/Remotion/src` ↔ `Packs/Media/src/Remotion` | 4 | 0 | 9 | bundle is a **subset** |
| `Packs/AudioEditor/src` ↔ `Packs/Utilities/src/AudioEditor` | 0 | 0 | 9 | same file set, **content drift** |

Key facts:
- **No bundle copy has any only-in-bundle file** for Art/Remotion → the standalone is a superset; nothing unique is lost by treating standalone as source.
- **AudioEditor** has the same file set but 9 files differ in content — the standalone is the actively-maintained copy (it's where the Step-3 ffmpeg/whisper/timeout Windows fixes landed).

## Bundle-only sub-skills (cannot be "collapsed away")

`Packs/Utilities/src/` contains three sub-skills with **no** standalone `Packs/<name>` source:

- `Cloudflare`
- `Documents`
- `Parser`

The bundle IS their only home. Any collapse must either promote these to standalone skills first, or have the bundle build treat them as bundle-native.

## Recommendation (for Alex's call)

Make the **standalone `Packs/<Skill>/src`** the single source of truth and **generate** the bundle copies from it — the same build-from-canonical pattern as `scripts/build-release.ts`. Rationale:

- For Art/Remotion the standalone is a strict superset, so generation loses nothing.
- For AudioEditor the standalone is the actively-maintained copy (Windows fixes live there), so generation propagates the current content.
- The bundle-only trio (Cloudflare/Documents/Parser) either gets promoted to standalone skills first, or the bundle build treats them as bundle-native.

## Why this is NOT a Windows blocker

Windows engineering is complete regardless of 4.2 — this is drift-hygiene. Both bundle and standalone copies already carry the Windows portability fixes (they were edited in lockstep and kept byte-identical per copy through Steps 1–3). 4.2 is about *stopping the drift from recurring*, not about making Windows work. The `lint-portable-paths` baseline gate keeps the deferral safe.

## What executing this would involve (not done here)

1. Decide direction (recommend: standalone → bundle generation).
2. Write a `build-bundles.ts` (or extend `build-release.ts`) that materializes `Packs/Utilities/src/<Skill>` and `Packs/Media/src/<Skill>` from `Packs/<Skill>/src`, treating the bundle-only trio as native.
3. Reconcile the 9 AudioEditor content diffs (confirm standalone is newer for each) before first generation, so generation doesn't clobber a bundle-only fix.
4. Wire a check so the bundle copies can't drift again (CI diff, or generation-on-commit).
