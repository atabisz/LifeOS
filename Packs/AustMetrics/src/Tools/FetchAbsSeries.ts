#!/usr/bin/env bun
/**
 * FetchAbsSeries.ts
 *
 * Fetches a historical data series from the ABS Data API (keyless SDMX) and
 * computes multi-timeframe trend statistics. The Australian equivalent of
 * USMetrics' FetchFredSeries.ts.
 *
 * Usage:
 *   bun run FetchAbsSeries.ts <flow> <key> [--start=2016] [--trends] [--json]
 *   bun run FetchAbsSeries.ts LF M13.3.1599.20.AUS.M --trends
 *   bun run FetchAbsSeries.ts CPI 3.10001.10.50.M --start=2015 --json
 *
 * No API key is required — the ABS Data API removed keys on 2024-11-29.
 */

import { parseArgs } from "util";

const ABS_BASE = "https://data.api.abs.gov.au/rest/data";
const ABS_ACCEPT = "application/vnd.sdmx.data+csv";

interface Observation {
  date: string;
  value: number;
}

interface SeriesData {
  flow: string;
  key: string;
  observations: Observation[];
  latest: Observation | null;
  stats: { min: number; max: number; mean: number; count: number } | null;
}

/** ABS periods look like "2026-05" (monthly) or "2026-Q1" (quarterly). Sort-safe as strings. */
async function fetchAbsSeries(flow: string, key: string, startYear?: number): Promise<SeriesData | null> {
  let url = `${ABS_BASE}/${flow}/${key}`;
  if (startYear) url += `?startPeriod=${startYear}`;

  try {
    const r = await fetch(url, { headers: { Accept: ABS_ACCEPT } });
    if (!r.ok) {
      console.error(`Error fetching ${flow}/${key}: HTTP ${r.status}`);
      return null;
    }
    const text = await r.text();
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length < 2) {
      console.error(`No data for ${flow}/${key}`);
      return null;
    }
    const header = lines[0].split(",");
    const ti = header.indexOf("TIME_PERIOD");
    const vi = header.indexOf("OBS_VALUE");
    if (ti < 0 || vi < 0) return null;

    const observations: Observation[] = [];
    for (const line of lines.slice(1)) {
      const cells = line.split(",");
      const v = parseFloat(cells[vi]);
      if (Number.isFinite(v)) observations.push({ date: cells[ti], value: v });
    }
    // ABS returns newest-first or unordered; sort ascending by period string.
    observations.sort((a, b) => a.date.localeCompare(b.date));

    const values = observations.map((o) => o.value);
    const stats = values.length
      ? {
          min: Math.min(...values),
          max: Math.max(...values),
          mean: values.reduce((a, b) => a + b, 0) / values.length,
          count: values.length,
        }
      : null;

    return {
      flow,
      key,
      observations,
      latest: observations[observations.length - 1] ?? null,
      stats,
    };
  } catch (e) {
    console.error(`Error fetching ${flow}/${key}:`, e);
    return null;
  }
}

interface TrendStat {
  startValue: number;
  endValue: number;
  absoluteChange: number;
  percentChange: number;
  direction: "up" | "down" | "flat";
}

/** ABS periods are strings; compare against a cutoff year-month/quarter string. */
function calculateTrend(data: SeriesData, periodYears: number): TrendStat | null {
  if (!data.observations.length) return null;
  const cutoffYear = new Date().getFullYear() - periodYears;
  // Match both "YYYY-MM" and "YYYY-Qn" — first 4 chars are the year.
  const period = data.observations.filter((o) => parseInt(o.date.slice(0, 4)) >= cutoffYear);
  if (period.length < 2) return null;

  const startValue = period[0].value;
  const endValue = period[period.length - 1].value;
  const absoluteChange = endValue - startValue;
  const percentChange = startValue !== 0 ? (absoluteChange / Math.abs(startValue)) * 100 : 0;

  let direction: "up" | "down" | "flat";
  if (Math.abs(percentChange) < 2) direction = "flat";
  else direction = percentChange > 0 ? "up" : "down";

  return { startValue, endValue, absoluteChange, percentChange, direction };
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      start: { type: "string" },
      trends: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length < 2) {
    console.log(`
FetchAbsSeries.ts - Fetch a historical series from the ABS Data API (keyless)

Usage:
  bun run FetchAbsSeries.ts <flow> <key> [options]
  bun run FetchAbsSeries.ts LF M13.3.1599.20.AUS.M --trends

Options:
  --start=YYYY   Start year (default: full history)
  --trends       Include 10y/5y/2y/1y trend calculations
  --json         Output as JSON
  -h, --help     Show this help

No API key required. Find flow IDs at https://data.api.abs.gov.au/rest/dataflow
`);
    process.exit(positionals.length < 2 ? 1 : 0);
  }

  const [flow, key] = positionals;
  const startYear = values.start ? parseInt(values.start) : undefined;

  console.error(`Fetching ${flow}/${key}...`);
  const data = await fetchAbsSeries(flow, key, startYear);
  if (!data) process.exit(1);

  const trends = values.trends
    ? {
        "10y": calculateTrend(data, 10),
        "5y": calculateTrend(data, 5),
        "2y": calculateTrend(data, 2),
        "1y": calculateTrend(data, 1),
      }
    : undefined;

  if (values.json) {
    console.log(JSON.stringify({ ...data, trends }, null, 2));
    return;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`${flow}/${key}`);
  if (data.latest) console.log(`Latest: ${data.latest.value} (${data.latest.date})`);
  if (data.stats) {
    console.log(`Range: ${data.stats.min.toFixed(2)} - ${data.stats.max.toFixed(2)}`);
    console.log(`Mean: ${data.stats.mean.toFixed(2)}`);
    console.log(`Observations: ${data.stats.count}`);
  }
  if (trends) {
    const arrow = { up: "^", down: "v", flat: "-" } as const;
    console.log(`\nTrend Analysis:`);
    for (const [p, t] of Object.entries(trends)) {
      if (t) console.log(`  ${p}: ${t.startValue.toFixed(2)} -> ${t.endValue.toFixed(2)} (${t.percentChange.toFixed(1)}% ${arrow[t.direction]})`);
    }
  }
}

main();
