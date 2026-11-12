"use client";

import { BarChart, Figure, LineChart } from "@/components/charts";
import { Reveal } from "@/components/site/Reveal";
import { CHART } from "@/lib/data";
import { compact, dateShort, int, monthLabel, pct, usd } from "@/lib/format";
import type { Metrics, Series } from "@/lib/types";

function rolling(xs: number[], n: number): (number | null)[] {
  let acc = 0;
  return xs.map((x, i) => {
    acc += x;
    if (i >= n) acc -= xs[i - n];
    return i >= n - 1 ? acc / n : null;
  });
}

const every = <T,>(xs: T[], step: number) => xs.filter((_, i) => i % step === 0 || i === xs.length - 1);

export function Evidence({ m, s }: { m: Metrics; s: Series }) {
  const from = s.dates.indexOf("2026-02-23");
  const cut = <T,>(xs: T[]) => xs.slice(Math.max(0, from));
  const dates = cut(s.dates);
  const tick = (d: string) => dateShort(d);

  const buyback30 = cut(rolling(s.buybackNear, 30));
  const burn30 = cut(rolling(s.burnEstNear, 30));
  const vol30 = rolling(s.volumeUsd, 30);
  const tx30 = rolling(s.txns, 30);
  const act30 = rolling(s.activeAccounts, 30);
  const firstIdx = tx30.findIndex((v) => v !== null);
  const index = (xs: (number | null)[]) => xs.map((v) => (v === null ? null : (v / (xs[firstIdx] as number)) * 100));

  const ep = s.epochs;
  const months = m.growth.monthly;

  const rows = m.validators.rows;
  let acc = 0;
  const cumulative = rows.map((r) => (acc += r.stake) / m.validators.totalStake);

  return (
    <div className="shell py-16 md:py-24">
      <Reveal>
        <div className="eyebrow mb-5">Evidence / data to {m.asOf}</div>
        <h1 className="display max-w-[980px] text-[clamp(40px,6vw,88px)]">Seven charts. Each one says what it shows, and how to get it yourself.</h1>
        <p className="mt-7 max-w-[640px] text-[17px] leading-[1.6] text-ink-2">
          Every figure has three views: the chart, the table of the same numbers, and the exact query that produced it. All inputs are public and need no key. <span className="mono text-[14px]">npm run rebuild</span> regenerates all of them.
        </p>
      </Reveal>

      <div className="mt-16 grid gap-8">
        <Reveal>
          <Figure
            n="1"
            title="Income against the security bill"
            sentence={`Buybacks and gas burn cover ${pct(m.ledger.coverage)} of the NEAR minted for security, and the share has ${(s.coverage30.at(-1) ?? 0) > (s.coverage30.at(-61) ?? 0) ? "risen" : "fallen"} over the last two months.`}
            source="DefiLlama (captured revenue), NearBlocks (supply, fees, price), NEAR archival RPC (burn calibration)."
            query={`coverage(t) = (buyback_30d + burn_30d) / minted_30d\n\nbuyback(d)  = dailyHoldersRevenue(d) / near_price(d)\n              GET https://api.llama.fi/summary/fees/near-intents?dataType=dailyHoldersRevenue\nminted_30d  = total_supply(t) - total_supply(t-30) + burn_30d\n              GET https://api.nearblocks.io/v1/charts  (total_supply, txn_fee, near_price)\nburn(d)     = txn_fee(d) * ${m.usage.burnCalibration.toFixed(4)}\n              calibration = burn read from block headers / NearBlocks fee total, same 30 days\n\nCode: pipeline/compute.ts (coverage30)`}
            table={{ head: ["Date", "Coverage, 30d", "Minted / day, est."], rows: every(dates.map((d, i) => [d, cut(s.coverage30)[i] === null ? "" : pct(cut(s.coverage30)[i] as number), cut(s.mintedEstNear)[i] === null ? "" : int(cut(s.mintedEstNear)[i] as number)]), 7) }}
          >
            <LineChart labels={dates} xTick={tick} format={(v) => pct(v, 0)} series={[{ name: "Coverage, trailing 30 days", label: "coverage", color: CHART.oxide, values: cut(s.coverage30) }]} refLines={[{ y: 0.5, label: "Test passes at 50%" }]} yMax={Math.max(0.6, ...(cut(s.coverage30).filter((v) => v !== null) as number[])) * 1.05} />
          </Figure>
        </Reveal>

        <Reveal>
          <Figure
            n="2"
            title="Issuance, read from the chain"
            sentence={`Across ${ep.length} epochs the chain minted at ${pct(m.issuance.mintedRate, 2)} a year, just under its ${pct(m.protocol.maxInflationRate)} maximum, and two independent readings of each payment agree to better than ${m.issuance.crossCheckMaxRelDiff < 1e-6 ? "one part in a million" : "one part in a hundred thousand"}.`}
            source="NEAR archival RPC: block headers at each epoch boundary, and the validators method."
            query={`For each epoch k:\n  v      = validators([last block of epoch k-1])         -> epoch_start_height\n  start  = block(epoch_start_height)                      -> total_supply, timestamp\n  before = block(start.prev_hash)                         -> total_supply\n  minted = start.total_supply - before.total_supply + start.balance_burnt\n  check  = minted(k) == sum(validators(epoch k+1).validator_reward_paid_prev_epoch)\n  rate   = minted / epoch_hours * 24 * 365 / total_supply\n\nEndpoint: https://archival-rpc.mainnet.fastnear.com\nCode: pipeline/fetch.ts (epochRecord), pipeline/compute.ts`}
            table={{ head: ["Epoch", "Start (UTC)", "Minted NEAR", "Burned NEAR", "Hours", "Annual rate"], rows: ep.map((e) => [e.height, e.date.slice(0, 16).replace("T", " "), int(e.mintedNear), e.burnNear.toFixed(1), e.hours.toFixed(2), pct(e.annualRate, 3)]).reverse() }}
          >
            <LineChart labels={ep.map((e) => e.date.slice(0, 10))} xTick={tick} format={(v) => pct(v, 2)} series={[{ name: "Annual minted rate, per epoch", label: "minted", color: CHART.ink, values: ep.map((e) => e.annualRate) }]} refLines={[{ y: m.protocol.maxInflationRate, label: "Protocol maximum" }, { y: m.assumptions.hsp029.toRate, label: "Maximum after HSP-029" }]} yMin={0.012} yMax={0.028} />
          </Figure>
        </Reveal>

        <Reveal>
          <Figure
            n="3"
            title="What users pay, and what NEAR keeps"
            sentence={`Users paid ${usd(m.intents.feesUsd)} in NEAR Intents fees in the last 30 days and NEAR kept ${pct(m.intents.captureShare)} of it; the rest went to the apps and solvers that brought the trade.`}
            source="DefiLlama fees adapter for NEAR Intents (dailyFees, dailyRevenue)."
            query={`GET https://api.llama.fi/summary/fees/near-intents?dataType=dailyFees\nGET https://api.llama.fi/summary/fees/near-intents?dataType=dailyRevenue\n\nSummed by calendar month (UTC). Only complete months are shown.\nCode: pipeline/compute.ts (monthly)`}
            legend={[
              { name: "Fees paid by users", color: CHART.ink },
              { name: "Kept by NEAR", color: CHART.oxide },
            ]}
            table={{ head: ["Month", "Volume", "Fees", "Kept by NEAR", "Share kept", "Fee growth"], rows: months.map((x) => [x.month, usd(x.volumeUsd), usd(x.feesUsd), usd(x.revenueUsd), x.feesUsd ? pct(x.revenueUsd / x.feesUsd) : "", x.growth === null ? "" : pct(x.growth)]) }}
          >
            <BarChart labels={months.map((x) => monthLabel(x.month))} values={months.map((x) => x.feesUsd)} format={(v) => usd(v)} color={CHART.ink} secondary={{ values: months.map((x) => x.revenueUsd), color: CHART.oxide, name: "Kept by NEAR", primaryName: "Fees" }} />
          </Figure>
        </Reveal>

        <Reveal>
          <Figure
            n="4"
            title="Two sources of income, one unit"
            sentence={`Buybacks bring in ${int(m.ledger.buybackNearPerDay)} NEAR a day and gas burn ${int(m.ledger.burnNearPerDay)}: the chain's own fees are now the small part of what it earns.`}
            source="DefiLlama (captured revenue), NearBlocks (fees, price), NEAR archival RPC (burn calibration)."
            query={`buyback_near(d) = dailyHoldersRevenue(d) / near_price(d)\nburn_near(d)    = txn_fee(d) * ${m.usage.burnCalibration.toFixed(4)}\nBoth shown as trailing 30-day averages, from the start of the buyback program (2026-02-23).\nCode: pipeline/compute.ts`}
            legend={[
              { name: "Bought back", color: CHART.brass },
              { name: "Burned as gas", color: CHART.ink },
            ]}
            table={{ head: ["Date", "Bought back / day", "Burned / day"], rows: every(dates.map((d, i) => [d, buyback30[i] === null ? "" : int(buyback30[i] as number), burn30[i] === null ? "" : int(burn30[i] as number)]), 7) }}
          >
            <LineChart
              labels={dates}
              xTick={tick}
              format={(v) => compact(v)}
              series={[
                { name: "Bought back, NEAR a day", label: "bought back", color: CHART.brass, values: buyback30 },
                { name: "Burned as gas, NEAR a day", label: "burned", color: CHART.ink, values: burn30 },
              ]}
            />
          </Figure>
        </Reveal>

        <Reveal>
          <Figure
            n="5"
            title="Demand"
            sentence={`NEAR Intents settled ${usd(m.intents.volume90)} in the last 90 days, ${m.intents.growth90.toFixed(2)}x the 90 days before.`}
            source="DefiLlama dexs adapter for NEAR Intents (daily volume)."
            query={`GET https://api.llama.fi/summary/dexs/near-intents\nTrailing 30-day average of totalDataChart.\nCaveat: this is DefiLlama's series. Part of the flow settles on a private path that public indexers do not see.`}
            table={{ head: ["Date", "Volume / day, 30d avg"], rows: every(s.dates.map((d, i) => [d, vol30[i] === null ? "" : usd(vol30[i] as number)]), 14) }}
          >
            <LineChart labels={s.dates} xTick={tick} format={(v) => usd(v)} series={[{ name: "Volume a day, 30-day average", label: "volume", color: CHART.tide, values: vol30 }]} />
          </Figure>
        </Reveal>

        <Reveal>
          <Figure
            n="6"
            title="Who holds the stake"
            sentence={`The ${m.validators.nakamoto33} largest validators hold more than a third of all stake and the ten largest hold ${pct(m.validators.top10Share)}; half the set earns under ${m.validators.medianRewardPerEpoch.toFixed(1)} NEAR an epoch.`}
            source="NEAR RPC: validators method, current epoch."
            query={`POST https://rpc.mainnet.fastnear.com\n{"method":"validators","params":[null]}\n\nSort current_validators by stake, descending; plot cumulative share of total stake by rank.\nCommission: call_function get_reward_fee_fraction on each pool.\nCode: pipeline/compute.ts (validators), src/lib/model.ts (nakamoto, gini)`}
            table={{ head: ["Rank", "Validator", "Stake NEAR", "Cumulative", "Commission", "Reward / epoch"], rows: rows.map((r, i) => [i + 1, r.id, int(r.stake), pct(cumulative[i]), r.commission === null ? "n/a" : pct(r.commission, 0), r.rewardPerEpoch.toFixed(2)]) }}
          >
            <LineChart labels={rows.map((_, i) => `Rank ${i + 1}`)} xTick={(l) => l.replace("Rank ", "#")} format={(v) => pct(v, 0)} series={[{ name: "Cumulative share of stake", label: "of stake", color: CHART.ink, values: cumulative }]} refLines={[{ y: 1 / 3, label: "One third: can halt" }, { y: 2 / 3, label: "Two thirds: can finalise" }]} yMax={1.04} />
          </Figure>
        </Reveal>

        <Reveal>
          <Figure
            n="7"
            title="Base-layer use"
            sentence={`The chain carried ${compact(m.usage.txnsPerDay30)} transactions a day over the last 30 days against ${compact(m.usage.txnsPerDayPrev30)} in the 30 before: base-layer activity and Intents revenue do not move together.`}
            source="NearBlocks daily charts (txns, active_accounts)."
            query={`GET https://api.nearblocks.io/v1/charts\nTrailing 30-day averages of txns and active_accounts, each indexed to 100 at the first plotted day so they share one axis.`}
            legend={[
              { name: "Transactions", color: CHART.ink },
              { name: "Active accounts", color: CHART.tide },
            ]}
            table={{ head: ["Date", "Transactions / day", "Active accounts / day"], rows: every(s.dates.map((d, i) => [d, tx30[i] === null ? "" : int(tx30[i] as number), act30[i] === null ? "" : int(act30[i] as number)]), 14) }}
          >
            <LineChart
              labels={s.dates}
              xTick={tick}
              format={(v) => v.toFixed(0)}
              series={[
                { name: "Transactions (index)", label: "transactions", color: CHART.ink, values: index(tx30) },
                { name: "Active accounts (index)", label: "accounts", color: CHART.tide, values: index(act30) },
              ]}
              refLines={[{ y: 100, label: "Start = 100" }]}
            />
          </Figure>
        </Reveal>
      </div>

      <Reveal>
        <div className="mt-20">
          <div className="eyebrow mb-4">Source files in this build</div>
          <div className="scroll-x border-t-[1.5px] border-ink">
            <table className="data">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Source</th>
                  <th>Fetched (UTC)</th>
                  <th className="r">Bytes</th>
                  <th>sha256</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {m.sources.map((x) => (
                  <tr key={x.file}>
                    <td className="num">data/raw/{x.file}</td>
                    <td>{x.source}</td>
                    <td className="num">{x.fetchedAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="r num">{int(x.bytes)}</td>
                    <td className="num">{x.sha256.slice(0, 16)}</td>
                    <td className="mono text-[11px] uppercase" style={{ color: x.status === "fresh" ? "var(--color-moss)" : "var(--color-amber)" }}>
                      {x.status === "fresh" ? "Fresh" : "Kept from earlier run"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
