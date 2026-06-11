import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { collectElements } from "./inventory.js";

const FIXTURE = `<!DOCTYPE html>
<html><head><style>
  body { margin: 0; }
  .card { width: 200px; height: 100px; background: #112233; padding: 10px; }
  .hidden { display: none; }
  .invisible { visibility: hidden; width: 50px; height: 50px; }
</style></head>
<body>
  <header id="top" style="height: 40px; background: #000;"><span class="logo">Logo</span></header>
  <main>
    <div class="card"><p>First card</p></div>
    <div class="card"><p>Second card</p></div>
    <div class="hidden">never seen</div>
    <div class="invisible">also unseen</div>
    <p class="tiny" style="width:2px;height:2px;overflow:hidden">x</p>
  </main>
  <script>window.__loaded = true;</script>
</body></html>`;

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(`data:text/html,${encodeURIComponent(FIXTURE)}`);
});

afterAll(async () => {
  await browser.close();
});

describe("collectElements", () => {
  it("returns visible elements with unique, resolvable selectors", async () => {
    const elements = await collectElements(page);
    expect(elements.length).toBeGreaterThan(3);

    const selectors = elements.map((e) => e.selector);
    expect(new Set(selectors).size).toBe(selectors.length);

    for (const el of elements) {
      const count = await page.evaluate(
        (sel) => document.querySelectorAll(sel).length,
        el.selector,
      );
      expect(count).toBe(1);
    }
  });

  it("uses the id when unique", async () => {
    const elements = await collectElements(page);
    const header = elements.find((e) => e.tag === "header");
    expect(header?.selector).toBe("#top");
  });

  it("disambiguates repeated classes with nth-of-type", async () => {
    const elements = await collectElements(page);
    const cards = elements.filter((e) => e.tag === "div" && e.selector.includes(".card"));
    expect(cards.length).toBe(2);
    expect(cards[0]!.selector).not.toBe(cards[1]!.selector);
  });

  it("excludes hidden, invisible, tiny, and script elements", async () => {
    const elements = await collectElements(page);
    expect(elements.find((e) => e.text === "never seen")).toBeUndefined();
    expect(elements.find((e) => e.selector.includes(".invisible"))).toBeUndefined();
    expect(elements.find((e) => e.selector.includes(".tiny"))).toBeUndefined();
    expect(elements.find((e) => e.tag === "script")).toBeUndefined();
  });

  it("reports integer bounds and a computed-style subset", async () => {
    const elements = await collectElements(page);
    const card = elements.find((e) => e.selector.includes(".card"));
    expect(card).toBeDefined();
    expect(Number.isInteger(card!.bounds.x)).toBe(true);
    expect(Number.isInteger(card!.bounds.width)).toBe(true);
    expect(card!.styles.backgroundColor).toBe("rgb(17, 34, 51)");
    expect(card!.styles.paddingTop).toBe("10px");
  });

  it("orders containers before children (depth asc)", async () => {
    const elements = await collectElements(page);
    const main = elements.findIndex((e) => e.tag === "main");
    const p = elements.findIndex((e) => e.text === "First card" && e.tag === "p");
    expect(main).toBeGreaterThanOrEqual(0);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(main).toBeLessThan(p);
  });
});
