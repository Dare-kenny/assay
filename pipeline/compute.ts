/**
 * Step 2 of the rebuild: turn data/raw/ into data/metrics.json (every number
 * the thesis quotes) and data/series.json (every chart). Runs offline.
 */
import { resolve } from "node:path";
import { DATA_DIR, RAW_DIR, log, readJson, writeJson, type ManifestEntry } from "./lib/io.js";
import { EPOCHS_TARGET, FEE_SWITCH_DATE, HSP029, OTHER_WALLETS, REVENUE_WALLETS, RULES, VALIDATOR_COST_USD_PER_MONTH, WINDOWS } from "./config.js";
import type { EpochRecord } from "./fetch.js";
import { DAYS_PER_YEAR, gini, grade, mean, nakamoto, quantile, simulate, stakerYields, sum, viability, type SimulationInput, type ValidatorRow } from "../src/lib/model.js";
import type { Metrics, Series, Verdict } from "../src/lib/types.js";

const YOCTO = 10n ** 24n;
/** yoctoNEAR string -> NEAR as a float, keeping 6 decimals through BigInt first */
const near = (yocto: string | bigint) => Number(BigInt(yocto) / 10n ** 18n) / 1e6;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const raw = <T>(file: string) => readJson<T>(resolve(RAW_DIR, file));

type Chart = { chart: [number, number][] };
const [volume, fees, revenue, holdersRev, tvl, nb, head, config, validatorsRaw, commissionsRaw, epochsRaw, walletsRaw, manifest] = await Promise.all([
  raw<Chart>("llama_intents_volume.json"),
  raw<Chart>("llama_intents_fees.json"),
  raw<Chart>("llama_intents_revenue.json"),
  raw<Chart>("llama_intents_holders_revenue.json"),
  raw<Chart>("llama_intents_tvl.json"),
  raw<{ fields: string[]; rows: string[][] }>("nearblocks_charts.json"),
  raw<{ height: number; timestampMs: number; totalSupply: string }>("rpc_head.json"),
  raw<Record<string, unknown>>("rpc_protocol_config.json"),
  raw<{ epochHeight: number; validators: { id: string; stake: string }[]; rewardPaidPrevEpoch: Record<string, string> }>("rpc_validators.json"),
  raw<{ commissions: Record<string, number | null>; unreadable: number }>("rpc_commissions.json"),
  raw<{ epochs: EpochRecord[] }>("rpc_epochs.json"),
  raw<{ snapshots: { date: string; height: number; balances: Record<string, string> }[] }>("rpc_wallets.json"),
  raw<ManifestEntry[]>("manifest.json"),
]);

/* ------------------------------------------------------------ daily tables */

const byDate = (c: Chart) => new Map(c.chart.map(([ts, v]) => [iso(ts * 1000), v]));
const volBy = byDate(volume);
const feesBy = byDate(fees);
const revBy = byDate(revenue);
const holdersBy = byDate(holdersRev);
const tvlBy = byDate(tvl);

const col = (name: string) => nb.fields.indexOf(name);
const nbBy = new Map(
  nb.rows.map((r) => [
    r[col("date")],
    {
      price: Number(r[col("near_price")]),
      supply: near(r[col("total_supply")].split(".")[0]),
      txns: Number(r[col("txns")]),
      feeNear: near(r[col("txn_fee")].split(".")[0]),
      active: Number(r[col("active_accounts")]),
    },
  ]),
);

const today = iso(head.timestampMs);
const lastOf = (m: Map<string, unknown>) => [...m.keys()].filter((d) => d < today).sort().at(-1) as string;
/** last full UTC day present in every daily source */
const asOf = [lastOf(feesBy), lastOf(revBy), lastOf(volBy), lastOf(nbBy)].sort()[0];
const asOfMs = Date.parse(asOf);

const START = "2025-05-01";
const dates: string[] = [];
for (let t = Date.parse(START); t <= asOfMs; t += DAY) dates.push(iso(t));

