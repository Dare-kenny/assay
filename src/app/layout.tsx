import type { Metadata, Viewport } from "next";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { Footer, Nav, Smooth } from "@/components/site/Chrome";
import { metrics } from "@/lib/data";
import { dateLong, pct } from "@/lib/format";

const description = `NEAR earns back ${pct(metrics.ledger.coverage)} of what it pays for security. An investment thesis measured from block headers, with every number re-derivable in your browser.`;

export const metadata: Metadata = {
  title: { default: "Assay: NEAR, weighed", template: "%s / Assay" },
  description,
  openGraph: { title: "Assay: NEAR, weighed", description, type: "article" },
};

export const viewport: Viewport = { themeColor: "#f1ece1", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Smooth>
          <a href="#main" className="btn btn-solid sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50">
            Skip to content
          </a>
          <Nav asOf={dateLong(metrics.asOf)} />
          <main id="main">{children}</main>
          <Footer generatedAt={metrics.generatedAt} sources={metrics.sources.length} />
        </Smooth>
      </body>
    </html>
  );
}
