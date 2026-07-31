---
name: AustMetrics
pack-id: austmetrics-v1.0.0
version: 1.0.0
author: PAI
description: 23 Australian economic indicators from the ABS Data API and RBA statistical tables (keyless) with trend analysis and cross-metric correlation
type: skill
purpose-type: [data-analysis, economics, research, metrics]
platform: claude-code
dependencies: []
keywords: [economics, GDP, inflation, CPI, unemployment, RBA, ABS, cash-rate, AUD, trend-analysis, Australia, indicators]
---

# AustMetrics

> 23 Australian economic indicators from federal sources — trend analysis, cross-metric correlation, and structured economic overviews on demand. No API key required.

---

## The Problem

Understanding the Australian economy requires pulling data from the ABS (national accounts, CPI, labour force, trade), the RBA (cash rate, bond yields, exchange rates), and other agencies — each with a different access model. When you want a quick economic overview, you end up bouncing between the ABS Data Explorer and the RBA statistical-tables page, assembling a picture by hand, without trend context.

Unlike the US (where FRED aggregates almost everything behind one keyed API), Australia splits coverage across a keyless SDMX API (ABS) and keyless flat-file tables (RBA). This skill wires both.

---

## The Solution

AustMetrics is the Australian counterpart to USMetrics. It provides two workflows:

**UpdateData workflow:**
1. Fetches live data for 23 metrics from the ABS Data API and RBA tables
2. Updates the AU-Common-Metrics dataset files
3. Produces both human-readable markdown and machine-readable CSV
4. Appends to a historical time series

**GetCurrentState workflow:**
1. Fetches current data across all categories
2. Analyses cross-metric relationships (yield curve, housing affordability)
3. Generates a structured "Australian Economic State Analysis" report

The 8 categories: Economic Output & Growth, Inflation & Prices, Employment & Labour, Consumer, Housing, Financial Markets, Trade & International, Demographics.

---

## What Makes This Different

**No API key.** The single biggest difference from USMetrics: both anchor sources are keyless and public. The ABS removed Data API keys on 2024-11-29; the RBA publishes flat CSV tables. AustMetrics returns real data on first run with zero credentials.

Every series key was live-probed and cross-checked before shipping (e.g. real GDP `ANA_AGG/M1.GPM.20.AUS.Q` = 695,945, matching the FRED-republished IMF figure). A wrong SDMX key silently returns the wrong economy, so correctness of the keys is the core design invariant.

---

## What's Included

| Component | Path | Purpose |
|-----------|------|---------|
| Skill definition | `src/SKILL.md` | Routing, workflows, categories, source config |
| UpdateData workflow | `src/Workflows/UpdateData.md` | Fetching live data from ABS + RBA |
| GetCurrentState workflow | `src/Workflows/GetCurrentState.md` | Generating the economic analysis |
| UpdateAustMetrics tool | `src/Tools/UpdateAustMetrics.ts` | Primary — fetches all 23 metrics, updates dataset |
| FetchAbsSeries tool | `src/Tools/FetchAbsSeries.ts` | Historical series + trend calculations |
| GenerateAnalysis tool | `src/Tools/GenerateAnalysis.ts` | Generates the analysis report |

**Summary:**
- **Directories:** 2 (Workflows/, Tools/)
- **Workflow files:** 2
- **Tool files:** 3
- **Dependencies:** `bun` runtime. No API keys.

---

## Data Sources

| Source | Access | Metrics |
|--------|--------|---------|
| **ABS Data API** | `data.api.abs.gov.au/rest/data` (SDMX-CSV, keyless) | GDP, CPI, labour force, wages, household spending, trade, dwelling prices, population |
| **RBA Statistical Tables** | `rba.gov.au/statistics/tables/csv` (flat CSV, keyless) | cash rate, 2yr & 10yr bond yields, AUD/USD, Trade-Weighted Index, mortgage rate |

---

## Documented Gaps (v1)

These US metrics have no clean keyless Australian equivalent and are intentionally excluded (see SKILL.md for detail): building approvals (662k-series dataflow, no national key), consumer sentiment (scrape-only), fuel prices (no national API), equity/volatility indices (unofficial Yahoo endpoint only), fiscal debt/deficit (spreadsheet/CKAN, not SDMX), and income distribution/GINI (biennial, release-only).

---

## Configuration

### API Keys
None required.

### Runtime
`bun` must be installed and on PATH.

### Data Directory
Defaults to `~/Projects/Substrate/Data/AU-Common-Metrics/`. Override with the `AU_METRICS_DIR` environment variable. The directory is created automatically on first run.

---

## Credits

- **Structural model:** the USMetrics pack (Daniel Miessler / PAI).
- **Data sources:** Australian Bureau of Statistics (ABS), Reserve Bank of Australia (RBA).

---

## Changelog

### 1.0.0 - 2026-07-04
- Initial release
- 23 metrics across 8 categories from ABS + RBA (keyless)
- Two workflows: UpdateData and GetCurrentState
- Three TypeScript tools; every series key live-verified against real endpoints