let lastPrice = NaN;
let lastSupply = NaN;
const daily = dates.map((d) => {
  const n = nbBy.get(d);
  if (n && n.price > 0) lastPrice = n.price;
  if (n && n.supply > 0) lastSupply = n.supply;
  const rev = revBy.get(d) ?? 0;
  return {
    date: d,
    price: lastPrice,
    supply: lastSupply,
    txns: n?.txns ?? 0,
    active: n?.active ?? 0,
    feeNear: n?.feeNear ?? 0,
    volume: volBy.get(d) ?? 0,
    fees: feesBy.get(d) ?? 0,
    revenue: rev,
    /** NEAR the day's captured revenue buys at that day's price; zero before the buyback program */
    buybackNear: d >= FEE_SWITCH_DATE && lastPrice > 0 ? (holdersBy.get(d) ?? rev) / lastPrice : 0,
    tvl: tvlBy.get(d) ?? null,
  };
});

const tail = <T>(xs: T[], n: number, skip = 0) => xs.slice(xs.length - n - skip, xs.length - skip);
const W = WINDOWS.short;
const L = WINDOWS.long;
const last30 = tail(daily, W);
const prev30 = tail(daily, W, W);
const last90 = tail(daily, L);
const prev90 = tail(daily, L, L);
const price = daily.at(-1)!.price;

/* ------------------------------------------------- issuance, measured on chain */

const epochs = epochsRaw.epochs.slice().sort((a, b) => a.epochHeight - b.epochHeight);
if (epochs.length < 2) throw new Error("need at least two epoch records");
const newest = epochs.at(-1)!;
const windowStartMs = newest.startTsMs - W * DAY;
const inWindow = epochs.filter((e) => e.startTsMs >= windowStartMs);
const first = inWindow[0];
const windowDays = (newest.startTsMs - first.startTsMs) / DAY;
/**
 * NEAR minted in the first block of an epoch, read from block headers: the
 * rise in total supply across that block, plus what the block itself burned.
 */
const mintedAt = (e: EpochRecord) => BigInt(e.supplyAtStart) - BigInt(e.supplyBeforeStart) + BigInt(e.burntInStartBlock);
// the window runs from the first record's start to the newest record's start, so the first record's own mint is outside it
const mintedYocto = inWindow.slice(1).reduce((a, e) => a + mintedAt(e), 0n);
// `validators` for epoch k+1 lists, per account, what was paid at the start of epoch k; that is where the treasury share is visible
const withList = inWindow.slice(2);
const treasuryYocto = withList.reduce((a, e) => a + BigInt(e.treasuryReward), 0n);
const listedYocto = withList.reduce((a, e) => a + BigInt(e.rewardsPaid), 0n);
const burnYocto = BigInt(first.supplyAtStart) + mintedYocto - BigInt(newest.supplyAtStart);
const mintedNearPerDay = near(mintedYocto) / windowDays;
const burnNearPerDay = near(burnYocto) / windowDays;
const supplyNow = near(head.totalSupply);
const mintedRate = (mintedNearPerDay * DAYS_PER_YEAR) / supplyNow;
const netRate = ((mintedNearPerDay - burnNearPerDay) * DAYS_PER_YEAR) / supplyNow;
const meanEpochHours = (windowDays * 24) / (inWindow.length - 1);
const epochsPerYear = (DAYS_PER_YEAR * 24) / meanEpochHours;

// two independent readings of the same payment: the supply jump in the block header, and the reward list from `validators`
const crossCheckMaxRelDiff = Math.max(
  ...epochs.slice(1).map((e, i) => {
    const jump = mintedAt(epochs[i]); // minted at the start of epoch k, from headers
    const paid = BigInt(e.rewardsPaid); // the same payment, as listed by `validators` one epoch later
    if (paid === 0n) return 0;
    const diff = jump > paid ? jump - paid : paid - jump;
    return Number((diff * 10n ** 12n) / paid) / 1e12;
  }),
);

const [inflNum, inflDen] = config.max_inflation_rate as [number, number];
const [trNum, trDen] = config.protocol_reward_rate as [number, number];
const maxInflation = inflNum / inflDen;
const cutScale = HSP029.toRate / HSP029.fromRate;

