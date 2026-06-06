// Screenshot the display for design iteration.
//   node scripts/screenshot.mjs <outfile> [theme] [waitMs] [url]
import { chromium } from "playwright";

const out = process.argv[2] ?? "/tmp/shots/shot.png";
const theme = process.argv[3] ?? null;
const waitMs = Number(process.argv[4] ?? 9000);
const url = process.argv[5] ?? "http://localhost:3000/";

if (theme) {
  await fetch("http://localhost:3000/api/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ theme }),
  });
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
await page.goto(url, { waitUntil: "networkidle" });
// Let aircraft + comet trails accumulate from the live stream.
await page.waitForTimeout(waitMs);
await page.screenshot({ path: out });
await browser.close();
console.log("wrote", out);
