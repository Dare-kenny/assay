import type { Metadata } from "next";
import { ModelLab } from "@/components/pages/ModelLab";
import { metrics } from "@/lib/data";

export const metadata: Metadata = { title: "Model", description: "Change every assumption and see when NEAR's income covers its security bill." };

export default function Page() {
  return <ModelLab m={metrics} />;
}