/* ------------------------------------------------------------------- Intents */

const s = (rows: typeof daily, k: "volume" | "fees" | "revenue" | "buybackNear" | "txns" | "active" | "feeNear") => sum(rows.map((r) => r[k]));
const vol30 = s(last30, "volume");
const fees30 = s(last30, "fees");
const rev30 = s(last30, "revenue");
const latestTvl = [...daily].reverse().find((r) => r.tvl !== null)?.tvl ?? tvl.chart.at(-1)![1];
const sinceSwitch = daily.filter((r) => r.date >= FEE_SWITCH_DATE);

/* -------------------------------------------------------------------- ledger */

const buybackNearPerDay = s(last30, "buybackNear") / W;
const coverage = (buybackNearPerDay + burnNearPerDay) / mintedNearPerDay;
const coverageBuybackOnly = buybackNearPerDay / mintedNearPerDay;
const coverageAfterCut = (buybackNearPerDay + burnNearPerDay) / (mintedNearPerDay * cutScale);
// 90-day coverage uses the measured issuance rate against each day's supply
const minted90 = sum(last90.map((r) => (r.supply * mintedRate) / DAYS_PER_YEAR));
const burnCalibration = burnNearPerDay / (s(last30, "feeNear") / W); // chain burn relative to NearBlocks' fee total
const burn90 = s(last90, "feeNear") * burnCalibration;
const coverage90 = (s(last90, "buybackNear") + burn90) / minted90;
const budgetUsdPerYear = mintedNearPerDay * DAYS_PER_YEAR * price;
const incomeUsdPerYear = (buybackNearPerDay + burnNearPerDay) * DAYS_PER_YEAR * price;

/* ------------------------------------------------------------------- wallets */

const snap = (date: string) => walletsRaw.snapshots.find((x) => x.date === date);
const snaps = walletsRaw.snapshots.slice().sort((a, b) => a.date.localeCompare(b.date));
const latestSnap = snaps.at(-1)!;
const revIds = REVENUE_WALLETS.map((w) => w.id);
const held = (sn: { balances: Record<string, string> }) => sum(revIds.map((id) => near(sn.balances[id] ?? "0")));
function reconcile(from: { date: string; balances: Record<string, string> }, to: { date: string; balances: Record<string, string> }) {
  const rows = daily.filter((r) => r.date >= from.date && r.date < to.date);
  const gainedNear = held(to) - held(from);
  const impliedNear = sum(rows.map((r) => r.buybackNear));
  return { from: from.date, to: to.date, gainedNear, impliedNear, ratio: impliedNear > 0 ? gainedNear / impliedNear : NaN, seriesDays: rows.length };
}
const snap30 = snaps.filter((x) => x.date < latestSnap.date && x.date > FEE_SWITCH_DATE).at(-1) ?? snaps[0];
const snapSwitch = snap(FEE_SWITCH_DATE) ?? snaps[0];

/* ---------------------------------------------------------------- validators */

const rewards = validatorsRaw.rewardPaidPrevEpoch;
const rows: ValidatorRow[] = validatorsRaw.validators
  .map((v) => ({ id: v.id, stake: near(v.stake), rewardPerEpoch: near(rewards[v.id] ?? "0"), commission: commissionsRaw.commissions[v.id] ?? null }))
  .sort((a, b) => b.stake - a.stake);
const stakes = rows.map((r) => r.stake);
const totalStake = sum(stakes);
const sortedStakes = stakes.slice().sort((a, b) => a - b);
const known = rows.filter((r) => r.commission !== null);
const commissions = known.map((r) => r.commission as number).sort((a, b) => a - b);
const stakeWeightedCommission = sum(known.map((r) => (r.commission as number) * r.stake)) / sum(known.map((r) => r.stake));
const validatorRewards = rows.map((r) => r.rewardPerEpoch);
const grid = VALIDATOR_COST_USD_PER_MONTH.grid;
const viabilityToday = grid.map((c) => viability(rows, epochsPerYear, price, c, 1));
const viabilityAfterCut = grid.map((c) => viability(rows, epochsPerYear, price, c, cutScale));
const defaultCostIdx = grid.indexOf(VALIDATOR_COST_USD_PER_MONTH.default);

