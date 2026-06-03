// Deterministic monospace detection from a text region's column ink-activity.
//
// Monospace vs proportional is the single highest-impact font-family distinction (a
// code/terminal UI looks completely wrong in a proportional face) and, unlike serif vs
// sans-serif, it is reliably measurable from pixels: in a monospaced face every glyph
// starts on a uniform pitch, so the start-to-start distances have near-zero variation.

export interface MonospaceResult {
  monospace: boolean;
  confidence: number;
}

/** Coefficient of variation below this (over glyph pitch) is treated as monospaced. */
const MONO_COV_THRESHOLD = 0.15;
/** Need at least this many glyph runs to judge pitch uniformity. */
const MIN_GLYPHS = 4;

/**
 * @param activity per-column boolean: true where the column contains text ink.
 */
export function detectMonospace(activity: boolean[]): MonospaceResult {
  const starts: number[] = [];
  const n = activity.length;
  let i = 0;
  while (i < n) {
    if (activity[i]) {
      starts.push(i);
      while (i < n && activity[i]) i++;
    } else {
      i++;
    }
  }

  if (starts.length < MIN_GLYPHS) {
    return { monospace: false, confidence: 0.2 };
  }

  const pitches: number[] = [];
  for (let k = 1; k < starts.length; k++) pitches.push(starts[k]! - starts[k - 1]!);
  const mean = pitches.reduce((s, p) => s + p, 0) / pitches.length;
  if (mean <= 0) return { monospace: false, confidence: 0.2 };

  const variance = pitches.reduce((s, p) => s + (p - mean) ** 2, 0) / pitches.length;
  const cov = Math.sqrt(variance) / mean;

  if (cov < MONO_COV_THRESHOLD) {
    return { monospace: true, confidence: clamp01(0.6 + (MONO_COV_THRESHOLD - cov) * 2) };
  }
  return { monospace: false, confidence: clamp01(0.5 + Math.min(0.4, (cov - MONO_COV_THRESHOLD) * 2)) };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
