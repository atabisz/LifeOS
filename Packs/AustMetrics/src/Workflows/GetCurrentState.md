# GetCurrentState Workflow

**Skill:** AustMetrics
**Purpose:** Generate a comprehensive Australian economic overview with trend analysis

## Overview

This workflow produces a detailed analysis document examining Australian
economic indicators across all categories, identifying patterns, cross-metric
relationships, and research opportunities.

Data comes live from ABS + RBA (keyless). You can either run the analysis tool
directly (self-contained) or run `UpdateData` first and read the dataset files.

## Execution Steps

### Step 1: Initialize

```
Running **GetCurrentState** in **AustMetrics**...
```

### Step 2: Generate the Analysis

Direct (self-contained — fetches its own live data):
```bash
bun ~/.claude/skills/AustMetrics/Tools/GenerateAnalysis.ts
```

Or save to a file:
```bash
bun ~/.claude/skills/AustMetrics/Tools/GenerateAnalysis.ts \
  --output ~/.claude/History/research/$(date +%Y-%m)/$(date +%Y-%m-%d)_AU-Economic-State-Analysis.md
```

### Step 3: Historical Trends (optional)

For any metric, pull a historical series with 10y/5y/2y/1y trends:
```bash
bun ~/.claude/skills/AustMetrics/Tools/FetchAbsSeries.ts LF M13.3.1599.20.AUS.M --trends
bun ~/.claude/skills/AustMetrics/Tools/FetchAbsSeries.ts CPI 3.10001.10.50.M --start=2015 --trends
```

## Analysis Structure

The generated report contains:

1. **Executive Summary** — unemployment, inflation, GDP growth, cash rate.
2. **Current Snapshot by Category** — Economic Output, Inflation, Employment, Housing, Consumer, Financial Markets, Trade.
3. **Cross-Metric Analysis:**
   - **Monetary policy & yield curve** — 2yr vs 10yr govt bond spread (inversion = recession signal).
   - **Housing affordability** — mean dwelling price vs standard variable mortgage rate.
4. **Research Recommendations** — inflation composition (trimmed mean), labour market (participation vs wages), housing transmission.

## Cross-Category Relationships to Analyse

1. **Inflation ↔ Employment** — CPI vs unemployment (Phillips curve); WPI wage growth vs inflation.
2. **Monetary Policy ↔ Economy** — cash rate → mortgage rates → housing; 10Y-2Y spread as recession indicator.
3. **Consumer ↔ Output** — household spending growth vs GDP.
4. **Trade ↔ Currency** — trade balance vs AUD/USD and the Trade-Weighted Index.

## Output Location

```
~/.claude/History/research/[YYYY-MM]/[YYYY-MM-DD]_AU-Economic-State-Analysis.md
```

## Notes

- Australian GDP and wages are **quarterly**; expect coarser cadence than a US dashboard on those tiles.
- CPI is **monthly** (since late 2025); the trimmed-mean "core" gauge lives inside the same ABS `CPI` dataflow.
- All values are keyless and public — no API key or credential is needed to run this workflow.