/* ------------------------------------------------------------------ security */

const costOneThirdUsd = (totalStake / 3) * price;
const chainFeesUsdPerYear = burnNearPerDay * DAYS_PER_YEAR * price;
const annualFeesUsd = (fees30 / W) * DAYS_PER_YEAR + chainFeesUsdPerYear;

/* ------------------------------------------------------------------- stakers */

const treasuryShare = Number((treasuryYocto * 10n ** 9n) / (listedYocto === 0n ? 1n : listedYocto)) / 1e9;
const stakedShare = totalStake / supplyNow;
const yieldsToday = stakerYields({ mintedToStakersRate: mintedRate * (1 - treasuryShare), netSupplyGrowth: netRate, stakedShare, commission: stakeWeightedCommission });
const burnRate = (burnNearPerDay * DAYS_PER_YEAR) / supplyNow;
const yieldsAfterCut = stakerYields({
  mintedToStakersRate: mintedRate * cutScale * (1 - treasuryShare),
  netSupplyGrowth: mintedRate * cutScale - burnRate,
  stakedShare,
  commission: stakeWeightedCommission,
});

/* -------------------------------------------------- monthly growth and paths */

const monthKeys = [...new Set(daily.map((r) => r.date.slice(0, 7)))];
const fullMonths = monthKeys.filter((m) => {
  const next = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1));
  return next.getTime() - DAY <= asOfMs && daily.some((r) => r.date === `${m}-01`);
});
const monthly = fullMonths.map((m) => {
  const rs = daily.filter((r) => r.date.startsWith(m));
  return { month: m, feesUsd: s(rs, "fees"), revenueUsd: s(rs, "revenue"), volumeUsd: s(rs, "volume"), growth: null as number | null };
});
// growth is only defined once the base is no longer tiny; the first months grew from near zero
const MIN_BASE_USD = 250_000;
monthly.forEach((m, i) => {
  const p = monthly[i - 1];
  if (p && p.feesUsd >= MIN_BASE_USD) m.growth = m.feesUsd / p.feesUsd - 1;
});
const allGrowth = monthly.map((m) => m.growth).filter((g): g is number => g !== null);
/**
 * The simulation resamples only the last twelve complete months. Earlier
 * months grew by 70% to 250% from a small base; drawing from them would
 * promise growth no mature product repeats.
 */
const SIM_HISTORY_MONTHS = 12;
const recentGrowth = allGrowth.slice(-SIM_HISTORY_MONTHS);
/**
 * Two of those twelve months are spikes (a doubling and a tripling). Compounded
 * over five years they would dominate every path, so each rate is clipped to
 * Tukey's fences (quartiles -/+ 1.5 x the interquartile range) before resampling.
 */
const recentSorted = recentGrowth.slice().sort((a, b) => a - b);
const q1 = quantile(recentSorted, 0.25);
const q3 = quantile(recentSorted, 0.75);
const fences = { lo: q1 - 1.5 * (q3 - q1), hi: q3 + 1.5 * (q3 - q1) };
const growthRates = recentGrowth.map((g) => Math.round(Math.min(fences.hi, Math.max(fences.lo, g)) * 1e4) / 1e4);
const sortedGrowth = allGrowth.slice().sort((a, b) => a - b);
const last6 = growthRates.slice(-6).sort((a, b) => a - b);

