// Deterministic structural UI-fidelity score. Replaces "raw pixel-mismatch" as
// the thing we actually care about: does the build reproduce the reference's
// CONTENT, LAYOUT, and COLOR the way a human reads fidelity — and does it avoid
// the failures pixel-diff is blind to (overlapping text, missing content)?
//
// Design follows Design2Code's human-validated recipe (arXiv 2403.03163): match
// blocks by text content (offset-robust), score matched pairs on position + color,
// weight recall of content heavily. Their human-preference regression put Position
// (0.76) and Block-recall (0.74) far above Color (0.35) and exact Text (~0), so the
// composite here leans on placement + content-recall, uses perceptual color
// (CIEDE2000), and ignores exact text similarity beyond presence.
//
// Two GATES encode the failures the user observed converge produce, which pixels
// can't see: overlapping text collapses the score, and missing content multiplies
// it down. A blurry overlap can never out-score a clean layout.

import type { Bounds } from "@one-shot-ui/core";
import { bboxIoU, normalizeText } from "./matching.js";
import { colorDelta } from "./color.js";

export interface FidelityText {
  text: string;
  bounds: Bounds;
  color?: string | null;
  /** Optional label for overlap reporting (selector/id). */
  label?: string;
}
export interface FidelityRegion {
  bounds: Bounds;
  fill?: string | null;
}
export interface FidelityInput {
  layout: FidelityRegion[];
  text: FidelityText[];
}

export interface TextOverlap {
  a: string;
  b: string;
  area: number;
}

export interface FidelityBreakdown {
  /** Fraction of reference text blocks present in the impl (count-based; the gate). */
  contentRecall: number;
  /** Area-weighted recall — big missing blocks hurt more (the score term). */
  contentRecallArea: number;
  /** Mean per-matched-pair center alignment, [0,1]. */
  positionScore: number;
  /** Mean per-matched-pair perceptual color agreement, [0,1] (1 when no color data). */
  colorScore: number;
  /** Mean fuzzy text similarity of matched blocks, [0,1] (diagnostic; low human weight). */
  textScore: number;
  /** Mean IoU of best-matched region pairs — structural placement, [0,1]. */
  layoutIoU: number;
  overlapCount: number;
  overlapArea: number;
  overlapRatio: number;
  matchedText: number;
  refText: number;
  gates: { contentComplete: boolean; noOverlap: boolean };
  /** Gated composite, [0,100]. Higher = closer to the reference as a human reads it. */
  score: number;
}

export interface FidelityOptions {
  canvasWidth: number;
  canvasHeight: number;
  /** Impl render dimensions, if different from the reference (positions are normalized per-side). */
  implCanvasWidth?: number;
  implCanvasHeight?: number;
  /** Below this recall the content gate trips (default 0.85). */
  recallGate?: number;
  /** overlapRatio at/above which the overlap penalty zeros the score (default 0.003). */
  overlapRatioGate?: number;
  /** ΔE00 at which colorScore reaches 0 (default 20). */
  colorDeltaMax?: number;
  /** Min fuzzy text similarity for an impl block to be a match candidate (default 0.3). */
  diceFloor?: number;
  /** Max fraction of score an overlap can remove — soft on noisy OCR boxes (default 0.5). */
  maxOverlapPenalty?: number;
  /** overlapRatio at which the overlap penalty reaches its max (default 0.02 = 2% of canvas). */
  overlapPenaltyFullRatio?: number;
  /** Ignore text-box intersections smaller than this many px² (default 40). */
  overlapMinArea?: number;
}

const center = (b: Bounds) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const area = (b: Bounds) => Math.max(0, b.width) * Math.max(0, b.height);

function intersectionArea(a: Bounds, b: Bounds): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

/** Does `outer` (roughly) contain `inner`? Legit nesting, not a collision. */
function contains(outer: Bounds, inner: Bounds, tol = 2): boolean {
  return (
    outer.x <= inner.x + tol &&
    outer.y <= inner.y + tol &&
    outer.x + outer.width >= inner.x + inner.width - tol &&
    outer.y + outer.height >= inner.y + inner.height - tol
  );
}

/**
 * Text boxes that visually collide — the "overlapping text" failure. Two boxes
 * overlap illegitimately when they intersect substantially and neither contains
 * the other (containment = intended nesting, e.g. a label inside its card).
 * Wildly different sizes are treated as container/child, not a text collision.
 * Works on any text-bearing items (extract text blocks OR live DOM elements).
 */
