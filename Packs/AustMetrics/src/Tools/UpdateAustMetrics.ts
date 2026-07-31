#!/usr/bin/env bun
/**
 * UpdateAustMetrics.ts
 *
 * Fetches current data from Australian federal sources (ABS Data API, RBA
 * statistical tables) and updates the AU-Common-Metrics dataset files.
 *
 * The Australian equivalent of USMetrics' UpdateSubstrateMetrics.ts.
 *
 * KEY DIFFERENCE FROM THE US TOOL: no API key is required. The ABS Data API
 * removed keys on 2024-11-29, and the RBA publishes keyless flat CSV tables.
 * This tool returns real data on first run with zero credentials.
 *
 * Usage:
 *   bun run UpdateAustMetrics.ts [--dry-run]
 *
 * Environment (all optional):
 *   AU_METRICS_DIR - override the output directory
 *
 * Output files (in the data directory):
 *   - AU-Common-Metrics.md      (human-readable, values populated)
 *   - au-metrics-current.csv     (machine-readable snapshot)
 *   - au-metrics-historical.csv  (appended time series)
 *
 * Every series key below was live-probed against the real ABS/RBA endpoints
 * on 2026-07-04 and cross-checked (e.g. GDP real = 695,945 matched FRED's IMF
 * figure). Do not edit a key without re-probing — a wrong SDMX key silently
 * returns the wrong economy.
 */

import { parseArgs } from "util";
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ============================================================================
// CONFIGURATION
// ============================================================================

// HOME hardening: process.env.HOME is unset under Windows autostart; fall back
// to USERPROFILE then os.homedir(). Never assume HOME is present.
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
const DATA_DIR = process.env.AU_METRICS_DIR ?? join(HOME, "Projects/Substrate/Data/AU-Common-Metrics");

const ABS_BASE = "https://data.api.abs.gov.au/rest/data";
const ABS_ACCEPT = "application/vnd.sdmx.data+csv";
const RBA_BASE = "https://www.rba.gov.au/statistics/tables/csv";

// ---------------------------------------------------------------------------
// Metric registry. `source` is "abs" or "rba".
//   ABS: flow + key select one SDMX series; value read from OBS_VALUE column.
//   RBA: table + seriesId select one column in a flat CSV.
// ---------------------------------------------------------------------------
type Fmt = "percent" | "currency" | "billions" | "index" | "number" | "thousands" | "persons";

interface AbsMetric {
  source: "abs";
  name: string;
  category: string;
  flow: string;
  key: string;
  format: Fmt;
  decimals?: number;
  note?: string;
}
interface RbaMetric {
  source: "rba";
  name: string;
  category: string;
  table: string;   // e.g. "f1.1"
  seriesId: string; // e.g. "FIRMMCRT"
  format: Fmt;
  decimals?: number;
  note?: string;
}
type Metric = AbsMetric | RbaMetric;