const cutStartInMonths = Math.max(0, Math.round((Date.parse(HSP029.assumedStart) - asOfMs) / DAY / (DAYS_PER_YEAR / 12)));
const SIM = { seed: 20261112, paths: 4000, horizonMonths: 60, blockMonths: 3 };
const baseSim: Omit<SimulationInput, "issuance" | "growthScale"> = {
  supply: supplyNow,
  priceUsd: price,
  buybackUsdPerDay: buybackNearPerDay * price,
  burnNearPerDay,
  priceGrowthAnnual: 0,
  months: SIM.horizonMonths,
  historicalMonthlyGrowth: growthRates,
  blockMonths: SIM.blockMonths,
  paths: SIM.paths,
  seed: SIM.seed,
};
const policy = (start: number | null) => ({ measuredRate: mintedRate, fromRate: HSP029.fromRate, toRate: HSP029.toRate, rampMonths: HSP029.rampMonths, startInMonths: start });
const round = (xs: number[]) => xs.map((x) => Math.round(x * 1e4) / 1e4);
const pack = (r: ReturnType<typeof simulate>) => ({ p10: round(r.p10), p50: round(r.p50), p90: round(r.p90), probFullByMonth: round(r.probFullByMonth), probHalfByMonth: round(r.probHalfByMonth) });
const simNoCut = pack(simulate({ ...baseSim, growthScale: 1, issuance: policy(null) }));
const simWithCut = pack(simulate({ ...baseSim, growthScale: 1, issuance: policy(cutStartInMonths) }));
const simHalf = pack(simulate({ ...baseSim, growthScale: 0.5, issuance: policy(cutStartInMonths) }));

