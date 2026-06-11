import type { Bounds } from "@one-shot-ui/core";
import type { Candidate, MatchedElement } from "./types.js";

export const FAMILY_ORDER = ["geometry", "color", "typography", "effects"] as const;
export type Family = (typeof FAMILY_ORDER)[number];

const GEOMETRY_THRESHOLD_PX = 2;
const FONT_SIZE_THRESHOLD_PX = 1;
const RADIUS_THRESHOLD_PX = 2;

export function rgbToHex(rgb: string | null | undefined): string | null {
  if (!rgb) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(rgb)) return rgb.toUpperCase();
  const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?/i);
  if (!m) return null;
  const [, r, g, b, a] = m;
  if (a != null && Number(a) === 0) return null;
  const toHex = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${toHex(r!)}${toHex(g!)}${toHex(b!)}`.toUpperCase();
}

function sameColor(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function parsePx(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^(-?\d*(?:\.\d+)?)px$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Refinement steps around an accepted numeric value: ±1, ±2, ±4 px. */
export function refinementValues(base: number, unit: string): string[] {
  const out: string[] = [];
  for (const step of [1, 2, 4]) {
    out.push(`${base + step}${unit}`, `${base - step}${unit}`);
  }
  return out;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

export interface CandidateContext {
  /** Dominant reference color under a CSS-px bounds (pixel-sampled, exact hex). */
  sampleFill?: (bounds: Bounds) => string | null;
}

export function candidatesFor(
  m: MatchedElement,
  family: Family,
  ctx: CandidateContext = {},
): Candidate[] {
  switch (family) {
    case "geometry":
      return geometryCandidates(m);
    case "color":
      return colorCandidates(m, ctx);
    case "typography":
      return typographyCandidates(m);
    case "effects":
      return effectsCandidates(m);
  }
}

function geometryCandidates(m: MatchedElement): Candidate[] {
  const out: Candidate[] = [];
  const region = m.region;
  if (!region) return textAnchoredGeometry(m);
  const { selector, bounds, styles } = withElement(m);

  const dw = region.bounds.width - bounds.width;
  if (Math.abs(dw) > GEOMETRY_THRESHOLD_PX) {
    out.push({
      selector,
      property: "width",
      value: `${region.bounds.width}px`,
      source: "geometry:width",
      numeric: { base: region.bounds.width, unit: "px" },
    });
  }

  const dh = region.bounds.height - bounds.height;
  if (Math.abs(dh) > GEOMETRY_THRESHOLD_PX) {
    out.push({
      selector,
      property: "height",
      value: `${region.bounds.height}px`,
      source: "geometry:height",
      numeric: { base: region.bounds.height, unit: "px" },
    });
    // Height deltas are often padding, not content height — offer the padding
    // split as an alternative candidate when the element has vertical padding.
    const pt = parsePx(styles.paddingTop);
    const pb = parsePx(styles.paddingBottom);
    if (pt != null && pb != null && (pt > 0 || pb > 0)) {
      const adjust = Math.round(dh / 2);
      const newPt = pt + adjust;
      const newPb = pb + (dh - adjust);
      if (newPt >= 0 && newPb >= 0) {
        out.push({
          selector,
          property: "padding-top",
          value: `${newPt}px`,
          source: "geometry:padding-top",
          numeric: { base: newPt, unit: "px" },
        });
        out.push({
          selector,
          property: "padding-bottom",
          value: `${newPb}px`,
          source: "geometry:padding-bottom",
          numeric: { base: newPb, unit: "px" },
        });
      }
    }
  }

  const dx = region.bounds.x - bounds.x;
  if (Math.abs(dx) > GEOMETRY_THRESHOLD_PX) {
    const ml = parsePx(styles.marginLeft) ?? 0;
    out.push({
      selector,
      property: "margin-left",
      value: `${ml + dx}px`,
      source: "geometry:margin-left",
      numeric: { base: ml + dx, unit: "px" },
    });
  }

  const dy = region.bounds.y - bounds.y;
  if (Math.abs(dy) > GEOMETRY_THRESHOLD_PX) {
    const mt = parsePx(styles.marginTop) ?? 0;
    out.push({
      selector,
      property: "margin-top",
      value: `${mt + dy}px`,
      source: "geometry:margin-top",
      numeric: { base: mt + dy, unit: "px" },
    });
  }

  return out;
}

/**
 * Geometry for elements with no matched region but with matched reference
 * text: shift the element so its text lands where the reference's text sits.
 * The seed only needs to be near — the trial + line search settle the value.
 */
function textAnchoredGeometry(m: MatchedElement): Candidate[] {
  const out: Candidate[] = [];
  if (!m.textBlocks.length || !m.element.text) return out;
  const { selector, bounds, styles } = withElement(m);

  const dx = median(m.textBlocks.map((t) => t.bounds.x - bounds.x));
  const dy = median(m.textBlocks.map((t) => t.bounds.y - bounds.y));
  const SANITY_PX = 64;

  if (dx != null && Math.abs(dx) > GEOMETRY_THRESHOLD_PX && Math.abs(dx) <= SANITY_PX) {
    const ml = parsePx(styles.marginLeft) ?? 0;
    out.push({
      selector,
      property: "margin-left",
      value: `${ml + dx}px`,
      source: "geometry:text-anchor-x",
      numeric: { base: ml + dx, unit: "px" },
    });
  }
  if (dy != null && Math.abs(dy) > GEOMETRY_THRESHOLD_PX && Math.abs(dy) <= SANITY_PX) {
    const mt = parsePx(styles.marginTop) ?? 0;
    out.push({
      selector,
      property: "margin-top",
      value: `${mt + dy}px`,
      source: "geometry:text-anchor-y",
      numeric: { base: mt + dy, unit: "px" },
    });
  }
  return out;
}

const MIN_SAMPLE_AREA_PX = 600;

function colorCandidates(m: MatchedElement, ctx: CandidateContext): Candidate[] {
  const out: Candidate[] = [];
  const { selector, bounds, styles } = withElement(m);
  const mine = rgbToHex(styles.backgroundColor);

  // Pixel-sampled surface color beats extract's quantized fill — exact hex from
  // the reference pixels under this element's own footprint.
  let sampled: string | null = null;
  if (ctx.sampleFill && m.element.area >= MIN_SAMPLE_AREA_PX) {
    sampled = ctx.sampleFill(bounds);
    if (sampled && mine && !sameColor(mine, sampled)) {
      out.push({
        selector,
        property: "background-color",
        value: sampled.toUpperCase(),
        source: "color:ref-pixels",
      });
    }
  }

  const refFill = m.region?.fill ?? null;
  if (refFill && (!sampled || !sameColor(refFill, sampled))) {
    if (mine && !sameColor(mine, refFill)) {
      out.push({
        selector,
        property: "background-color",
        value: refFill.toUpperCase(),
        source: "color:fill",
      });
    }
  }

  const textColors = m.textBlocks.map((t) => t.color).filter((c): c is string => !!c);
  if (textColors.length) {
    // Dominant = most frequent (ties broken by first occurrence — deterministic).
    const counts = new Map<string, number>();
    for (const c of textColors) {
      const key = c.toUpperCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const mine = rgbToHex(styles.color);
    if (mine && !sameColor(mine, dominant)) {
      out.push({
        selector,
        property: "color",
        value: dominant,
        source: "color:text",
      });
    }
  }

  return out;
}

const WEIGHT_BUCKETS = [400, 500, 600, 700];

function typographyCandidates(m: MatchedElement): Candidate[] {
  const out: Candidate[] = [];
  if (!m.textBlocks.length) return out;
  const { selector, styles } = withElement(m);

  const refSize = median(m.textBlocks.map((t) => t.fontSize).filter((s): s is number => s != null && s > 0));
  const mySize = parsePx(styles.fontSize);
  if (refSize != null && mySize != null && Math.abs(refSize - mySize) > FONT_SIZE_THRESHOLD_PX) {
    out.push({
      selector,
      property: "font-size",
      value: `${Math.round(refSize)}px`,
      source: "typography:font-size",
      numeric: { base: Math.round(refSize), unit: "px" },
    });
  }

  const refWeight = median(m.textBlocks.map((t) => t.fontWeight).filter((w): w is number => w != null && w > 0));
  const myWeight = styles.fontWeight ? Number(styles.fontWeight) : null;
  if (refWeight != null && myWeight != null && Math.abs(refWeight - myWeight) >= 100) {
    const ordered = [...WEIGHT_BUCKETS].sort(
      (a, b) => Math.abs(a - refWeight) - Math.abs(b - refWeight) || a - b,
    );
    for (const w of ordered) {
      if (w === myWeight) continue;
      out.push({
        selector,
        property: "font-weight",
        value: String(w),
        source: "typography:font-weight",
      });
    }
  }

  return out;
}

function effectsCandidates(m: MatchedElement): Candidate[] {
  const out: Candidate[] = [];
  const region = m.region;
  if (!region) return out;
  const { selector, styles } = withElement(m);

  if (region.borderRadius != null) {
    const mine = parsePx(styles.borderRadius);
    if (mine != null && Math.abs(mine - region.borderRadius) > RADIUS_THRESHOLD_PX) {
      out.push({
        selector,
        property: "border-radius",
        value: `${region.borderRadius}px`,
        source: "effects:border-radius",
        numeric: { base: region.borderRadius, unit: "px" },
      });
    }
  }

  return out;
}

/** Bare-tag selectors that are safe to group without a class. */
const GROUPABLE_BARE_TAGS = new Set(["td", "th", "tr", "li", "dt", "dd"]);
const SAFE_CLASS = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
const GROUP_NUMERIC_SPREAD_PX = 4;

/** Shared-rule selector for an element (e.g. "span.avatar", "td"), or null. */
export function groupSelectorOf(el: { tag: string; classes: string[] }): string | null {
  const classes = el.classes.filter((c) => SAFE_CLASS.test(c));
  if (classes.length !== el.classes.length) return null; // unsafe class name present
  if (classes.length) return `${el.tag}.${classes.join(".")}`;
  return GROUPABLE_BARE_TAGS.has(el.tag) ? el.tag : null;
}

/**
 * Merge per-element candidates that agree across same-class elements into one
 * shared-rule candidate (e.g. 5 td cells each proposing ~14px padding-top →
 * `td { padding-top: 14px }`). One root-cause rule beats N nth-of-type patches:
 * fewer trials, and a patch the agent can fold into its stylesheet directly.
 */
export function groupCandidates(
  items: Array<{ element: { tag: string; classes: string[] }; candidate: Candidate }>,
): Candidate[] {
  const buckets = new Map<string, { selector: string; property: string; source: string; values: string[]; numerics: number[]; unit: string | null }>();
  for (const { element, candidate } of items) {
    const groupSelector = groupSelectorOf(element);
    if (!groupSelector) continue;
    const key = `${groupSelector}|${candidate.property}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { selector: groupSelector, property: candidate.property, source: candidate.source, values: [], numerics: [], unit: null };
      buckets.set(key, bucket);
    }
    bucket.values.push(candidate.value);
    if (candidate.numeric) {
      bucket.numerics.push(candidate.numeric.base);
      bucket.unit = candidate.numeric.unit;
    }
  }

  const out: Candidate[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.values.length < 2) continue;
    if (bucket.numerics.length === bucket.values.length && bucket.unit) {
      const sorted = [...bucket.numerics].sort((a, b) => a - b);
      if (sorted[sorted.length - 1]! - sorted[0]! > GROUP_NUMERIC_SPREAD_PX) continue;
      const med = median(bucket.numerics)!;
      out.push({
        selector: bucket.selector,
        property: bucket.property,
        value: `${med}${bucket.unit}`,
        source: `${bucket.source}:grouped`,
        numeric: { base: med, unit: bucket.unit },
      });
    } else {
      const first = bucket.values[0]!;
      if (!bucket.values.every((v) => v === first)) continue;
      out.push({
        selector: bucket.selector,
        property: bucket.property,
        value: first,
        source: `${bucket.source}:grouped`,
      });
    }
  }
  return out;
}

