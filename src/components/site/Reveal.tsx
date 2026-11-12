"use client";

import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

const EASE = [0.2, 0.7, 0.1, 1] as const;

/** Fades and lifts its children into place the first time they scroll into view. */
export function Reveal({ children, delay = 0, y = 22, className, immediate = false }: { children: ReactNode; delay?: number; y?: number; className?: string; immediate?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      // above-the-fold content animates on load; everything else waits until it scrolls into view
      {...(immediate ? { animate: { opacity: 1, y: 0 } } : { whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "0px 0px -12% 0px" } })}
      transition={{ duration: 0.9, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** A headline whose lines rise out of a mask, one after another. */
export function Lines({ lines, className, delay = 0 }: { lines: ReactNode[]; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <span className={className}>
      {lines.map((l, i) => (
        <span key={i} className="block overflow-hidden pb-[0.08em]">
          <motion.span className="block" initial={reduce ? false : { y: "105%" }} animate={{ y: 0 }} transition={{ duration: 1.1, delay: delay + i * 0.09, ease: EASE }}>
            {l}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/**
 * Counts up to a value when it comes into view. The final text is rendered on
 * the server, so the real number is in the HTML even with scripts disabled.
 */
export function Count({ value, format, className }: { value: number; format: (v: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (!inView || reduce) return;
    const controls = animate(value * 0.6, value, { duration: 1.4, ease: EASE, onUpdate: setShown });
    return () => controls.stop();
  }, [inView, reduce, value]);
  return (
    <span ref={ref} className={className}>
      {format(shown)}
    </span>
  );
}
