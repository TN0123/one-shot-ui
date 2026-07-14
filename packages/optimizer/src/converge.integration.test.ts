import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Browser } from "playwright";
import { PNG } from "pngjs";
import { converge } from "./index.js";
import type { ReferenceData } from "./matching.js";

const WIDTH = 900;
const HEIGHT = 600;

const FIXTURE = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; background: #15161c; font-family: Arial, sans-serif; color: #e4e4e7; }
  .topbar { height: 56px; background: #0e0f14; padding: 0 24px; display: flex; align-items: center; }
  .title { font-size: 18px; font-weight: 700; color: #a78bfa; }
  .content { padding: 24px; display: flex; flex-direction: column; gap: 16px; }
  .cards { display: flex; gap: 16px; }
  .card { width: 268px; height: 120px; background: #1c1d26; border-radius: 12px; padding: 20px; }
  .card .label { font-size: 13px; color: #71717a; }
  .card .value { font-size: 28px; font-weight: 700; margin-top: 8px; }
  .panel { height: 280px; background: #1c1d26; border-radius: 12px; padding: 20px; }
  .panel h2 { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
  .row { height: 40px; border-bottom: 1px solid #27272a; display: flex; align-items: center; font-size: 14px; }
</style></head>
<body>
  <div class="topbar"><span class="title">Fixture</span></div>
  <div class="content">
    <div class="cards">
      <div class="card"><div class="label">Revenue</div><div class="value">$12,500</div></div>
      <div class="card"><div class="label">Deals</div><div class="value">64</div></div>
      <div class="card"><div class="label">Win rate</div><div class="value">38%</div></div>
    </div>
    <div class="panel">
      <h2>Recent</h2>
      <div class="row">Jane Doe — Enterprise</div>
      <div class="row">Mike Kim — Pro</div>
      <div class="row">Sara Roth — Team</div>
    </div>
  </div>
</body></html>`;

// 6 planted ground-truth bugs (property, wrong value in perturbed copy, truth):
const PERTURBATIONS: Array<[string, string]> = [
  // 1. content padding 24 -> 32
  [".content { padding: 24px;", ".content { padding: 32px;"],
  // 2. card value font 28 -> 23
  [".card .value { font-size: 28px;", ".card .value { font-size: 23px;"],
  // 3. cards gap 16 -> 28
  [".cards { display: flex; gap: 16px; }", ".cards { display: flex; gap: 28px; }"],
  // 4. card background #1c1d26 -> #262834
  [".card { width: 268px; height: 120px; background: #1c1d26;", ".card { width: 268px; height: 120px; background: #262834;"],
  // 5. card radius 12 -> 4
  ["border-radius: 12px; padding: 20px; }\n  .card .label", "border-radius: 4px; padding: 20px; }\n  .card .label"],
  // 6. title color #a78bfa -> #f59e0b
  [".title { font-size: 18px; font-weight: 700; color: #a78bfa; }", ".title { font-size: 18px; font-weight: 700; color: #f59e0b; }"],
];

let dir: string;
let browser: Browser;
let referencePath: string;
let referenceRgba: Uint8ClampedArray;
let refData: ReferenceData;

function buildRefData(): ReferenceData {
  // Hand-authored reference data mirroring what extract would report for the
  // fixture (region bounds in CSS px, fills, radii, text with sizes/colors).
  return {
    layout: [
      { id: "topbar", bounds: { x: 0, y: 0, width: 900, height: 56 }, fill: "#0E0F14", borderRadius: 0 },
      { id: "card-1", bounds: { x: 24, y: 80, width: 268, height: 120 }, fill: "#1C1D26", borderRadius: 12 },
      { id: "card-2", bounds: { x: 308, y: 80, width: 268, height: 120 }, fill: "#1C1D26", borderRadius: 12 },
      { id: "card-3", bounds: { x: 592, y: 80, width: 268, height: 120 }, fill: "#1C1D26", borderRadius: 12 },
      { id: "panel", bounds: { x: 24, y: 216, width: 852, height: 280 }, fill: "#1C1D26", borderRadius: 12 },
    ],
    text: [
      { text: "Fixture", bounds: { x: 24, y: 19, width: 60, height: 18 }, typography: { fontSize: 18, fontWeight: 700 }, color: "#A78BFA" },
      { text: "Revenue", bounds: { x: 44, y: 100, width: 60, height: 13 }, typography: { fontSize: 13, fontWeight: 400 }, color: "#71717A" },
      { text: "$12,500", bounds: { x: 44, y: 121, width: 110, height: 28 }, typography: { fontSize: 28, fontWeight: 700 }, color: "#E4E4E7" },
      { text: "64", bounds: { x: 328, y: 121, width: 40, height: 28 }, typography: { fontSize: 28, fontWeight: 700 }, color: "#E4E4E7" },
      { text: "38%", bounds: { x: 612, y: 121, width: 60, height: 28 }, typography: { fontSize: 28, fontWeight: 700 }, color: "#E4E4E7" },
    ],
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "osui-converge-test-"));
  browser = await chromium.launch({ headless: true });

  const refHtml = join(dir, "ref.html");
  await writeFile(refHtml, FIXTURE);
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.goto(`file://${refHtml}`);
  await page.waitForTimeout(100);
  referencePath = join(dir, "ref.png");
  await page.screenshot({ path: referencePath, fullPage: false });
  await page.close();

  const png = PNG.sync.read(Buffer.from(await Bun.file(referencePath).arrayBuffer()) as unknown as Uint8Array);
  referenceRgba = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength);
  refData = buildRefData();
}, 60_000);

afterAll(async () => {
  await browser.close();
  await rm(dir, { recursive: true, force: true });
});

describe("converge (integration)", () => {
  it(
    "drives a 6-bug perturbed build to pixel-converged and recovers the planted values",
    async () => {
      let perturbed = FIXTURE;
      for (const [truth, wrong] of PERTURBATIONS) {
        expect(perturbed.includes(truth)).toBe(true);
        perturbed = perturbed.replace(truth, wrong);
      }
      const implPath = join(dir, "perturbed.html");
      await writeFile(implPath, perturbed);

      const report = await converge({
        referencePath,
        implPath,
        referenceRgba,
        width: WIDTH,
        height: HEIGHT,
        viewport: { width: WIDTH, height: HEIGHT, scale: 1 },
        refData,
        browser,
      });

      expect(report.initialMismatchRatio).toBeGreaterThan(0.005);
      expect(report.finalMismatchRatio).toBeLessThanOrEqual(0.002);
      expect(report.verdict).toBe("pixel-converged");

      const byProp = (p: string) => report.accepted.filter((f) => f.property === p);
      // Color bugs recovered exactly.
      expect(byProp("background-color").some((f) => f.value.toUpperCase() === "#1C1D26")).toBe(true);
      expect(byProp("color").some((f) => f.value.toUpperCase() === "#A78BFA")).toBe(true);
      // Font size recovered within 1px.
      expect(byProp("font-size").some((f) => Math.abs(parseInt(f.value, 10) - 28) <= 1)).toBe(true);
      // Radius recovered within 1px.
      expect(byProp("border-radius").some((f) => Math.abs(parseInt(f.value, 10) - 12) <= 1)).toBe(true);
      // Patch text contains every accepted fix.
      for (const fix of report.accepted) {
        expect(report.patchCss.includes(`${fix.property}: ${fix.value}`)).toBe(true);
      }
      // The converged build keeps all content and scores high on fidelity — the
      // pixel win did NOT come at the cost of hidden/overlapping text.
      expect(report.contentRestored).toBeGreaterThanOrEqual(0);
      expect(report.fidelity.contentRecall).toBe(1);
      expect(report.fidelity.score).toBeGreaterThan(85);
    },
    240_000,
  );

  it(
    "accepts nothing on an unperturbed build (no churn)",
    async () => {
      const implPath = join(dir, "clean.html");
      await writeFile(implPath, FIXTURE);

      const report = await converge({
        referencePath,
        implPath,
        referenceRgba,
        width: WIDTH,
        height: HEIGHT,
        viewport: { width: WIDTH, height: HEIGHT, scale: 1 },
        refData,
        browser,
      });

      expect(report.accepted.length).toBe(0);
      expect(report.finalMismatchRatio).toBeLessThanOrEqual(0.002);
      expect(report.verdict).toBe("pixel-converged");
      // Structural gates are no-ops on a faithful build, and fidelity is high.
      expect(report.overlapsRepaired).toBe(0);
      expect(report.contentRestored).toBe(0);
      expect(report.fidelity.contentRecall).toBe(1);
      expect(report.fidelity.gates.contentComplete).toBe(true);
      expect(report.fidelity.score).toBeGreaterThan(90);
    },
    120_000,
  );
});
