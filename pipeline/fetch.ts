/**
 * Step 1 of the rebuild: download every raw input into data/raw/ and record
 * a manifest (url, time, bytes, sha256) so any number can be traced to a file.
 *
 * Design rules:
 *  - No API keys. Every source is public.
 *  - A source that fails keeps its last good copy and is marked "kept" in the
 *    manifest. The build never publishes a half-downloaded file.
 *  - Archival RPC work is incremental: finished epochs are cached by epoch
 *    height and never fetched twice.
 */
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import { RAW_DIR, log, readJsonOr, writeJson, type ManifestEntry } from "./lib/io.js";
import { getBlock, getFinalBlock, getJson, pool, rpc, viewAccount, viewCall, RpcError, type ValidatorsResult } from "./lib/http.js";
import { EPOCHS_TARGET, FEE_SWITCH_DATE, REVENUE_WALLETS, OTHER_WALLETS } from "./config.js";

const manifest: ManifestEntry[] = [];
const previous = await readJsonOr<ManifestEntry[]>(resolve(RAW_DIR, "manifest.json"), []);

async function source(file: string, sourceName: string, url: string, produce: () => Promise<unknown>, note?: string) {
  const path = resolve(RAW_DIR, file);
  const fetchedAt = new Date().toISOString();
  try {
    const value = await produce();
    const hash = await writeJson(path, value, false);
    const { size } = await stat(path);
    manifest.push({ file, source: sourceName, url, fetchedAt, bytes: size, sha256: hash, status: "fresh", note });
    log(`fresh  ${file} (${size.toLocaleString()} bytes)`);
  } catch (err) {
    const old = previous.find((m) => m.file === file);
    if (!old) throw new Error(`${file}: download failed and there is no earlier copy to keep. ${(err as Error).message}`);
    manifest.push({ ...old, status: "kept", note: `kept copy from ${old.fetchedAt}; refresh failed: ${(err as Error).message}`.slice(0, 300) });
    log(`KEPT   ${file} (refresh failed: ${(err as Error).message})`);
  }
  await saveManifest();
}

/** Written after every source, so an interrupted run still leaves a usable record of what it finished. */
async function saveManifest() {
  const rest = previous.filter((p) => !manifest.some((m) => m.file === p.file));
  await writeJson(resolve(RAW_DIR, "manifest.json"), [...manifest, ...rest]);
}

/* ---------------------------------------------------------------- DefiLlama */

type LlamaSummary = { totalDataChart: [number, number][]; methodology?: Record<string, string> };
const llama = (path: string) => `https://api.llama.fi/${path}`;

async function llamaSeries(url: string) {
  const j = await getJson<LlamaSummary>(url);
  if (!Array.isArray(j.totalDataChart) || j.totalDataChart.length < 30) throw new Error("series missing or too short");
  return { chart: j.totalDataChart, methodology: j.methodology ?? null };
}

await source("llama_intents_volume.json", "DefiLlama", llama("summary/dexs/near-intents"), () => llamaSeries(llama("summary/dexs/near-intents")));
await source("llama_intents_fees.json", "DefiLlama", llama("summary/fees/near-intents?dataType=dailyFees"), () => llamaSeries(llama("summary/fees/near-intents?dataType=dailyFees")));
await source("llama_intents_revenue.json", "DefiLlama", llama("summary/fees/near-intents?dataType=dailyRevenue"), () => llamaSeries(llama("summary/fees/near-intents?dataType=dailyRevenue")));
await source("llama_intents_holders_revenue.json", "DefiLlama", llama("summary/fees/near-intents?dataType=dailyHoldersRevenue"), () =>
  llamaSeries(llama("summary/fees/near-intents?dataType=dailyHoldersRevenue")),
);
await source("llama_intents_tvl.json", "DefiLlama", llama("protocol/near-intents"), async () => {
  const j = await getJson<{ tvl: { date: number; totalLiquidityUSD: number }[] }>(llama("protocol/near-intents"));
  if (!Array.isArray(j.tvl) || j.tvl.length < 10) throw new Error("tvl series missing");
  return { chart: j.tvl.map((p) => [p.date, p.totalLiquidityUSD]) };
});

