import type { ColorSwatch, DomElement, ExtractReport, LayoutNode, ShadowSpec, SpacingMeasurement, TextBlock } from "./index.js";

/**
 * Deterministic "design language" extracted from a screenshot — the measured
 * facts an agent needs to build a DIFFERENT UI in the same style. It deliberately
 * does NOT name semantic color roles, classify mood, or identify the exact font
 * family: those are judgments the calling agent (itself a vision model) makes.
 * The tool stays the agent's precise, hallucination-free eyes.
 */

export interface StyleSwatch {
  hex: string;
  rgb: { r: number; g: number; b: number };
  hsl: { h: number; s: number; l: number };
  count: number;
  /** Semantic role (primary/accent/surface/…) — left null for the agent to assign. */
  role: string | null;
}

export interface StyleSystem {
  colors: { neutrals: StyleSwatch[]; accents: StyleSwatch[] };
  spacing: { baseUnit: number | null; scale: number[]; confidence: number };
  typography: {
    sizes: number[];
    /** Median ratio between consecutive sizes (modular scale), or null. */
    ratio: number | null;
    weights: number[];
    monospace: boolean;
    /** Low-confidence guesses — font family from a raster is unreliable. */
    families: Array<{ family: string; confidence: number }>;
  };
  radius: { scale: Array<{ name: string; value: number }> };
  elevation: { tiers: Array<{ name: string; shadow: string }> };
  /** Where the measurements came from — affects how much to trust them. */
  source: "screenshot" | "dom";
}

export interface BuildStyleSystemOptions {
  source?: "screenshot" | "dom";
  /** Divide raw-image-px measurements by this to report CSS px (screenshot path). */
  dpr?: number;
}

/**
 * Saturation below this reads as a neutral (gray/white/black/near-tint, including
 * dark tinted surfaces like #1C1D26). Matches the conformance "chromatic" gate.
 */
const NEUTRAL_SATURATION = 0.25;
const SCALE_NAMES = ["sm", "md", "lg", "xl", "2xl", "3xl"];

export function buildStyleSystem(report: ExtractReport, opts: BuildStyleSystemOptions = {}): StyleSystem {
  const dpr = opts.dpr && opts.dpr > 0 ? opts.dpr : 1;
  return {
    colors: buildColors(report.colors),
    spacing: buildSpacing(report.spacing.map((s) => s.distance / dpr)),
    typography: buildTypography(report, dpr),
    radius: buildRadius(report, dpr),
    elevation: buildElevation(report, dpr),
    source: opts.source ?? "screenshot",
  };
}

/**
 * Build a StyleSystem from a live build's DOM (exact computed CSS). Used for the
 * NEW-UI side of a conformance check when the agent can serve its build — far more
 * accurate than re-screenshotting it. Maps computed styles into report fields, then
 * reuses `buildStyleSystem` so the output shape and logic are identical to the
 * screenshot path.
 */
export function aggregateComputedStyles(elements: DomElement[]): StyleSystem {
  return buildStyleSystem(domToReport(elements), { source: "dom" });
}

