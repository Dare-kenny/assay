"use client";

import { useCallback, useState } from "react";
import { Reveal } from "@/components/site/Reveal";
import { int, pct, usd } from "@/lib/format";
import { nakamoto } from "@/lib/model";
import type { Metrics } from "@/lib/types";

/**
 * Re-derives headline numbers in the visitor's browser, from the primary
 * sources, and sets them beside the published ones. Nothing here goes through
 * a server of ours: there is none. Each check is independent, has a timeout,
 * and reports a failure to reach its source as exactly that.
 */

const RPCS = ["https://rpc.mainnet.fastnear.com", "https://near.lava.build", "https://rpc.mainnet.near.org"];
const near = (yocto: string) => Number(BigInt(yocto) / 10n ** 18n) / 1e6;

async function rpc<T>(method: string, params: unknown): Promise<T> {
  let last: unknown;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "assay-verify", method, params }), signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(j.error.cause?.name ?? j.error.message ?? "RPC error");
      return j.result as T;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("RPC unreachable");
}

async function llama(path: string): Promise<[number, number][]> {
  const res = await fetch(`https://api.llama.fi/${path}`, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return j.totalDataChart as [number, number][];
}

type Result = { ours: string; live: string; diff: number | null; ok: boolean; note?: string };
type State = { status: "idle" | "running" | "done" | "error"; result?: Result; error?: string };
type Check = { id: string; title: string; how: string; tolerance: number; why: string; run: (m: Metrics, shared: Shared) => Promise<Result> };
type Validators = { current_validators: { account_id: string; stake: string }[]; validator_reward_paid_prev_epoch?: Record<string, string> };
type Shared = { validators?: Promise<Validators> };

const rel = (a: number, b: number) => (b === 0 ? 0 : a / b - 1);
const validators = (s: Shared) => (s.validators ??= rpc<Validators>("validators", [null]));
const windowSum = (chart: [number, number][], asOf: string, days: number) => {
  const end = Date.parse(`${asOf}T00:00:00Z`) / 1000;
  return chart.filter(([t]) => t <= end && t > end - days * 86400).reduce((a, [, v]) => a + v, 0);
};

const CHECKS: Check[] = [
  {
    id: "supply",
    title: "Total supply",
    how: 'RPC block {finality: "final"} -> header.total_supply',
    tolerance: 0.002,
    why: "Supply steps up at each epoch boundary and drifts down between them as gas burns, so a live reading sits within a hair of the snapshot.",
    run: async (m) => {
      const b = await rpc<{ header: { total_supply: string } }>("block", { finality: "final" });
      const live = near(b.header.total_supply);
      const d = rel(live, m.supply.total);
      return { ours: int(m.supply.total), live: int(live), diff: d, ok: Math.abs(d) < 0.002 };
    },
  },
  {
    id: "cap",
    title: "Maximum issuance rate",
    how: "RPC EXPERIMENTAL_protocol_config -> max_inflation_rate",
    tolerance: 0,
    why: "This changes only with a protocol upgrade. If it differs, the issuance cut has activated since this snapshot.",
    run: async (m) => {
      const c = await rpc<{ max_inflation_rate: [number, number] }>("EXPERIMENTAL_protocol_config", { finality: "final" });
      const live = c.max_inflation_rate[0] / c.max_inflation_rate[1];
      return { ours: pct(m.protocol.maxInflationRate, 2), live: pct(live, 2), diff: rel(live, m.protocol.maxInflationRate), ok: live === m.protocol.maxInflationRate };
    },
  },
  {
    id: "mint",
    title: "NEAR minted, annual rate",
    how: "RPC validators [null] -> sum(validator_reward_paid_prev_epoch), annualised with the measured epoch length",
    tolerance: 0.05,
    why: "You are reading one epoch; we average about a hundred. Epochs differ slightly in length and validator uptime.",
    run: async (m, s) => {
      const v = await validators(s);
      const minted = Object.values(v.validator_reward_paid_prev_epoch ?? {}).reduce((a, x) => a + near(x), 0);
      const b = await rpc<{ header: { total_supply: string } }>("block", { finality: "final" });
      const live = (minted * m.issuance.epochsPerYear) / near(b.header.total_supply);
      const d = rel(live, m.issuance.mintedRate);
      return { ours: pct(m.issuance.mintedRate, 3), live: pct(live, 3), diff: d, ok: Math.abs(d) < 0.05, note: `${int(minted)} NEAR paid for the last epoch` };
    },
  },
  {
    id: "stake",
    title: "NEAR at stake",
    how: "RPC validators [null] -> sum(current_validators.stake)",
    tolerance: 0.03,
    why: "Stake moves as holders stake and unstake between epochs.",
    run: async (m, s) => {
      const v = await validators(s);
      const live = v.current_validators.reduce((a, x) => a + near(x.stake), 0);
      const d = rel(live, m.validators.totalStake);
      return { ours: int(m.validators.totalStake), live: int(live), diff: d, ok: Math.abs(d) < 0.03, note: `${v.current_validators.length} validators` };
    },
  },
  {
    id: "nakamoto",
    title: "Validators holding one third of stake",
    how: "Same response, sorted by stake, counted until the running total passes one third",
    tolerance: 0,
    why: "Can shift by one when a large delegation moves.",
    run: async (m, s) => {
      const v = await validators(s);
      const live = nakamoto(v.current_validators.map((x) => near(x.stake)), 1 / 3);
      return { ours: String(m.validators.nakamoto33), live: String(live), diff: live - m.validators.nakamoto33, ok: Math.abs(live - m.validators.nakamoto33) <= 1 };
    },
  },
  {
    id: "wallets",
    title: "NEAR held by the three revenue wallets",
    how: "RPC query view_account on each wallet -> amount + locked",
    tolerance: 0.05,
    why: "The wallets receive revenue every day, so a live reading should be at or above the snapshot. A lower one would matter.",
    run: async (m) => {
      const balances = await Promise.all(m.wallets.list.map((w) => rpc<{ amount: string; locked: string }>("query", { request_type: "view_account", finality: "final", account_id: w.id })));
      const live = balances.reduce((a, b) => a + near(b.amount) + near(b.locked), 0);
      const d = rel(live, m.wallets.totalNear);
      return { ours: int(m.wallets.totalNear), live: int(live), diff: d, ok: d > -0.01 && d < 0.05, note: d < -0.01 ? "Balance fell since the snapshot" : undefined };
    },
  },
  {
    id: "fees",
    title: "Intents fees, 30 days to the snapshot date",
    how: "GET api.llama.fi/summary/fees/near-intents?dataType=dailyFees, summed over the same 30 days",
    tolerance: 0.01,
    why: "DefiLlama occasionally restates recent days.",
    run: async (m) => {
      const live = windowSum(await llama("summary/fees/near-intents?dataType=dailyFees"), m.asOf, m.intents.windowDays);
      const d = rel(live, m.intents.feesUsd);
      return { ours: usd(m.intents.feesUsd, 2), live: usd(live, 2), diff: d, ok: Math.abs(d) < 0.01 };
    },
  },
  {
    id: "capture",
    title: "Share of fees NEAR keeps",
    how: "dailyRevenue / dailyFees over the same 30 days",
    tolerance: 0.01,
    why: "Same restatement caveat.",
    run: async (m) => {
      const [f, r] = await Promise.all([llama("summary/fees/near-intents?dataType=dailyFees"), llama("summary/fees/near-intents?dataType=dailyRevenue")]);
      const live = windowSum(r, m.asOf, m.intents.windowDays) / windowSum(f, m.asOf, m.intents.windowDays);
      const d = rel(live, m.intents.captureShare);
      return { ours: pct(m.intents.captureShare, 2), live: pct(live, 2), diff: d, ok: Math.abs(d) < 0.01 };
    },
  },
  {
    id: "coverage",
    title: "Coverage: buybacks over NEAR minted",
    how: "Each day's revenue (DefiLlama) / that day's price (DefiLlama coins API, a different price source from ours), over NEAR minted in the last epoch. Gas burn left out.",
    tolerance: 0.1,
    why: "Built from a single live epoch and an independent price series, so expect a few percent of drift from our figure.",
    run: async (m, s) => {
      const end = Date.parse(`${m.asOf}T00:00:00Z`) / 1000;
      const days = m.intents.windowDays;
      const [r, v, prices] = await Promise.all([
        llama("summary/fees/near-intents?dataType=dailyHoldersRevenue"),
        validators(s),
        fetch(`https://coins.llama.fi/chart/coingecko:near?start=${end - (days + 1) * 86400}&span=${days + 3}&period=1d`, { signal: AbortSignal.timeout(25_000) }).then((x) => {
          if (!x.ok) throw new Error(`HTTP ${x.status}`);
          return x.json() as Promise<{ coins: Record<string, { prices: { timestamp: number; price: number }[] }> }>;
        }),
      ]);
      const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
      const priceBy = new Map(prices.coins["coingecko:near"].prices.map((p) => [day(p.timestamp), p.price]));
      let bought = 0;
      for (const [t, usdValue] of r) {
        if (t > end || t <= end - days * 86400) continue;
        const p = priceBy.get(day(t)) ?? m.price.usd;
        bought += usdValue / p;
      }
      const buybackNearPerDay = bought / days;
      const mintedPerEpoch = Object.values(v.validator_reward_paid_prev_epoch ?? {}).reduce((a, x) => a + near(x), 0);
      const mintedPerDay = (mintedPerEpoch * m.issuance.epochsPerYear) / 365;
      const live = buybackNearPerDay / mintedPerDay;
      const d = rel(live, m.ledger.coverageBuybackOnly);
      return { ours: pct(m.ledger.coverageBuybackOnly, 2), live: pct(live, 2), diff: d, ok: Math.abs(d) < 0.1 };
    },
  },
];

export function VerifyLab({ m }: { m: Metrics }) {
  const [states, setStates] = useState<Record<string, State>>({});
  const [running, setRunning] = useState(false);

  const runAll = useCallback(async () => {
    setRunning(true);
    const shared: Shared = {};
    setStates(Object.fromEntries(CHECKS.map((c) => [c.id, { status: "running" as const }])));
    await Promise.all(
      CHECKS.map(async (c) => {
        try {
          const result = await c.run(m, shared);
          setStates((s) => ({ ...s, [c.id]: { status: "done", result } }));
        } catch (e) {
          setStates((s) => ({ ...s, [c.id]: { status: "error", error: e instanceof Error ? e.message : "failed" } }));
        }
      }),
    );
    setRunning(false);
  }, [m]);

  const done = Object.values(states).filter((s) => s.status === "done");
  const agree = done.filter((s) => s.result?.ok).length;
  const failed = Object.values(states).filter((s) => s.status === "error").length;

  return (
    <div className="shell py-16 md:py-24">
      <Reveal>
        <div className="eyebrow mb-5">Verify / snapshot of {m.asOf}</div>
        <h1 className="display max-w-[980px] text-[clamp(40px,6vw,88px)]">Check the numbers from your own machine.</h1>
        <p className="mt-7 max-w-[660px] text-[17px] leading-[1.6] text-ink-2">
          Press the button and your browser asks NEAR's public RPC and DefiLlama for the raw figures, recomputes nine of our headline numbers, and puts them next to ours. No server of ours is involved, because there is none. Where a live figure differs, the row says why it can.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-5">
          <button className="btn btn-solid" onClick={runAll} disabled={running}>
            {running ? "Asking the chain" : done.length ? "Run again" : "Run all nine checks"}
          </button>
          <div className="mono text-[12.5px] text-ink-2" role="status" aria-live="polite">
            {done.length + failed === 0 ? "Not run yet." : `${agree} of ${CHECKS.length} agree within tolerance${failed ? `, ${failed} could not reach a source` : ""}.`}
          </div>
        </div>
      </Reveal>

      <div className="mt-12 border-t-[1.5px] border-ink">
        <div className="hidden grid-cols-[1.6fr_1fr_1fr_90px_130px] gap-6 border-b border-rule py-3 md:grid">
          {["Check", "Published", "Recomputed now", "Gap", "Result"].map((h, i) => (
            <span key={h} className={`eyebrow ${i > 0 && i < 4 ? "text-right" : ""}`}>
              {h}
            </span>
          ))}
        </div>
        {CHECKS.map((c) => {
          const st = states[c.id] ?? { status: "idle" as const };
          const r = st.result;
          return (
            <div key={c.id} className="grid gap-x-6 gap-y-2 border-b border-rule py-5 md:grid-cols-[1.6fr_1fr_1fr_90px_130px] md:items-baseline">
              <div>
                <div className="serif text-[20px]">{c.title}</div>
                <div className="mono mt-1 text-[11.5px] leading-relaxed text-ink-2">{c.how}</div>
                <div className="mt-1 text-[12.5px] text-ink-3">{c.why}</div>
              </div>
              <div className="num md:text-right">
                <span className="eyebrow mr-2 md:hidden">Published</span>
                {r?.ours ?? publishedFor(c.id, m)}
              </div>
              <div className="num md:text-right">
                <span className="eyebrow mr-2 md:hidden">Now</span>
                {st.status === "running" ? <span className="text-ink-3">reading</span> : r ? r.live : st.status === "error" ? <span className="text-ink-3">n/a</span> : <span className="text-ink-3">--</span>}
                {r?.note && <div className="mt-0.5 font-sans text-[11.5px] text-ink-3">{r.note}</div>}
              </div>
              <div className="num text-ink-2 md:text-right">{r && r.diff !== null ? (c.id === "nakamoto" ? (r.diff > 0 ? `+${r.diff}` : `${r.diff}`) : `${r.diff >= 0 ? "+" : ""}${(r.diff * 100).toFixed(2)}%`) : ""}</div>
              <div className="mono text-[11px] uppercase tracking-[0.1em]">
                {st.status === "done" && r ? (
                  <span style={{ color: r.ok ? "var(--color-moss)" : "var(--color-oxide)" }}>{r.ok ? "Agrees" : "Differs"}</span>
                ) : st.status === "error" ? (
                  <span className="text-amber" title={st.error}>
                    Source unreachable
                  </span>
                ) : st.status === "running" ? (
                  <span className="text-ink-3">Running</span>
                ) : (
                  <span className="text-ink-3">Waiting</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-16 grid gap-10 md:grid-cols-2">
        <div>
          <div className="eyebrow mb-3">Rebuild everything locally</div>
          <pre className="mono scroll-x bg-ink p-5 text-[13px] leading-[1.8] text-paper">{`git clone <this repository>\ncd <folder>\nnpm install\nnpm run rebuild     # download, compute, validate, write THESIS.md\nnpm test            # model unit tests\nnpm run build       # the site, as static files in out/`}</pre>
          <p className="mt-3 text-[13.5px] text-ink-2">Node 20 or newer. No API key, no account, no wallet. The first run reads about 125 epoch boundaries from archival RPC and takes several minutes; later runs reuse them.</p>
        </div>
        <div>
          <div className="eyebrow mb-3">What "agrees" means</div>
          <p className="text-[15px] leading-[1.65] text-ink-2">
            The published figures are a snapshot; the chain keeps moving. Each check has a tolerance sized to how fast its quantity drifts: a fifth of a percent for supply, five percent for a one-epoch reading of issuance. A row marked "Differs" is not hidden or softened. If you see one, the snapshot is stale or we are wrong, and either is worth knowing.
          </p>
        </div>
      </div>
    </div>
  );
}

function publishedFor(id: string, m: Metrics): string {
  switch (id) {
    case "supply":
      return int(m.supply.total);
    case "cap":
      return pct(m.protocol.maxInflationRate, 2);
    case "mint":
      return pct(m.issuance.mintedRate, 3);
    case "stake":
      return int(m.validators.totalStake);
    case "nakamoto":
      return String(m.validators.nakamoto33);
    case "wallets":
      return int(m.wallets.totalNear);
    case "fees":
      return usd(m.intents.feesUsd, 2);
    case "capture":
      return pct(m.intents.captureShare, 2);
    default:
      return pct(m.ledger.coverageBuybackOnly, 2);
  }
}
