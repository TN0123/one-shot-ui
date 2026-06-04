import { colorDistance, rgbToHex, type ImageAsset } from "@one-shot-ui/image-io";

/**
 * Deterministic "ruler" measurement of a single screenshot via pixel projections.
 *
 * This replaces the ad-hoc PIL/column-projection scripts that agents otherwise
 * hand-roll to recover the exact geometry of a reference (top-bar height, content
 * column edges, gutters). It reports background-zone bands along the y-axis and
 * content columns and gutters along the x-axis, all in raw image pixels — the CLI
 * applies DPR to convert to CSS px, matching the rest of the extract pipeline.
 */

export interface RulerBand {
  /** y of the band's top edge (raw image px). */
  start: number;
  /** y of the band's bottom edge, exclusive. */
  end: number;
  /** end - start. */
  size: number;
  /** Dominant background color of this y-zone. */
  background: string;
  /** Fraction (0..1) of pixels in the band that differ from `background`. */
  inkDensity: number;
}

export interface RulerColumn {
  /** x of the column's left edge (raw image px). */
  start: number;
  /** x of the column's right edge, exclusive. */
  end: number;
  /** end - start. */
  size: number;
  /** Fraction (0..1) of sampled rows with content at each x, averaged. */
  inkDensity: number;
}

export interface RulerGutter {
  /** x of the gutter's left edge. */
  start: number;
  /** x of the gutter's right edge, exclusive. */
  end: number;
  /** end - start — the gap width between two columns. */
  size: number;
}

export interface RulerReport {
  /** Global dominant background of the whole frame. */
  background: string;
  /** y-axis segmentation into background zones (top chrome, body, footers…). */
  bands: RulerBand[];
  /** The band (by area) used as the content region for column detection. */
  contentRegion: { start: number; end: number };
  /** x-axis content columns measured within `contentRegion`. */
  columns: RulerColumn[];
  /** Interior gaps between adjacent columns within `contentRegion`. */
  gutters: RulerGutter[];
}

export interface MeasureRulersOptions {
  /** Color distance above which a pixel counts as "different" ink (default 32). */
  colorTolerance?: number;
  /**
   * Color distance separating two background *zones* (default 16). Tighter than
   * `colorTolerance` so a near-black top bar is not merged into a near-black page.
   */
  bandTolerance?: number;
}

type RGB = { r: number; g: number; b: number };

function sampleStep(extent: number, target = 220): number {
  return Math.max(1, Math.round(extent / target));
}

/** Most-populous coarse (4-bit/channel) color bin over a region, averaged. */
function dominantColor(
  image: ImageAsset,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  xStep: number,
  yStep: number
): RGB {
  const ch = image.channels;
  const bins = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let y = y0; y < y1; y += yStep) {
    const row = y * image.width;
    for (let x = x0; x < x1; x += xStep) {
      const o = (row + x) * ch;
      const r = image.data[o] ?? 0;
      const g = image.data[o + 1] ?? 0;
      const b = image.data[o + 2] ?? 0;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const acc = bins.get(key);
      if (acc) {
        acc.r += r;
        acc.g += g;
        acc.b += b;
        acc.n += 1;
      } else {
        bins.set(key, { r, g, b, n: 1 });
      }
    }
  }
  let best: { r: number; g: number; b: number; n: number } | null = null;
  for (const acc of bins.values()) {
    if (!best || acc.n > best.n) best = acc;
  }
  if (!best) return { r: 0, g: 0, b: 0 };
  return { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n) };
}

/** Fraction of sampled pixels in a region differing from `ref` by > tol. */
function inkDensity(image: ImageAsset, x0: number, y0: number, x1: number, y1: number, xStep: number, yStep: number, ref: RGB, tol: number): number {
  const ch = image.channels;
  let total = 0;
  let ink = 0;
  for (let y = y0; y < y1; y += yStep) {
    const row = y * image.width;
    for (let x = x0; x < x1; x += xStep) {
      const o = (row + x) * ch;
      total += 1;
      if (colorDistance(image.data[o] ?? 0, image.data[o + 1] ?? 0, image.data[o + 2] ?? 0, ref.r, ref.g, ref.b) > tol) ink += 1;
    }
  }
  return total === 0 ? 0 : ink / total;
}

