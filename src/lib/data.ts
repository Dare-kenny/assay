import metricsJson from "../../data/metrics.json";
import seriesJson from "../../data/series.json";
import type { Metrics, Series } from "./types";

/** Build-time snapshots. The site never fetches these at runtime. */
export const metrics = metricsJson as unknown as Metrics;
export const series = seriesJson as unknown as Series;

export const CHART = { oxide: "#b5391e", tide: "#0b7fa8", brass: "#a87a08", ink: "#1b1915", moss: "#2f6b3a", rule: "#cdc5b3", ink2: "#56514a", ink3: "#857f73", paper: "#f1ece1" } as const;