/* --------------------------------------------------------------- NearBlocks */

type NbRow = Record<string, string>;
await source("nearblocks_charts.json", "NearBlocks", "https://api.nearblocks.io/v1/charts", async () => {
  const j = await getJson<{ charts: NbRow[] }>("https://api.nearblocks.io/v1/charts", { timeoutMs: 90_000 });
  if (!Array.isArray(j.charts) || j.charts.length < 1000) throw new Error("charts missing");
  const keep = ["date", "near_price", "total_supply", "txns", "txn_fee", "active_accounts", "new_accounts", "blocks"] as const;
  return {
    fields: keep,
    rows: j.charts.filter((r) => r.date >= "2023-01-01").map((r) => keep.map((k) => (k === "date" ? r.date.slice(0, 10) : r[k]))),
  };
});

/* ------------------------------------------------------------------ NEAR RPC */

const head = await getFinalBlock();
const headTsMs = Number(BigInt(head.header.timestamp_nanosec) / 1_000_000n);

await source("rpc_head.json", "NEAR RPC", "rpc: block {finality: final}", async () => ({
  height: head.header.height,
  timestampMs: headTsMs,
  totalSupply: head.header.total_supply,
}));

await source("rpc_protocol_config.json", "NEAR RPC", "rpc: EXPERIMENTAL_protocol_config", async () => {
  const c = await rpc<Record<string, unknown>>("EXPERIMENTAL_protocol_config", { finality: "final" });
  const pick = ["protocol_version", "epoch_length", "num_blocks_per_year", "max_inflation_rate", "protocol_reward_rate", "protocol_treasury_account", "online_min_threshold", "online_max_threshold", "protocol_upgrade_stake_threshold", "minimum_stake_ratio"];
  return Object.fromEntries(pick.map((k) => [k, c[k] ?? null]));
});

let currentValidators: ValidatorsResult | null = null;
await source("rpc_validators.json", "NEAR RPC", "rpc: validators [null]", async () => {
  const v = await rpc<ValidatorsResult>("validators", [null]);
  currentValidators = v;
  return {
    epochHeight: v.epoch_height,
    epochStartHeight: v.epoch_start_height,
    validators: v.current_validators.map((x) => ({
      id: x.account_id,
      stake: x.stake,
      blocks: [x.num_produced_blocks, x.num_expected_blocks],
      chunks: [x.num_produced_chunks, x.num_expected_chunks],
      endorsements: [x.num_produced_endorsements ?? 0, x.num_expected_endorsements ?? 0],
    })),
    nextValidators: v.next_validators.length,
    kickedOut: v.prev_epoch_kickout.length,
    rewardPaidPrevEpoch: v.validator_reward_paid_prev_epoch ?? {},
  };
});

await source("rpc_commissions.json", "NEAR RPC", "rpc: call_function get_reward_fee_fraction on every validator pool", async () => {
  const v = currentValidators ?? (await rpc<ValidatorsResult>("validators", [null]));
  // Commissions change rarely. Reuse readings made in the last 20 hours and only ask for pools we have not seen.
  const earlier = previous.find((x) => x.file === "rpc_commissions.json");
  const recent = earlier && Date.now() - Date.parse(earlier.fetchedAt) < 20 * 3_600_000 && !process.env.ASSAY_FORCE;
  const cache = recent ? (await readJsonOr<{ commissions: Record<string, number | null> }>(resolve(RAW_DIR, "rpc_commissions.json"), { commissions: {} })).commissions : {};
  let failures = 0;
  const rows = await pool(v.current_validators, 3, async (val) => {
    if (val.account_id in cache) {
      if (cache[val.account_id] === null) failures++;
      return [val.account_id, cache[val.account_id]] as const;
    }
    try {
      const f = await viewCall<{ numerator: number; denominator: number }>(val.account_id, "get_reward_fee_fraction");
      return [val.account_id, f.denominator > 0 ? f.numerator / f.denominator : null] as const;
    } catch {
      failures++;
      return [val.account_id, null] as const; // not a staking-pool contract, or method missing
    }
  });
  if (failures > v.current_validators.length * 0.25) throw new Error(`${failures} of ${v.current_validators.length} commission reads failed`);
  return { commissions: Object.fromEntries(rows), unreadable: failures };
});

