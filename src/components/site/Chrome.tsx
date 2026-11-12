"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactLenis } from "lenis/react";
import { motion, useScroll, useSpring } from "motion/react";
import type { ReactNode } from "react";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/evidence/", label: "Evidence" },
  { href: "/model/", label: "Model" },
  { href: "/verify/", label: "Verify" },
  { href: "/thesis/", label: "Thesis" },
];

export function Smooth({ children }: { children: ReactNode }) {
  return (
    <ReactLenis root options={{ lerp: 0.11, duration: 1.1, smoothWheel: true }}>
      {children}
    </ReactLenis>
  );
}

export function Nav({ asOf }: { asOf: string }) {
  const path = usePathname();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 });
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href.replace(/\/$/, "")));
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/85 backdrop-blur-md">
      <div className="shell flex h-[58px] items-center justify-between gap-4">
        <Link href="/" className="flex items-baseline gap-3 no-underline" aria-label="Assay, home">
          <span className="display text-[26px]">Assay</span>
          <span className="eyebrow hidden sm:inline">NEAR, weighed</span>
        </Link>
        <nav className="scroll-x flex items-center gap-1" aria-label="Sections">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined} className={`mono whitespace-nowrap px-2.5 py-2 text-[11.5px] uppercase tracking-[0.08em] no-underline transition-colors ${active(l.href) ? "text-ink" : "text-ink-3 hover:text-ink"}`}>
              <span className={active(l.href) ? "border-b-[1.5px] border-oxide pb-1" : ""}>{l.label}</span>
            </Link>
          ))}
        </nav>
        <div className="eyebrow hidden whitespace-nowrap lg:block">Data to {asOf}</div>
      </div>
      <motion.div className="absolute bottom-[-1px] left-0 h-[1.5px] w-full origin-left bg-oxide" style={{ scaleX: progress }} />
    </header>
  );
}

export function Footer({ generatedAt, sources }: { generatedAt: string; sources: number }) {
  return (
    <footer className="mt-32 border-t-[1.5px] border-ink">
      <div className="shell grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="display text-[40px]">Assay</div>
          <p className="mt-3 max-w-[420px] text-[14px] text-ink-2">
            An assay tests what a metal is really made of. This one tests a claim about NEAR. Every figure on this site was computed from public data by code in the repository, and can be recomputed by anyone.
          </p>
        </div>
        <div className="text-[13.5px] text-ink-2">
          <div className="eyebrow mb-3">Build</div>
          <p>
            Snapshot built {new Date(generatedAt).toUTCString().replace("GMT", "UTC")} from {sources} hash-pinned source files.
          </p>
          <p className="mt-2">Built at NEAR HACKATHON 2026, Investment Thesis track.</p>
        </div>
        <div className="text-[13.5px] text-ink-2">
          <div className="eyebrow mb-3">Read this</div>
          <p>Research, not financial advice. Nothing here is an offer or a recommendation to buy or sell anything. Read-only: the site never asks for a wallet or a key.</p>
        </div>
      </div>
    </footer>
  );
}
