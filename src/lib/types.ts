import type { Status, ValidatorRow, Viability, SimulationResult } from "./model";

export type Verdict = {
  id: string;
  title: string;
  /** the question an investor would ask, in plain words */
  question: string;
  /** the rule, fixed in pipeline/config.ts before the number was computed */
  rule: string;
  value: number;
  display: string;
  status: Status;
  /** one sentence on what the measurement shows */
  reading: string;
  /** the strongest point against reading it that way */
  against: string;
};

export type SourceEntry = { file: string; source: string; url: string; fetchedAt: string; bytes: number; sha256: string; status: "fresh" | "kept"; note?: string };

export type Metrics = {
  generatedAt: string;
  /** last full UTC day covered by every daily source */
  asOf: string;
  price: { usd: number; date: string };
  supply: { total: number; staked: number; stakedShare: number };
  protocol: { version: number; maxInflationRate: number; treasuryRewardRate: number; epochLength: number };
  issuance: {
    epochs: number;
    windowDays: number;
    fromDate: string;
    toDate: string;
    meanEpochHours: number;
    epochsPerYear: number;
    mintedNearPerDay: number;
    burnNearPerDay: number;
    netNearPerDay: number;
    mintedRate: number;
    netRate: number;
    treasuryShare: number;
    /** largest relative gap between the supply jump in a block header and the rewards the RPC lists for that epoch */
    crossCheckMaxRelDiff: number;
    budgetUsdPerYear: number;
    budgetUsdPerYearAfterCut: number;
  };
  intents: {
    windowDays: number;
    volumeUsd: number;
    feesUsd: number;
    revenueUsd: number;
    takeRateBps: number;
    captureShare: number;
    volume90: number;
    volumePrev90: number;
    growth90: number;
    fees90: number;
    revenue90: number;
    tvlUsd: number;
    revenueUsdPerDay: number;
    revenueSinceSwitchUsd: number;
  };
  ledger: {
    windowDays: number;
    mintedNearPerDay: number;
    buybackNearPerDay: number;
    burnNearPerDay: number;
    /** (buyback + burn) / minted */
    coverage: number;
    coverageBuybackOnly: number;
    coverage90: number;
    /** same revenue against the post-cut issuance rate */
    coverageAfterCut: number;
    /** NEAR price at or below which today's dollar revenue would cover all issuance */
    breakEvenRevenueMultiple: number;
    shortfallUsdPerYear: number;
  };
  wallets: {
    list: { id: string; label: string; near: number }[];
    totalNear: number;
    treasuryNear: number;
    window: { from: string; to: string; gainedNear: number; impliedNear: number; ratio: number; seriesDays: number };
    sinceSwitch: { from: string; to: string; gainedNear: number; impliedNear: number; ratio: number };
  };
  validators: {
    count: number;
    totalStake: number;
    nakamoto33: number;
    nakamoto67: number;
    top10Share: number;
    gini: number;
    minStake: number;
    medianStake: number;
    medianCommission: number;
    stakeWeightedCommission: number;
    commissionUnreadable: number;
    rewardPerEpoch: number;
    medianRewardPerEpoch: number;
    viability: { today: Viability[]; afterCut: Viability[] };
    rows: ValidatorRow[];
  };
  security: {
    costOneThirdUsd: number;
    costTwoThirdsUsd: number;
    attackCostToTvl: number;
    budgetPerDollarOfFees: number;
    annualFeesUsd: number;
  };
  staker: {
    today: { nominal: number; realStaker: number; realNonStaker: number };
    afterCut: { nominal: number; realStaker: number; realNonStaker: number };
  };
  growth: {
    /** month-on-month growth of Intents gross fees, full calendar months */
    monthly: { month: string; feesUsd: number; revenueUsd: number; volumeUsd: number; growth: number | null }[];
    medianLast6: number;
    medianAll: number;
    /** the month-on-month rates the simulation resamples: the last twelve complete months */
    simulationRates: number[];
    /** how many of those were outliers clipped to Tukey's fences */
    simulationClipped: number;
    simulationMean: number;
  };
  simulation: {
    seed: number;
    paths: number;
    horizonMonths: number;
    blockMonths: number;
    noCut: Pick<SimulationResult, "p10" | "p50" | "p90" | "probFullByMonth" | "probHalfByMonth">;
    withCut: Pick<SimulationResult, "p10" | "p50" | "p90" | "probFullByMonth" | "probHalfByMonth">;
    halfSpeedWithCut: Pick<SimulationResult, "p10" | "p50" | "p90" | "probFullByMonth" | "probHalfByMonth">;
    cutStartInMonths: number;
  };
  usage: { txnsPerDay30: number; txnsPerDayPrev30: number; activeAccounts30: number; activeAccountsPrev30: number; burnCalibration: number };
  verdicts: Verdict[];
  stance: { label: string; summary: string };
  sources: SourceEntry[];
  assumptions: { validatorCostUsdPerMonth: number; hsp029: { fromRate: number; toRate: number; rampMonths: number; assumedStart: string } };
};

/** Daily columns for charts. Arrays are aligned with `dates`. */
export type Series = {
  dates: string[];
  price: number[];
  volumeUsd: number[];
  feesUsd: number[];
  revenueUsd: number[];
  buybackNear: number[];
  supply: number[];
  txns: number[];
  activeAccounts: number[];
  /** trailing 30-day (buyback + burn) / minted, minted estimated from the supply series */
  coverage30: (number | null)[];
  mintedEstNear: (number | null)[];
  burnEstNear: number[];
  tvlUsd: (number | null)[];
  epochs: { height: number; date: string; mintedNear: number; burnNear: number; hours: number; stake: number; validators: number; annualRate: number }[];
};