/* -------------------------------------------------- epoch accounting (cached) */

export type EpochRecord = {
  epochHeight: number;
  startHeight: number;
  startTsMs: number;
  /** hash of the last block of the previous epoch */
  prevHash: string;
  /** id of the previous epoch, read from that block; lets the walk continue from cache */
  prevEpochId: string;
  supplyAtStart: string;
  supplyBeforeStart: string;
  burntInStartBlock: string;
  /** sum of validator_reward_paid_prev_epoch: what was paid in the first block of the PREVIOUS epoch */
  rewardsPaid: string;
  treasuryReward: string;
  validatorCount: number;
  totalStake: string;
};

const sum = (xs: string[]) => xs.reduce((a, x) => a + BigInt(x), 0n);

async function epochRecord(v: ValidatorsResult): Promise<EpochRecord> {
  const start = await getBlock(v.epoch_start_height);
  const before = await getBlock(start.header.prev_hash);
  const rewards = v.validator_reward_paid_prev_epoch ?? {};
  return {
    epochHeight: v.epoch_height,
    startHeight: v.epoch_start_height,
    startTsMs: Number(BigInt(start.header.timestamp_nanosec) / 1_000_000n),
    prevHash: start.header.prev_hash,
    prevEpochId: before.header.epoch_id,
    supplyAtStart: start.header.total_supply,
    supplyBeforeStart: before.header.total_supply,
    burntInStartBlock: sum(start.chunks.map((c) => c.balance_burnt)).toString(),
    rewardsPaid: sum(Object.values(rewards)).toString(),
    treasuryReward: rewards["treasury.near"] ?? "0",
    validatorCount: v.current_validators.length,
    totalStake: sum(v.current_validators.map((x) => x.stake)).toString(),
  };
}

await source(
  "rpc_epochs.json",
  "NEAR archival RPC",
  "rpc: validators [block] + block headers at each epoch boundary",
  async () => {
    const cached = await readJsonOr<{ epochs: EpochRecord[] }>(resolve(RAW_DIR, "rpc_epochs.json"), { epochs: [] });
    const byHeight = new Map(cached.epochs.filter((e) => e.prevEpochId).map((e) => [e.epochHeight, e]));
    const current = currentValidators ?? (await rpc<ValidatorsResult>("validators", [null]));
    const out: EpochRecord[] = [];
    let fetched = 0;
    let rec = byHeight.get(current.epoch_height) ?? (fetched++, await epochRecord(current));
    out.push(rec);
    while (out.length < EPOCHS_TARGET) {
      const wanted = rec.epochHeight - 1;
      let prev = byHeight.get(wanted);
      if (!prev) {
        // Archival nodes answer "validators by block" only for recent epochs; by epoch id they answer for any.
        const v = await rpc<ValidatorsResult>("validators", { epoch_id: rec.prevEpochId }, { archival: true });
        if (v.epoch_height !== wanted) throw new Error(`epoch walk broke: expected ${wanted}, got ${v.epoch_height}`);
        prev = await epochRecord(v);
        fetched++;
        if (fetched % 20 === 0) {
          log(`  epochs fetched: ${fetched}`);
          // checkpoint, so an interrupted first run resumes instead of starting over
          await writeJson(resolve(RAW_DIR, "rpc_epochs.json"), { epochs: [...out, prev, ...cached.epochs.filter((e) => e.epochHeight < wanted)] }, false);
        }
      }
      out.push(prev);
      rec = prev;
    }
    log(`  epochs: ${out.length} total, ${fetched} fetched this run, ${out.length - fetched} from cache`);
    return { epochs: out.sort((a, b) => a.epochHeight - b.epochHeight) };
  },
  "Each record is read at an epoch boundary: supply just before and just after the first block of the epoch, and the rewards paid in that block.",
);

