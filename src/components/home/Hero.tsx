"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { motion, useScroll, useTransform } from "motion/react";
import { useRef, useState } from "react";
import { Stage } from "@/components/three/Stage";
import { Lines, Reveal } from "@/components/site/Reveal";
import { int, pct } from "@/lib/format";
import type { Metrics } from "@/lib/types";

const ScaleScene = dynamic(() => import("@/components/three/ScaleScene"), { ssr: false });

const COINS = 18;
type Scenario = "today" | "cut" | "even";

export function Hero({ m }: { m: Metrics }) {
  const [scenario, setScenario] = useState<Scenario>("today");
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const lift = useTransform(scrollYProgress, [0, 1], [0, -90]);
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0.25]);

  const cutScale = m.assumptions.hsp029.toRate / m.assumptions.hsp029.fromRate;
  const unit = m.ledger.mintedNearPerDay / COINS; // NEAR per coin, the same on both pans
  const minted = scenario === "cut" ? m.ledger.mintedNearPerDay * cutScale : m.ledger.mintedNearPerDay;
  const returned = scenario === "even" ? minted : m.ledger.buybackNearPerDay + m.ledger.burnNearPerDay;
  const coverage = returned / minted;
  const burnCoins = m.ledger.burnNearPerDay / unit;
  const buybackCoins = Math.max(0, Math.round((returned - m.ledger.burnNearPerDay) / unit));

  const captions: Record<Scenario, string> = {
    today: `Measured over ${Math.round(m.issuance.windowDays)} days of epoch boundaries to ${m.asOf}.`,
    cut: `Same revenue, issuance at the post-cut maximum of ${pct(m.assumptions.hsp029.toRate)}. The cut has passed a vote; its start date is not set.`,
    even: `What balance looks like: revenue ${(m.ledger.breakEvenRevenueMultiple).toFixed(1)}x today's, at today's price and issuance.`,
  };

  const fallback = (
    <svg viewBox="0 0 600 420" className="h-full w-full" role="img" aria-label="Balance scale">
      <g transform={`rotate(${Math.min(12, (1 - Math.min(coverage, 2)) * 12)} 300 110)`} stroke="#1b1915" strokeWidth="3" fill="none">
        <line x1="90" x2="510" y1="110" y2="110" />
      </g>
      <line x1="300" x2="300" y1="110" y2="380" stroke="#1b1915" strokeWidth="4" />
      <rect x="230" y="380" width="140" height="10" fill="#1b1915" />
    </svg>
  );

  return (
    <section ref={ref} className="relative overflow-hidden rule-b">
      <div className="shell relative grid min-h-[calc(100svh-58px)] items-center gap-6 py-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:py-0">
        <div className="relative z-10">
          <Reveal y={0} immediate>
            <div className="eyebrow mb-7 flex flex-wrap gap-x-4 gap-y-1">
              <span>Investment thesis</span>
              <span className="text-oxide">NEAR Protocol</span>
              <span>Data to {m.asOf}</span>
            </div>
          </Reveal>
          <h1 className="display text-[clamp(44px,7.4vw,112px)]">
            <Lines lines={["NEAR pays for", "its security.", <span key="x" className="italic text-oxide">It earns back</span>, <span key="y">{pct(m.ledger.coverage)}.</span>]} />
          </h1>
          <Reveal delay={0.5} immediate>
            <p className="mt-8 max-w-[520px] text-[17px] leading-[1.6] text-ink-2">
              Every day the chain mints <b className="font-semibold text-ink">{int(m.ledger.mintedNearPerDay)} NEAR</b> to pay validators. Revenue from NEAR Intents buys back <b className="font-semibold text-ink">{int(m.ledger.buybackNearPerDay)}</b> and gas burns{" "}
              <b className="font-semibold text-ink">{int(m.ledger.burnNearPerDay)}</b>. The long-term case for the token is whether that gap closes. This site measures it from block headers and lets you check every number yourself.
            </p>
          </Reveal>
          <Reveal delay={0.65} immediate>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/evidence/" className="btn btn-solid">
                Read the evidence
              </Link>
              <Link href="/verify/" className="btn">
                Verify it yourself
              </Link>
            </div>
          </Reveal>
        </div>

        <motion.div style={{ y: lift, opacity: fade }} className="relative h-[440px] sm:h-[520px] lg:h-[calc(100svh-58px)] lg:max-h-[860px]">
          <Stage className="absolute inset-0" fallback={fallback}>
            {(paused) => <ScaleScene left={Math.round(minted / unit)} rightBuyback={buybackCoins} rightBurn={burnCoins} coverage={coverage} paused={paused} />}
          </Stage>
          <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-between gap-4 lg:top-[9%]">
            <div>
              <div className="eyebrow">Minted for security</div>
              <div className="num mt-1 text-[22px] leading-none md:text-[28px]">{int(minted)}</div>
              <div className="eyebrow mt-1 text-ink-3">NEAR a day</div>
            </div>
            <div className="text-right">
              <div className="eyebrow">Returned to holders</div>
              <div className="num mt-1 text-[22px] leading-none md:text-[28px]">{int(returned)}</div>
              <div className="eyebrow mt-1 text-ink-3">NEAR a day / {pct(coverage, 0)}</div>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-4 lg:bottom-[7%]">
            <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="Scenario">
              {(
                [
                  ["today", "Today"],
                  ["cut", "After the issuance cut"],
                  ["even", "At balance"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className="chip bg-paper/70 backdrop-blur" aria-pressed={scenario === k} onClick={() => setScenario(k)}>
                  {label}
                </button>
              ))}
            </div>
            <p className="mx-auto mt-3 max-w-[440px] text-center text-[12.5px] text-ink-2" aria-live="polite">
              {captions[scenario]} One coin is {int(unit)} NEAR on both pans.
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
