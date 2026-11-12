import type { Metadata } from "next";
import { Evidence } from "@/components/pages/Evidence";
import { metrics, series } from "@/lib/data";

export const metadata: Metadata = { title: "Evidence", description: "Seven charts, each with its source, its query and a table of the same numbers." };

export default function Page() {
  return <Evidence m={metrics} s={series} />;
}