export function detectTextOverlaps(
  items: Array<{ text?: string | null; bounds: Bounds; label?: string; selector?: string; id?: string }>,
  minArea = 40,
): TextOverlap[] {
  const texts = items.filter((it) => (it.text ? normalizeText(it.text).length >= 1 : false));
  const out: TextOverlap[] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]!;
      const b = texts[j]!;
      const inter = intersectionArea(a.bounds, b.bounds);
      if (inter < minArea) continue;
      const areaA = area(a.bounds);
      const areaB = area(b.bounds);
      // Legit nesting = one box strictly, meaningfully larger AND containing the
      // other (a label inside its card). Mutual/near-equal containment is two
      // texts stacked at the same spot — a real collision, so it is NOT skipped.
      const nested =
        (contains(a.bounds, b.bounds) && areaA > areaB * 1.1) ||
        (contains(b.bounds, a.bounds) && areaB > areaA * 1.1);
      if (nested) continue;
      const small = Math.min(areaA, areaB);
      if (small <= 0) continue;
      if (Math.max(areaA, areaB) / small > 12) continue; // container-vs-child, not a text collision
      if (inter / small < 0.1) continue; // incidental sliver
      out.push({
        a: a.label ?? a.selector ?? a.id ?? String(i),
        b: b.label ?? b.selector ?? b.id ?? String(j),
        area: Math.round(inter),
      });
    }
  }
  return out;
}

/** Greedy mutual-best IoU matching between two region sets → mean IoU of matches. */
function meanRegionIoU(refRegions: FidelityRegion[], implRegions: FidelityRegion[]): number {
  if (!refRegions.length || !implRegions.length) return 0;
  const used = new Set<number>();
  const ious: number[] = [];
  for (const r of refRegions) {
    let bestIoU = 0;
    let bestIdx = -1;
    implRegions.forEach((im, idx) => {
      if (used.has(idx)) return;
      const iou = bboxIoU(r.bounds, im.bounds);
      if (iou > bestIoU) {
        bestIoU = iou;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0 && bestIoU > 0) {
      used.add(bestIdx);
      ious.push(bestIoU);
    }
  }
  return ious.length ? ious.reduce((a, b) => a + b, 0) / ious.length : 0;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, "");
  for (let i = 0; i < t.length - 1; i++) {
    const bg = t.slice(i, i + 2);
    m.set(bg, (m.get(bg) ?? 0) + 1);
  }
  return m;
}

/**
 * Sørensen–Dice similarity on character bigrams, [0,1]. Robust to the OCR noise
 * that makes two independent text extractions of the same pixels differ char-for-
 * char — which is why block matching is fuzzy, not exact (Design2Code does the same).
 */
export function diceSim(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const ba = bigrams(a);
  const bb = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [k, v] of ba) {
    total += v;
    if (bb.has(k)) overlap += Math.min(v, bb.get(k)!);
  }
  for (const [, v] of bb) total += v;
  return total > 0 ? (2 * overlap) / total : 0;
}

export interface TextAssignment {
  /** Index into the filtered reference text blocks (stable for a fixed reference). */
  refIndex: number;
  refBlock: FidelityText;
  implBlock: FidelityText;
  /** The matched impl block's label (its DOM selector, when available). */
  implLabel: string | null;
  dice: number;
}
export interface TextAssignmentResult {
  /** Reference text blocks after the ≥2-char filter — the recall denominator. */
  refTexts: FidelityText[];
  /** One-to-one matches, highest-confidence first. */
  assignments: TextAssignment[];
}

/**
 * Match reference text blocks to impl text blocks by CONTENT, not pixels
 * (Design2Code style, offset-robust). Text identity FILTERS candidates (fuzzy
 * Dice, so OCR noise is tolerated); among those, proximity PICKS the spatially-
 * closest — which disambiguates duplicate strings (repeated "Email …") to the
 * right block. A global best-first pass assigns the highest-scoring pairs first
 * (one-to-one), which is robust where a per-block greedy cascades.
 *
 * Shared by the fidelity score AND converge's content gate: a reference block
 * that has no assignment is content the build is not showing.
 */
export function assignTextBlocks(
  ref: FidelityInput,
  impl: FidelityInput,
  opts: FidelityOptions,
): TextAssignmentResult {
  const W = opts.canvasWidth;
  const H = opts.canvasHeight;
  const IW = opts.implCanvasWidth ?? W;
  const IH = opts.implCanvasHeight ?? H;
  const diceFloor = opts.diceFloor ?? 0.3;
  const refTexts = ref.text.filter((t) => normalizeText(t.text).length >= 2);
  const implNorm = impl.text
    .filter((t) => normalizeText(t.text).length >= 1)
    .map((t) => ({ norm: normalizeText(t.text), t }));

  const posProx = (refBlock: FidelityText, implBlock: FidelityText): number => {
    const rcx = W > 0 ? center(refBlock.bounds).x / W : 0;
    const rcy = H > 0 ? center(refBlock.bounds).y / H : 0;
    const icx = IW > 0 ? center(implBlock.bounds).x / IW : 0;
    const icy = IH > 0 ? center(implBlock.bounds).y / IH : 0;
    return 1 - clamp01(Math.max(Math.abs(rcx - icx), Math.abs(rcy - icy)));
  };
  const pairs: Array<{ ri: number; ii: number; score: number; dice: number }> = [];
  refTexts.forEach((rt, ri) => {
    const normed = normalizeText(rt.text);
    implNorm.forEach((x, ii) => {
      const d = diceSim(normed, x.norm);
      if (d < diceFloor) return;
      pairs.push({ ri, ii, score: 0.5 * d + 0.5 * posProx(rt, x.t), dice: d });
    });
  });
  pairs.sort((a, b) => b.score - a.score);
  const usedRef = new Set<number>();
  const usedImpl = new Set<number>();
  const assignments: TextAssignment[] = [];
  for (const p of pairs) {
    if (usedRef.has(p.ri) || usedImpl.has(p.ii)) continue;
    usedRef.add(p.ri);
    usedImpl.add(p.ii);
    const implBlock = implNorm[p.ii]!.t;
    assignments.push({
      refIndex: p.ri,
      refBlock: refTexts[p.ri]!,
      implBlock,
      implLabel: implBlock.label ?? null,
      dice: p.dice,
    });
  }
  return { refTexts, assignments };
}