function domToReport(elements: DomElement[]): ExtractReport {
  const flat: DomElement[] = [];
  const walk = (els: DomElement[]) => {
    for (const e of els) {
      flat.push(e);
      if (e.children?.length) walk(e.children as DomElement[]);
    }
  };
  walk(elements);

  // Weight color contributions by element AREA (like the screenshot path's pixel
  // population), not per-element count — otherwise dozens of tiny glyphs (e.g. list
  // checkmarks) outweigh the page background and read as a dominant color.
  const colorCounts = new Map<string, { rgb: { r: number; g: number; b: number }; count: number }>();
  const bump = (raw: string | undefined, area: number) => {
    const c = raw ? parseCssColor(raw) : null;
    if (!c) return;
    const entry = colorCounts.get(c.hex) ?? { rgb: c.rgb, count: 0 };
    entry.count += area;
    colorCounts.set(c.hex, entry);
  };

  const layout: LayoutNode[] = [];
  const text: TextBlock[] = [];
  const spacing: SpacingMeasurement[] = [];
  const bounds = { x: 0, y: 0, width: 0, height: 0 };

  flat.forEach((e, i) => {
    const cs = e.computedStyle;
    const area = Math.max(1, (e.bounds?.width ?? 0) * (e.bounds?.height ?? 0));
    bump(cs["background-color"], area);
    bump(cs["color"], area);
    bump(cs["border-color"], area);

    const radius = parsePx(cs["border-radius"]);
    const shadow = parseShadow(cs["box-shadow"]);
    const fill = cs["background-color"] ? parseCssColor(cs["background-color"])?.hex ?? null : null;
    if (radius !== null || shadow) {
      layout.push({ id: `dom-${i}`, kind: "region", bounds, fill, borderRadius: radius, shadow: shadow ?? undefined, componentId: null, confidence: 1 });
    }

    const fontSize = parsePx(cs["font-size"]);
    if (fontSize !== null) {
      const family = firstFontFamily(cs["font-family"]);
      text.push({
        id: `dom-${i}`,
        text: "",
        confidence: 1,
        bounds,
        typography: {
          fontSize,
          fontWeight: parseFontWeight(cs["font-weight"]),
          lineHeight: parsePx(cs["line-height"]),
          letterSpacing: parsePx(cs["letter-spacing"]),
          monospace: /mono/i.test(cs["font-family"] ?? ""),
          fontFamilyCandidates: family ? [{ family, confidence: 0.6 }] : undefined,
          confidence: 1,
        },
      });
    }

    for (const prop of ["gap", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left"]) {
      const v = parsePx(cs[prop]);
      if (v !== null && v >= 2) spacing.push({ id: `dom-${i}-${prop}`, fromId: "a", toId: "b", axis: prop.includes("left") || prop.includes("right") || prop === "gap" ? "horizontal" : "vertical", distance: v, alignment: "start" });
    }
  });

  const totalArea = [...colorCounts.values()].reduce((s, v) => s + v.count, 0);
  const colors: ColorSwatch[] = [...colorCounts.entries()].map(([hex, v]) => ({ hex, rgb: v.rgb, population: Math.round(v.count), ratio: v.count / Math.max(1, totalArea) }));
  const background = colors.slice().sort((a, b) => b.population - a.population)[0]?.hex ?? "#FFFFFF";

  return {
    version: "dom",
    image: { path: "dom", width: 1, height: 1, channels: 4, trimmedBounds: null },
    colors,
    layout,
    text,
    spacing,
    components: [],
    diagnostics: { background, activePixelRatio: 1 },
  };
}

function buildColors(colors: ColorSwatch[]): StyleSystem["colors"] {
  // `colors` is expected to already include small high-chroma brand accents — the CLI
  // enriches a screenshot's dominant colors with `extractAccentColors` before calling
  // this, and the DOM path lists every computed color. Here we only split + order.
  const neutrals: StyleSwatch[] = [];
  const accents: StyleSwatch[] = [];
  const seen = new Set<string>();
  for (const c of colors) {
    const hex = c.hex.toUpperCase();
    if (seen.has(hex)) continue;
    seen.add(hex);
    const hsl = rgbToHsl(c.rgb.r, c.rgb.g, c.rgb.b);
    const sw: StyleSwatch = { hex, rgb: c.rgb, hsl, count: c.population, role: null };
    (hsl.s < NEUTRAL_SATURATION ? neutrals : accents).push(sw);
  }
  neutrals.sort((a, b) => a.hsl.l - b.hsl.l);
  accents.sort((a, b) => b.count * b.hsl.s - a.count * a.hsl.s);
  return { neutrals, accents };
}

function buildSpacing(distances: number[]): StyleSystem["spacing"] {
  const ds = distances.filter((d) => d >= 2);
  // The grid is defined by which distinct step sizes EXIST, not how often each is
  // used — detect on the deduped scale so incidental, repeated padding values don't
  // skew the base toward a small grid.
  const scale = [...new Set(ds.map((d) => quantize(d, 2)))].sort((a, b) => a - b);
  const { baseUnit, confidence } = detectBaseUnit(scale);
  return { baseUnit, scale, confidence };
}

/**
 * Detect the spacing grid via chance-corrected scoring. A ±1px tolerance (for raster
 * noise) lets a small base match ~3/b of random values by luck — so a naive hit-rate
 * spuriously favors 4/5 over 8 on dense, varied data. Subtracting that chance baseline
 * makes a genuine 5px rhythm read as 5, while a Tailwind 4-grid reads as 4 and an
 * 8-grid as 8. Below a clear margin we report no grid rather than guess.
 */
function detectBaseUnit(distances: number[]): { baseUnit: number | null; confidence: number } {
  if (distances.length === 0) return { baseUnit: null, confidence: 0 };
  let best: { base: number | null; adjusted: number; raw: number } = { base: null, adjusted: -Infinity, raw: 0 };
  for (const b of [4, 5, 6, 8, 10]) {
    const hits = distances.filter((d) => { const m = ((d % b) + b) % b; return m <= 1 || m >= b - 1; }).length;
    const raw = hits / distances.length;
    const adjusted = raw - Math.min(1, 3 / b); // 3 of b residues hit by chance under ±1
    if (adjusted > best.adjusted + 1e-9 || (Math.abs(adjusted - best.adjusted) <= 0.03 && b > (best.base ?? 0))) {
      best = { base: b, adjusted, raw };
    }
  }
  if (best.adjusted < 0.1) return { baseUnit: null, confidence: 0 };
  return { baseUnit: best.base, confidence: Number(best.raw.toFixed(2)) };
}

function buildTypography(report: ExtractReport, dpr: number): StyleSystem["typography"] {
  const sizes = [...new Set(
    report.text
      .map((t) => t.typography?.fontSize)
      .filter((s): s is number => typeof s === "number" && s > 0)
      .map((s) => quantize(s / dpr, 2)),
  )].sort((a, b) => a - b);

  let ratio: number | null = null;
  if (sizes.length >= 2) {
    const ratios = sizes.slice(1).map((s, i) => s / sizes[i]!).filter((r) => r > 0);
    ratio = ratios.length ? Number(median(ratios).toFixed(2)) : null;
  }

  const weights = [...new Set(
    report.text.map((t) => t.typography?.fontWeight).filter((w): w is number => typeof w === "number"),
  )].sort((a, b) => a - b);

  const withType = report.text.filter((t) => t.typography);
  const monoCount = withType.filter((t) => t.typography?.monospace).length;
  const monospace = withType.length > 0 && monoCount / withType.length > 0.5;

  return { sizes, ratio, weights, monospace, families: aggregateFamilies(report) };
}

function aggregateFamilies(report: ExtractReport): Array<{ family: string; confidence: number }> {
  const votes = new Map<string, { votes: number; maxConf: number }>();
  for (const t of report.text) {
    for (const cand of t.typography?.fontFamilyCandidates ?? []) {
      const v = votes.get(cand.family) ?? { votes: 0, maxConf: 0 };
      v.votes++;
      v.maxConf = Math.max(v.maxConf, cand.confidence);
      votes.set(cand.family, v);
    }
  }
  return [...votes.entries()]
    .sort((a, b) => b[1].votes - a[1].votes || b[1].maxConf - a[1].maxConf)
    .slice(0, 3)
    .map(([family, v]) => ({ family, confidence: Number(v.maxConf.toFixed(2)) }));
}

function buildRadius(report: ExtractReport, dpr: number): StyleSystem["radius"] {
  const values = [...new Set(
    report.layout
      .map((n) => n.borderRadius)
      .filter((r): r is number => typeof r === "number" && r > 0)
      .map((r) => r / dpr)
      // Don't quantize pill/full radii — keep the authored value.
      .map((r) => (r >= 500 ? r : quantize(r, 2))),
  )].sort((a, b) => a - b);

  let nameIdx = 0;
  const scale = values.map((value) => {
    if (value >= 500) return { name: "full", value };
    return { name: SCALE_NAMES[nameIdx++] ?? `r${nameIdx}`, value };
  });
  return { scale };
}

function buildElevation(report: ExtractReport, dpr: number): StyleSystem["elevation"] {
  const seen = new Map<string, { blur: number; shadow: string }>();
  for (const n of report.layout) {
    if (!n.shadow) continue;
    const x = Math.round(n.shadow.xOffset / dpr);
    const y = Math.round(n.shadow.yOffset / dpr);
    const blur = quantize(n.shadow.blurRadius / dpr, 2);
    const key = `${x}:${y}:${blur}`;
    if (!seen.has(key)) {
      seen.set(key, { blur, shadow: `${x}px ${y}px ${blur}px ${n.shadow.color}` });
    }
  }
  const tiers = [...seen.values()]
    .sort((a, b) => a.blur - b.blur)
    .map((t, i) => ({ name: SCALE_NAMES[i] ?? `e${i}`, shadow: t.shadow }));
  return { tiers };
}

// --- emitters: canonical StyleSystem -> a string an agent pastes ---

export type StyleEmitFormat = "json" | "shadcn" | "tailwind";

export function emitStyleSystem(sys: StyleSystem, format: StyleEmitFormat): string {
  if (format === "json") return JSON.stringify(sys, null, 2);
  if (format === "shadcn") return emitShadcn(sys);
  return emitTailwind(sys);
}

/** The single radius shadcn expects (`--radius`) — prefer the "md" tier. */
function baseRadius(sys: StyleSystem): number | null {
  const md = sys.radius.scale.find((r) => r.name === "md");
  return (md ?? sys.radius.scale[0])?.value ?? null;
}

function emitShadcn(sys: StyleSystem): string {
  const lines: string[] = [":root {"];
  lines.push("  /* Measured palette — assign these to shadcn roles in the TODO below. */");
  sys.colors.neutrals.forEach((c, i) => lines.push(`  --neutral-${i}: ${c.hex}; /* L=${c.hsl.l} */`));
  sys.colors.accents.forEach((c, i) => lines.push(`  --accent-${i}: ${c.hex};`));
  if (sys.radius.scale.length) {
    lines.push("");
    for (const r of sys.radius.scale) lines.push(`  --radius-${r.name}: ${r.value}px;`);
    const base = baseRadius(sys);
    if (base !== null) lines.push(`  --radius: ${base}px;`);
  }
  for (const t of sys.elevation.tiers) lines.push(`  --shadow-${t.name}: ${t.shadow};`);
  lines.push("");
  lines.push("  /* TODO (agent): map the measured colors above to shadcn role tokens, e.g.");
  lines.push("     --background: <lightest neutral>;  --foreground: <darkest neutral>;");
  lines.push("     --primary: <brand accent>;          --border / --muted: <mid neutral>; */");
  lines.push("}");
  return lines.join("\n");
}

function emitTailwind(sys: StyleSystem): string {
  const lines: string[] = ["@theme {"];
  sys.colors.neutrals.forEach((c, i) => lines.push(`  --color-neutral-${i}: ${c.hex};`));
  sys.colors.accents.forEach((c, i) => lines.push(`  --color-accent-${i}: ${c.hex};`));
  if (sys.spacing.baseUnit !== null) lines.push(`  --spacing: ${sys.spacing.baseUnit}px;`);
  sys.typography.sizes.forEach((s, i) => lines.push(`  --text-${i}: ${s}px;`));
  for (const r of sys.radius.scale) lines.push(`  --radius-${r.name}: ${r.value}px;`);
  for (const t of sys.elevation.tiers) lines.push(`  --shadow-${t.name}: ${t.shadow};`);
  lines.push("}");
  return lines.join("\n");
}

// --- small local color/math helpers (ponytail: ~30 lines beats a new dep) ---

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let s = 0, h = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      default: h = (rn - gn) / d + 4; break;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Number(s.toFixed(3)), l: Number(l.toFixed(3)) };
}

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}

