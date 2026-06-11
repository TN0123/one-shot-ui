import type { Bounds } from "@one-shot-ui/core";

export interface OffsetResult {
  /** Shift the BUILD's content by (dx, dy) to best align with the reference. */
  dx: number;
  dy: number;
  /** Match-fraction improvement of the best offset over (0,0). */
  improvement: number;
}

const CHANNEL_SUM_TOLERANCE = 30;

/**
 * Direct translation search: slide the build's pixels within `bounds` over the
 * reference and return the (dx, dy) that maximizes pixel agreement. This is
 * the robust detector for the single most common agent-build failure — a whole
 * container offset by a uniform few px (the "ghosted heatmap") — and unlike
 * region matching it is exact to the pixel and immune to extract quantization.
 * Pure buffer computation: no browser trial needed to find the seed.
 */
export function bestOffset(
  ref: Uint8ClampedArray | Uint8Array,
  shot: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  bounds: Bounds,
  opts: { range: number; step: number; sampleStride?: number } = { range: 12, step: 2 },
): OffsetResult | null {
  const stride = opts.sampleStride ?? 2;
  const x0 = Math.max(opts.range, Math.floor(bounds.x));
  const y0 = Math.max(opts.range, Math.floor(bounds.y));
  const x1 = Math.min(width - opts.range, Math.ceil(bounds.x + bounds.width));
  const y1 = Math.min(height - opts.range, Math.ceil(bounds.y + bounds.height));
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;

  const matchFraction = (dx: number, dy: number): number => {
    let match = 0;
    let total = 0;
    for (let y = y0; y < y1; y += stride) {
      for (let x = x0; x < x1; x += stride) {
        const so = (y * width + x) * 4;
        const ro = ((y + dy) * width + (x + dx)) * 4;
        const diff =
          Math.abs(shot[so]! - ref[ro]!) +
          Math.abs(shot[so + 1]! - ref[ro + 1]!) +
          Math.abs(shot[so + 2]! - ref[ro + 2]!);
        if (diff < CHANNEL_SUM_TOLERANCE) match++;
        total++;
      }
    }
    return total ? match / total : 0;
  };

  const baseline = matchFraction(0, 0);
  let best: OffsetResult = { dx: 0, dy: 0, improvement: 0 };
  for (let dy = -opts.range; dy <= opts.range; dy += opts.step) {
    for (let dx = -opts.range; dx <= opts.range; dx += opts.step) {
      if (dx === 0 && dy === 0) continue;
      const improvement = matchFraction(dx, dy) - baseline;
      if (
        improvement > best.improvement ||
        (improvement === best.improvement && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))
      ) {
        best = { dx, dy, improvement };
      }
    }
  }
  // Refine at step 1 around the winner when the coarse step might have skipped px.
  if (opts.step > 1 && best.improvement > 0) {
    for (let dy = best.dy - opts.step + 1; dy <= best.dy + opts.step - 1; dy++) {
      for (let dx = best.dx - opts.step + 1; dx <= best.dx + opts.step - 1; dx++) {
        if (dx === best.dx && dy === best.dy) continue;
        if (Math.abs(dx) > opts.range || Math.abs(dy) > opts.range) continue;
        const improvement = matchFraction(dx, dy) - baseline;
        if (improvement > best.improvement) best = { dx, dy, improvement };
      }
    }
  }
  return best.improvement > 0 ? best : null;
}
