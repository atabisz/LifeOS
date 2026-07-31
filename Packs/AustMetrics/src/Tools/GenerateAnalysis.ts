#!/usr/bin/env bun
/**
 * GenerateAnalysis.ts
 *
 * Generates the "Australian Economic State Analysis" document by fetching
 * current data from ABS + RBA and producing a structured markdown report.
 * The Australian equivalent of USMetrics' GenerateAnalysis.ts.
 *
 * Usage:
 *   bun run GenerateAnalysis.ts [--output=path]
 *
 * No API key required — ABS and RBA are keyless public sources.
 */

import { parseArgs } from "util";

const ABS_BASE = "https://data.api.abs.gov.au/rest/data";
const ABS_ACCEPT = "application/vnd.sdmx.data+csv";
const RBA_BASE = "https://www.rba.gov.au/statistics/tables/csv";

// Priority series for the analysis (headline indicators, live-verified keys).
interface Src { name: string; abs?: [string, string]; rba?: [string, string]; unit: string }
const PRIORITY: Record<string, Src[]> = {
  "Economic Output & Growth": [
    { name: "Real GDP", abs: ["ANA_AGG", "M1.GPM.20.AUS.Q"], unit: "$m" },
    { name: "GDP Growth (QoQ)", abs: ["ANA_AGG", "M2.GPM_PCA.20.AUS.Q"], unit: "%" },
  ],
  "Inflation & Prices": [
    { name: "CPI (index)", abs: ["CPI", "1.10001.10.50.M"], unit: "index" },
    { name: "CPI Inflation (annual)", abs: ["CPI", "3.10001.10.50.M"], unit: "%" },
  ],
  "Employment & Labour": [
    { name: "Unemployment Rate", abs: ["LF", "M13.3.1599.20.AUS.M"], unit: "%" },
    { name: "Participation Rate", abs: ["LF", "M12.3.1599.20.AUS.M"], unit: "%" },
    { name: "Wage Price Index (annual)", abs: ["WPI", "3.THRPEB.7.TOT.10.AUS.Q"], unit: "%" },
  ],
  "Housing": [
    { name: "Mean Dwelling Price", abs: ["RES_DWELL_ST", "3.AUS.Q"], unit: "$" },
    { name: "Std Variable Mortgage Rate", rba: ["f5", "FILRHLBVS"], unit: "%" },
  ],
  "Consumer": [
    { name: "Household Spending (total)", abs: ["HSI_M", "7.TOT.CUR.20.AUS.M"], unit: "$m" },
    { name: "Household Spending Growth", abs: ["HSI_M", "9.TOT.CUR.20.AUS.M"], unit: "%" },
  ],
  "Financial Markets": [
    { name: "Cash Rate Target", rba: ["f1.1", "FIRMMCRT"], unit: "%" },
    { name: "2-Year Govt Bond", rba: ["f2", "FCMYGBAG2D"], unit: "%" },
    { name: "10-Year Govt Bond", rba: ["f2", "FCMYGBAG10D"], unit: "%" },
  ],
  "Trade & International": [
    { name: "Trade Balance (goods)", abs: ["ITGS", "M1.170.20.AUS.M"], unit: "$m" },
    { name: "AUD/USD", rba: ["f11.1", "FXRUSD"], unit: "" },
    { name: "Trade-Weighted Index", rba: ["f11.1", "FXRTWI"], unit: "index" },
  ],
};

async function fetchAbs(flow: string, key: string): Promise<{ value: number; date: string } | null> {
  try {
    const r = await fetch(`${ABS_BASE}/${flow}/${key}?lastNObservations=1`, { headers: { Accept: ABS_ACCEPT } });
    if (!r.ok) return null;
    const lines = (await r.text()).split("\n").filter((l) => l.trim());
    if (lines.length < 2) return null;
    const h = lines[0].split(",");
    const ti = h.indexOf("TIME_PERIOD"), vi = h.indexOf("OBS_VALUE");
    const c = lines[1].split(",");
    const v = parseFloat(c[vi]);
    return Number.isFinite(v) ? { value: v, date: c[ti] } : null;
  } catch { return null; }
}

async function fetchRba(table: string, seriesId: string): Promise<{ value: number; date: string } | null> {
  try {
    const r = await fetch(`${RBA_BASE}/${table}-data.csv`);
    if (!r.ok) return null;
    const lines = (await r.text()).split("\n");
    const sidRow = lines.find((l) => l.startsWith("Series ID,"));
    if (!sidRow) return null;
    const col = sidRow.split(",").map((s) => s.trim()).indexOf(seriesId);
    if (col < 0) return null;
    const dateRe = /^(\d{2}\/\d{2}\/\d{4}|\d{1,2}-[A-Za-z]{3}-\d{4})/;
    const data = lines.filter((l) => dateRe.test(l));
    for (let i = data.length - 1; i >= 0; i--) {
      const cells = data[i].split(",");
      const raw = (cells[col] ?? "").trim();
      if (raw === "") continue;
      const v = parseFloat(raw);
      if (Number.isFinite(v)) return { value: v, date: cells[0].trim() };
    }
    return null;
  } catch { return null; }
}