// --- computed-CSS value parsers (for the DOM path) ---

function parseCssColor(v: string): { hex: string; rgb: { r: number; g: number; b: number } } | null {
  const m = /rgba?\(([^)]+)\)/i.exec(v);
  if (!m) return null;
  const parts = m[1]!.split(",").map((p) => parseFloat(p.trim()));
  const [r, g, b, a] = parts;
  if (r === undefined || g === undefined || b === undefined) return null;
  if (a !== undefined && a < 0.5) return null; // faint/transparent — a decorative tint, not a real surface color
  const hex = `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  return { hex, rgb: { r: Math.round(r), g: Math.round(g), b: Math.round(b) } };
}

function parsePx(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim());
  return m ? Math.round(Number(m[1])) : null;
}

function parseFontWeight(v: string | undefined): number | null {
  if (!v) return null;
  if (v === "normal") return 400;
  if (v === "bold") return 700;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function firstFontFamily(v: string | undefined): string | null {
  if (!v) return null;
  const first = v.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  return first || null;
}

function parseShadow(v: string | undefined): ShadowSpec | null {
  if (!v || v === "none") return null;
  const colorMatch = /rgba?\([^)]+\)/i.exec(v);
  const color = colorMatch ? colorMatch[0] : "rgba(0, 0, 0, 0.1)";
  const rest = v.replace(/rgba?\([^)]+\)/i, "").trim();
  const nums = rest.match(/-?\d+(?:\.\d+)?px/g)?.map((p) => Math.round(parseFloat(p))) ?? [];
  if (nums.length < 3) return null;
  const [xOffset, yOffset, blurRadius, spread] = nums;
  return { xOffset: xOffset!, yOffset: yOffset!, blurRadius: Math.max(0, blurRadius!), spread: spread ?? 0, color, confidence: 1 };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
