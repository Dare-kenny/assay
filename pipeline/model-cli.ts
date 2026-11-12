/**
 * The model from the command line, with the same code the website runs.
 *
 *   npm run model
 *   npm run model -- --growth 0.03 --half-life 12 --price 0.2 --cut-start 6
 *   npm run model -- --no-cut --json
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { DATA_DIR, readJson } from "./lib/io.js";
import { firstMonthAtCoverage, project, simulate } from "../src/lib/model.js";
import type { Metrics } from "../src/lib/types.js";

const m = await readJson<Metrics>(resolve(DATA_DIR, "metrics.json"));
const { values } = parseArgs({
  options: {
    growth: { type: "string", default: String(Math.max(0, m.growth.medianLast6)) },
    "half-life": { type: "string", default: "18" },
    price: { type: "string", default: "0" },
    "cut-start": { type: "string", default: String(m.simulation.cutStartInMonths) },
    "no-cut": { type: "boolean", default: false },
    months: { type: "string", default: "60" },
    scale: { type: "string", default: "1" },
    json: { type: "boolean", default: false },
  },
});

const number = (name: string, raw: string) => {
  const x = Number(raw);
  if (!Number.isFinite(x)) {
    console.error(`--${name} must be a number, got "${raw}"`);
    process.exit(2);
  }
  return x;
};
const months = number("months", values.months);
const halfLife = values["half-life"] === "inf" ? null : number("half-life", values["half-life"]);
const base = {
  supply: m.supply.total,
  priceUsd: m.price.usd,
  buybackUsdPerDay: m.ledger.buybackNearPerDay * m.price.usd,
  burnNearPerDay: m.ledger.burnNearPerDay,
  priceGrowthAnnual: number("price", values.price),
  issuance: { measuredRate: m.issuance.mintedRate, fromRate: m.assumptions.hsp029.fromRate, toRate: m.assumptions.hsp029.toRate, rampMonths: m.assumptions.hsp029.rampMonths, startInMonths: values["no-cut"] ? null : number("cut-start", values["cut-start"]) },
  months,
};
const path = project({ ...base, monthlyGrowth: number("growth", values.growth), growthHalfLifeMonths: halfLife });
const sim = simulate({ ...base, historicalMonthlyGrowth: m.growth.simulationRates, blockMonths: m.simulation.blockMonths, growthScale: number("scale", values.scale), paths: m.simulation.paths, seed: m.simulation.seed });

if (values.json) {
  console.log(JSON.stringify({ asOf: m.asOf, inputs: values, path, simulation: sim }, null, 1));
} else {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const pad = (s: string, n: number) => s.padStart(n);
  console.log(`Assay model, starting from data to ${m.asOf}`);
  console.log(`growth ${pct(number("growth", values.growth))}/month, half-life ${halfLife ?? "never"} months, price ${pct(base.priceGrowthAnnual)}/year, cut ${base.issuance.startInMonths === null ? "never" : `starts in ${base.issuance.startInMonths} months`}\n`);
  console.log(`${pad("month", 6)}${pad("rate", 9)}${pad("minted/day", 13)}${pad("bought/day", 13)}${pad("coverage", 11)}`);
  for (const p of path.filter((x) => x.month % 6 === 0)) console.log(`${pad(String(p.month), 6)}${pad(pct(p.rate), 9)}${pad(Math.round(p.mintedNearPerDay).toLocaleString("en-US"), 13)}${pad(Math.round(p.buybackNearPerDay).toLocaleString("en-US"), 13)}${pad(pct(p.coverage), 11)}`);
  const half = firstMonthAtCoverage(path, 0.5);
  const full = firstMonthAtCoverage(path, 1);
  console.log(`\nreaches 50% coverage: ${half === null ? `not within ${months} months` : `month ${half}`}`);
  console.log(`income covers the bill: ${full === null ? `not within ${months} months` : `month ${full}`}`);
  console.log(`if history repeats (${m.simulation.paths} paths, seed ${m.simulation.seed}): ${pct(sim.probFullByMonth[Math.min(36, months)])} chance of full coverage within 3 years, ${pct(sim.probFullByMonth.at(-1)!)} by month ${months}`);
}