/**
 * Geometry candidates for a container that matched no reference region, derived
 * from its matched children. When children are uniformly offset from their
 * regions the cause is usually the container's padding, and when adjacent
 * children's reference gaps disagree with the computed flex/grid gap the cause
 * is the gap — one container fix instead of N per-child margin nudges (which
 * coordinate descent often cannot accept one at a time without breaking
 * siblings' already-correct positions).
 */
export function containerCandidates(
  container: MatchedElement,
  allMatched: MatchedElement[],
): Candidate[] {
  const out: Candidate[] = [];
  const c = container.element;

  const children = allMatched.filter((m) => {
    if (m === container || !m.region) return false;
    if (m.element.depth <= c.depth) return false;
    return overlapRatio(c.bounds, m.element.bounds) >= 0.9;
  });
  if (!children.length) return out;

  const dxs = children.map((m) => m.region!.bounds.x - m.element.bounds.x);
  const dys = children.map((m) => m.region!.bounds.y - m.element.bounds.y);

  const medianDy = median(dys);
  if (medianDy != null && Math.abs(medianDy) > GEOMETRY_THRESHOLD_PX) {
    const pt = parsePx(c.styles.paddingTop);
    if (pt != null && pt + medianDy >= 0) {
      out.push({
        selector: c.selector,
        property: "padding-top",
        value: `${pt + medianDy}px`,
        source: "geometry:container-padding-top",
        numeric: { base: pt + medianDy, unit: "px" },
      });
    }
  }

  const medianDx = median(dxs);
  if (medianDx != null && Math.abs(medianDx) > GEOMETRY_THRESHOLD_PX) {
    const pl = parsePx(c.styles.paddingLeft);
    if (pl != null && pl + medianDx >= 0) {
      out.push({
        selector: c.selector,
        property: "padding-left",
        value: `${pl + medianDx}px`,
        source: "geometry:container-padding-left",
        numeric: { base: pl + medianDx, unit: "px" },
      });
    }
  }

  if (/^(flex|grid|inline-flex|inline-grid)$/.test(c.styles.display ?? "")) {
    const refGap = medianAdjacentGap(children);
    const current = parsePx(c.styles.gap) ?? parsePx(c.styles.columnGap) ?? parsePx(c.styles.rowGap);
    if (refGap != null && refGap >= 0 && current != null && Math.abs(refGap - current) > GEOMETRY_THRESHOLD_PX) {
      out.push({
        selector: c.selector,
        property: "gap",
        value: `${refGap}px`,
        source: "geometry:container-gap",
        numeric: { base: refGap, unit: "px" },
      });
    }
  }

  return out;
}

