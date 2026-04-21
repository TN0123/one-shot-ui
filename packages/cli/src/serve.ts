import http from "node:http";
import { watch } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, dirname, join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { compareImages } from "@one-shot-ui/diff-engine";

export interface ServeOptions {
  referencePath: string;
  implPath: string;
  port: number;
  extractReport: any;
}

type Bbox = { x: number; y: number; width: number; height: number };

export async function runServe(opts: ServeOptions): Promise<void> {
  const { referencePath, implPath, port, extractReport: refReport } = opts;
  const absImplPath = implPath.startsWith("http") ? implPath : resolve(implPath);
  const implUrl = implPath.startsWith("http")
    ? implPath
    : pathToFileURL(absImplPath).href;

  const workDir = await mkdtemp(join(tmpdir(), "one-shot-ui-serve-"));
  const shutdown: Array<() => Promise<void> | void> = [
    async () => rm(workDir, { recursive: true, force: true }),
  ];

  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Executable doesn't exist")) {
      throw new Error(
        "Playwright Chromium is not installed. Run `npx playwright install chromium` and retry.",
      );
    }
    throw err;
  }
  shutdown.push(() => browser.close());

  const context: BrowserContext = await browser.newContext({
    viewport: { width: refReport.image.width, height: refReport.image.height },
    deviceScaleFactor: 1,
  });
  const page: Page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  async function loadImpl(): Promise<void> {
    consoleErrors.length = 0;
    await page.goto(implUrl, { waitUntil: "networkidle", timeout: 30_000 });
  }
  await loadImpl();

  if (!implPath.startsWith("http")) {
    let debounce: NodeJS.Timeout | null = null;
    const watcher = watch(absImplPath, { persistent: true }, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        process.stderr.write(`[watch] ${absImplPath} changed, reloading...\n`);
        try {
          await loadImpl();
          process.stderr.write(`[watch] reloaded.\n`);
        } catch (err) {
          process.stderr.write(`[watch] reload failed: ${err instanceof Error ? err.message : err}\n`);
        }
      }, 120);
    });
    shutdown.push(() => watcher.close());
  }

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, {
        page,
        refReport,
        referencePath,
        workDir,
        consoleErrors,
      });
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, () => {
      console.log(`\none-shot-ui serve ready at http://localhost:${port}`);
      console.log(`  reference: ${referencePath} (${refReport.image.width}x${refReport.image.height})`);
      console.log(`  impl:      ${implPath}`);
      console.log();
      console.log("Endpoints:");
      console.log("  GET  /status                      Overall mismatch + top mismatched regions");
      console.log("  GET  /reference                   Reference brief (colors, text, regions)");
      console.log("  GET  /element?selector=<css>      DOM element -> reference-region diff");
      console.log("  POST /apply-temp  { selector, css }  Trial CSS, return mismatch delta");
      console.log("  POST /reload                      Manually reload the impl");
      console.log();
      console.log("Ctrl-C to stop.");
      resolvePromise();
    });
  });
  shutdown.push(() => new Promise<void>((r) => server.close(() => r())));

  const stop = async () => {
    process.stderr.write("\nShutting down one-shot-ui serve...\n");
    for (const fn of shutdown.reverse()) {
      try {
        await fn();
      } catch {
        // ignore
      }
    }
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Keep running
  await new Promise(() => {});
}

// ── Request routing ─────────────────────────────────────────────────────────

