# llcli Quick Start

**The 30-second guide to using llcli**

## Installation

Already done! Located at: `~/.claude/PAI/TOOLS/llcli/`

## Usage

```bash
# Get help
~/.claude/PAI/TOOLS/llcli/llcli.ts --help

# Today's recordings
~/.claude/PAI/TOOLS/llcli/llcli.ts today

# Specific date
~/.claude/PAI/TOOLS/llcli/llcli.ts date 2025-11-17

# Search
~/.claude/PAI/TOOLS/llcli/llcli.ts search "consulting"

# With custom limit
~/.claude/PAI/TOOLS/llcli/llcli.ts today --limit 50
```

## Piping to jq

```bash
# Just titles
~/.claude/PAI/TOOLS/llcli/llcli.ts today | jq -r '.data.lifelogs[].title'

# Count recordings
~/.claude/PAI/TOOLS/llcli/llcli.ts date 2025-11-17 | jq '.data.lifelogs | length'

# Long recordings (>30 min)
~/.claude/PAI/TOOLS/llcli/llcli.ts today | jq '.data.lifelogs[] | select(
  ((.endTime | fromdateiso8601) - (.startTime | fromdateiso8601)) > 1800
)'
```

## Configuration

API key already configured in `~/.claude/.env`:
```bash
LIMITLESS_API_KEY=your_key
```

## Full Documentation

See: `~/.claude/PAI/TOOLS/llcli/README.md`