const METRICS: Record<string, Metric> = {
  // ── Economic Output & Growth (ABS National Accounts, quarterly) ──
  GDP_REAL:   { source: "abs", name: "Real GDP (chain volume)", category: "Economic Output", flow: "ANA_AGG", key: "M1.GPM.20.AUS.Q", format: "currency", decimals: 0, note: "$m, quarterly" },
  GDP_NOMINAL:{ source: "abs", name: "Nominal GDP", category: "Economic Output", flow: "ANA_AGG", key: "M1.GPM.10.AUS.Q", format: "currency", decimals: 0, note: "$m, quarterly" },
  GDP_GROWTH: { source: "abs", name: "GDP Growth (QoQ)", category: "Economic Output", flow: "ANA_AGG", key: "M2.GPM_PCA.20.AUS.Q", format: "percent", decimals: 1, note: "quarterly % change" },

  // ── Inflation & Prices (ABS CPI, now monthly; REGION 50 = weighted avg 8 capitals) ──
  CPI_INDEX:  { source: "abs", name: "CPI (All Groups index)", category: "Inflation", flow: "CPI", key: "1.10001.10.50.M", format: "index", decimals: 1 },
  CPI_ANNUAL: { source: "abs", name: "CPI Inflation (annual)", category: "Inflation", flow: "CPI", key: "3.10001.10.50.M", format: "percent", decimals: 1, note: "YoY % change" },

  // ── Employment & Labour (ABS Labour Force, monthly, persons=3, 15+=1599, SA=20) ──
  UNEMP_RATE: { source: "abs", name: "Unemployment Rate", category: "Employment", flow: "LF", key: "M13.3.1599.20.AUS.M", format: "percent", decimals: 1 },
  PARTIC_RATE:{ source: "abs", name: "Participation Rate", category: "Employment", flow: "LF", key: "M12.3.1599.20.AUS.M", format: "percent", decimals: 1 },
  EMPLOYED:   { source: "abs", name: "Employed Persons", category: "Employment", flow: "LF", key: "M3.3.1599.20.AUS.M", format: "thousands", decimals: 0, note: "'000 persons" },
  EMP_POP:    { source: "abs", name: "Employment-Population Ratio", category: "Employment", flow: "LF", key: "M16.3.1599.20.AUS.M", format: "percent", decimals: 1 },
  WPI_ANNUAL: { source: "abs", name: "Wage Price Index (annual)", category: "Employment", flow: "WPI", key: "3.THRPEB.7.TOT.10.AUS.Q", format: "percent", decimals: 1, note: "YoY % change, quarterly" },

  // ── Consumer & Household (ABS Household Spending Indicator, monthly) ──
  HSI_LEVEL:  { source: "abs", name: "Household Spending (total)", category: "Consumer", flow: "HSI_M", key: "7.TOT.CUR.20.AUS.M", format: "currency", decimals: 0, note: "$m, current price, SA" },
  HSI_ANNUAL: { source: "abs", name: "Household Spending Growth", category: "Consumer", flow: "HSI_M", key: "9.TOT.CUR.20.AUS.M", format: "percent", decimals: 1, note: "YoY % change" },

  // ── Housing (ABS dwelling values + RBA mortgage rate) ──
  DWELL_PRICE:{ source: "abs", name: "Mean Dwelling Price", category: "Housing", flow: "RES_DWELL_ST", key: "3.AUS.Q", format: "currency", decimals: 0, note: "$, quarterly" },
  MORTGAGE_VAR:{ source: "rba", name: "Std Variable Mortgage Rate (owner-occ)", category: "Housing", table: "f5", seriesId: "FILRHLBVS", format: "percent", decimals: 2 },

  // ── Financial Markets (RBA, monthly/daily flat CSV) ──
  CASH_RATE:  { source: "rba", name: "Cash Rate Target", category: "Financial", table: "f1.1", seriesId: "FIRMMCRT", format: "percent", decimals: 2 },
  BOND_2Y:    { source: "rba", name: "2-Year Govt Bond Yield", category: "Financial", table: "f2", seriesId: "FCMYGBAG2D", format: "percent", decimals: 2 },
  BOND_10Y:   { source: "rba", name: "10-Year Govt Bond Yield", category: "Financial", table: "f2", seriesId: "FCMYGBAG10D", format: "percent", decimals: 2 },

  // ── Trade & International (ABS Int'l Trade in Goods, monthly; RBA FX) ──
  TRADE_BAL:  { source: "abs", name: "Trade Balance (goods)", category: "Trade", flow: "ITGS", key: "M1.170.20.AUS.M", format: "currency", decimals: 0, note: "$m, SA" },
  EXPORTS:    { source: "abs", name: "Goods Exports", category: "Trade", flow: "ITGS", key: "M1.1000.20.AUS.M", format: "currency", decimals: 0, note: "$m, SA" },
  IMPORTS:    { source: "abs", name: "Goods Imports", category: "Trade", flow: "ITGS", key: "M1.2000.20.AUS.M", format: "currency", decimals: 0, note: "$m, SA (shown as debit)" },
  AUD_USD:    { source: "rba", name: "AUD/USD Exchange Rate", category: "Trade", table: "f11.1", seriesId: "FXRUSD", format: "number", decimals: 4 },
  TWI:        { source: "rba", name: "Trade-Weighted Index", category: "Trade", table: "f11.1", seriesId: "FXRTWI", format: "index", decimals: 1 },

  // ── Demographics (ABS Estimated Resident Population, quarterly) ──
  POPULATION: { source: "abs", name: "Estimated Resident Population", category: "Demographics", flow: "ERP_Q", key: "1.3.TOT.AUS.Q", format: "persons", decimals: 0 },
};

// ============================================================================
// DATA FETCHING
// ============================================================================

interface FetchResult {
  id: string;
  name: string;
  category: string;
  value: number;
  formattedValue: string;
  period: string;
  updated: string;
  source: string;
}

