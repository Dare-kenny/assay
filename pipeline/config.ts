/**
 * Every setting the analysis depends on, in one place. Changing a value here
 * and running `npm run rebuild:offline` re-derives every number.
 */

/** Epoch boundaries to read from archival RPC. ~125 epochs is a little over 35 days. */
export const EPOCHS_TARGET = 125;

/** NEAR Intents revenue started buying NEAR on the open market on this date (DefiLlama methodology note). */
export const FEE_SWITCH_DATE = "2026-02-23";

/** The wallets DefiLlama's revenue series counts. Read on chain to reconcile the series. */
export const REVENUE_WALLETS = [
  { id: "buybacks.multisignature.near", label: "Buyback multisig" },
  { id: "fefundsadmin.sputnik-dao.near", label: "Front-end fund DAO" },
  { id: "1csfundsadmin.sputnik-dao.near", label: "1Click fund DAO" },
] as const;

export const OTHER_WALLETS = [{ id: "treasury.near", label: "Protocol treasury" }] as const;

/**
 * HSP-029 as reported: maximum annual issuance 2.5% -> 1.6%, stepped down
 * over 24 months. The start date is not set on chain; it is an assumption
 * the reader can change in the model.
 */
export const HSP029 = {
  fromRate: 0.025,
  toRate: 0.016,
  rampMonths: 24,
  assumedStart: "2027-04-01",
} as const;

/**
 * Validator operating cost. This is an assumption, not a measurement: the
 * chain does not publish what an operator pays for hardware. The dashboard
 * exposes it as a control and the thesis reports results across the grid.
 */
export const VALIDATOR_COST_USD_PER_MONTH = { default: 500, grid: [250, 500, 1000, 2000] } as const;

/** Verdict thresholds, written before the numbers were computed. See THESIS.md. */
export const RULES = {
  demandGrowth: { supported: 1.0, mixedFloor: 0.8 },
  coverage: { supported: 0.5, mixedFloor: 0.2 },
  retention: { supported: 0.9, mixedFloor: 0.75 },
  attackCostMultiple: { supported: 2.0, mixedFloor: 1.0 },
  viableStakeShare: { supported: 0.9, mixedFloor: 0.67 },
  realStakerYield: { supported: 0.0, mixedFloor: -0.005 },
  nakamoto: { supported: 10, mixedFloor: 7 },
} as const;

export const WINDOWS = { short: 30, long: 90 } as const;
