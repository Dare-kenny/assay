"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { FanChart } from "@/components/charts";
import { Count, Reveal } from "@/components/site/Reveal";
import { Stage } from "@/components/three/Stage";
import type { SkylineColumn } from "@/components/three/SkylineScene";
import { CHART } from "@/lib/data";
import { compact, int, pct, usd } from "@/lib/format";
import { viability, type Status } from "@/lib/model";
import type { Metrics } from "@/lib/types";

const SkylineScene = dynamic(() => import("@/components/three/SkylineScene"), { ssr: false });

/* ------------------------------------------------------------ status mark */

const STATUS: Record<Status, { label: string; color: string; glyph: React.ReactNode }> = {
  supported: { label: "Supported", color: "var(--color-moss)", glyph: <path d="M2 7.5 5.5 11 12 3.5" /> },
  mixed: { label: "Mixed", color: "var(--color-amber)", glyph: <path d="M2 7h10" /> },
  contradicted: { label: "Contradicted", color: "var(--color-oxide)", glyph: <path d="M3 3l8 8M11 3l-8 8" /> },
};

export function StatusMark({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span className="mono inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.1em]" style={{ color: s.color }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden>
        {s.glyph}
      </svg>
      {s.label}
    </span>
  );
}

function SectionHead({ n, kicker, title, children }: { n: string; kicker: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Reveal>
      <div className="grid gap-6 md:grid-cols-[180px_1fr]">
        <div className="eyebrow pt-2">
          <span className="text-oxide">{n}</span> / {kicker}
        </div>
        <div>
          <h2 className="display max-w-[900px] text-[clamp(32px,4.6vw,64px)]">{title}</h2>
          {children && <div className="mt-6 max-w-[640px] text-[17px] leading-[1.6] text-ink-2">{children}</div>}
        </div>
      </div>
    </Reveal>
  );
}

/* ------------------------------------------------------------------ ticker */

export function Ticker({ m }: { m: Metrics }) {
  const items = [
    ["NEAR price", `$${m.price.usd.toFixed(2)}`],
    ["Minted, annual rate", pct(m.issuance.mintedRate, 2)],
    ["Security budget", `${usd(m.issuance.budgetUsdPerYear)} / yr`],
    ["Intents volume, 30d", usd(m.intents.volumeUsd)],
    ["Intents fees, 30d", usd(m.intents.feesUsd)],
    ["Kept by NEAR", pct(m.intents.captureShare)],
    ["Validators", int(m.validators.count)],
    ["Staked", pct(m.supply.stakedShare)],
    ["One third of stake", usd(m.security.costOneThirdUsd)],
  ];
  const row = (hidden: boolean) => (
    <div className="flex shrink-0 items-center" aria-hidden={hidden}>
      {items.map(([k, v]) => (
        <span key={k} className="flex items-baseline gap-3 px-7 py-4">
          <span className="eyebrow">{k}</span>
          <span className="num text-[15px]">{v}</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className="overflow-hidden rule-b bg-paper-2/60">
      <motion.div className="flex w-max" animate={{ x: ["0%", "-50%"] }} transition={{ duration: 48, ease: "linear", repeat: Infinity }}>
        {row(false)}
        {row(true)}
      </motion.div>
    </div>
  );
}

/* -------------------------------------------------------- income statement */

export function Statement({ m }: { m: Metrics }) {
  const p = m.price.usd;
  const yr = (nearPerDay: number) => nearPerDay * 365 * p;
  const lines: { label: string; note: string; near: number; sign: 1 | -1; strong?: boolean }[] = [
    { label: "Minted to validators and stakers", note: `Read from ${m.issuance.epochs} epoch boundaries. Annual rate ${pct(m.issuance.mintedRate, 2)} of supply.`, near: m.ledger.mintedNearPerDay, sign: -1 },
    { label: "Bought back with Intents revenue", note: `${pct(m.intents.captureShare)} of ${usd(m.intents.feesUsd)} in fees over 30 days, converted at each day's price. Held, not burned.`, near: m.ledger.buybackNearPerDay, sign: 1 },
    { label: "Burned as gas", note: "Supply at the start of the window, plus what was minted, minus supply at the end.", near: m.ledger.burnNearPerDay, sign: 1 },
  ];
  const net = m.ledger.mintedNearPerDay - m.ledger.buybackNearPerDay - m.ledger.burnNearPerDay;
  return (
    <section className="shell py-24 md:py-32">
      <SectionHead n="01" kicker="The ledger" title={<>Read NEAR like an income statement.</>}>
        A network buys security the way a company buys anything: it pays for it. NEAR pays in new tokens. What it earns comes back two ways, as tokens bought on the open market and tokens destroyed as gas. The difference is what holders fund.
      </SectionHead>
      <Reveal delay={0.1}>
        <div className="mt-14 md:ml-[204px]">
          <div className="grid grid-cols-[1fr_auto_auto] items-end gap-x-6 border-b-[1.5px] border-ink pb-2 md:gap-x-12">
            <span className="eyebrow">Per day, {m.ledger.windowDays}-day average</span>
            <span className="eyebrow text-right">NEAR</span>
            <span className="eyebrow hidden w-[110px] text-right sm:block">USD a year</span>
          </div>
          {lines.map((l) => (
            <div key={l.label} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-6 border-b border-rule py-5 md:gap-x-12">
              <div>
                <div className="serif text-[21px] md:text-[25px]">{l.label}</div>
                <div className="mt-1 max-w-[520px] text-[13px] text-ink-2">{l.note}</div>
              </div>
              <div className="num text-right text-[22px] md:text-[30px]" style={{ color: l.sign < 0 ? "var(--color-oxide)" : "var(--color-ink)" }}>
                {l.sign < 0 ? "(" : ""}
                <Count value={l.near} format={int} />
                {l.sign < 0 ? ")" : ""}
              </div>
              <div className="num hidden w-[110px] text-right text-[14px] text-ink-2 sm:block">{usd(yr(l.near))}</div>
            </div>
          ))}
          <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-6 border-b-[3px] border-double border-ink py-6 md:gap-x-12">
            <div>
              <div className="serif text-[24px] md:text-[30px]">Net cost carried by holders</div>
              <div className="mt-1 text-[13px] text-ink-2">
                Income covers <b className="text-ink">{pct(m.ledger.coverage)}</b> of the bill. Over {m.intents.windowDays * 3} days it was {pct(m.ledger.coverage90)}.
              </div>
            </div>
            <div className="num text-right text-[26px] text-oxide md:text-[38px]">
              (<Count value={net} format={int} />)
            </div>
            <div className="num hidden w-[110px] text-right text-[14px] text-ink-2 sm:block">{usd(m.ledger.shortfallUsdPerYear)}</div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ------------------------------------------------------------------ verdicts */

export function Verdicts({ m }: { m: Metrics }) {
  const [open, setOpen] = useState<string | null>(m.verdicts[1]?.id ?? null);
  return (
    <section className="bg-paper-2/55 rule-t rule-b">
      <div className="shell py-24 md:py-32">
        <SectionHead n="02" kicker="Seven tests" title={<>The rules were written before the numbers.</>}>
          Each test has a threshold fixed in <span className="mono text-[14px]">pipeline/config.ts</span>. The build grades it; nobody edits the verdict by hand. A test that fails stays on the page. {m.stance.summary}
        </SectionHead>
        <div className="mt-14 border-t-[1.5px] border-ink">
          {m.verdicts.map((v, i) => {
            const isOpen = open === v.id;
            return (
              <Reveal key={v.id} delay={i * 0.04} y={12}>
                <div className="border-b border-rule">
                  <button className="grid w-full cursor-pointer grid-cols-[28px_1fr_auto] items-baseline gap-x-4 py-5 text-left md:grid-cols-[48px_1.1fr_1.6fr_130px_150px] md:gap-x-6" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : v.id)}>
                    <span className="mono text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                    <span className="serif text-[21px] md:text-[24px]">{v.title}</span>
                    <span className="hidden text-[14.5px] text-ink-2 md:block">{v.question}</span>
                    <span className="num text-right text-[20px] md:text-[24px]">{v.display}</span>
                    <span className="col-start-2 mt-1 md:col-start-auto md:mt-0 md:text-right">
                      <StatusMark status={v.status} />
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.45, ease: [0.2, 0.7, 0.1, 1] }} className="overflow-hidden">
                        <div className="grid gap-6 pb-7 md:grid-cols-3 md:pl-[72px]">
                          {(
                            [
                              ["What was measured", v.reading],
                              ["The rule", v.rule],
                              ["The case against", v.against],
                            ] as const
                          ).map(([h, t]) => (
                            <div key={h}>
                              <div className="eyebrow mb-2">{h}</div>
                              <p className="text-[14.5px] leading-[1.6] text-ink">{t}</p>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ security */

const COSTS = [100, 250, 500, 750, 1000, 1500, 2000, 3000];

export function Security({ m }: { m: Metrics }) {
  const [costIdx, setCostIdx] = useState(COSTS.indexOf(m.assumptions.validatorCostUsdPerMonth));
  const cost = COSTS[costIdx];
  const cutScale = m.assumptions.hsp029.toRate / m.assumptions.hsp029.fromRate;
  const { columns, now, cut } = useMemo(() => {
    const need = cost * 12;
    const income = (r: (typeof m.validators.rows)[number], scale: number) => r.rewardPerEpoch * (r.commission ?? 0) * m.issuance.epochsPerYear * m.price.usd * scale;
    const cols: SkylineColumn[] = m.validators.rows.map((r) => ({
      stake: r.stake,
      state: r.commission === null ? "unknown" : income(r, cutScale) >= need ? "viable" : income(r, 1) >= need ? "lost" : "below",
    }));
    return { columns: cols, now: viability(m.validators.rows, m.issuance.epochsPerYear, m.price.usd, cost, 1), cut: viability(m.validators.rows, m.issuance.epochsPerYear, m.price.usd, cost, cutScale) };
  }, [cost, cutScale, m]);

  const legend: [string, string, number][] = [
    ["Fee income pays the bill, before and after", "#2a2722", cut.viableCount],
    ["Pays today, not after the cut", CHART.oxide, now.viableCount - cut.viableCount],
    ["Does not pay today", "#cfc6b2", now.assessed - now.viableCount],
  ];

  return (
    <section className="shell py-24 md:py-32">
      <SectionHead n="03" kicker="The other side of the ledger" title={<>Issuance is not waste. It is what the chain pays to stay honest.</>}>
        Most cases for NEAR treat new tokens as pure dilution and the coming cut as free money. It is a pay cut for {int(m.validators.count)} validators. So we asked the question most analyses skip: after issuance falls from {pct(m.assumptions.hsp029.fromRate)} to{" "}
        {pct(m.assumptions.hsp029.toRate)}, who can still afford to run a node, and how much stake sits with them?
      </SectionHead>

      <div className="mt-14 grid gap-8 lg:grid-cols-[1.25fr_1fr]">
        <Reveal>
          <div className="card relative h-[380px] overflow-hidden md:h-[520px]">
            <Stage className="absolute inset-0" fallback={<div className="flex h-full items-center justify-center text-ink-3">3D view needs WebGL. The numbers beside it are complete.</div>}>
              {(paused) => <SkylineScene columns={columns} paused={paused} />}
            </Stage>
            <div className="eyebrow pointer-events-none absolute left-5 top-5">
              {int(m.validators.count)} validators / height is stake
            </div>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <div>
            <label className="block" htmlFor="cost">
              <div className="flex items-baseline justify-between">
                <span className="eyebrow">Cost to run a validator (assumption)</span>
                <span className="num text-[22px]">${int(cost)} / mo</span>
              </div>
              <input id="cost" type="range" min={0} max={COSTS.length - 1} step={1} value={costIdx} onChange={(e) => setCostIdx(Number(e.target.value))} className="mt-3" />
            </label>
            <p className="mt-2 text-[12.5px] text-ink-2">The chain does not publish what operators pay, so this is yours to set. Income counted is commission only, a lower bound.</p>

            <div className="mt-7 border-t-[1.5px] border-ink">
              {legend.map(([label, color, n]) => (
                <div key={label} className="flex items-center justify-between gap-4 border-b border-rule py-3.5">
                  <span className="flex items-center gap-3 text-[14.5px]">
                    <span className="inline-block h-3.5 w-3.5 border border-ink/20" style={{ background: color }} />
                    {label}
                  </span>
                  <span className="num text-[20px]">{int(n)}</span>
                </div>
              ))}
            </div>

            <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-6">
              {(
                [
                  ["Stake with paying validators, after the cut", pct(cut.viableStakeShare)],
                  ["Same, today", pct(now.viableStakeShare)],
                  ["Validators holding one third of stake", String(m.validators.nakamoto33)],
                  ["Median pool reward per epoch", `${m.validators.medianRewardPerEpoch.toFixed(2)} NEAR`],
                  ["One third of stake at spot", usd(m.security.costOneThirdUsd)],
                  ["Held in NEAR Intents", usd(m.intents.tvlUsd)],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <div className="num text-[26px] leading-none">{v}</div>
                  <div className="mt-1.5 text-[12.5px] text-ink-2">{k}</div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------- path */

export function Path({ m }: { m: Metrics }) {
  const sim = m.simulation;
  const months = Array.from({ length: sim.horizonMonths + 1 }, (_, i) => i);
  const start = new Date(`${m.asOf}T00:00:00Z`);
  const label = (mo: number) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + mo, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  const at = (xs: number[], mo: number) => xs[Math.min(mo, xs.length - 1)];
  return (
    <section className="bg-paper-2/55 rule-t rule-b">
      <div className="shell py-24 md:py-32">
        <SectionHead n="04" kicker="The path" title={<>When does the scale level?</>}>
          We resample the last {m.growth.simulationRates.length} months of NEAR Intents fee growth {int(sim.paths)} times, with spikes clipped, and hold the price flat. It is a scenario generator with a fixed seed, not a forecast, and it is the least certain thing on this page. Change every assumption in the model.
        </SectionHead>
        <Reveal delay={0.1}>
          <div className="mt-12 grid gap-10 lg:grid-cols-[1.5fr_1fr]">
            <div className="card p-5 md:p-7">
              <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-2">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-[3px] w-4" style={{ background: CHART.oxide }} /> With the issuance cut, median
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-[3px] w-4" style={{ background: CHART.tide }} /> Growth at half speed, median
                </span>
                <span className="text-ink-3">Shaded: 10th to 90th percentile</span>
              </div>
              <FanChart
                months={months}
                yMax={2}
                format={(v) => pct(v, 0)}
                xLabel={label}
                refLines={[{ y: 1, label: "Income equals the security bill" }]}
                bands={[
                  { name: "With cut", color: CHART.oxide, ...sim.withCut },
                  { name: "Half speed", color: CHART.tide, ...sim.halfSpeedWithCut },
                ]}
              />
            </div>
            <div>
              <div className="border-t-[1.5px] border-ink">
                {(
                  [
                    ["Chance income has covered the bill within 3 years", pct(at(sim.withCut.probFullByMonth, 36), 0), "history repeats, cut on schedule"],
                    ["Same, if growth runs at half speed", pct(at(sim.halfSpeedWithCut.probFullByMonth, 36), 0), "half the resampled growth"],
                    ["Same, if the cut never starts", pct(at(sim.noCut.probFullByMonth, 36), 0), "issuance stays at today's rate"],
                    ["Median month-on-month fee growth, last six months", pct(m.growth.medianLast6), `${pct(m.growth.medianAll)} over all ${m.growth.monthly.filter((x) => x.growth !== null).length} months`],
                  ] as const
                ).map(([k, v, note]) => (
                  <div key={k} className="grid grid-cols-[1fr_auto] items-baseline gap-4 border-b border-rule py-4">
                    <div>
                      <div className="text-[15px]">{k}</div>
                      <div className="mt-0.5 text-[12.5px] text-ink-3">{note}</div>
                    </div>
                    <div className="num text-[28px]">{v}</div>
                  </div>
                ))}
              </div>
              <Link href="/model/" className="btn btn-solid mt-8">
                Open the model
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- closing */

export function Closing({ m }: { m: Metrics }) {
  const fresh = m.sources.filter((s) => s.status === "fresh").length;
  return (
    <section className="shell py-24 md:py-32">
      <div className="grid gap-12 lg:grid-cols-2">
        <Reveal>
          <div className="eyebrow mb-5">
            <span className="text-oxide">05</span> / Check our work
          </div>
          <h2 className="display text-[clamp(32px,4.4vw,60px)]">Do not take our word for any of it.</h2>
          <p className="mt-6 max-w-[520px] text-[17px] leading-[1.6] text-ink-2">
            The verify page re-derives the headline numbers in your browser, straight from NEAR RPC and DefiLlama, and shows them beside ours. No install, no key, no wallet. Or clone the repository and run one command: it rebuilds every number, chart and sentence from {m.sources.length} source files ({fresh} refreshed in this build), each pinned by hash.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/verify/" className="btn btn-solid">
              Run the checks
            </Link>
            <Link href="/thesis/" className="btn">
              Read the full thesis
            </Link>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="card p-6 md:p-8">
            <div className="eyebrow mb-4">What would change our mind</div>
            <ol className="space-y-5">
              {[
                [`Coverage falls below ${pct(0.1, 0)} for 90 days.`, `Today ${pct(m.ledger.coverage)}. That would mean revenue is shrinking against the bill, cut or no cut.`],
                ["The revenue wallets stop keeping what they receive.", `They gained ${pct(m.wallets.window.ratio, 0)} of what the series implies over the last window. Below 75% for two windows and the buyback is a label, not a policy.`],
                ["The cut empties the validator set.", `If stake with fee-paying validators falls under two thirds after the cut, cheaper security has become weaker security.`],
              ].map(([h, t], i) => (
                <li key={i} className="grid grid-cols-[28px_1fr] gap-3">
                  <span className="mono text-[12px] text-oxide">{String(i + 1).padStart(2, "0")}</span>
                  <span>
                    <span className="serif block text-[20px] leading-snug">{h}</span>
                    <span className="mt-1 block text-[14px] text-ink-2">{t}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>
      </div>
      <div className="mt-20 text-center text-[12px] text-ink-3">
        Supply {compact(m.supply.total, 3)} NEAR / protocol version {m.protocol.version} / {int(m.issuance.epochs)} epochs read
      </div>
    </section>
  );
}