/* ------------------------------------------------------------------ verdicts */

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const usd = (x: number) => (Math.abs(x) >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${Math.round(x).toLocaleString("en-US")}`);
const num = (x: number) => Math.round(x).toLocaleString("en-US");

const growth90 = s(last90, "volume") / s(prev90, "volume");
const recon30 = reconcile(snap30, latestSnap);
const reconSwitch = reconcile(snapSwitch, latestSnap);
const viaCut = viabilityAfterCut[defaultCostIdx];
const viaNow = viabilityToday[defaultCostIdx];
const attackCostToTvl = costOneThirdUsd / latestTvl;
const n33 = nakamoto(stakes, 1 / 3);

const verdicts: Verdict[] = [
  {
    id: "demand",
    title: "Demand",
    question: "Is use of NEAR Intents still growing?",
    rule: `Supported if the last ${L} days of volume are at least ${RULES.demandGrowth.supported.toFixed(1)}x the ${L} days before; contradicted below ${RULES.demandGrowth.mixedFloor}x.`,
    value: growth90,
    display: `${growth90.toFixed(2)}x`,
    status: grade(growth90, RULES.demandGrowth),
    reading: `NEAR Intents settled ${usd(s(last90, "volume"))} in the last ${L} days against ${usd(s(prev90, "volume"))} in the ${L} days before.`,
    against: "Volume is DefiLlama's series, not rebuilt from chain logs here, and part of the flow now settles on a private path that public indexers cannot see.",
  },
  {
    id: "coverage",
    title: "Income against the security bill",
    question: "How much of what NEAR pays for security comes back to holders?",
    rule: `Supported if buybacks plus gas burn cover at least ${pct(RULES.coverage.supported, 0)} of NEAR minted over ${W} days; contradicted below ${pct(RULES.coverage.mixedFloor, 0)}.`,
    value: coverage,
    display: pct(coverage),
    status: grade(coverage, RULES.coverage),
    reading: `The chain minted ${num(mintedNearPerDay)} NEAR a day. Captured Intents revenue bought ${num(buybackNearPerDay)} and gas burned ${num(burnNearPerDay)}.`,
    against: "Coverage is counted in NEAR while revenue is earned in dollars, so the same revenue covers less when the price rises. Bought NEAR is held, not burned.",
  },
  {
    id: "retention",
    title: "Does the money arrive",
    question: "Do the revenue wallets on chain hold what the revenue series says they received?",
    rule: `Supported if the three revenue wallets gained at least ${pct(RULES.retention.supported, 0)} of the NEAR the series implies over the window; contradicted below ${pct(RULES.retention.mixedFloor, 0)}.`,
    value: recon30.ratio,
    display: pct(recon30.ratio, 0),
    status: grade(recon30.ratio, RULES.retention),
    reading: `From ${recon30.from} to ${recon30.to} the three wallets gained ${num(recon30.gainedNear)} NEAR; the series implies ${num(recon30.impliedNear)}.`,
    against: "Nothing in code locks these wallets. A multisig can move the balance, so this measures a policy that has been kept so far, not a rule.",
  },
  {
    id: "security",
    title: "Security after the cut",
    question: "Does a smaller security budget still price an attack well above what the chain settles?",
    rule: `Supported if one third of all stake costs at least ${RULES.attackCostMultiple.supported}x the value held in NEAR Intents at spot; contradicted below ${RULES.attackCostMultiple.mixedFloor}x.`,
    value: attackCostToTvl,
    display: `${attackCostToTvl.toFixed(1)}x`,
    status: grade(attackCostToTvl, RULES.attackCostMultiple),
    reading: `One third of the ${num(totalStake)} NEAR at stake is worth ${usd(costOneThirdUsd)} at spot, against ${usd(latestTvl)} held in NEAR Intents.`,
    against: "Spot value is not an attack cost: buying that much would move the price up, and a price fall shrinks the margin without any change in stake.",
  },
  {
    id: "validators",
    title: "Validator set after the cut",
    question: "After issuance falls to 1.6%, how much stake sits with validators whose fee income still pays for the machine?",
    rule: `Supported if at least ${pct(RULES.viableStakeShare.supported, 0)} of stake sits with validators whose commission income covers $${VALIDATOR_COST_USD_PER_MONTH.default} a month at the post-cut rate; contradicted below ${pct(RULES.viableStakeShare.mixedFloor, 0)}.`,
    value: viaCut.viableStakeShare,
    display: pct(viaCut.viableStakeShare),
    status: grade(viaCut.viableStakeShare, RULES.viableStakeShare),
    reading: `${viaCut.viableCount} of ${viaCut.assessed} validators clear the bar after the cut (${viaNow.viableCount} today); they hold ${pct(viaCut.viableStakeShare)} of stake.`,
    against: `The $${VALIDATOR_COST_USD_PER_MONTH.default} a month cost is an assumption, and commission is a lower bound on operator income because it leaves out rewards on the operator's own stake.`,
  },
  {
    id: "concentration",
    title: "Who could halt the chain",
    question: "How many validators would have to act together to hold a third of stake?",
    rule: `Supported at ${RULES.nakamoto.supported} or more validators; contradicted below ${RULES.nakamoto.mixedFloor}.`,
    value: n33,
    display: `${n33}`,
    status: grade(n33, RULES.nakamoto),
    reading: `The ${n33} largest of ${rows.length} validators hold more than a third of stake; the ten largest hold ${pct(sum(stakes.slice(0, 10)) / totalStake)}.`,
    against: "Validator accounts are not owners. Several pools can belong to one operator, so the true number is this or lower.",
  },
  {
    id: "staker",
    title: "The holder who stakes",
    question: "Does a staker's share of all NEAR still grow after the cut?",
    rule: `Supported if the real staking yield after the cut is above ${pct(RULES.realStakerYield.supported, 0)}; contradicted below ${pct(RULES.realStakerYield.mixedFloor)}.`,
    value: yieldsAfterCut.realStaker,
    display: pct(yieldsAfterCut.realStaker, 2),
    status: grade(yieldsAfterCut.realStaker, RULES.realStakerYield),
    reading: `Staking pays ${pct(yieldsToday.nominal, 2)} a year today and ${pct(yieldsAfterCut.nominal, 2)} after the cut; net of supply growth that is ${pct(yieldsToday.realStaker, 2)} and ${pct(yieldsAfterCut.realStaker, 2)}.`,
    against: "This holds the staked share fixed. If lower rewards make holders unstake, the yield per staked NEAR rises and the stake securing the chain falls.",
  },
];

