/**
 * Step 3 of the rebuild: the publish gate. If any check fails the process
 * exits non-zero, the scheduled refresh stops, and the site keeps serving the
 * last snapshot that passed. A wrong number is worse than a stale one.
 */
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { DATA_DIR, RAW_DIR, log, readJson, sha256 } from "./lib/io.js";
import type { Metrics, Series } from "../src/lib/types.js";

const m = await readJson<Metrics>(resolve(DATA_DIR, "metrics.json"));
const s = await readJson<Series>(resolve(DATA_DIR, "series.json"));

const failures: string[] = [];
let passed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}
const between = (x: number, lo: number, hi: number) => Number.isFinite(x) && x >= lo && x <= hi;

// 1. every raw file still matches the hash recorded when it was downloaded
for (const src of m.sources) {
  const text = await readFile(resolve(RAW_DIR, src.file), "utf8");
  check(`hash ${src.file}`, sha256(text) === src.sha256, "file on disk differs from the manifest");
}

// 2. freshness: the daily sources are at most a few days behind the build
const ageDays = (Date.parse(m.generatedAt) - Date.parse(m.asOf)) / 86_400_000;
check("freshness", between(ageDays, 0, 6), `as-of date ${m.asOf} is ${ageDays.toFixed(1)} days before the build`);

// 3. no number is NaN or infinite anywhere in the output
const bad: string[] = [];
(function walk(v: unknown, path: string) {
  if (typeof v === "number" && !Number.isFinite(v)) bad.push(path);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
})(m, "metrics");
check("finite numbers", bad.length === 0, bad.slice(0, 5).join(", "));

// 4. plausibility bounds: wide enough to never fire on real data, tight enough to catch a unit error
check("price", between(m.price.usd, 0.05, 500));
check("supply", between(m.supply.total, 1.0e9, 2.0e9));
check("staked share", between(m.supply.stakedShare, 0.1, 0.9));
check("minted rate", between(m.issuance.mintedRate, 0.005, 0.06), `${m.issuance.mintedRate}`);
check("minted rate at or below the protocol maximum", m.issuance.mintedRate <= m.protocol.maxInflationRate * 1.02, `${m.issuance.mintedRate} vs ${m.protocol.maxInflationRate}`);
check("burn is non-negative and below minted", between(m.issuance.burnNearPerDay, 0, m.issuance.mintedNearPerDay));
check("epoch length", between(m.issuance.meanEpochHours, 2, 30));
check("issuance window", between(m.issuance.windowDays, 25, 31), `${m.issuance.windowDays}`);
check("take rate", between(m.intents.takeRateBps, 0.5, 200));
check("capture share", between(m.intents.captureShare, 0, 1));
check("coverage", between(m.ledger.coverage, 0, 20));
check("validator count", between(m.validators.count, 50, 2000));
check("commission", between(m.validators.stakeWeightedCommission, 0, 1));

// 5. internal consistency: two routes to the same quantity must agree
check("header jump equals listed rewards", m.issuance.crossCheckMaxRelDiff < 1e-5, `max relative gap ${m.issuance.crossCheckMaxRelDiff}`);
const stakeFromRows = m.validators.rows.reduce((a, r) => a + r.stake, 0);
check("stake rows sum to total", Math.abs(stakeFromRows / m.validators.totalStake - 1) < 1e-4);
const rewardShare = m.validators.rewardPerEpoch / (m.issuance.mintedNearPerDay * (m.issuance.meanEpochHours / 24));
check("last epoch reward is near the window average", between(rewardShare, 0.7, 1.3), `${rewardShare.toFixed(3)}`);
check("ledger equals issuance", m.ledger.mintedNearPerDay === m.issuance.mintedNearPerDay);
const cov = (m.ledger.buybackNearPerDay + m.ledger.burnNearPerDay) / m.ledger.mintedNearPerDay;
check("coverage arithmetic", Math.abs(cov - m.ledger.coverage) < 1e-9);

// 6. series are aligned and complete
const n = s.dates.length;
for (const [k, v] of Object.entries(s)) if (Array.isArray(v) && k !== "epochs" && k !== "dates") check(`series ${k} length`, v.length === n, `${v.length} vs ${n}`);
check("series ends at as-of", s.dates.at(-1) === m.asOf);
check("series has no gaps", s.dates.every((d, i) => i === 0 || Date.parse(d) - Date.parse(s.dates[i - 1]) === 86_400_000));
check("epoch series", s.epochs.length >= 60 && s.epochs.every((e) => e.mintedNear > 0 && e.hours > 0));

// 7. every verdict carries its rule, its reading and the case against it
for (const v of m.verdicts) check(`verdict ${v.id}`, Boolean(v.rule && v.reading && v.against && v.display) && ["supported", "mixed", "contradicted"].includes(v.status));

const kept = m.sources.filter((x) => x.status === "kept");
if (kept.length) log(`note: ${kept.length} source(s) kept from an earlier run: ${kept.map((k) => k.file).join(", ")}`);

if (failures.length) {
  log(`VALIDATION FAILED: ${failures.length} check(s)`);
  for (const f of failures) log(`  - ${f}`);
  process.exit(1);
}
log(`validation passed: ${passed} checks`);