interface HandlerCtx {
  page: Page;
  refReport: any;
  referencePath: string;
  workDir: string;
  consoleErrors: string[];
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: HandlerCtx,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && url.pathname === "/status") {
    return handleStatus(res, ctx);
  }
  if (req.method === "GET" && url.pathname === "/reference") {
    return handleReference(res, ctx);
  }
  if (req.method === "GET" && url.pathname === "/element") {
    return handleElement(res, ctx, url.searchParams.get("selector"));
  }
  if (req.method === "POST" && url.pathname === "/apply-temp") {
    return handleApplyTemp(req, res, ctx);
  }
  if (req.method === "POST" && url.pathname === "/reload") {
    await ctx.page.reload({ waitUntil: "networkidle" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found", method: req.method, path: url.pathname }));
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleStatus(res: http.ServerResponse, ctx: HandlerCtx): Promise<void> {
  const shot = join(ctx.workDir, `status-${Date.now()}.png`);
  await ctx.page.screenshot({ path: shot, fullPage: false });
  const compare = await compareImages(ctx.referencePath, shot, {
    disableOcr: true,
  });
  await rm(shot, { force: true });

  const topRegions = (compare.summary.gridBreakdown ?? [])
    .slice(0, 5)
    .map((g: any) => ({
      label: g.label,
      mismatchRatio: g.mismatchRatio,
      contributionPct: Math.round((g.contribution ?? 0) * 100),
    }));

  res.end(
    JSON.stringify(
      {
        mismatchRatio: compare.summary.mismatchRatio,
        mismatchPixels: compare.summary.mismatchPixels,
        rawMismatch: compare.summary.rawMismatch,
        segmented: compare.summary.segmented,
        topRegions,
        issueCount: compare.issues.length,
        consoleErrors: ctx.consoleErrors.slice(-5),
      },
      null,
      2,
    ),
  );
}

async function handleReference(res: http.ServerResponse, ctx: HandlerCtx): Promise<void> {
  const r = ctx.refReport;
  const brief = {
    image: r.image,
    background: r.diagnostics?.background ?? null,
    colors: (r.colors ?? []).slice(0, 10),
    fontSizes: extractFontSizes(r.text ?? []),
    text: (r.text ?? []).map((t: any) => ({
      text: t.text,
      bounds: t.bounds,
      fontSize: t.typography?.fontSize ?? null,
      fontWeight: t.typography?.fontWeight ?? null,
    })),
    regions: (r.layout ?? []).map((n: any) => ({
      id: n.id,
      bounds: n.bounds,
      fill: n.fill,
      borderRadius: n.borderRadius ?? null,
      shadow: n.shadow ?? null,
    })),
    semanticAnchors: (r.semanticAnchors ?? []).map((a: any) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      bounds: a.bounds,
      parentId: a.parentId,
    })),
  };
  res.end(JSON.stringify(brief, null, 2));
}

async function handleElement(
  res: http.ServerResponse,
  ctx: HandlerCtx,
  selector: string | null,
): Promise<void> {
  if (!selector) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "?selector=<css> is required" }));
    return;
  }

  let count: number;
  try {
    count = await ctx.page.locator(selector).count();
  } catch (err) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: `invalid selector: ${err instanceof Error ? err.message : err}` }));
    return;
  }
  if (count === 0) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: `no elements match ${selector}` }));
    return;
  }

  const locator = ctx.page.locator(selector).first();
  const bbox = await locator.boundingBox();
  if (!bbox) {
    res.end(JSON.stringify({ error: "element is not visible (zero-size or display:none)", selector, matchCount: count }));
    return;
  }

  const computed = await locator.evaluate((el) => {
    const s = window.getComputedStyle(el as Element);
    const textContent = (el as HTMLElement).innerText?.trim().slice(0, 200) || null;
    return {
      tag: el.tagName.toLowerCase(),
      id: (el as HTMLElement).id || null,
      classList: Array.from((el as HTMLElement).classList),
      text: textContent,
      backgroundColor: s.backgroundColor,
      color: s.color,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      padding: s.padding,
      paddingTop: s.paddingTop,
      paddingRight: s.paddingRight,
      paddingBottom: s.paddingBottom,
      paddingLeft: s.paddingLeft,
      margin: s.margin,
      border: s.border,
      borderRadius: s.borderRadius,
      boxShadow: s.boxShadow,
      width: s.width,
      height: s.height,
      display: s.display,
      textAlign: s.textAlign,
      opacity: s.opacity,
    };
  });

  const refRegion = findReferenceRegion(ctx.refReport, bbox);
  const diffs = computeDiffs(computed, refRegion, ctx.refReport);

  res.end(
    JSON.stringify(
      {
        selector,
        matchCount: count,
        boundingBox: {
          x: Math.round(bbox.x),
          y: Math.round(bbox.y),
          width: Math.round(bbox.width),
          height: Math.round(bbox.height),
        },
        myComputed: computed,
        reference: refRegion,
        diffs,
      },
      null,
      2,
    ),
  );
}

