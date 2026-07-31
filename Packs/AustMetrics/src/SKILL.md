---
name: AustMetrics
description: 23 Australian economic indicators from the ABS Data API and RBA statistical tables (keyless, no API key required) with trend analysis and cross-metric correlation. Updates the AU-Common-Metrics dataset, produces economic overviews. USE WHEN Australian GDP, inflation, CPI, unemployment, RBA cash rate, AUD, ASX, economic metrics, how is the Australian economy, update AU data, refresh Australian metrics, get current state, economic overview, ABS, RBA, fetch ABS series, Australian economic trends.
---

## Customization

**Before executing, check for user customizations at:**
`~/.claude/LIFEOS/USER/SKILLCUSTOMIZATIONS/AustMetrics/`

If this directory exists, load and apply any PREFERENCES.md, configurations, or resources found there. These override default behavior. If the directory does not exist, proceed with skill defaults.

## Workflow Routing

**When executing a workflow, output this notification directly:**

```
Running the **WorkflowName** workflow in the **AustMetrics** skill to ACTION...
```

### Available Workflows

| Workflow | Description | Use When |
|----------|-------------|----------|
| **UpdateData** | Fetch live data from ABS + RBA and update the AU-Common-Metrics dataset | "Update AU metrics", "refresh Australian data", "pull latest" |
| **GetCurrentState** | Comprehensive Australian economic overview with trend analysis | "How is the Australian economy?", "economic overview", "get current state" |

# Australian Metrics — Economic Indicator Analysis

**Purpose:** Analyse Australian economic metrics from the ABS Data API and RBA statistical tables. Provides trend analysis, cross-metric correlation, and structured economic overviews.

## Data Source

- **Location:** `${AU_METRICS_DIR}` or `~/Projects/Substrate/Data/AU-Common-Metrics/`
- **Master Document:** `AU-Common-Metrics.md`
- **Underlying sources:** ABS Data API (SDMX, keyless), RBA Statistical Tables (CSV, keyless)

**No API key is required.** Unlike the US equivalent (FRED/EIA keys), both Australian anchor sources are public and keyless: the ABS removed API keys on 2024-11-29, and the RBA publishes flat CSV tables.

## Workflows

### UpdateData

**Full documentation:** `Workflows/UpdateData.md`

**Execution:**
```bash
bun ~/.claude/skills/AustMetrics/Tools/UpdateAustMetrics.ts
```

**Outputs:**
- `AU-Common-Metrics.md` — updated with current values
- `au-metrics-current.csv` — machine-readable snapshot
- `au-metrics-historical.csv` — appended time series

### GetCurrentState

**Full documentation:** `Workflows/GetCurrentState.md`

**Produces:** A comprehensive overview analysing GDP, inflation, employment, housing, consumer, financial-markets, and trade indicators, with cross-metric interplay and research recommendations.

## Metric Categories Covered

1. **Economic Output & Growth** — real & nominal GDP, GDP growth (ABS National Accounts, quarterly)
2. **Inflation & Prices** — CPI index & annual inflation (ABS CPI, monthly since late 2025)
3. **Employment & Labour** — unemployment, participation, employed persons, emp-pop ratio, Wage Price Index (ABS Labour Force + WPI)
4. **Consumer** — Household Spending Indicator level & growth (ABS HSI, monthly)
5. **Housing** — mean dwelling price (ABS), standard variable mortgage rate (RBA F5)
6. **Financial Markets** — cash rate target, 2yr & 10yr govt bond yields (RBA F1.1, F2)
7. **Trade & International** — trade balance, exports, imports (ABS ITGS), AUD/USD & Trade-Weighted Index (RBA F11.1)
8. **Demographics** — Estimated Resident Population (ABS ERP, quarterly)

## API Keys Required

**None.** ABS Data API and RBA tables are both keyless. This is the main structural difference from USMetrics.

## Tools

| Tool | Purpose |
|------|---------|
| `Tools/UpdateAustMetrics.ts` | **Primary** — fetch all 23 metrics from ABS + RBA, update dataset files |
| `Tools/FetchAbsSeries.ts` | Fetch a historical series from the ABS Data API with trend calculations |
| `Tools/GenerateAnalysis.ts` | Generate the Australian Economic State Analysis report |

## Documented Gaps (v1)

Some US metrics have no clean keyless Australian equivalent and are intentionally excluded:

- **Building approvals** — ABS `BA_SA2` has 662k series with no clean national aggregate key; housing is covered via dwelling prices + mortgage rates instead.
- **Consumer sentiment** — Westpac–Melbourne Institute, NAB, ANZ-Roy Morgan are all free-to-read but have no programmatic API (scrape-only).
- **Fuel/petrol prices** — no national API; state schemes exist (WA FuelWatch RSS free, NSW FuelCheck OAuth, QLD token).
- **Equity/volatility indices** — S&P/ASX 200 (`^AXJO`) and A-VIX (`^AXVI`) only via the unofficial Yahoo v8 endpoint.
- **Fiscal debt/deficit** — AOFM `.xlsx` + data.gov.au CKAN (Finance monthly statements); not wired into v1 (spreadsheet parsing, not SDMX).
- **Income distribution / GINI** — ABS Survey of Income & Housing is biennial, release-only, not a clean API dataflow.

## Example Usage

```
User: "How is the Australian economy doing?"

→ Invoke GetCurrentState workflow
→ Fetch current data for all metrics from ABS + RBA
→ Analyse cross-metric relationships (yield curve, housing affordability)
→ Output comprehensive markdown report
```