/** Median gap between adjacent children's REFERENCE regions, x-axis then y-axis. */
function medianAdjacentGap(children: MatchedElement[]): number | null {
  const gaps: number[] = [];
  const byX = [...children].sort((a, b) => a.region!.bounds.x - b.region!.bounds.x);
  for (let i = 0; i + 1 < byX.length; i++) {
    const a = byX[i]!.region!.bounds;
    const b = byX[i + 1]!.region!.bounds;
    const yOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    const gap = b.x - (a.x + a.width);
    if (yOverlap > Math.min(a.height, b.height) / 2 && gap >= 0) gaps.push(gap);
  }
  if (!gaps.length) {
    const byY = [...children].sort((a, b) => a.region!.bounds.y - b.region!.bounds.y);
    for (let i = 0; i + 1 < byY.length; i++) {
      const a = byY[i]!.region!.bounds;
      const b = byY[i + 1]!.region!.bounds;
      const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const gap = b.y - (a.y + a.height);
      if (xOverlap > Math.min(a.width, b.width) / 2 && gap >= 0) gaps.push(gap);
    }
  }
  return median(gaps);
}

function overlapRatio(outer: Bounds, inner: Bounds): number {
  const x1 = Math.max(outer.x, inner.x);
  const y1 = Math.max(outer.y, inner.y);
  const x2 = Math.min(outer.x + outer.width, inner.x + inner.width);
  const y2 = Math.min(outer.y + outer.height, inner.y + inner.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area = inner.width * inner.height;
  return area > 0 ? inter / area : 0;
}

function withElement(m: MatchedElement) {
  return {
    selector: m.element.selector,
    bounds: m.element.bounds,
    styles: m.element.styles,
  };
}