async function handleApplyTemp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: HandlerCtx,
): Promise<void> {
  const body = await readBody(req);
  let payload: { selector?: string; css?: string };
  try {
    payload = JSON.parse(body);
  } catch (err) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "request body must be valid JSON with { selector, css }" }));
    return;
  }
  const { selector, css } = payload;
  if (!selector || !css) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "both selector and css are required" }));
    return;
  }

  const beforeShot = join(ctx.workDir, `before-${Date.now()}.png`);
  const afterShot = join(ctx.workDir, `after-${Date.now()}.png`);

  // Score before
  await ctx.page.screenshot({ path: beforeShot, fullPage: false });
  const before = await compareImages(ctx.referencePath, beforeShot, {
    disableOcr: true,
  });

  // Inject CSS scoped to selector. We use a data attribute to make removal clean.
  const tagId = `one-shot-ui-temp-${Date.now()}`;
  const rule = `${selector} { ${css} }`;
  await ctx.page.evaluate(
    ([id, text]) => {
      const existing = document.getElementById(id);
      if (existing) existing.remove();
      const tag = document.createElement("style");
      tag.id = id;
      tag.textContent = text;
      document.head.appendChild(tag);
    },
    [tagId, rule],
  );
  // Let layout settle briefly
  await ctx.page.waitForTimeout(80);

  await ctx.page.screenshot({ path: afterShot, fullPage: false });
  const after = await compareImages(ctx.referencePath, afterShot, {
    disableOcr: true,
  });

  // Remove our style tag so the page is back to its clean state
  await ctx.page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  }, tagId);

  // Scoped scoring: also crop the before/after/reference to the element's bbox
  let scopedDelta: number | null = null;
  try {
    const locator = ctx.page.locator(selector).first();
    const bbox = await locator.boundingBox();
    if (bbox) {
      // Use a direct scoped compare via CompareImagesOptions.crop
      const cropBounds = {
        x: Math.max(0, Math.floor(bbox.x)),
        y: Math.max(0, Math.floor(bbox.y)),
        width: Math.max(1, Math.floor(bbox.width)),
        height: Math.max(1, Math.floor(bbox.height)),
      };
      const scopedBefore = await compareImages(ctx.referencePath, beforeShot, {
        disableOcr: true,
        crop: cropBounds,
      });
      const scopedAfter = await compareImages(ctx.referencePath, afterShot, {
        disableOcr: true,
        crop: cropBounds,
      });
      scopedDelta = scopedAfter.summary.mismatchRatio - scopedBefore.summary.mismatchRatio;
    }
  } catch {
    // ignore
  }

  await rm(beforeShot, { force: true });
  await rm(afterShot, { force: true });

  const globalDelta = after.summary.mismatchRatio - before.summary.mismatchRatio;

  res.end(
    JSON.stringify(
      {
        selector,
        css,
        before: { mismatchRatio: before.summary.mismatchRatio },
        after: { mismatchRatio: after.summary.mismatchRatio },
        globalDelta,
        globalImprovement: -globalDelta,
        scopedDelta,
        scopedImprovement: scopedDelta == null ? null : -scopedDelta,
        verdict: (() => {
          // Global delta is what ultimately matters — an edit that helps the
          // scoped region but hurts layout elsewhere is still a net loss.
          // Scoped delta is reported separately so the agent can see both.
          if (globalDelta < -0.0005) return "better";
          if (globalDelta > 0.0005) return "worse";
          return "no-change";
        })(),
      },
      null,
      2,
    ),
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function extractFontSizes(text: any[]): Array<{ size: number; count: number }> {
  const map = new Map<number, number>();
  for (const t of text) {
    const s = t.typography?.fontSize;
    if (s) map.set(s, (map.get(s) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([size, count]) => ({ size, count }));
}

function findReferenceRegion(refReport: any, bbox: Bbox): any {
  const layout = refReport.layout ?? [];
  const anchors = refReport.semanticAnchors ?? [];
  const text = refReport.text ?? [];

  // Find layout node with best IoU overlap
  let bestNode: any = null;
  let bestIoU = 0;
  for (const node of layout) {
    const iou = bboxIoU(node.bounds, bbox);
    if (iou > bestIoU) {
      bestIoU = iou;
      bestNode = node;
    }
  }

  // Find anchor matching by nodeId or bounds
  let matchedAnchor: any = null;
  if (bestNode) {
    matchedAnchor =
      anchors.find((a: any) => a.nodeId === bestNode.id) ??
      anchors.find(
        (a: any) =>
          a.bounds.x === bestNode.bounds.x && a.bounds.y === bestNode.bounds.y,
      );
  }
  // If no layout-node match, look for anchor whose bounds contain/overlap bbox
  if (!matchedAnchor) {
    let best: { anchor: any; iou: number } | null = null;
    for (const a of anchors) {
      const iou = bboxIoU(a.bounds, bbox);
      if (!best || iou > best.iou) best = { anchor: a, iou };
    }
    if (best && best.iou > 0.2) matchedAnchor = best.anchor;
  }

  // Text blocks contained within bbox (with small tolerance)
  const tol = 6;
  const containedText = text
    .filter(
      (t: any) =>
        t.bounds.x >= bbox.x - tol &&
        t.bounds.y >= bbox.y - tol &&
        t.bounds.x + t.bounds.width <= bbox.x + bbox.width + tol &&
        t.bounds.y + t.bounds.height <= bbox.y + bbox.height + tol,
    )
    .map((t: any) => ({
      text: t.text,
      bounds: t.bounds,
      fontSize: t.typography?.fontSize ?? null,
      fontWeight: t.typography?.fontWeight ?? null,
      confidence: t.confidence,
    }));

  if (!bestNode && !matchedAnchor && containedText.length === 0) {
    return null;
  }

  return {
    layoutNode: bestNode
      ? {
          id: bestNode.id,
          bounds: bestNode.bounds,
          fill: bestNode.fill,
          borderRadius: bestNode.borderRadius ?? null,
          shadow: bestNode.shadow ?? null,
          gradient: bestNode.gradient ?? null,
          iouWithElement: Number(bestIoU.toFixed(3)),
        }
      : null,
    anchor: matchedAnchor
      ? {
          id: matchedAnchor.id,
          name: matchedAnchor.name,
          role: matchedAnchor.role,
          bounds: matchedAnchor.bounds,
          parentId: matchedAnchor.parentId,
        }
      : null,
    containedText,
  };
}

function computeDiffs(computed: any, refRegion: any, _refReport: any): Array<{
  property: string;
  mine: string;
  reference: string;
  suggestion: string;
  severity: "high" | "medium" | "low";
}> {
  const diffs: Array<{
    property: string;
    mine: string;
    reference: string;
    suggestion: string;
    severity: "high" | "medium" | "low";
  }> = [];

  if (!refRegion) return diffs;

  const refFill = refRegion.layoutNode?.fill;
  if (refFill && typeof refFill === "string") {
    const myHex = rgbToHex(computed.backgroundColor);
    if (myHex && !sameColor(myHex, refFill)) {
      diffs.push({
        property: "background-color",
        mine: myHex,
        reference: refFill,
        suggestion: `background-color: ${refFill};`,
        severity: deltaE(myHex, refFill) > 12 ? "high" : "medium",
      });
    }
  }

  const refRadius = refRegion.layoutNode?.borderRadius;
  if (refRadius != null && typeof refRadius === "number") {
    const myRadius = parsePx(computed.borderRadius);
    if (myRadius != null && Math.abs(myRadius - refRadius) > 2) {
      diffs.push({
        property: "border-radius",
        mine: `${myRadius}px`,
        reference: `${refRadius}px`,
        suggestion: `border-radius: ${refRadius}px;`,
        severity: "low",
      });
    }
  }

  if (refRegion.containedText && refRegion.containedText.length > 0) {
    // Aggregate reference font size (weighted by text length)
    let totalWeight = 0;
    let sum = 0;
    for (const t of refRegion.containedText) {
      if (t.fontSize && t.fontSize > 0) {
        const w = Math.max(1, (t.text ?? "").length);
        sum += t.fontSize * w;
        totalWeight += w;
      }
    }
    if (totalWeight > 0) {
      const refSize = Math.round(sum / totalWeight);
      const mySize = parsePx(computed.fontSize);
      if (mySize != null && Math.abs(mySize - refSize) > 2) {
        diffs.push({
          property: "font-size",
          mine: `${mySize}px`,
          reference: `~${refSize}px (inferred from OCR; can be off by ±2px)`,
          suggestion: `font-size: ${refSize}px;`,
          severity: Math.abs(mySize - refSize) > 6 ? "medium" : "low",
        });
      }
    }
  }

  // Bounds/size diff
  if (refRegion.layoutNode?.bounds) {
    const rb = refRegion.layoutNode.bounds;
    // Using the element's OWN bbox vs the reference layout node's bbox — these may
    // reasonably differ when the element is a container whose children fill a
    // smaller area; flag only when the gap is large.
    // (Skipping for now: the element bbox comes from Playwright separately.)
    void rb;
  }

  return diffs;
}

function rgbToHex(rgb: string | null): string | null {
  if (!rgb) return null;
  const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?/i);
  if (!m) return null;
  const [, r, g, b, a] = m;
  // Fully transparent → no meaningful background color; don't emit a false diff.
  if (a != null && Number(a) === 0) return null;
  const toHex = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${toHex(r!)}${toHex(g!)}${toHex(b!)}`.toUpperCase();
}

function parsePx(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/^(-?\d*(?:\.\d+)?)px$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function sameColor(a: string, b: string): boolean {
  return a.replace("#", "").toLowerCase() === b.replace("#", "").toLowerCase();
}

function deltaE(a: string, b: string): number {
  // Simple RGB distance, not true Lab deltaE, but good enough for severity buckets.
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  if (!pa || !pb) return 0;
  const dr = pa.r - pb.r;
  const dg = pa.g - pb.g;
  const db = pa.b - pb.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function hexToRgb(h: string): { r: number; g: number; b: number } | null {
  const m = h.replace("#", "");
  if (m.length !== 6) return null;
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  };
}

function bboxIoU(a: Bbox, b: Bbox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}