/** Fetch the latest observation for one ABS SDMX series (CSV format). */
async function fetchAbs(m: AbsMetric): Promise<{ value: number; date: string } | null> {
  const url = `${ABS_BASE}/${m.flow}/${m.key}?lastNObservations=1`;
  try {
    const r = await fetch(url, { headers: { Accept: ABS_ACCEPT } });
    if (!r.ok) return null;
    const text = await r.text();
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return null;
    const header = lines[0].split(",");
    const ti = header.indexOf("TIME_PERIOD");
    const vi = header.indexOf("OBS_VALUE");
    if (ti < 0 || vi < 0) return null;
    const cells = lines[1].split(",");
    const value = parseFloat(cells[vi]);
    if (!Number.isFinite(value)) return null;
    return { value, date: cells[ti] };
  } catch {
    return null;
  }
}

/**
 * Parse an RBA flat statistical table and read the latest value for one Series ID.
 * RBA tables carry a metadata header block (Title/Frequency/Units/Series ID rows)
 * followed by dated data rows. Date formats DIFFER per table:
 *   F1.1 uses DD/MM/YYYY, F2 & F11.1 use DD-Mon-YYYY.
 * We match either, then scan bottom-up for the last row with a non-empty value.
 */
async function fetchRba(m: RbaMetric): Promise<{ value: number; date: string } | null> {
  const url = `${RBA_BASE}/${m.table}-data.csv`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const lines = (await r.text()).split("\n");

    // Locate the Series ID header row to find our column index.
    const sidRow = lines.find((l) => l.startsWith("Series ID,"));
    if (!sidRow) return null;
    const ids = sidRow.split(",").map((s) => s.trim());
    const col = ids.indexOf(m.seriesId);
    if (col < 0) return null;

    // Data rows start with a date in either DD/MM/YYYY or DD-Mon-YYYY form.
    const dateRe = /^(\d{2}\/\d{2}\/\d{4}|\d{1,2}-[A-Za-z]{3}-\d{4})/;
    const dataLines = lines.filter((l) => dateRe.test(l));
    if (dataLines.length === 0) return null;

    // Scan bottom-up: the last non-empty value for this column is the latest.
    for (let i = dataLines.length - 1; i >= 0; i--) {
      const cells = dataLines[i].split(",");
      const raw = (cells[col] ?? "").trim();
      if (raw === "") continue;
      const value = parseFloat(raw);
      if (!Number.isFinite(value)) continue;
      return { value, date: cells[0].trim() };
    }
    return null;
  } catch {
    return null;
  }
}

