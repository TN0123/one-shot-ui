import type { RulerReport } from "@one-shot-ui/vision-layout";

/**
 * Two-image spacing delta from deterministic projection rulers.
 *
 * Instead of fuzzy per-node "offset by Npx" on auto-matched boxes, this diffs the
 * background-zone bands and content columns/gutters of the reference against the
 * implementation and reports axis-level deltas that convert directly into a CSS
 * edit (band height/padding, container margin, column-gap). All inputs are raw
 * image px; pass `dpr` to report CSS px in the messages and values.
 */

export type SpacingIssueCode = "BAND_HEIGHT_DELTA" | "EDGE_X_DELTA" | "GUTTER_DELTA";

export interface SpacingIssue {
  code: SpacingIssueCode;
  name: string;
  axis: "x" | "y";
  /** Signed CSS-px delta: implementation − reference. */
  delta: number;
  reference: { x?: number; y?: number; size: number };
  implementation: { x?: number; y?: number; size: number };
  suggestedFix: string;
  confidence: number;
}

export interface CompareRulersOptions {
  /** Device pixel ratio of BOTH rulers; reported values/messages are divided by it. */
  dpr?: number;
  /** Minimum CSS-px delta worth reporting (default 4). */
  threshold?: number;
}

export function compareRulers(reference: RulerReport, implementation: RulerReport, opts: CompareRulersOptions = {}): SpacingIssue[] {
  const dpr = opts.dpr ?? 1;
  const threshold = opts.threshold ?? 4;
  const px = (n: number) => Math.round(n / dpr);
  const issues: SpacingIssue[] = [];

  // --- Bands: background-zone heights (the top-bar height ruler). ---
  const bandPairs = pairByStart(reference.bands, implementation.bands);
  for (const { ref, impl, index } of bandPairs) {
    if (!impl) continue;
    const refSize = px(ref.size);
    const implSize = px(impl.size);
    const delta = implSize - refSize;
    if (Math.abs(delta) < threshold) continue;
    const refY = px(ref.start);
    const name = index === 0 && ref.start === 0 ? "top zone" : `band at y${refY} (${ref.background})`;
    issues.push({
      code: "BAND_HEIGHT_DELTA",
      name,
      axis: "y",
      delta,
      reference: { y: refY, size: refSize },
      implementation: { y: px(impl.start), size: implSize },
      suggestedFix: `${name} is ${Math.abs(delta)}px too ${delta > 0 ? "tall" : "short"} (${implSize} vs ${refSize}px). ${delta > 0 ? "Reduce" : "Increase"} its height/padding by ${Math.abs(delta)}px.`,
      confidence: 0.9
    });
  }

  // --- Columns: left-edge (x start) shifts. ---
  const colPairs = pairByStart(reference.columns, implementation.columns);
  for (const { ref, impl } of colPairs) {
    if (!impl) continue;
    const refStart = px(ref.start);
    const implStart = px(impl.start);
    const delta = implStart - refStart;
    if (Math.abs(delta) < threshold) continue;
    issues.push({
      code: "EDGE_X_DELTA",
      name: `column at x≈${refStart}`,
      axis: "x",
      delta,
      reference: { x: refStart, size: px(ref.size) },
      implementation: { x: implStart, size: px(impl.size) },
      suggestedFix: `Column at x≈${refStart} left edge is ${Math.abs(delta)}px too far ${delta > 0 ? "right" : "left"} (${implStart} vs ${refStart}px). ${delta > 0 ? "Reduce" : "Increase"} its left margin/padding by ${Math.abs(delta)}px.`,
      confidence: 0.8
    });
  }

  // --- Gutters: gap widths between columns. ---
  const gutterCount = Math.min(reference.gutters.length, implementation.gutters.length);
  for (let i = 0; i < gutterCount; i++) {
    const r = reference.gutters[i]!;
    const m = implementation.gutters[i]!;
    const refSize = px(r.size);
    const implSize = px(m.size);
    const delta = implSize - refSize;
    if (Math.abs(delta) < threshold) continue;
    issues.push({
      code: "GUTTER_DELTA",
      name: `gutter #${i + 1}`,
      axis: "x",
      delta,
      reference: { x: px(r.start), size: refSize },
      implementation: { x: px(m.start), size: implSize },
      suggestedFix: `Gutter #${i + 1} is ${Math.abs(delta)}px too ${delta > 0 ? "wide" : "narrow"} (${implSize} vs ${refSize}px). ${delta > 0 ? "Reduce" : "Increase"} the gap (column-gap/margin) by ${Math.abs(delta)}px.`,
      confidence: 0.75
    });
  }

  return issues;
}

interface Spanned { start: number; end: number; size: number }

/**
 * Pair reference spans to implementation spans. When counts match, pair by index
 * (rulers are ordered top-to-bottom / left-to-right). Otherwise greedily match each
 * reference span to the nearest-start unused implementation span.
 */
function pairByStart<R extends Spanned, I extends Spanned>(refs: R[], impls: I[]): Array<{ ref: R; impl: I | undefined; index: number }> {
  if (refs.length === impls.length) {
    return refs.map((ref, index) => ({ ref, impl: impls[index], index }));
  }
  const used = new Set<number>();
  return refs.map((ref, index) => {
    let best = -1;
    let bestDist = Infinity;
    for (let j = 0; j < impls.length; j++) {
      if (used.has(j)) continue;
      const d = Math.abs(impls[j]!.start - ref.start);
      if (d < bestDist) { bestDist = d; best = j; }
    }
    if (best >= 0) used.add(best);
    return { ref, impl: best >= 0 ? impls[best] : undefined, index };
  });
}
