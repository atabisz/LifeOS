# UpdateData Workflow

**Skill:** AustMetrics
**Purpose:** Fetch current data from ABS + RBA and update the AU-Common-Metrics dataset

## Overview

This workflow pulls live data from the ABS Data API (keyless SDMX) and the RBA
statistical tables (keyless CSV), then writes the current values to the
AU-Common-Metrics dataset files. The GetCurrentState workflow then reads from
these populated files.

**No API key is required.**

## Data Flow

```
ABS Data API (keyless)  +  RBA Statistical Tables (keyless)
    ↓
UpdateData workflow (this)
    ↓
Dataset files:
  - AU-Common-Metrics.md      (markdown with values)
  - au-metrics-current.csv     (machine-readable)
  - au-metrics-historical.csv  (time series)
    ↓
GetCurrentState workflow
    ↓
Analysis report
```

## Execution Steps

### Step 1: Initialize

```
Running **UpdateData** in **AustMetrics**...
```

### Step 2: Run Update Tool

```bash
bun ~/.claude/skills/AustMetrics/Tools/UpdateAustMetrics.ts
```

This tool:
1. Fetches current values for all 23 metrics from ABS + RBA
2. Creates the data directory if it doesn't exist
3. Writes `AU-Common-Metrics.md`
4. Exports to `au-metrics-current.csv`
5. Appends to `au-metrics-historical.csv` (with timestamp)

### Step 3: Verify Update

- Verify `AU-Common-Metrics.md` has current values (not placeholders)
- Verify `au-metrics-current.csv` exists and has data
- Check the fetch count (`Fetched N/23 metrics`) for any failures

## Sources

| Source | Access | Metrics | Auth |
|--------|--------|---------|------|
| **ABS Data API** | `data.api.abs.gov.au/rest/data` (SDMX-CSV) | GDP, CPI, labour, wages, spending, trade, dwelling prices, population | **None** |
| **RBA Statistical Tables** | `rba.gov.au/statistics/tables/csv` (flat CSV) | cash rate, bond yields, exchange rates, mortgage rate | **None** |

## Environment

```bash
# Optional — override the output directory:
export AU_METRICS_DIR="/path/to/data"
```

## Output Files

### AU-Common-Metrics.md
Markdown with a Quick Reference dashboard plus per-category tables showing
value, period, updated date, source, and the underlying series key.

### au-metrics-current.csv
```csv
metric_id,metric_name,category,value,formatted_value,period,updated,source
GDP_REAL,"Real GDP (chain volume)","Economic Output",695945,"$695,945",2026-Q1,2026-07-04,ABS
UNEMP_RATE,"Unemployment Rate","Employment",4.36,"4.4%",2026-05,2026-07-04,ABS
```

### au-metrics-historical.csv
Appends each update as a new row with timestamp.

## Trigger Phrases

- "Update AU metrics"
- "Refresh the Australian economic data"
- "Pull latest Australian metrics"

## Error Handling

- **Fetch failure**: logged per metric; the run continues with the rest.
- **Zero metrics fetched**: aborts (likely a network/connectivity issue).
- **Missing data dir**: created automatically (no manual setup needed).

## Update Cadence (differs from the US)

| Frequency | Metrics |
|-----------|---------|
| Daily | Bond yields (F2), exchange rates (F11.1) |
| Monthly | CPI, labour force, household spending, trade, cash rate, mortgage rate |
| Quarterly | GDP, Wage Price Index, dwelling prices, population |

Note: Australian GDP and wages are **quarterly** (no monthly proxy), and CPI
became **monthly** only in late 2025.