const supportedN = verdicts.filter((v) => v.status === "supported").length;
const contradictedN = verdicts.filter((v) => v.status === "contradicted").length;
const core = verdicts.find((v) => v.id === "coverage")!;
const stanceLabel = core.status === "supported" && contradictedN === 0 ? "Self-funding" : core.status === "contradicted" ? "Subsidised" : "Closing the gap";
const stance = {
  label: stanceLabel,
  summary: `${supportedN} of ${verdicts.length} tests supported, ${contradictedN} contradicted. NEAR earns back ${pct(coverage)} of what it pays for security; the HSP-029 cut alone would lift that to ${pct(coverageAfterCut)}.`,
};

/* -------------------------------------------------------------------- output */

const metrics: Metrics = {
  generatedAt: new Date().toISOString(),
  asOf,
  price: { usd: price, date: asOf },
  supply: { total: supplyNow, staked: totalStake, stakedShare },
  protocol: { version: config.protocol_version as number, maxInflationRate: maxInflation, treasuryRewardRate: trDen ? trNum / trDen : 0, epochLength: config.epoch_length as number },
  issuance: {
    epochs: inWindow.length,
    windowDays,
    fromDate: new Date(first.startTsMs).toISOString(),
    toDate: new Date(newest.startTsMs).toISOString(),
    meanEpochHours,
    epochsPerYear,
    mintedNearPerDay,
    burnNearPerDay,
    netNearPerDay: mintedNearPerDay - burnNearPerDay,
    mintedRate,
    netRate,
    treasuryShare,
    crossCheckMaxRelDiff,
    budgetUsdPerYear,
    budgetUsdPerYearAfterCut: budgetUsdPerYear * cutScale,
  },
  intents: {
    windowDays: W,
    volumeUsd: vol30,
    feesUsd: fees30,
    revenueUsd: rev30,
    takeRateBps: (fees30 / vol30) * 1e4,
    captureShare: rev30 / fees30,
    volume90: s(last90, "volume"),
    volumePrev90: s(prev90, "volume"),
    growth90,
    fees90: s(last90, "fees"),
    revenue90: s(last90, "revenue"),
    tvlUsd: latestTvl,
    revenueUsdPerDay: rev30 / W,
    revenueSinceSwitchUsd: s(sinceSwitch, "revenue"),
  },
  ledger: {
    windowDays: W,
    mintedNearPerDay,
    buybackNearPerDay,
    burnNearPerDay,
    coverage,
    coverageBuybackOnly,
    coverage90,
    coverageAfterCut,
    breakEvenRevenueMultiple: (mintedNearPerDay - burnNearPerDay) / buybackNearPerDay,
    shortfallUsdPerYear: budgetUsdPerYear - incomeUsdPerYear,
  },
  wallets: {
    list: REVENUE_WALLETS.map((w) => ({ id: w.id, label: w.label, near: near(latestSnap.balances[w.id] ?? "0") })),
    totalNear: held(latestSnap),
    treasuryNear: near(latestSnap.balances[OTHER_WALLETS[0].id] ?? "0"),
    window: recon30,
    sinceSwitch: reconSwitch,
  },
  validators: {
    count: rows.length,
    totalStake,
    nakamoto33: n33,
    nakamoto67: nakamoto(stakes, 2 / 3),
    top10Share: sum(stakes.slice(0, 10)) / totalStake,
    gini: gini(stakes),
    minStake: sortedStakes[0],
    medianStake: quantile(sortedStakes, 0.5),
    medianCommission: quantile(commissions, 0.5),
    stakeWeightedCommission,
    commissionUnreadable: rows.length - known.length,
    rewardPerEpoch: sum(validatorRewards),
    medianRewardPerEpoch: quantile(validatorRewards.slice().sort((a, b) => a - b), 0.5),
    viability: { today: viabilityToday, afterCut: viabilityAfterCut },
    rows: rows.map((r) => ({ ...r, stake: Math.round(r.stake), rewardPerEpoch: Math.round(r.rewardPerEpoch * 1e4) / 1e4 })),
  },
  security: {
    costOneThirdUsd,
    costTwoThirdsUsd: costOneThirdUsd * 2,
    attackCostToTvl,
    budgetPerDollarOfFees: budgetUsdPerYear / annualFeesUsd,
    annualFeesUsd,
  },
  staker: { today: yieldsToday, afterCut: yieldsAfterCut },
  growth: { monthly, medianLast6: quantile(last6, 0.5), medianAll: quantile(sortedGrowth, 0.5), simulationRates: growthRates, simulationClipped: recentGrowth.filter((g) => g < fences.lo || g > fences.hi).length, simulationMean: mean(growthRates) },
  simulation: { ...SIM, noCut: simNoCut, withCut: simWithCut, halfSpeedWithCut: simHalf, cutStartInMonths },
  usage: {
    txnsPerDay30: s(last30, "txns") / W,
    txnsPerDayPrev30: s(prev30, "txns") / W,
    activeAccounts30: s(last30, "active") / W,
    activeAccountsPrev30: s(prev30, "active") / W,
    burnCalibration,
  },
  verdicts,
  stance,
  sources: manifest,
  assumptions: { validatorCostUsdPerMonth: VALIDATOR_COST_USD_PER_MONTH.default, hsp029: { ...HSP029 } },
};

