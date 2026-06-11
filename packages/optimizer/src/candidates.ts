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

export function candidatesFor(m: MatchedElement, family: Family): Candidate[] {
  switch (family) {
    case "geometry":
      return geometryCandidates(m);
    case "color":
      return colorCandidates(m);
    case "typography":
      return typographyCandidates(m);
    case "effects":
      return effectsCandidates(m);
  }
}

function geometryCandidates(m: MatchedElement): Candidate[] {
  const out: Candidate[] = [];
  const region = m.region;
  if (!region) return out;
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

function colorCandidates(m: MatchedElement): Candidate[] {
  const out: Candidate[] = [];
  const { selector, styles } = withElement(m);

  const refFill = m.region?.fill ?? null;
  if (refFill) {
    const mine = rgbToHex(styles.backgroundColor);
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

function withElement(m: MatchedElement) {
  return {
    selector: m.element.selector,
    bounds: m.element.bounds,
    styles: m.element.styles,
  };
}
