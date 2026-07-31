# AustMetrics v1.0.0 - Installation Guide

**This guide is designed for AI agents installing this pack into a user's infrastructure.**

---

## AI Agent Instructions

**This is a wizard-style installation.** Use Claude Code's native tools:

1. **AskUserQuestion** — for user decisions and confirmations
2. **TodoWrite** — for progress tracking
3. **Bash/Read/Write** — for actual installation
4. **VERIFY.md** — for final validation

### Welcome Message

```
"I'm installing AustMetrics v1.0.0 — 23 Australian economic indicators with
trend analysis and cross-metric correlation.

This skill adds two workflows:
- UpdateData — fetch live data from the ABS Data API and RBA statistical tables
- GetCurrentState — generate a comprehensive Australian economic analysis

Note: no API key is required — both sources are public and keyless.

Let me analyse your system and guide you through installation."
```

---

## Phase 1: System Analysis

**Execute this analysis BEFORE any file operations.**

```bash
CLAUDE_DIR="$HOME/.claude"
echo "Claude directory: $CLAUDE_DIR"

# Skills directory
if [ -d "$CLAUDE_DIR/skills" ]; then
  echo "OK Skills directory exists"
else
  echo "INFO Skills directory does not exist (will be created)"
fi

# Existing AustMetrics skill
if [ -d "$CLAUDE_DIR/skills/AustMetrics" ]; then
  echo "WARNING Existing AustMetrics skill found"
  ls -la "$CLAUDE_DIR/skills/AustMetrics/" 2>/dev/null
else
  echo "OK No existing AustMetrics skill (clean install)"
fi

# bun runtime
if command -v bun &>/dev/null; then
  echo "OK bun runtime available: $(bun --version)"
else
  echo "WARNING bun runtime not found (required for TypeScript tools)"
fi

# Connectivity to the keyless sources (optional check)
echo "INFO AustMetrics needs no API key — ABS and RBA are keyless."
```

### Present Findings

```
"Here's what I found on your system:
- Skills directory: [exists / will be created]
- Existing AustMetrics skill: [found — will ask about conflict / not found]
- bun runtime: [found (version) / not found — required for tools]

No API keys are needed. Both data sources (ABS, RBA) are public and keyless.

[If bun not found]: The TypeScript tools require bun. Install it with:
curl -fsSL https://bun.sh/install | bash"
```

---

## Phase 2: User Questions

### Question 1: Conflict Resolution (only if existing skill found)

```json
{
  "header": "Conflict",
  "question": "An existing AustMetrics skill was found. How should I proceed?",
  "multiSelect": false,
  "options": [
    {"label": "Backup and Replace (Recommended)", "description": "Timestamped backup, then install new version"},
    {"label": "Replace Without Backup", "description": "Overwrite without backup"},
    {"label": "Abort Installation", "description": "Cancel, keep existing skill"}
  ]
}
```

### Question 2: Final Confirmation

```json
{
  "header": "Install",
  "question": "Ready to install AustMetrics v1.0.0?",
  "multiSelect": false,
  "options": [
    {"label": "Yes, install now (Recommended)", "description": "Copies skill files to ~/.claude/skills/AustMetrics/"},
    {"label": "Show me what will change", "description": "Lists all files that will be created"},
    {"label": "Cancel", "description": "Abort installation"}
  ]
}
```

---

## Phase 3: Backup (If Needed)

```bash
CLAUDE_DIR="$HOME/.claude"
BACKUP_DIR="$CLAUDE_DIR/Backups/AustMetrics-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
if [ -d "$CLAUDE_DIR/skills/AustMetrics" ]; then
  cp -r "$CLAUDE_DIR/skills/AustMetrics" "$BACKUP_DIR/AustMetrics"
  echo "Backed up AustMetrics skill directory"
fi
echo "Backup created at: $BACKUP_DIR"
```

---

## Phase 4: Installation

### 4.1 Create Skill Directory Structure

```bash
CLAUDE_DIR="$HOME/.claude"
mkdir -p "$CLAUDE_DIR/skills/AustMetrics/Tools"
mkdir -p "$CLAUDE_DIR/skills/AustMetrics/Workflows"
echo "Created AustMetrics skill directory structure"
```

### 4.2 Copy Skill Files

```bash
PACK_DIR="$(pwd)"
CLAUDE_DIR="$HOME/.claude"

cp "$PACK_DIR/src/SKILL.md" "$CLAUDE_DIR/skills/AustMetrics/SKILL.md"
cp "$PACK_DIR/src/Tools/UpdateAustMetrics.ts" "$CLAUDE_DIR/skills/AustMetrics/Tools/UpdateAustMetrics.ts"
cp "$PACK_DIR/src/Tools/FetchAbsSeries.ts" "$CLAUDE_DIR/skills/AustMetrics/Tools/FetchAbsSeries.ts"
cp "$PACK_DIR/src/Tools/GenerateAnalysis.ts" "$CLAUDE_DIR/skills/AustMetrics/Tools/GenerateAnalysis.ts"
cp "$PACK_DIR/src/Workflows/UpdateData.md" "$CLAUDE_DIR/skills/AustMetrics/Workflows/UpdateData.md"
cp "$PACK_DIR/src/Workflows/GetCurrentState.md" "$CLAUDE_DIR/skills/AustMetrics/Workflows/GetCurrentState.md"

echo "Installed AustMetrics skill files"
```

---

## Phase 5: Verification

**Execute all checks from VERIFY.md.** A quick functional smoke test (no key needed):

```bash
bun "$HOME/.claude/skills/AustMetrics/Tools/UpdateAustMetrics.ts" --dry-run
```

Expect `Fetched N/23 metrics` with real values.

---

## Success Message

```
"AustMetrics v1.0.0 installed successfully!

What's available:
- UpdateData workflow — fetches live data from ABS + RBA (no key needed)
- GetCurrentState workflow — generates a comprehensive Australian economic analysis

Try it now: Ask 'How is the Australian economy doing?' or 'Update the AU metrics'"
```

---

## Troubleshooting

### Skill not recognized after installation
Restart Claude Code. Skills load at session start.

### UpdateData workflow fails
Check that `bun` is installed and that the machine can reach `data.api.abs.gov.au` and `www.rba.gov.au`. No API key is involved.

### Data files not appearing
The tool creates `~/Projects/Substrate/Data/AU-Common-Metrics/` automatically. Set `AU_METRICS_DIR` to change the location.