/* ------------------------------------------- wallet balances at fixed moments */

async function blockAtOrAfter(height: number): Promise<{ height: number; tsMs: number }> {
  for (let h = height; h < height + 40; h++) {
    try {
      const b = await getBlock(h);
      return { height: b.header.height, tsMs: Number(BigInt(b.header.timestamp_nanosec) / 1_000_000n) };
    } catch (err) {
      if (err instanceof RpcError && err.causeName === "UNKNOWN_BLOCK") continue; // skipped height
      throw err;
    }
  }
  throw new Error(`no block found near height ${height}`);
}

/** First block whose timestamp is >= tsMs, by bisection on block headers. */
async function firstBlockAt(tsMs: number): Promise<number> {
  let hi = head.header.height;
  let hiTs = headTsMs;
  if (tsMs >= hiTs) return hi;
  let lo = Math.max(1, Math.floor(hi - ((hiTs - tsMs) / 1000) * 2.2)); // blocks are never faster than ~0.45s
  let loB = await blockAtOrAfter(lo);
  while (loB.tsMs > tsMs) {
    lo = Math.max(1, lo - Math.floor((hi - lo) * 1.5) - 1000);
    loB = await blockAtOrAfter(lo);
  }
  lo = loB.height;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const b = await blockAtOrAfter(mid);
    if (b.height >= hi) {
      hi = mid; // every height in [mid, hi) was skipped
      continue;
    }
    if (b.tsMs >= tsMs) {
      hi = b.height;
      hiTs = b.tsMs;
    } else lo = b.height;
  }
  return hi;
}

const DAY = 86_400_000;
const asOfMidnight = Math.floor(headTsMs / DAY) * DAY; // 00:00 UTC today = end of the last full day
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

await source("rpc_wallets.json", "NEAR RPC (live + archival)", "rpc: query view_account at fixed block heights", async () => {
  type Snap = { date: string; height: number; balances: Record<string, string> };
  const cached = await readJsonOr<{ snapshots: Snap[] }>(resolve(RAW_DIR, "rpc_wallets.json"), { snapshots: [] });
  const wanted = [...new Set([FEE_SWITCH_DATE, iso(asOfMidnight - 90 * DAY), iso(asOfMidnight - 30 * DAY), iso(asOfMidnight)])];
  const accounts = [...REVENUE_WALLETS.map((w) => w.id), ...OTHER_WALLETS.map((w) => w.id)];
  const snapshots: Snap[] = [];
  for (const date of wanted) {
    const hit = cached.snapshots.find((s) => s.date === date && accounts.every((a) => a in s.balances));
    if (hit) {
      snapshots.push(hit);
      continue;
    }
    const height = await firstBlockAt(Date.parse(`${date}T00:00:00Z`));
    const balances: Record<string, string> = {};
    for (const a of accounts) {
      try {
        const acc = await viewAccount(a, height);
        balances[a] = (BigInt(acc.amount) + BigInt(acc.locked)).toString();
      } catch (err) {
        if (err instanceof RpcError && err.causeName === "UNKNOWN_ACCOUNT") balances[a] = "0"; // account not created yet
        else throw err;
      }
    }
    snapshots.push({ date, height, balances });
    log(`  wallets at ${date} (block ${height})`);
  }
  return { snapshots };
});

await saveManifest();
const kept = manifest.filter((m) => m.status === "kept").length;
log(`manifest written: ${manifest.length} files, ${kept} kept from an earlier run`);
