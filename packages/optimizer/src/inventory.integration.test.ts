import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { collectElements } from "./inventory.js";

// A page with two text runs: one clipped by overflow:hidden, one plainly visible.
const FIXTURE = `<!DOCTYPE html><html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 600px; height: 400px; font-family: Arial, sans-serif; background: #fff; color: #111; }
  .clipped { position: absolute; left: 20px; top: 20px; width: 300px; height: 24px; overflow: hidden; font-size: 16px; line-height: 24px; }
  .visible { position: absolute; left: 20px; top: 220px; font-size: 16px; }
</style></head><body>
  <p class="clipped">This paragraph is far too long to fit inside its clipped box so the tail is cut</p>
  <p class="visible">Plainly visible caption</p>
</body></html>`;

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 600, height: 400 } });
  await page.setContent(FIXTURE, { waitUntil: "networkidle" });
}, 60_000);

afterAll(async () => {
  await browser.close();
});

describe("collectElements hidden detection", () => {
  it("flags overflow-clipped text as clip", async () => {
    const els = await collectElements(page);
    const clipped = els.find((e) => e.selector.includes("clipped"));
    expect(clipped?.hidden).toBe("clip");
  });

  it("leaves plainly visible text unflagged", async () => {
    const els = await collectElements(page);
    const vis = els.find((e) => e.selector.includes("visible"));
    expect(vis?.hidden ?? null).toBeNull();
  });
});
