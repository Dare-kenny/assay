/**
 * Captures the README screenshots from a running copy of the site.
 *
 *   npm run build && npx serve out -l 4173   (in one terminal)
 *   node scripts/screenshots.mjs             (in another)
 *
 * Uses the Chrome or Edge already installed on the machine. Set CHROME_PATH
 * to point at a different browser, and SITE_URL at a different address.
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const candidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error("No Chrome or Edge found. Set CHROME_PATH.");
  process.exit(1);
}

const base = process.env.SITE_URL ?? "http://localhost:4173";
const out = "docs/screenshots";
await mkdir(out, { recursive: true });

const browser = await puppeteer.launch({ executablePath, headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Scroll through the page once so every reveal-on-scroll section has appeared. */
async function settle() {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.7;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 220));
    }
    window.scrollTo(0, 0);
  });
  await wait(1200);
}

async function shot(name, path, { width = 1440, height = 900, full = false, selector, before } = {}) {
  await page.setViewport({ width, height, deviceScaleFactor: 1.5 });
  await page.goto(`${base}${path}`, { waitUntil: "networkidle0", timeout: 60_000 });
  await wait(2600);
  if (full || selector) await settle();
  if (before) await before();
  if (selector) {
    const el = await page.$(selector);
    if (!el) throw new Error(`selector not found: ${selector}`);
    await el.evaluate((n) => n.scrollIntoView({ block: "start" }));
    await wait(1500);
    await el.screenshot({ path: `${out}/${name}.png` });
  } else {
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  }
  console.log(`wrote ${out}/${name}.png`);
}

await shot("01-hero", "/");
await shot("02-ledger", "/", { selector: "main > section:nth-of-type(2)" });
await shot("03-tests", "/", { selector: "main > section:nth-of-type(3)" });
await shot("04-security", "/", { selector: "main > section:nth-of-type(4)" });
await shot("05-path", "/", { selector: "main > section:nth-of-type(5)" });
await shot("06-evidence", "/evidence/", { height: 1500 });
await shot("07-model", "/model/", { height: 1300 });
await shot("08-verify", "/verify/", {
  height: 1500,
  before: async () => {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Run all/.test(b.textContent ?? ""))?.click());
    await wait(9000);
  },
});
await shot("09-thesis", "/thesis/", { height: 1300 });
await shot("10-mobile", "/", { width: 390, height: 844 });

await browser.close();
