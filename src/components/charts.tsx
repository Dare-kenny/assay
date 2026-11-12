"use client";

import { scaleLinear } from "d3-scale";
import { area, line } from "d3-shape";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CHART } from "@/lib/data";

/* ------------------------------------------------------------------ shared */

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceTicks(min: number, max: number, count = 4): number[] {
  return scaleLinear().domain([min, max]).nice(count).ticks(count);
}

export type TableData = { head: string[]; rows: (string | number)[][] };

/**
 * The frame every chart sits in: a headline that states the finding, the
 * chart, the source, the exact query behind it, and a table of the same
 * numbers for anyone who cannot or would rather not read the picture.
 */
export function Figure({ n, title, sentence, source, query, table, children, legend }: { n: string; title: string; sentence: string; source: string; query: string; table?: TableData; children: ReactNode; legend?: { name: string; color: string; dashed?: boolean }[] }) {
  const [view, setView] = useState<"chart" | "table" | "query">("chart");
  const id = useId();
  return (
    <figure className="card p-5 md:p-7" aria-labelledby={id}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[640px]">
          <div className="eyebrow mb-2">
            Fig. {n} / {title}
          </div>
          <figcaption id={id} className="serif text-[21px] leading-[1.25] md:text-[24px]">
            {sentence}
          </figcaption>
        </div>
        <div className="flex gap-1.5" role="group" aria-label="View">
          {(["chart", "table", "query"] as const).map((v) =>
            v === "table" && !table ? null : (
              <button key={v} className="chip" aria-pressed={view === v} onClick={() => setView(v)}>
                {v}
              </button>
            ),
          )}
        </div>
      </div>
      {legend && legend.length > 1 && view === "chart" && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-ink-2">
          {legend.map((l) => (
            <span key={l.name} className="inline-flex items-center gap-2">
              <svg width="18" height="8" aria-hidden>
                <line x1="0" x2="18" y1="4" y2="4" stroke={l.color} strokeWidth="2.5" strokeDasharray={l.dashed ? "4 3" : undefined} />
              </svg>
              {l.name}
            </span>
          ))}
        </div>
      )}
      <div className="mt-5">
        {view === "chart" && children}
        {view === "table" && table && (
          <div className="scroll-x max-h-[360px] overflow-y-auto">
            <table className="data">
              <thead>
                <tr>
                  {table.head.map((h, i) => (
                    <th key={h} className={i ? "r" : ""}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className={j ? "r num" : "num"}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view === "query" && <pre className="mono scroll-x whitespace-pre-wrap bg-paper-2 p-4 text-[12.5px] leading-relaxed text-ink">{query}</pre>}
      </div>
      <div className="mt-4 text-[12px] text-ink-2">
        <span className="eyebrow mr-2">Source</span>
        {source}
      </div>
    </figure>
  );
}

type Tip = { x: number; y: number; title: string; rows: { name: string; value: string; color?: string }[] } | null;

function Tooltip({ tip, width }: { tip: Tip; width: number }) {
  if (!tip) return null;
  const flip = tip.x > width - 190;
  return (
    <div className="pointer-events-none absolute z-10 min-w-[150px] border border-ink bg-paper px-3 py-2 text-[12px] shadow-[3px_3px_0_rgba(27,25,21,0.12)]" style={{ left: flip ? undefined : tip.x + 14, right: flip ? width - tip.x + 14 : undefined, top: Math.max(0, tip.y - 12) }}>
      <div className="eyebrow mb-1">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.name} className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            {r.color && <span className="inline-block h-[3px] w-3" style={{ background: r.color }} />}
            {r.name}
          </span>
          <span className="num text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- lines */

export type LineSeries = { name: string; color: string; values: (number | null)[]; dashed?: boolean; label?: string };

export function LineChart({
  labels,
  series,
  format,
  height = 300,
  refLines = [],
  yMax,
  yMin = 0,
  tickEvery,
  xTick,
}: {
  labels: string[];
  series: LineSeries[];
  format: (v: number) => string;
  height?: number;
  refLines?: { y: number; label: string }[];
  yMax?: number;
  yMin?: number;
  tickEvery?: number;
  xTick?: (label: string) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { t: 14, r: width < 520 ? 64 : 92, b: 28, l: 4 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const n = labels.length;

  const { x, y, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
    const hi = yMax ?? Math.max(...all, ...refLines.map((r) => r.y)) * 1.06;
    const ys = scaleLinear().domain([yMin, hi]).range([ih, 0]);
    const xs = scaleLinear().domain([0, Math.max(1, n - 1)]).range([0, iw]);
    return { x: xs, y: ys, ticks: niceTicks(yMin, hi, 4).filter((t) => t <= hi) };
  }, [series, refLines, yMax, yMin, ih, iw, n]);

  const path = line<number | null>()
    .defined((d) => d !== null && Number.isFinite(d))
    .x((_, i) => x(i))
    .y((d) => y(d as number));

  const step = tickEvery ?? Math.max(1, Math.round(n / (width < 520 ? 4 : 7)));
  const xt = labels.map((l, i) => ({ l, i })).filter(({ i }) => i % step === 0);

  // direct labels at the right edge, nudged apart so they never collide
  const ends = series
    .map((s) => {
      let i = s.values.length - 1;
      while (i >= 0 && (s.values[i] === null || !Number.isFinite(s.values[i] as number))) i--;
      return i < 0 ? null : { s, i, v: s.values[i] as number, py: y(s.values[i] as number) };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.py - b.py);
  for (let k = 1; k < ends.length; k++) if (ends[k].py - ends[k - 1].py < 26) ends[k].py = ends[k - 1].py + 26;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(x.invert(((e.clientX - box.left) / box.width) * iw));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const tip: Tip =
    hover === null
      ? null
      : {
          x: m.l + x(hover),
          y: m.t + 8,
          title: labels[hover],
          rows: series.filter((s) => s.values[hover] !== null).map((s) => ({ name: s.name, value: format(s.values[hover] as number), color: s.color })),
        };

  return (
    <div ref={ref} className="relative select-none">
      <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join(", ")}>
        <g transform={`translate(${m.l},${m.t})`}>
          {ticks.map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x1={0} x2={iw} stroke={CHART.rule} strokeWidth={1} strokeDasharray={t === yMin ? undefined : "2 4"} />
              <text x={0} y={-5} fontSize={10.5} fill={CHART.ink3} fontFamily="var(--font-mono)">
                {format(t)}
              </text>
            </g>
          ))}
          {refLines.map((r) => (
            <g key={r.label} transform={`translate(0,${y(r.y)})`}>
              <line x1={0} x2={iw} stroke={CHART.ink} strokeWidth={1} />
              <text x={iw} y={-6} textAnchor="end" fontSize={10.5} fill={CHART.ink} fontFamily="var(--font-mono)">
                {r.label}
              </text>
            </g>
          ))}
          {xt.map(({ l, i }) => (
            <text key={i} x={x(i)} y={ih + 19} fontSize={10.5} fill={CHART.ink3} fontFamily="var(--font-mono)" textAnchor={i === 0 ? "start" : "middle"}>
              {xTick ? xTick(l) : l}
            </text>
          ))}
          {series.map((s) => (
            <path key={s.name} d={path(s.values) ?? ""} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "5 4" : undefined} />
          ))}
          {ends.map((e) => (
            <g key={e.s.name}>
              <circle cx={x(e.i)} cy={y(e.v)} r={4} fill={e.s.color} stroke={CHART.paper} strokeWidth={2} />
              <text x={x(e.i) + 9} y={e.py - 1} fontSize={12} fill={CHART.ink} fontFamily="var(--font-mono)">
                {format(e.v)}
              </text>
              <text x={x(e.i) + 9} y={e.py + 12} fontSize={10} fill={CHART.ink2}>
                {e.s.label ?? e.s.name}
              </text>
            </g>
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={0} y2={ih} stroke={CHART.ink} strokeWidth={1} />
              {series.map((s) =>
                s.values[hover] === null ? null : <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] as number)} r={4.5} fill={s.color} stroke={CHART.paper} strokeWidth={2} />,
              )}
            </g>
          )}
          <rect x={0} y={0} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: "pan-y" }} />
        </g>
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