function formatValue(value: number, m: Metric): string {
  const d = m.decimals ?? 2;
  switch (m.format) {
    case "percent":
      return `${value.toFixed(d)}%`;
    case "currency":
      return `$${value.toLocaleString("en-AU", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
    case "billions":
      return `$${value.toFixed(d)}B`;
    case "thousands":
      return `${value.toLocaleString("en-AU", { maximumFractionDigits: 0 })}K`;
    case "persons":
      return value.toLocaleString("en-AU", { maximumFractionDigits: 0 });
    case "index":
      return value.toFixed(d);
    case "number":
    default:
      return value.toLocaleString("en-AU", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
}

async function fetchAllMetrics(): Promise<Map<string, FetchResult>> {
  const results = new Map<string, FetchResult>();
  const errors: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  console.log("Fetching metrics from ABS + RBA (keyless)...\n");

  for (const [id, m] of Object.entries(METRICS)) {
    const tag = m.source === "abs" ? "ABS" : "RBA";
    console.log(`  [${tag}] ${m.name}...`);
    const data = m.source === "abs" ? await fetchAbs(m) : await fetchRba(m);

    if (data) {
      results.set(id, {
        id,
        name: m.name,
        category: m.category,
        value: data.value,
        formattedValue: formatValue(data.value, m),
        period: data.date,
        updated: today,
        source: m.source.toUpperCase(),
      });
      console.log(`    OK ${formatValue(data.value, m)} (${data.date})`);
    } else {
      errors.push(id);
      console.log(`    FAILED`);
    }

    // Be polite to the endpoints.
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log(`\nFetched ${results.size}/${Object.keys(METRICS).length} metrics`);
  if (errors.length > 0) console.log(`Failed: ${errors.join(", ")}`);
  return results;
}

// ============================================================================
// FILE OUTPUT
// ============================================================================

function generateMarkdown(results: Map<string, FetchResult>): string {
  const now = new Date().toISOString().split("T")[0];
  const byCat = new Map<string, FetchResult[]>();
  for (const r of results.values()) {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category)!.push(r);
  }

  let md = `# AU-Common-Metrics\n\n`;
  md += `**Last Updated:** ${now}\n`;
  md += `**Sources:** ABS Data API (keyless SDMX), RBA Statistical Tables\n`;
  md += `**Metrics:** ${results.size} across ${byCat.size} categories\n\n`;
  md += `> All data is public and keyless. ABS = Australian Bureau of Statistics; RBA = Reserve Bank of Australia.\n\n`;

  md += `## Quick Reference Dashboard\n\n`;
  md += `| Category | Metric | Value | Period | Source |\n`;
  md += `|----------|--------|-------|--------|--------|\n`;
  for (const [cat, rows] of byCat) {
    for (const r of rows) {
      md += `| ${cat} | ${r.name} | ${r.formattedValue} | ${r.period} | ${r.source} |\n`;
    }
  }
  md += `\n`;

  for (const [cat, rows] of byCat) {
    md += `## ${cat}\n\n`;
    md += `| Metric | Value | Period | Updated | Source | Key |\n`;
    md += `|--------|-------|--------|---------|--------|-----|\n`;
    for (const r of rows) {
      const m = METRICS[r.id];
      const key = m.source === "abs" ? `${m.flow}/${m.key}` : `${m.table}:${m.seriesId}`;
      md += `| ${r.name} | ${r.formattedValue} | ${r.period} | ${r.updated} | ${r.source} | \`${key}\` |\n`;
    }
    md += `\n`;
  }
  return md;
}

function generateCurrentCsv(results: Map<string, FetchResult>): string {
  const lines = ["metric_id,metric_name,category,value,formatted_value,period,updated,source"];
  for (const r of results.values()) {
    lines.push([r.id, `"${r.name}"`, `"${r.category}"`, r.value, `"${r.formattedValue}"`, r.period, r.updated, r.source].join(","));
  }
  return lines.join("\n") + "\n";
}

function generateHistoricalCsv(results: Map<string, FetchResult>): string {
  const ts = new Date().toISOString();
  const lines: string[] = [];
  for (const r of results.values()) lines.push(`${ts},${r.id},${r.value},${r.period}`);
  return lines.join("\n") + "\n";
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
UpdateAustMetrics.ts - Update AU-Common-Metrics dataset (ABS + RBA, keyless)

Usage:
  bun run UpdateAustMetrics.ts [--dry-run]

Options:
  --dry-run    Fetch data but don't write files
  -h, --help   Show this help

Environment:
  AU_METRICS_DIR   Override output directory (default: ~/Projects/Substrate/Data/AU-Common-Metrics)

No API key is required. ABS and RBA are both public keyless sources.
`);
    process.exit(0);
  }

  console.log("=".repeat(60));
  console.log("AU-Common-Metrics Update (ABS + RBA, keyless)");
  console.log("=".repeat(60));
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  const results = await fetchAllMetrics();

  if (results.size === 0) {
    console.error("No metrics fetched successfully. Aborting.");
    process.exit(1);
  }

  const updatedMd = generateMarkdown(results);
  const currentCsv = generateCurrentCsv(results);
  const historicalCsv = generateHistoricalCsv(results);

  if (values["dry-run"]) {
    console.log("\n[DRY RUN] Would write:");
    console.log(`  - AU-Common-Metrics.md (${updatedMd.length} bytes)`);
    console.log(`  - au-metrics-current.csv (${currentCsv.length} bytes)`);
    console.log(`  - au-metrics-historical.csv (append ${historicalCsv.length} bytes)`);
    console.log("\nSample CSV:");
    console.log(currentCsv.split("\n").slice(0, 6).join("\n"));
    process.exit(0);
  }

  // Create the data directory if it doesn't exist (USMetrics hard-fails here;
  // we create it so a first run works without manual setup).
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
    console.log(`\nCreated data directory: ${DATA_DIR}`);
  }

  const mdPath = join(DATA_DIR, "AU-Common-Metrics.md");
  const currentPath = join(DATA_DIR, "au-metrics-current.csv");
  const historicalPath = join(DATA_DIR, "au-metrics-historical.csv");

  console.log("\nWriting files...");
  writeFileSync(mdPath, updatedMd);
  console.log(`  OK ${mdPath}`);
  writeFileSync(currentPath, currentCsv);
  console.log(`  OK ${currentPath}`);
  if (!existsSync(historicalPath)) writeFileSync(historicalPath, "fetch_timestamp,metric_id,value,period\n");
  appendFileSync(historicalPath, historicalCsv);
  console.log(`  OK ${historicalPath} (appended)`);

  console.log("\n" + "=".repeat(60));
  console.log(`Update complete. ${results.size} metrics updated.`);
  console.log("=".repeat(60));
}

main();
