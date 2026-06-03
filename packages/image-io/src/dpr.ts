// Deterministic device-pixel-ratio (DPR) estimation for screenshots.
//
// Why: Mac screenshots are almost always 2x Retina. one-shot-ui historically reported
// all geometry in raw image pixels, so an agent reading "70px" for a heading on a 3420px
// wide 2x capture would build a 70px (or, guessing, much larger) heading when the real
// CSS size is ~35px. That single ambiguity threw off fonts, spacing and sizing together.
//
// DPR genuinely cannot be known with certainty from pixels alone, so this is a best-effort
// heuristic that reports an honest confidence. The authoritative path is an explicit --dpr
// from the agent (which usually knows it is a Retina screenshot); auto-detection only kicks
// in when we are confident, and otherwise we keep raw px and emit a hint rather than
// silently halving (a wrong halving would be worse than no normalization).

export interface DprSample {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  channels: number;
}

export interface DprEstimate {
  /** Best-guess device pixel ratio (1 or 2). */
  dpr: number;
  /** 0..1 confidence in the guess. */
  confidence: number;
  reason: string;
}

export interface ResolvedDpr {
  dpr: number;
  source: "explicit" | "auto" | "default";
  confidence: number;
  reason: string;
  /** Present when we kept raw px but the image might still be Retina. */
  scaleHint?: string;
}

/** Confidence at/above which an auto-detected 2x is applied without an explicit flag. */
const AUTO_APPLY_CONFIDENCE = 0.85;

/**
 * Estimate DPR from edge-run granularity. A 2x image has effectively no 1px-wide feature
 * runs (every CSS pixel maps to two device pixels), and its short runs skew even-length; a
 * 1x image is full of 1px detail. A large, even-dimensioned canvas is a weak extra nudge.
 */
export function estimateDpr(img: DprSample): DprEstimate {
  const { width, height, channels } = img;
  const data = img.data;

  const rowStep = Math.max(1, Math.floor(height / 200));
  let len1 = 0; // # of length-1 feature runs
  let ge2Even = 0;
  let ge2Odd = 0;

  for (let y = 0; y < height; y += rowStep) {
    let runVal = -1;
    let runLen = 0;
    let runStartX = 0;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * channels;
      const lum = 0.299 * (data[o] ?? 0) + 0.587 * (data[o + 1] ?? 0) + 0.114 * (data[o + 2] ?? 0);
      const bit = lum > 128 ? 1 : 0;
      if (bit === runVal) {
        runLen++;
      } else {
        tally(runVal, runLen, runStartX, width);
        runVal = bit;
        runLen = 1;
        runStartX = x;
      }
    }
    // Drop the final run: it touches the right edge (likely background), like the first.
  }

  function tally(val: number, length: number, startX: number, w: number): void {
    if (val < 0) return;
    if (startX === 0) return; // first run touches the left edge — usually background
    if (length < 1 || length > 40) return; // ignore long background spans
    if (length === 1) len1++;
    else if (length % 2 === 0) ge2Even++;
    else ge2Odd++;
  }

  const totalFeat = len1 + ge2Even + ge2Odd;
  const bigEven = width % 2 === 0 && height % 2 === 0 && Math.max(width, height) >= 1600;

  if (totalFeat < 50) {
    return {
      dpr: 1,
      confidence: 0.2,
      reason: "insufficient edge detail to estimate scale; assuming 1x",
    };
  }

  const share1 = len1 / totalFeat;
  const evenShareGE2 = ge2Even + ge2Odd > 0 ? ge2Even / (ge2Even + ge2Odd) : 0;

  // Strong 2x: essentially no 1px detail and even-skewed runs.
  if (share1 < 0.06 && evenShareGE2 > 0.6) {
    const conf = clamp01(0.65 + (evenShareGE2 - 0.6) * 0.8 + (bigEven ? 0.1 : 0));
    return {
      dpr: 2,
      confidence: conf,
      reason: `2x: ${(share1 * 100).toFixed(0)}% 1px runs, ${(evenShareGE2 * 100).toFixed(0)}% of wider runs even-length${bigEven ? ", large even canvas" : ""}`,
    };
  }

  // Clear 1x: plenty of single-pixel detail.
  if (share1 > 0.15) {
    const conf = clamp01(0.6 + (share1 - 0.15) * 1.2);
    return {
      dpr: 1,
      confidence: conf,
      reason: `1x: ${(share1 * 100).toFixed(0)}% of feature runs are a single pixel wide`,
    };
  }

  // Ambiguous granularity. Lean on the size nudge but stay low-confidence.
  return {
    dpr: bigEven ? 2 : 1,
    confidence: bigEven ? 0.5 : 0.35,
    reason: bigEven
      ? "ambiguous edge granularity; large even canvas weakly suggests 2x"
      : "ambiguous edge granularity; assuming 1x",
  };
}

/**
 * Resolve the DPR to actually apply, preferring an explicit value, then a confident
 * auto-detection, otherwise defaulting to 1 (raw px) with a hint when Retina is plausible.
 */
export function resolveDpr(explicit: number | undefined, estimate: DprEstimate): ResolvedDpr {
  if (explicit != null && explicit > 0) {
    return { dpr: explicit, source: "explicit", confidence: 1, reason: `explicit --dpr ${explicit}` };
  }
  if (estimate.dpr >= 2 && estimate.confidence >= AUTO_APPLY_CONFIDENCE) {
    return { dpr: estimate.dpr, source: "auto", confidence: estimate.confidence, reason: estimate.reason };
  }
  const resolved: ResolvedDpr = {
    dpr: 1,
    source: "default",
    confidence: estimate.confidence,
    reason: estimate.reason,
  };
  if (estimate.dpr >= 2) {
    resolved.scaleHint =
      "This may be a 2x Retina screenshot — measurements below are in IMAGE pixels. " +
      "If so, pass --dpr 2 (CLI) / dpr: 2 (MCP) to get CSS pixels, or divide values by 2.";
  }
  return resolved;
}

/** Convert a raw image-pixel measurement to CSS pixels for the given dpr (rounded). */
export function applyDpr(value: number, dpr: number): number {
  if (!dpr || dpr === 1) return value;
  return Math.round(value / dpr);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
