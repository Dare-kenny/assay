"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";

/** WebGL can be missing or can fail on old hardware. The page must still read. */
class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Mounts a 3D scene only in the browser, only when WebGL exists, and tells it
 * to stop rendering while it is off screen so it never drains a laptop.
 */
export function Stage({ children, fallback, className }: { children: (paused: boolean) => ReactNode; fallback: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState<"pending" | "webgl" | "none">("pending");
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setReady(hasWebGL() ? "webgl" : "none");
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {ready === "webgl" ? <Boundary fallback={fallback}>{children(!visible)}</Boundary> : ready === "none" ? fallback : null}
    </div>
  );
}
