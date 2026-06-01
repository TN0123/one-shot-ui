import { hexToRgb, colorDistance } from "@one-shot-ui/image-io";

function dist(a: string, b: string): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return colorDistance(x.r, x.g, x.b, y.r, y.g, y.b);
}

/**
 * True only for a genuine fill recolor: both fills present, meaningfully different, and NEITHER is
 * the page background. When one side equals the background, the region is content appearing or
 * disappearing (a move / add / remove) — not a recolor — which is the dominant source of false
 * positive colour issues when matching pairs elements imperfectly under reflow.
 */
export function isMeaningfulRecolor(
  refFill: string | null | undefined,
  implFill: string | null | undefined,
  backgroundHex: string | null | undefined,
  opts: { minDelta?: number; bgTolerance?: number } = {}
): boolean {
  if (!refFill || !implFill) return false;
  const minDelta = opts.minDelta ?? 24;
  const bgTolerance = opts.bgTolerance ?? 28;
  if (dist(refFill, implFill) < minDelta) return false;
  if (backgroundHex && (dist(refFill, backgroundHex) < bgTolerance || dist(implFill, backgroundHex) < bgTolerance)) {
    return false;
  }
  return true;
}