function fmt(v: number, unit: string): string {
  if (unit === "%") return `${v.toFixed(1)}%`;
  if (unit === "$" || unit === "$m") return `$${v.toLocaleString("en-AU", { maximumFractionDigits: 0 })}${unit === "$m" ? "m" : ""}`;
  if (unit === "index") return v.toFixed(1);
  return v.toFixed(4);
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { output: { type: "string" }, help: { type: "boolean", short: "h" } },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
GenerateAnalysis.ts - Generate Australian Economic State Analysis (keyless)

Usage:
  bun run GenerateAnalysis.ts [--output=path]

Options:
  --output=PATH  Save to file instead of stdout
  -h, --help     Show this help
`);
    process.exit(0);
  }

  console.error("Fetching data from ABS + RBA...");
  const fetched = new Map<string, { value: number; date: string }>();
  for (const srcs of Object.values(PRIORITY)) {
    for (const s of srcs) {
      const data = s.abs ? await fetchAbs(s.abs[0], s.abs[1]) : await fetchRba(s.rba![0], s.rba![1]);
      if (data) fetched.set(s.name, data);
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  let md = `# Australian Economic State Analysis\n\n`;
  md += `**Generated:** ${now}\n`;
  md += `**Sources:** ABS Data API (keyless SDMX), RBA Statistical Tables\n\n---\n\n`;

  // Executive summary
  md += `## Executive Summary\n\n`;
  const unemp = fetched.get("Unemployment Rate");
  const cpi = fetched.get("CPI Inflation (annual)");
  const gdpg = fetched.get("GDP Growth (QoQ)");
  const cash = fetched.get("Cash Rate Target");
  if (unemp) md += `- **Unemployment** at ${fmt(unemp.value, "%")} (${unemp.date})\n`;
  if (cpi) md += `- **CPI inflation** running ${fmt(cpi.value, "%")} YoY (${cpi.date})\n`;
  if (gdpg) md += `- **GDP** ${gdpg.value >= 0 ? "grew" : "contracted"} ${fmt(Math.abs(gdpg.value), "%")} in the latest quarter (${gdpg.date})\n`;
  if (cash) md += `- **Cash Rate Target** at ${fmt(cash.value, "%")} (${cash.date})\n`;

  // Detailed snapshot by category
  md += `\n---\n\n## Current Snapshot by Category\n\n`;
  for (const [cat, srcs] of Object.entries(PRIORITY)) {
    md += `### ${cat}\n\n| Metric | Current | Period |\n|--------|---------|--------|\n`;
    for (const s of srcs) {
      const d = fetched.get(s.name);
      if (d) md += `| ${s.name} | ${fmt(d.value, s.unit)} | ${d.date} |\n`;
    }
    md += `\n`;
  }

  // Cross-metric notes
  md += `---\n\n## Cross-Metric Analysis\n\n### Monetary Policy & Yield Curve\n\n`;
  const b2 = fetched.get("2-Year Govt Bond"), b10 = fetched.get("10-Year Govt Bond");
  if (b2 && b10) {
    const spread = b10.value - b2.value;
    md += `- 2-Year Govt Bond: ${fmt(b2.value, "%")}\n- 10-Year Govt Bond: ${fmt(b10.value, "%")}\n`;
    md += `- Spread: ${spread.toFixed(2)}pp (${spread < 0 ? "INVERTED — recessionary signal" : "Normal — positive slope"})\n`;
  }
  md += `\n### Housing Affordability\n\n`;
  const price = fetched.get("Mean Dwelling Price"), mort = fetched.get("Std Variable Mortgage Rate");
  if (price && mort) {
    md += `With mean dwelling price at ${fmt(price.value, "$")} and the standard variable mortgage rate at ${fmt(mort.value, "%")}, `;
    md += price.value > 500000 && mort.value > 6 ? `affordability remains stretched.\n` : `affordability is challenging but stabilising.\n`;
  }

  md += `\n---\n\n## Research Recommendations\n\n`;
  md += `1. **Inflation composition** — examine trimmed-mean vs headline CPI drivers (RBA's preferred core gauge).\n`;
  md += `2. **Labour market** — track participation and wage growth (WPI) against the unemployment rate.\n`;
  md += `3. **Housing** — monitor dwelling prices against the cash rate transmission to mortgage rates.\n`;
  md += `\n---\n\n## Sources\n\n`;
  md += `- **ABS Data API** — GDP, CPI, labour, wages, spending, trade, dwelling prices, population (keyless SDMX).\n`;
  md += `- **RBA Statistical Tables** — cash rate, bond yields, exchange rates, mortgage rates (keyless CSV).\n`;
  md += `\n*Analysis generated by the AustMetrics skill.*\n`;

  if (values.output) {
    await Bun.write(values.output, md);
    console.error(`Analysis saved to ${values.output}`);
  } else {
    console.log(md);
  }
}

main();
