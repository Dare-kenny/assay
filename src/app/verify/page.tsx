import type { Metadata } from "next";
import { VerifyLab } from "@/components/pages/VerifyLab";
import { metrics } from "@/lib/data";

export const metadata: Metadata = { title: "Verify", description: "Re-derive the headline numbers in your browser, straight from NEAR RPC and DefiLlama." };

export default function Page() {
  return <VerifyLab m={metrics} />;
}