/* --------------------------------------------------------------------- bars */

export function BarChart({ labels, values, format, color = CHART.ink, height = 260, highlight, secondary }: { labels: string[]; values: number[]; format: (v: number) => string; color?: string; height?: number; highlight?: (i: number) => boolean; secondary?: { values: number[]; color: string; name: string; primaryName: string } }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { t: 14, r: 4, b: 28, l: 4 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const hi = Math.max(...values, ...(secondary?.values ?? [])) * 1.08;
  const y = scaleLinear().domain([0, hi]).range([ih, 0]);
  const band = iw / values.length;
  const bw = Math.max(3, Math.min(34, band - 2));
  const ticks = niceTicks(0, hi, 4).filter((t) => t <= hi);
  const skip = Math.max(1, Math.ceil(values.length / (width < 520 ? 5 : 10)));
  const bar = (v: number, cx: number, w: number, fill: string, key: string) => {
    const h = Math.max(0, ih - y(v));
    const r = Math.min(3, w / 2, h);
    // rounded only at the data end; the base sits square on the axis
    return <path key={key} d={`M${cx - w / 2},${ih} V${ih - h + r} Q${cx - w / 2},${ih - h} ${cx - w / 2 + r},${ih - h} H${cx + w / 2 - r} Q${cx + w / 2},${ih - h} ${cx + w / 2},${ih - h + r} V${ih} Z`} fill={fill} />;
  };
  const tip: Tip =
    hover === null
      ? null
      : {
          x: m.l + band * (hover + 0.5),
          y: m.t + 8,
          title: labels[hover],
          rows: secondary
            ? [
                { name: secondary.primaryName, value: format(values[hover]), color },
                { name: secondary.name, value: format(secondary.values[hover]), color: secondary.color },
              ]
            : [{ name: "Value", value: format(values[hover]) }],
        };
  return (
    <div ref={ref} className="relative select-none">
      <svg width={width} height={height} role="img">
        <g transform={`translate(${m.l},${m.t})`}>
          {ticks.map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x1={0} x2={iw} stroke={CHART.rule} strokeDasharray={t === 0 ? undefined : "2 4"} />
              <text x={0} y={-5} fontSize={10.5} fill={CHART.ink3} fontFamily="var(--font-mono)">
                {format(t)}
              </text>
            </g>
          ))}
          {values.map((v, i) => {
            const cx = band * (i + 0.5);
            const fill = hover === i ? CHART.oxide : highlight && !highlight(i) ? CHART.ink3 : color;
            if (!secondary) return bar(v, cx, bw, fill, `b${i}`);
            const w = Math.max(2, (bw - 2) / 2);
            return (
              <g key={i}>
                {bar(v, cx - w / 2 - 1, w, color, `p${i}`)}
                {bar(secondary.values[i], cx + w / 2 + 1, w, secondary.color, `s${i}`)}
              </g>
            );
          })}
          {labels.map((l, i) =>
            i % skip === 0 ? (
              <text key={i} x={band * (i + 0.5)} y={ih + 19} fontSize={10.5} fill={CHART.ink3} fontFamily="var(--font-mono)" textAnchor="middle">
                {l}
              </text>
            ) : null,
          )}
          {values.map((_, i) => (
            <rect key={i} x={band * i} y={0} width={band} height={ih} fill="transparent" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
          ))}
        </g>
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

/* ---------------------------------------------------------------------- fan */

export type FanBand = { name: string; color: string; p10: number[]; p50: number[]; p90: number[] };

export function FanChart({ months, bands, format, height = 320, refLines = [], yMax, xLabel }: { months: number[]; bands: FanBand[]; format: (v: number) => string; height?: number; refLines?: { y: number; label: string }[]; yMax: number; xLabel: (m: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { t: 14, r: width < 520 ? 60 : 96, b: 28, l: 4 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const x = scaleLinear().domain([0, months.length - 1]).range([0, iw]);
  const y = scaleLinear().domain([0, yMax]).range([ih, 0]).clamp(true);
  const ticks = niceTicks(0, yMax, 4).filter((t) => t <= yMax);
  const xt = months.filter((mo) => mo % 12 === 0);
  const ends = bands.map((b) => ({ b, py: y(b.p50.at(-1) as number), v: b.p50.at(-1) as number })).sort((a, c) => a.py - c.py);
  for (let k = 1; k < ends.length; k++) if (ends[k].py - ends[k - 1].py < 26) ends[k].py = ends[k - 1].py + 26;
  const tip: Tip =
    hover === null
      ? null
      : {
          x: m.l + x(hover),
          y: m.t + 8,
          title: xLabel(hover),
          rows: bands.flatMap((b) => [
            { name: `${b.name}, median`, value: format(b.p50[hover]), color: b.color },
            { name: "10th to 90th", value: `${format(b.p10[hover])} to ${format(b.p90[hover])}` },
          ]),
        };
  return (
    <div ref={ref} className="relative select-none">
      <svg width={width} height={height} role="img">
        <g transform={`translate(${m.l},${m.t})`}>
          {ticks.map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x1={0} x2={iw} stroke={CHART.rule} strokeDasharray={t === 0 ? undefined : "2 4"} />
              <text x={0} y={-5} fontSize={10.5} fill={CHART.ink3} fontFamily="var(--font-mono)">
                {format(t)}
              </text>
            </g>
          ))}
          {bands.map((b) => (
            <path
              key={`${b.name}-band`}
              d={
                area<number>()
                  .x((_, i) => x(i))
                  .y0((_, i) => y(b.p10[i]))
                  .y1((_, i) => y(b.p90[i]))(months) ?? ""
              }
              fill={b.color}
              opacity={0.13}
            />
          ))}
          {refLines.map((r) => (
            <g key={r.label} transform={`translate(0,${y(r.y)})`}>
              <line x1={0} x2={iw} stroke={CHART.ink} strokeWidth={1} />
              <text x={4} y={-6} fontSize={10.5} fill={CHART.ink} fontFamily="var(--font-mono)">
                {r.label}
              </text>
            </g>
          ))}
          {bands.map((b) => (
            <path
              key={b.name}
              d={
                line<number>()
                  .x((_, i) => x(i))
                  .y((d) => y(d))(b.p50) ?? ""
              }
              fill="none"
              stroke={b.color}
              strokeWidth={2}
            />
          ))}
          {ends.map((e) => (
            <g key={e.b.name}>
              <circle cx={iw} cy={y(e.v)} r={4} fill={e.b.color} stroke={CHART.paper} strokeWidth={2} />
              <text x={iw + 9} y={e.py - 1} fontSize={12} fill={CHART.ink} fontFamily="var(--font-mono)">
                {format(e.v)}
              </text>
              <text x={iw + 9} y={e.py + 12} fontSize={10} fill={CHART.ink2}>
                {e.b.name}
              </text>
            </g>
          ))}
          {xt.map((mo) => (
            <text key={mo} x={x(mo)} y={ih + 19} fontSize={10.5} fill={CHART.ink3} fontFamily="var(--font-mono)" textAnchor={mo === 0 ? "start" : "middle"}>
              {xLabel(mo)}
            </text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={ih} stroke={CHART.ink} />}
          <rect
            x={0}
            y={0}
            width={iw}
            height={ih}
            fill="transparent"
            style={{ touchAction: "pan-y" }}
            onPointerMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              setHover(Math.max(0, Math.min(months.length - 1, Math.round(x.invert(((e.clientX - box.left) / box.width) * iw)))));
            }}
            onPointerLeave={() => setHover(null)}
          />
        </g>
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}