/* trailing-30-day coverage through time, with issuance estimated from the supply series */
const coverage30: (number | null)[] = [];
const mintedEst: (number | null)[] = [];
daily.forEach((r, i) => {
  if (i < W || r.date < FEE_SWITCH_DATE) {
    coverage30.push(null);
    mintedEst.push(null);
    return;
  }
  const win = daily.slice(i - W + 1, i + 1);
  const burn = (sum(win.map((x) => x.feeNear)) * burnCalibration) / W;
  const minted = (r.supply - daily[i - W].supply) / W + burn; // supply change plus what was burned
  mintedEst.push(minted > 0 ? Math.round(minted) : null);
  coverage30.push(minted > 0 ? Math.round(((sum(win.map((x) => x.buybackNear)) / W + burn) / minted) * 1e4) / 1e4 : null);
});

const series: Series = {
  dates,
  price: daily.map((r) => Math.round(r.price * 1e4) / 1e4),
  volumeUsd: daily.map((r) => Math.round(r.volume)),
  feesUsd: daily.map((r) => Math.round(r.fees)),
  revenueUsd: daily.map((r) => Math.round(r.revenue)),
  buybackNear: daily.map((r) => Math.round(r.buybackNear)),
  supply: daily.map((r) => Math.round(r.supply)),
  txns: daily.map((r) => r.txns),
  activeAccounts: daily.map((r) => r.active),
  coverage30,
  mintedEstNear: mintedEst,
  burnEstNear: daily.map((r) => Math.round(r.feeNear * burnCalibration)),
  tvlUsd: daily.map((r) => (r.tvl === null ? null : Math.round(r.tvl))),
  epochs: epochs.slice(1).map((e, i) => {
    const prev = epochs[i];
    const hours = (e.startTsMs - prev.startTsMs) / 3_600_000;
    const minted = near(mintedAt(e)); // paid in the first block of the next epoch, for the work of this one
    const burn = near(BigInt(prev.supplyAtStart) + mintedAt(e) - BigInt(e.supplyAtStart));
    return {
      height: prev.epochHeight,
      date: new Date(prev.startTsMs).toISOString(),
      mintedNear: Math.round(minted * 100) / 100,
      burnNear: Math.round(burn * 100) / 100,
      hours: Math.round(hours * 1000) / 1000,
      stake: Math.round(near(prev.totalStake)),
      validators: prev.validatorCount,
      annualRate: Math.round(((minted / hours) * 24 * DAYS_PER_YEAR * 1e6) / near(prev.supplyAtStart)) / 1e6,
    };
  }),
};

await writeJson(resolve(DATA_DIR, "metrics.json"), metrics);
await writeJson(resolve(DATA_DIR, "series.json"), series, false);
void YOCTO;
void EPOCHS_TARGET;
void mean;
log(`metrics.json and series.json written. As of ${asOf}: price $${price.toFixed(2)}, minted ${num(mintedNearPerDay)} NEAR/day (${pct(mintedRate, 2)}/yr), coverage ${pct(coverage)}, stance "${stance.label}"`);
