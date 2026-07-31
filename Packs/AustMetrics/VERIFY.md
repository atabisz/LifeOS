# AustMetrics Verification

> **FOR AI AGENTS:** Complete this checklist AFTER installation. Every file check must pass before declaring the pack installed. Dependency checks are informational.

---

## File Verification

### Check SKILL.md exists

```bash
CLAUDE_DIR="$HOME/.claude"
[ -f "$CLAUDE_DIR/skills/AustMetrics/SKILL.md" ] && echo "OK SKILL.md" || echo "MISSING SKILL.md"
```

### Check subdirectories exist

```bash
CLAUDE_DIR="$HOME/.claude"
[ -d "$CLAUDE_DIR/skills/AustMetrics/Tools" ] && echo "OK Tools/" || echo "MISSING Tools/"
[ -d "$CLAUDE_DIR/skills/AustMetrics/Workflows" ] && echo "OK Workflows/" || echo "MISSING Workflows/"
```

### Check tool files exist

```bash
CLAUDE_DIR="$HOME/.claude"
[ -f "$CLAUDE_DIR/skills/AustMetrics/Tools/UpdateAustMetrics.ts" ] && echo "OK UpdateAustMetrics.ts" || echo "MISSING UpdateAustMetrics.ts"
[ -f "$CLAUDE_DIR/skills/AustMetrics/Tools/FetchAbsSeries.ts" ] && echo "OK FetchAbsSeries.ts" || echo "MISSING FetchAbsSeries.ts"
[ -f "$CLAUDE_DIR/skills/AustMetrics/Tools/GenerateAnalysis.ts" ] && echo "OK GenerateAnalysis.ts" || echo "MISSING GenerateAnalysis.ts"
```

### Check workflow files exist

```bash
CLAUDE_DIR="$HOME/.claude"
[ -f "$CLAUDE_DIR/skills/AustMetrics/Workflows/UpdateData.md" ] && echo "OK UpdateData.md" || echo "MISSING UpdateData.md"
[ -f "$CLAUDE_DIR/skills/AustMetrics/Workflows/GetCurrentState.md" ] && echo "OK GetCurrentState.md" || echo "MISSING GetCurrentState.md"
```

### Check frontmatter is valid

```bash
CLAUDE_DIR="$HOME/.claude"
if [ -f "$CLAUDE_DIR/skills/AustMetrics/SKILL.md" ]; then
  head -1 "$CLAUDE_DIR/skills/AustMetrics/SKILL.md" | grep -q "^---" && echo "OK frontmatter" || echo "ERROR missing frontmatter"
  grep -q "^name: AustMetrics" "$CLAUDE_DIR/skills/AustMetrics/SKILL.md" && echo "OK name field" || echo "ERROR missing name"
  grep -q "^description:" "$CLAUDE_DIR/skills/AustMetrics/SKILL.md" && echo "OK description" || echo "ERROR missing description"
fi
```

---

## Dependency Availability (Informational)

```bash
echo "Dependencies:"
command -v bun &>/dev/null && echo "  AVAILABLE bun runtime ($(bun --version))" || echo "  UNAVAILABLE bun (install: curl -fsSL https://bun.sh/install | bash)"
echo "  NO API KEY REQUIRED — ABS and RBA are keyless public sources"
```

---

## Functional Test (no key needed)

```bash
bun "$HOME/.claude/skills/AustMetrics/Tools/UpdateAustMetrics.ts" --dry-run
```

**Expected:** `Fetched N/23 metrics` with real 2026 values (e.g. Real GDP ~$695,945, Unemployment ~4.4%, Cash Rate 4.35%). This confirms live connectivity to ABS + RBA and that the shipped series keys resolve.

---

## Installation Checklist

```markdown
## AustMetrics Installation Verification

### Files
- [ ] SKILL.md installed with valid frontmatter (name: AustMetrics)
- [ ] Tools/ directory with 3 TypeScript files
- [ ] Workflows/ directory with 2 workflow files

### Dependencies (informational)
- [ ] bun runtime available
- [ ] (no API key needed)

### Functional
- [ ] --dry-run returns real values for most of the 23 metrics
- [ ] "How is the Australian economy doing?" triggers GetCurrentState
- [ ] "Update the AU metrics" triggers UpdateData
```

---

## Verification Complete

When all file checks pass:

1. **Confirm to user:** "AustMetrics installation verified successfully"
2. **Recommend:** "Try 'How is the Australian economy doing?' or 'Update the AU metrics'"
3. **Note:** "No API key is needed — data comes live from the keyless ABS and RBA sources"