export function computeFidelity(
  ref: FidelityInput,
  impl: FidelityInput,
  opts: FidelityOptions,
): FidelityBreakdown {
  const W = opts.canvasWidth;
  const H = opts.canvasHeight;
  // Impl may render at a different height (e.g. a taller page). Normalize each
  // side's positions to [0,1] in its OWN canvas before comparing — otherwise a
  // taller impl reads as "everything shifted down" (Design2Code normalizes too).
  const IW = opts.implCanvasWidth ?? W;
  const IH = opts.implCanvasHeight ?? H;
  const implArea = IW * IH;
  const recallGate = opts.recallGate ?? 0.85;
  const overlapRatioGate = opts.overlapRatioGate ?? 0.003;
  const colorDeltaMax = opts.colorDeltaMax ?? 20;

  const posProx = (refBlock: FidelityText, implBlock: FidelityText): number => {
    const rcx = W > 0 ? center(refBlock.bounds).x / W : 0;
    const rcy = H > 0 ? center(refBlock.bounds).y / H : 0;
    const icx = IW > 0 ? center(implBlock.bounds).x / IW : 0;
    const icy = IH > 0 ? center(implBlock.bounds).y / IH : 0;
    return 1 - clamp01(Math.max(Math.abs(rcx - icx), Math.abs(rcy - icy)));
  };

  const { refTexts, assignments } = assignTextBlocks(ref, impl, opts);
  const totalRefArea = refTexts.reduce((s, t) => s + area(t.bounds), 0);
  const presentArea = assignments.reduce((s, a) => s + area(a.refBlock.bounds), 0);
  const matchedPairs = assignments.map((a) => ({ rt: a.refBlock, it: a.implBlock, dice: a.dice }));
  const presentCount = assignments.length;
  const contentRecall = refTexts.length ? presentCount / refTexts.length : 1;
  const contentRecallArea = totalRefArea > 0 ? presentArea / totalRefArea : 1;
  const textScore = matchedPairs.length ? mean(matchedPairs.map((p) => p.dice)) : refTexts.length ? 0 : 1;

  // Position + color over matched pairs.
  const posScores: number[] = [];
  const colorScores: number[] = [];
  for (const { rt, it } of matchedPairs) {
    posScores.push(posProx(rt, it));
    const dE = colorDelta(rt.color, it.color);
    if (Number.isFinite(dE)) colorScores.push(1 - clamp01(dE / colorDeltaMax));
  }
  const layoutIoU = meanRegionIoU(ref.layout, impl.layout);
  const positionScore = matchedPairs.length ? mean(posScores) : layoutIoU;
  const colorScore = colorScores.length ? mean(colorScores) : 1;

  // Overlap (the gate that kills "overlapping text").
  const overlaps = detectTextOverlaps(
    impl.text.map((t, i) => ({ text: t.text, bounds: t.bounds, label: t.label ?? String(i) })),
    opts.overlapMinArea,
  );
  const overlapArea = overlaps.reduce((s, o) => s + o.area, 0);
  const overlapRatio = implArea > 0 ? overlapArea / implArea : 0;

  // Composite: recall multiplies (missing content dominates), matched-pair quality
  // is position + color weighted to human perception, overlap penalty zeros it out.
  const matchQuality = colorScores.length
    ? (0.76 * positionScore + 0.35 * colorScore) / 1.11
    : positionScore;
  // Soft overlap downweight (capped): OCR can produce spurious box intersections,
  // so a detected overlap discounts the score but never annihilates it here — the
  // HARD "never ship overlap" enforcement lives in converge's DOM-reliable gate.
  const maxOverlapPenalty = opts.maxOverlapPenalty ?? 0.5;
  const overlapPenaltyFullRatio = opts.overlapPenaltyFullRatio ?? 0.02;
  const overlapPenalty = clamp01(overlapRatio / overlapPenaltyFullRatio) * maxOverlapPenalty;
  const score = 100 * contentRecallArea * matchQuality * (1 - overlapPenalty);

  return {
    contentRecall,
    contentRecallArea,
    positionScore,
    colorScore,
    textScore,
    layoutIoU,
    overlapCount: overlaps.length,
    overlapArea: Math.round(overlapArea),
    overlapRatio,
    matchedText: matchedPairs.length,
    refText: refTexts.length,
    gates: {
      contentComplete: contentRecall >= recallGate,
      noOverlap: overlapRatio <= overlapRatioGate,
    },
    score: Math.max(0, Math.min(100, score)),
  };
}