export function measureRulers(image: ImageAsset, opts: MeasureRulersOptions = {}): RulerReport {
  const tol = opts.colorTolerance ?? 32;
  const bandTol = opts.bandTolerance ?? 16;
  const { width, height } = image;
  const xStep = sampleStep(width);
  const globalBg = dominantColor(image, 0, 0, width, height, xStep, sampleStep(height));

  // --- 1. Block-wise dominant color, then segment y into background-zone runs. ---
  // Small vertical blocks smooth out single-row modal noise (a text-dense row
  // can momentarily flip its dominant) while still resolving thin top bars.
  const blockH = Math.max(1, Math.round(height / 300));
  type Run = { start: number; end: number; color: RGB };
  const runs: Run[] = [];
  for (let y = 0; y < height; y += blockH) {
    const y1 = Math.min(height, y + blockH);
    const c = dominantColor(image, 0, y, width, y1, xStep, 1);
    const cur = runs[runs.length - 1];
    if (cur && colorDistance(c.r, c.g, c.b, cur.color.r, cur.color.g, cur.color.b) <= bandTol) {
      cur.end = y1;
    } else {
      runs.push({ start: y, end: y1, color: c });
    }
  }

  // Absorb thin runs (anti-aliased edges, single content lines) into the
  // color-nearest neighbor so we don't emit phantom bands for text rows.
  const minBand = Math.max(4, Math.round(height * 0.015));
  let merged = true;
  while (merged && runs.length > 1) {
    merged = false;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!;
      if (run.end - run.start >= minBand) continue;
      const prev = runs[i - 1];
      const next = runs[i + 1];
      let target: Run | undefined;
      if (prev && next) {
        const dp = colorDistance(run.color.r, run.color.g, run.color.b, prev.color.r, prev.color.g, prev.color.b);
        const dn = colorDistance(run.color.r, run.color.g, run.color.b, next.color.r, next.color.g, next.color.b);
        target = dp <= dn ? prev : next;
      } else {
        target = prev ?? next;
      }
      if (!target) continue;
      target.start = Math.min(target.start, run.start);
      target.end = Math.max(target.end, run.end);
      runs.splice(i, 1);
      merged = true;
      break;
    }
  }

  // Collapse adjacent runs that share a background (absorbing a thin stray run
  // can leave two same-color runs touching) so one page zone is a single band.
  for (let i = runs.length - 1; i > 0; i--) {
    const a = runs[i - 1]!;
    const b = runs[i]!;
    if (colorDistance(a.color.r, a.color.g, a.color.b, b.color.r, b.color.g, b.color.b) <= bandTol) {
      a.end = b.end;
      runs.splice(i, 1);
    }
  }

  const bands: RulerBand[] = runs.map(run => {
    const yStep = Math.max(1, sampleStep(run.end - run.start, 80));
    const bg = dominantColor(image, 0, run.start, width, run.end, xStep, yStep);
    return {
      start: run.start,
      end: run.end,
      size: run.end - run.start,
      background: rgbToHex(bg.r, bg.g, bg.b),
      inkDensity: round3(inkDensity(image, 0, run.start, width, run.end, xStep, yStep, bg, tol))
    };
  });

  // --- 2. Vertical columns/gutters within the largest band (the body). ---
  // Measure "content vs the page canvas" using the GLOBAL background, not the
  // band's modal color: a band whose modal flips to a card/content fill must not
  // invert the column/gutter polarity.
  const body = bands.reduce((a, b) => (b.size > a.size ? b : a), bands[0]!);
  const yStep = Math.max(1, sampleStep(body.size, 200));
  const colInk: number[] = new Array(width).fill(0);
  for (let x = 0; x < width; x++) {
    colInk[x] = inkDensity(image, x, body.start, x + 1, body.end, 1, yStep, globalBg, tol);
  }

  const inkThreshold = 0.04;
  const mergeGap = Math.max(4, Math.round(width * 0.012));
  // Binarize then merge content runs across small gaps.
  const colBoxes: Array<{ start: number; end: number }> = [];
  let runStart = -1;
  for (let x = 0; x <= width; x++) {
    const isInk = x < width && (colInk[x] ?? 0) >= inkThreshold;
    if (isInk && runStart < 0) runStart = x;
    else if (!isInk && runStart >= 0) {
      const last = colBoxes[colBoxes.length - 1];
      if (last && runStart - last.end <= mergeGap) last.end = x;
      else colBoxes.push({ start: runStart, end: x });
      runStart = -1;
    }
  }
  const minColumn = Math.max(6, Math.round(width * 0.02));
  const columns: RulerColumn[] = colBoxes
    .filter(c => c.end - c.start >= minColumn)
    .map(c => {
      let sum = 0;
      for (let x = c.start; x < c.end; x++) sum += colInk[x] ?? 0;
      return { start: c.start, end: c.end, size: c.end - c.start, inkDensity: round3(sum / (c.end - c.start)) };
    });

  const minGutter = Math.max(4, Math.round(width * 0.008));
  const gutters: RulerGutter[] = [];
  for (let i = 1; i < columns.length; i++) {
    const gStart = columns[i - 1]!.end;
    const gEnd = columns[i]!.start;
    if (gEnd - gStart >= minGutter) gutters.push({ start: gStart, end: gEnd, size: gEnd - gStart });
  }

  return {
    background: rgbToHex(globalBg.r, globalBg.g, globalBg.b),
    bands,
    contentRegion: { start: body.start, end: body.end },
    columns,
    gutters
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
