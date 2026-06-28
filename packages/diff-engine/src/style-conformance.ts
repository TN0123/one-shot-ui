import type { StyleSystem, StyleSwatch } from "@one-shot-ui/core/style-system";

/**
 * Style-transfer's analog of `compareImages`: instead of pixel-diffing two screens,
 * it diffs two extracted design *systems* and reports where a new UI drifts from the
 * reference's design language. Deterministic; no pixel oracle needed (the new UI is
 * meant to differ in content/layout, only conform in style).
 *
 * Honesty is the whole point here. The reference is always a screenshot (we only have
 * a picture of it), which yields a SPARSE, NOISY view: it surfaces only dominant
 * colors, under-detects corner radii, and false-detects shadows on dark UIs. The new
 * UI, when DOM-measured, is EXACT and dense. Comparing sparse-vs-dense by exact value
 * membership cries wolf on a faithful build. So:
 *   - palette/spacing/typography compare DOMINANT CHARACTER (what both sides see
 *     reliably) and drive the pass/fail verdict (high confidence);
 *   - radius/elevation are reported as ADVISORIES (low confidence) when the reference
 *     is a screenshot, because a raster can't reliably ground them — they inform the
 *     agent without failing the build.
 */

export type StyleDimensionName = "palette" | "spacing" | "radius" | "typography" | "elevation";

export interface StyleDimension {
  name: StyleDimensionName;
  verdict: "match" | "drift";
  /** "high" dims drive the pass/fail verdict; "low" dims are advisory only. */
  confidence: "high" | "low";
  drifts: string[];
}

export interface StyleConformanceReport {
  dimensions: StyleDimension[];
  /** True when no HIGH-confidence dimension drifts. */
  conforms: boolean;
  /** Count of low-confidence (advisory) dimensions that drift. */
  advisories: number;
  summary: string;
}

const COLOR_MATCH_DISTANCE = 60; // rgb manhattan; an off-hue dominant accent is far above this
const CHROMATIC_SATURATION = 0.25; // clearly-colored (vs a tinted near-neutral surface)
const SIGNIFICANCE = 0.2; // keep colors with count >= 20% of the most-used color
const RATIO_TOLERANCE = 0.15;

export function compareStyleSystems(ref: StyleSystem, impl: StyleSystem): StyleConformanceReport {
  const refIsRaster = ref.source === "screenshot";
  const dimensions: StyleDimension[] = [
    checkPalette(ref, impl),
    checkSpacing(ref, impl),
    checkTypography(ref, impl),
    checkRadius(ref, impl, refIsRaster ? "low" : "high"),
    checkElevation(ref, impl, refIsRaster ? "low" : "high"),
  ];

  const highDrift = dimensions.filter((d) => d.confidence === "high" && d.verdict === "drift");
  const advisories = dimensions.filter((d) => d.confidence === "low" && d.verdict === "drift").length;
  const conforms = highDrift.length === 0;
  const advisoryNote = advisories ? ` (${advisories} advisor${advisories > 1 ? "ies" : "y"} on raster-unverifiable dimensions)` : "";
  const summary = conforms
    ? `Conforms to the reference design language${advisoryNote}.`
    : `Drift from the reference design language in ${highDrift.map((d) => d.name).join(", ")}${advisoryNote}.`;

  return { dimensions, conforms, advisories, summary };
}

function checkPalette(ref: StyleSystem, impl: StyleSystem): StyleDimension {
  const drifts: string[] = [];
  const refPalette = [...ref.colors.accents, ...ref.colors.neutrals];
  const implColors = significant([...impl.colors.accents, ...impl.colors.neutrals]);

  // Only judge clearly-chromatic dominant colors. Neutrals form a continuous ramp
  // (a new gray shade isn't "off-palette"); rare status/chart accents are filtered
  // out by significance so a faithful build isn't flagged for having badge colors.
  for (const c of implColors.filter((s) => s.hsl.s >= CHROMATIC_SATURATION)) {
    const nearest = nearestColor(c, refPalette);
    if (!nearest || nearest.dist > COLOR_MATCH_DISTANCE) {
      drifts.push(`dominant color ${c.hex} is not in the reference palette${nearest ? ` (nearest ${nearest.swatch.hex})` : ""}.`);
    }
  }
  return { name: "palette", verdict: drifts.length ? "drift" : "match", confidence: "high", drifts };
}

