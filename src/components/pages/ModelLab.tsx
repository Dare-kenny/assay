"use client";

import { useMemo, useState } from "react";
import { FanChart, LineChart } from "@/components/charts";
import { Reveal } from "@/components/site/Reveal";
import { CHART } from "@/lib/data";
import { int, pct, usd } from "@/lib/format";
import { firstMonthAtCoverage, project, simulate, type IssuancePolicy } from "@/lib/model";
import type { Metrics } from "@/lib/types";

function Slider({ label, value, min, max, step, onChange, display, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string; hint?: string }) {
  return (
    <label className="block border-b border-rule py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14.5px]">{label}</span>
        <span className="num text-[18px]">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2" />
      {hint && <div className="mt-1 text-[12px] text-ink-3">{hint}</div>}
    </label>
  );
}

export function ModelLab({ m }: { m: Metrics }) {
  const defaults = { growth: Math.max(0, Math.round(m.growth.medianLast6 * 1000) / 1000), halfLife: 18, price: 0, cut: true, cutStart: m.simulation.cutStartInMonths, months: 60, scale: 1 };
  const [growth, setGrowth] = useState(defaults.growth);
  const [halfLife, setHalfLife] = useState(defaults.halfLife);
  const [price, setPrice] = useState(defaults.price);
  const [cut, setCut] = useState(defaults.cut);
  const [cutStart, setCutStart] = useState(defaults.cutStart);
  const [scale, setScale] = useState(defaults.scale);
  const months = defaults.months;

  const policy: IssuancePolicy = useMemo(() => ({ measuredRate: m.issuance.mintedRate, fromRate: m.assumptions.hsp029.fromRate, toRate: m.assumptions.hsp029.toRate, rampMonths: m.assumptions.hsp029.rampMonths, startInMonths: cut ? cutStart : null }), [cut, cutStart, m]);
  const base = useMemo(
    () => ({ supply: m.supply.total, priceUsd: m.price.usd, buybackUsdPerDay: m.ledger.buybackNearPerDay * m.price.usd, burnNearPerDay: m.ledger.burnNearPerDay, priceGrowthAnnual: price, issuance: policy, months }),
    [m, price, policy, months],
  );
  const path = useMemo(() => project({ ...base, monthlyGrowth: growth, growthHalfLifeMonths: halfLife >= 61 ? null : halfLife }), [base, growth, halfLife]);
  const flat = useMemo(() => project({ ...base, monthlyGrowth: 0, growthHalfLifeMonths: null }), [base]);
  const sim = useMemo(
    () => simulate({ ...base, historicalMonthlyGrowth: m.growth.simulationRates, blockMonths: m.simulation.blockMonths, growthScale: scale, paths: 1500, seed: m.simulation.seed }),
    [base, scale, m],
  );

  const start = new Date(`${m.asOf}T00:00:00Z`);
  const label = (mo: number) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + mo, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  const half = firstMonthAtCoverage(path, 0.5);
  const full = firstMonthAtCoverage(path, 1);
  const end = path.at(-1)!;
  const yMax = Math.min(3, Math.max(1.2, end.coverage * 1.15));
  const reset = () => {
    setGrowth(defaults.growth);
    setHalfLife(defaults.halfLife);
    setPrice(defaults.price);
    setCut(defaults.cut);
    setCutStart(defaults.cutStart);
    setScale(defaults.scale);
  };

  return (
    <div className="shell py-16 md:py-24">
      <Reveal>
        <div className="eyebrow mb-5">Model / starts from data to {m.asOf}</div>
        <h1 className="display max-w-[980px] text-[clamp(40px,6vw,88px)]">Move the assumptions. Watch the scale.</h1>
        <p className="mt-7 max-w-[660px] text-[17px] leading-[1.6] text-ink-2">
          The starting point is measured: {int(m.ledger.mintedNearPerDay)} NEAR minted a day, {usd(m.ledger.buybackNearPerDay * m.price.usd)} a day of revenue buying NEAR at ${m.price.usd.toFixed(2)}, {int(m.ledger.burnNearPerDay)} NEAR burned. Everything after that is an assumption, and every assumption is a control. The same code runs
          from the command line: <span className="mono text-[14px]">npm run model -- --growth 0.03</span>.
        </p>
      </Reveal>

      <div className="mt-14 grid gap-10 lg:grid-cols-[360px_1fr]">
        <div className="lg:sticky lg:top-[82px] lg:self-start">
          <div className="flex items-center justify-between border-b-[1.5px] border-ink pb-2">
            <span className="eyebrow">Assumptions</span>
            <button className="chip" onClick={reset}>
              Reset to measured
            </button>
          </div>
          <Slider label="Revenue growth per month, at the start" value={growth} min={-0.05} max={0.2} step={0.005} onChange={setGrowth} display={pct(growth)} hint={`Median of the last six months: ${pct(m.growth.medianLast6)}`} />
          <Slider label="Months for that growth to halve" value={halfLife} min={3} max={61} step={1} onChange={setHalfLife} display={halfLife >= 61 ? "never" : `${halfLife}`} hint="Fast growth from a small base fades. Slide right to assume it never does." />
          <Slider label="NEAR price change per year" value={price} min={-0.5} max={1} step={0.05} onChange={setPrice} display={pct(price, 0)} hint="A higher price buys fewer NEAR for the same revenue." />
          <div className="flex items-center justify-between border-b border-rule py-4">
            <span className="text-[14.5px]">HSP-029 issuance cut</span>
            <div className="flex gap-1.5">
              <button className="chip" aria-pressed={cut} onClick={() => setCut(true)}>
                Starts
              </button>
              <button className="chip" aria-pressed={!cut} onClick={() => setCut(false)}>
                Never
              </button>
            </div>
          </div>
          {cut && <Slider label="Cut starts in" value={cutStart} min={0} max={36} step={1} onChange={setCutStart} display={`${cutStart} mo`} hint={`Assumed ${m.assumptions.hsp029.assumedStart}; ramps over ${m.assumptions.hsp029.rampMonths} months. The start date is not set on chain.`} />}
        </div>

        <div className="grid gap-8">
          <div className="grid grid-cols-2 gap-px bg-rule md:grid-cols-4">
            {(
              [
                ["Coverage today", pct(path[0].coverage)],
                [`Coverage in ${months / 12} years`, pct(end.coverage, 0)],
                ["Reaches 50%", half === null ? "after 2031" : half === 0 ? "now" : label(half)],
                ["Income covers the bill", full === null ? "after 2031" : label(full)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="bg-paper p-5">
                <div className="num text-[26px] leading-none md:text-[30px]">{v}</div>
                <div className="mt-2 text-[12.5px] text-ink-2">{k}</div>
              </div>
            ))}
          </div>

          <div className="card p-5 md:p-7">
            <div className="eyebrow mb-2">Your scenario</div>
            <div className="serif mb-4 text-[22px] leading-snug">
              {full !== null ? `On these assumptions, income covers the security bill in ${label(full)}.` : `On these assumptions, income covers ${pct(end.coverage, 0)} of the security bill after five years and never all of it.`}
            </div>
            <div className="mb-3 flex flex-wrap gap-x-5 text-[12.5px] text-ink-2">
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-[3px] w-4" style={{ background: CHART.oxide }} /> Your scenario
              </span>
              <span className="inline-flex items-center gap-2">
                <svg width="18" height="6" aria-hidden>
                  <line x1="0" x2="18" y1="3" y2="3" stroke={CHART.ink3} strokeWidth="2" strokeDasharray="4 3" />
                </svg>
                No growth at all
              </span>
            </div>
            <LineChart
              labels={path.map((p) => label(p.month))}
              tickEvery={12}
              format={(v) => pct(v, 0)}
              yMax={yMax}
              height={340}
              refLines={[{ y: 1, label: "Income equals the security bill" }]}
              series={[
                { name: "Your scenario", label: "scenario", color: CHART.oxide, values: path.map((p) => Math.min(p.coverage, yMax)) },
                { name: "No growth", label: "no growth", color: CHART.ink3, dashed: true, values: flat.map((p) => p.coverage) },
              ]}
            />
          </div>

          <div className="card p-5 md:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-[520px]">
                <div className="eyebrow mb-2">If history repeats</div>
                <div className="serif text-[22px] leading-snug">
                  1,500 paths resampled from the months already observed give a {pct(sim.probFullByMonth[36], 0)} chance of full coverage within three years and {pct(sim.probFullByMonth.at(-1)!, 0)} within five.
                </div>
              </div>
              <div className="w-full max-w-[260px]">
                <Slider label="Speed against history" value={scale} min={0} max={1.5} step={0.05} onChange={setScale} display={`${scale.toFixed(2)}x`} />
              </div>
            </div>
            <div className="mt-4">
              <FanChart months={sim.months} yMax={2.5} format={(v) => pct(v, 0)} xLabel={label} height={340} refLines={[{ y: 1, label: "Income equals the security bill" }]} bands={[{ name: "Median", color: CHART.tide, p10: sim.p10, p50: sim.p50, p90: sim.p90 }]} />
            </div>
            <p className="mt-3 text-[12.5px] text-ink-2">
              Shaded band: 10th to 90th percentile. Block bootstrap, {m.simulation.blockMonths}-month blocks, seed {m.simulation.seed}, uses your price and issuance settings. Resamples the last {m.growth.simulationRates.length} months of fee growth ({m.growth.simulationClipped} spikes clipped). A scenario generator, not a forecast.
            </p>
          </div>

          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="r">Issuance rate</th>
                  <th className="r">Minted / day</th>
                  <th className="r">Bought back / day</th>
                  <th className="r">Revenue / day</th>
                  <th className="r">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {path
                  .filter((p) => p.month % 6 === 0)
                  .map((p) => (
                    <tr key={p.month}>
                      <td className="num">{label(p.month)}</td>
                      <td className="r num">{pct(p.rate, 2)}</td>
                      <td className="r num">{int(p.mintedNearPerDay)}</td>
                      <td className="r num">{int(p.buybackNearPerDay)}</td>
                      <td className="r num">{usd(p.buybackUsdPerDay)}</td>
                      <td className="r num">{pct(p.coverage)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
