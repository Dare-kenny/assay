import { describe, expect, it } from "vitest";
import { firstMonthAtCoverage, gini, grade, issuanceRateAt, mulberry32, nakamoto, project, quantile, simulate, stakerYields, viability, type IssuancePolicy, type ProjectionInput } from "../src/lib/model";

const policy = (startInMonths: number | null): IssuancePolicy => ({ measuredRate: 0.024, fromRate: 0.025, toRate: 0.016, rampMonths: 24, startInMonths });

const base: ProjectionInput = {
  supply: 1_300_000_000,
  priceUsd: 3.5,
  buybackUsdPerDay: 50_000,
  burnNearPerDay: 1_000,
  monthlyGrowth: 0,
  growthHalfLifeMonths: null,
  priceGrowthAnnual: 0,
  issuance: policy(null),
  months: 60,
};

describe("issuance", () => {
  it("stays at the measured rate when the cut never starts", () => {
    expect(issuanceRateAt(0, policy(null))).toBe(0.024);
    expect(issuanceRateAt(120, policy(null))).toBe(0.024);
  });
  it("ramps linearly and keeps the measured-to-cap ratio", () => {
    const p = policy(6);
    expect(issuanceRateAt(6, p)).toBe(0.024);
    expect(issuanceRateAt(18, p)).toBeCloseTo(0.024 * ((0.025 + (0.016 - 0.025) * 0.5) / 0.025), 12);
    expect(issuanceRateAt(30, p)).toBeCloseTo(0.024 * (0.016 / 0.025), 12);
    expect(issuanceRateAt(300, p)).toBeCloseTo(0.024 * (0.016 / 0.025), 12);
  });
});

describe("projection", () => {
  it("month 0 reproduces the inputs", () => {
    const p0 = project(base)[0];
    expect(p0.mintedNearPerDay).toBeCloseTo((1_300_000_000 * 0.024) / 365, 6);
    expect(p0.buybackNearPerDay).toBeCloseTo(50_000 / 3.5, 9);
    expect(p0.coverage).toBeCloseTo((50_000 / 3.5 + 1_000) / ((1_300_000_000 * 0.024) / 365), 12);
  });
  it("with no growth, coverage drifts down as supply grows", () => {
    const path = project(base);
    expect(path.at(-1)!.coverage).toBeLessThan(path[0].coverage);
    expect(firstMonthAtCoverage(path, 1)).toBeNull();
  });
  it("a rising price lowers coverage for the same dollar revenue", () => {
    const flat = project(base).at(-1)!.coverage;
    const up = project({ ...base, priceGrowthAnnual: 0.2 }).at(-1)!.coverage;
    expect(up).toBeLessThan(flat);
  });
  it("the cut raises coverage and never lowers it", () => {
    const a = project(base);
    const b = project({ ...base, issuance: policy(3) });
    b.forEach((pt, i) => expect(pt.coverage).toBeGreaterThanOrEqual(a[i].coverage - 1e-12));
    expect(b.at(-1)!.coverage / a.at(-1)!.coverage).toBeGreaterThan(1.5);
  });
  it("steady growth reaches full coverage and reports the month", () => {
    const path = project({ ...base, monthlyGrowth: 0.08 });
    const m = firstMonthAtCoverage(path, 1);
    expect(m).not.toBeNull();
    expect(path[m! - 1].coverage).toBeLessThan(1);
  });
  it("fading growth converges", () => {
    const path = project({ ...base, monthlyGrowth: 0.1, growthHalfLifeMonths: 6, months: 240 });
    const late = path[200].buybackUsdPerDay / path[199].buybackUsdPerDay;
    expect(late).toBeLessThan(1.0001);
  });
});

describe("simulation", () => {
  const input = { ...base, historicalMonthlyGrowth: [0.3, -0.1, 0.05, 0.12, -0.2, 0.08], blockMonths: 3, growthScale: 1, paths: 500, seed: 7 };
  it("is reproducible from its seed", () => {
    expect(simulate(input)).toEqual(simulate(input));
    expect(simulate({ ...input, seed: 8 }).p50).not.toEqual(simulate(input).p50);
  });
  it("orders its quantiles and its probabilities never fall", () => {
    const r = simulate(input);
    r.months.forEach((i) => {
      expect(r.p10[i]).toBeLessThanOrEqual(r.p50[i]);
      expect(r.p50[i]).toBeLessThanOrEqual(r.p90[i]);
      if (i > 0) expect(r.probFullByMonth[i]).toBeGreaterThanOrEqual(r.probFullByMonth[i - 1]);
    });
    expect(r.p10[0]).toBe(r.p90[0]);
  });
  it("zero growth scale collapses to the deterministic path", () => {
    const r = simulate({ ...input, growthScale: 0 });
    const det = project(base);
    expect(r.p50.at(-1)).toBeCloseTo(det.at(-1)!.coverage, 12);
  });
});

describe("validators", () => {
  const rows = [
    { id: "a", stake: 50, rewardPerEpoch: 100, commission: 0.1 },
    { id: "b", stake: 30, rewardPerEpoch: 60, commission: 0.01 },
    { id: "c", stake: 15, rewardPerEpoch: 30, commission: 1 },
    { id: "d", stake: 5, rewardPerEpoch: 10, commission: null },
  ];
  it("counts only validators whose commission pays the bill", () => {
    // income per year at price 1, 1000 epochs: a = 10,000; b = 600; c = 30,000
    const v = viability(rows, 1000, 1, 500, 1);
    expect(v.assessed).toBe(3);
    expect(v.viableCount).toBe(2);
    expect(v.viableStakeShare).toBeCloseTo(65 / 95, 12);
  });
  it("a lower issuance rate can only remove validators", () => {
    const now = viability(rows, 1000, 1, 500, 1);
    const cut = viability(rows, 1000, 1, 500, 0.5);
    expect(cut.viableCount).toBeLessThanOrEqual(now.viableCount);
    expect(cut.viableCount).toBe(1);
  });
  it("nakamoto coefficient", () => {
    expect(nakamoto([50, 30, 15, 5], 1 / 3)).toBe(1);
    expect(nakamoto([25, 25, 25, 25], 1 / 3)).toBe(2);
    expect(nakamoto([25, 25, 25, 25], 2 / 3)).toBe(3);
  });
  it("gini", () => {
    expect(gini([1, 1, 1, 1])).toBeCloseTo(0, 12);
    expect(gini([0, 0, 0, 1])).toBeCloseTo(0.75, 12);
  });
});

describe("yields and grading", () => {
  it("a staker out-earns supply growth and a non-staker is diluted by it", () => {
    const y = stakerYields({ mintedToStakersRate: 0.024, netSupplyGrowth: 0.023, stakedShare: 0.45, commission: 0.05 });
    expect(y.nominal).toBeCloseTo((0.024 / 0.45) * 0.95, 12);
    expect(y.realStaker).toBeGreaterThan(0);
    expect(y.realNonStaker).toBeCloseTo(1 / 1.023 - 1, 12);
  });
  it("grades against fixed thresholds", () => {
    const rule = { supported: 0.5, mixedFloor: 0.2 };
    expect(grade(0.5, rule)).toBe("supported");
    expect(grade(0.49, rule)).toBe("mixed");
    expect(grade(0.19, rule)).toBe("contradicted");
    expect(grade(NaN, rule)).toBe("contradicted");
  });
  it("helpers", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    const r = mulberry32(1);
    const xs = Array.from({ length: 1000 }, r);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });
});