function checkSpacing(ref: StyleSystem, impl: StyleSystem): StyleDimension {
  const drifts: string[] = [];
  const rb = ref.spacing.baseUnit;
  const ib = impl.spacing.baseUnit;
  // Base compatibility is the one robust spacing signal across the screenshot/DOM
  // boundary. A 4px grid is a harmonic of an 8px grid (fine); a 5px rhythm is not.
  if (rb !== null && ib !== null && !gridCompatible(rb, ib)) {
    drifts.push(`build uses a ${ib}px spacing rhythm; the reference is on a ${rb}px grid (incompatible).`);
  }
  return { name: "spacing", verdict: drifts.length ? "drift" : "match", confidence: "high", drifts };
}

function checkTypography(ref: StyleSystem, impl: StyleSystem): StyleDimension {
  const drifts: string[] = [];
  if (ref.typography.ratio !== null && impl.typography.ratio !== null && Math.abs(ref.typography.ratio - impl.typography.ratio) > RATIO_TOLERANCE) {
    drifts.push(`type scale ratio is ${impl.typography.ratio}; the reference system is ${ref.typography.ratio}.`);
  }
  if (ref.typography.monospace !== impl.typography.monospace) {
    drifts.push(`reference body type is ${ref.typography.monospace ? "monospace" : "proportional"}; impl is ${impl.typography.monospace ? "monospace" : "proportional"}.`);
  }
  return { name: "typography", verdict: drifts.length ? "drift" : "match", confidence: "high", drifts };
}

function checkRadius(ref: StyleSystem, impl: StyleSystem, confidence: "high" | "low"): StyleDimension {
  const drifts: string[] = [];
  const refMax = maxValue(ref.radius.scale);
  const implMax = maxValue(impl.radius.scale);
  // Compare roundedness CHARACTER, not exact values (raster under-detects radii).
  if (refMax !== null && implMax !== null) {
    const gap = Math.abs(roundednessBucket(refMax) - roundednessBucket(implMax));
    if (gap >= 2) {
      drifts.push(`reference corners read as ${bucketLabel(refMax)} (~${refMax}px); the build is ${bucketLabel(implMax)} (~${implMax}px).`);
    }
  }
  return { name: "radius", verdict: drifts.length ? "drift" : "match", confidence, drifts };
}

function checkElevation(ref: StyleSystem, impl: StyleSystem, confidence: "high" | "low"): StyleDimension {
  const drifts: string[] = [];
  const refElevated = ref.elevation.tiers.length > 0;
  const implElevated = impl.elevation.tiers.length > 0;
  if (refElevated && !implElevated) {
    drifts.push("reference appears to use elevation (shadows); the build reads as flat.");
  } else if (!refElevated && implElevated) {
    drifts.push("build uses elevation (shadows); the reference reads as flat.");
  }
  return { name: "elevation", verdict: drifts.length ? "drift" : "match", confidence, drifts };
}

// --- helpers ---

/** Keep only the dominant colors — those used at least 20% as much as the top color. */
function significant(swatches: StyleSwatch[]): StyleSwatch[] {
  if (swatches.length === 0) return [];
  const max = Math.max(...swatches.map((s) => s.count));
  if (max <= 0) return swatches;
  return swatches.filter((s) => s.count >= max * SIGNIFICANCE);
}

function nearestColor(target: StyleSwatch, palette: StyleSwatch[]): { swatch: StyleSwatch; dist: number } | null {
  let best: { swatch: StyleSwatch; dist: number } | null = null;
  for (const p of palette) {
    const dist = Math.abs(target.rgb.r - p.rgb.r) + Math.abs(target.rgb.g - p.rgb.g) + Math.abs(target.rgb.b - p.rgb.b);
    if (!best || dist < best.dist) best = { swatch: p, dist };
  }
  return best;
}

/** Two grids are compatible when one is a whole-number multiple of the other (8 & 4 ok; 8 & 5 not). */
function gridCompatible(a: number, b: number): boolean {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return lo > 0 && hi % lo === 0;
}

function maxValue(scale: Array<{ value: number }>): number | null {
  return scale.length ? Math.max(...scale.map((s) => s.value)) : null;
}

function roundednessBucket(maxRadius: number): number {
  if (maxRadius <= 3) return 0; // sharp
  if (maxRadius <= 8) return 1; // sm
  if (maxRadius <= 16) return 2; // md
  return 3; // lg / pill
}

function bucketLabel(maxRadius: number): string {
  return ["sharp-cornered", "slightly rounded", "rounded", "very rounded/pill"][roundednessBucket(maxRadius)]!;
}
