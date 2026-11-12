/**
 * The model. Pure functions only: no I/O, no clock, no randomness that is not
 * seeded. The pipeline, the website and the tests all import this one file,
 * so a number on the page and a number in THESIS.md cannot disagree.
 */

export const DAYS_PER_YEAR = 365;
export const DAYS_PER_MONTH = DAYS_PER_YEAR / 12;
const MS_PER_DAY = 86_400_000;

/* ------------------------------------------------------------------ helpers */

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Small, fast, seeded PRNG so every simulation is reproducible bit for bit. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ----------------------------------------------------------------- issuance */

export type IssuancePolicy = {
  /** annual minted rate measured today, as a fraction of supply */
  measuredRate: number;
  /** the protocol's maximum rate today (2.5%) */
  fromRate: number;
  /** the maximum rate after the cut (1.6%) */
  toRate: number;
  rampMonths: number;
  /** months from the projection start until the ramp begins; null = the cut never starts */
  startInMonths: number | null;
};

/**
 * Annual minted rate t months from now. The measured rate is scaled by the
 * ratio of the scheduled maximum to today's maximum, so that whatever makes
 * the measured rate differ from the cap today (validator uptime) carries over.
 */
export function issuanceRateAt(monthsFromNow: number, p: IssuancePolicy): number {
  if (p.startInMonths === null || monthsFromNow <= p.startInMonths) return p.measuredRate;
  const progress = Math.min(1, (monthsFromNow - p.startInMonths) / Math.max(p.rampMonths, 1e-9));
  const cap = p.fromRate + (p.toRate - p.fromRate) * progress;
  return p.measuredRate * (cap / p.fromRate);
}

/* --------------------------------------------------------------- projection */

export type ProjectionInput = {
  supply: number;
  priceUsd: number;
  /** captured Intents revenue that buys NEAR, USD per day, today */
  buybackUsdPerDay: number;
  /** NEAR burned as gas, per day, today */
  burnNearPerDay: number;
  /** month-on-month growth of captured revenue at the start, e.g. 0.05 */
  monthlyGrowth: number;
  /** months for that growth rate to halve; null = it never fades */
  growthHalfLifeMonths: number | null;
  /** NEAR price change per year, e.g. 0 for flat */
  priceGrowthAnnual: number;
  issuance: IssuancePolicy;
  months: number;
};

export type ProjectionPoint = {
  month: number;
  rate: number;
  supply: number;
  priceUsd: number;
  mintedNearPerDay: number;
  buybackUsdPerDay: number;
  buybackNearPerDay: number;
  burnNearPerDay: number;
  /** (buyback + burn) / minted: the share of the security bill that comes back to holders */
  coverage: number;
};

/**
 * Coverage is counted in NEAR. Revenue is earned in dollars and converted at
 * the path's price, so a rising price lowers coverage for the same revenue.
 * Bought NEAR is held in a multisig, not burned, so it does not reduce supply
 * here; only the gas burn does.
 */
export function project(input: ProjectionInput, growthPath?: number[]): ProjectionPoint[] {
  const out: ProjectionPoint[] = [];
  let supply = input.supply;
  let buybackUsd = input.buybackUsdPerDay;
  const priceStep = Math.pow(1 + input.priceGrowthAnnual, 1 / 12);
  let price = input.priceUsd;
  for (let m = 0; m <= input.months; m++) {
    const rate = issuanceRateAt(m, input.issuance);
    const minted = (supply * rate) / DAYS_PER_YEAR;
    const buybackNear = buybackUsd / price;
    out.push({
      month: m,
      rate,
      supply,
      priceUsd: price,
      mintedNearPerDay: minted,
      buybackUsdPerDay: buybackUsd,
      buybackNearPerDay: buybackNear,
      burnNearPerDay: input.burnNearPerDay,
      coverage: minted > 0 ? (buybackNear + input.burnNearPerDay) / minted : NaN,
    });
    const g = growthPath ? growthPath[m] ?? 0 : input.growthHalfLifeMonths === null ? input.monthlyGrowth : input.monthlyGrowth * Math.pow(0.5, m / input.growthHalfLifeMonths);
    buybackUsd *= 1 + g;
    price *= priceStep;
    supply += (minted - input.burnNearPerDay) * DAYS_PER_MONTH;
  }
  return out;
}

/** First month at which coverage reaches the target, or null if it never does on this path. */
export function firstMonthAtCoverage(path: ProjectionPoint[], target: number): number | null {
  const hit = path.find((p) => p.coverage >= target);
  return hit ? hit.month : null;
}

/* -------------------------------------------------------------- simulation */

export type SimulationInput = Omit<ProjectionInput, "monthlyGrowth" | "growthHalfLifeMonths"> & {
  /** observed month-on-month growth rates to resample from, as fractions */
  historicalMonthlyGrowth: number[];
  /** resample in blocks of this many months to keep short-run momentum */
  blockMonths: number;
  /** multiply every resampled growth rate by this; 1 = history repeats, 0.5 = half as fast */
  growthScale: number;
  paths: number;
  seed: number;
};

export type SimulationResult = {
  months: number[];
  p10: number[];
  p50: number[];
  p90: number[];
  /** probability that coverage has reached 100% at least once by each month */
  probFullByMonth: number[];
  /** probability that coverage has reached 50% at least once by each month */
  probHalfByMonth: number[];
};

/**
 * Block bootstrap of the observed monthly growth rates. This asks "what if
 * the future is drawn from the same months we have already seen", which is a
 * scenario generator and not a forecast: the history is short and it starts
 * from a small base, so early months grew far faster than later ones can.
 */
export function simulate(input: SimulationInput): SimulationResult {
  const rand = mulberry32(input.seed);
  const hist = input.historicalMonthlyGrowth;
  const months = Array.from({ length: input.months + 1 }, (_, i) => i);
  const coverageByMonth: number[][] = months.map(() => []);
  const fullBy = months.map(() => 0);
  const halfBy = months.map(() => 0);
  for (let p = 0; p < input.paths; p++) {
    const growth: number[] = [];
    while (growth.length <= input.months) {
      const startIdx = Math.floor(rand() * hist.length);
      for (let k = 0; k < input.blockMonths && growth.length <= input.months; k++) growth.push(hist[(startIdx + k) % hist.length] * input.growthScale);
    }
    const path = project({ ...input, monthlyGrowth: 0, growthHalfLifeMonths: null }, growth);
    let full = false;
    let half = false;
    for (const pt of path) {
      coverageByMonth[pt.month].push(pt.coverage);
      if (pt.coverage >= 1) full = true;
      if (pt.coverage >= 0.5) half = true;
      if (full) fullBy[pt.month]++;
      if (half) halfBy[pt.month]++;
    }
  }
  const q = (i: number, qq: number) => quantile(coverageByMonth[i].slice().sort((a, b) => a - b), qq);
  return {
    months,
    p10: months.map((i) => q(i, 0.1)),
    p50: months.map((i) => q(i, 0.5)),
    p90: months.map((i) => q(i, 0.9)),
    probFullByMonth: fullBy.map((n) => n / input.paths),
    probHalfByMonth: halfBy.map((n) => n / input.paths),
  };
}

/* -------------------------------------------------------- validator economics */

export type ValidatorRow = {
  id: string;
  /** NEAR staked with this validator */
  stake: number;
  /** NEAR this pool was paid for the last full epoch */
  rewardPerEpoch: number;
  /** share of pool rewards the operator keeps, 0..1; null when the pool does not expose it */
  commission: number | null;
};

export type Viability = {
  costUsdPerMonth: number;
  rateScale: number;
  /** validators whose commission income is known */
  assessed: number;
  viableCount: number;
  /** share of assessed stake that sits with validators whose commission pays the bill */
  viableStakeShare: number;
  medianOperatorIncomeUsdPerYear: number;
};

/**
 * Commission income is a lower bound on what an operator earns: it leaves out
 * rewards on the operator's own stake, which the chain cannot tell apart from
 * a delegator's. A validator that fails this test is not necessarily losing
 * money; it is one whose fee income alone does not pay for the machine.
 */
export function viability(rows: ValidatorRow[], epochsPerYear: number, priceUsd: number, costUsdPerMonth: number, rateScale: number): Viability {
  const known = rows.filter((r) => r.commission !== null);
  const incomes = known.map((r) => r.rewardPerEpoch * (r.commission as number) * epochsPerYear * priceUsd * rateScale);
  const need = costUsdPerMonth * 12;
  const totalStake = sum(known.map((r) => r.stake));
  let viableCount = 0;
  let viableStake = 0;
  known.forEach((r, i) => {
    if (incomes[i] >= need) {
      viableCount++;
      viableStake += r.stake;
    }
  });
  return {
    costUsdPerMonth,
    rateScale,
    assessed: known.length,
    viableCount,
    viableStakeShare: totalStake > 0 ? viableStake / totalStake : NaN,
    medianOperatorIncomeUsdPerYear: quantile(incomes.slice().sort((a, b) => a - b), 0.5),
  };
}

/** Fewest validators whose combined stake exceeds the given share of all stake. */
export function nakamoto(stakes: number[], share = 1 / 3): number {
  const sorted = stakes.slice().sort((a, b) => b - a);
  const total = sum(sorted);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i];
    if (acc > total * share) return i + 1;
  }
  return sorted.length;
}

export function gini(values: number[]): number {
  const xs = values.slice().sort((a, b) => a - b);
  const n = xs.length;
  const total = sum(xs);
  if (!n || total === 0) return NaN;
  let acc = 0;
  xs.forEach((x, i) => (acc += (2 * (i + 1) - n - 1) * x));
  return acc / (n * total);
}

/* ------------------------------------------------------------- staker yield */

export type YieldInput = {
  /** annual NEAR minted to validators and their delegators (treasury share excluded), as a fraction of supply */
  mintedToStakersRate: number;
  /** annual net supply growth: minted minus burned, as a fraction of supply */
  netSupplyGrowth: number;
  stakedShare: number;
  commission: number;
};

export function stakerYields(i: YieldInput) {
  const nominal = (i.mintedToStakersRate / i.stakedShare) * (1 - i.commission);
  return {
    nominal,
    /** what a staker's share of all NEAR grows by in a year */
    realStaker: (1 + nominal) / (1 + i.netSupplyGrowth) - 1,
    /** what a holder who does not stake loses of their share in a year */
    realNonStaker: 1 / (1 + i.netSupplyGrowth) - 1,
  };
}

/* ------------------------------------------------------------------ verdicts */

export type Status = "supported" | "mixed" | "contradicted";

/** Higher is better: at or above `supported` passes, below `mixedFloor` fails. */
export function grade(value: number, rule: { supported: number; mixedFloor: number }): Status {
  if (!Number.isFinite(value)) return "contradicted";
  if (value >= rule.supported) return "supported";
  if (value >= rule.mixedFloor) return "mixed";
  return "contradicted";
}

export const daysBetween = (aMs: number, bMs: number) => (bMs - aMs) / MS_PER_DAY;
