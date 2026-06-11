import type { Bounds } from "@one-shot-ui/core";

/**
 * Dominant color of a rectangular area of an RGBA buffer: mode over 4-bit
 * quantized colors (merging anti-aliased shades), refined to the exact average
 * of the winning bucket's pixels. Deterministic. Returns null for empty areas.
 *
 * This is converge's escape hatch from extract's quantized fills — the
 * reference pixels themselves carry the exact surface color under any element.
 */
export function dominantColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  channels: number,
  bounds: Bounds,
): string | null {
  const x0 = Math.max(0, Math.floor(bounds.x));
  const y0 = Math.max(0, Math.floor(bounds.y));
  const x1 = Math.min(width, Math.ceil(bounds.x + bounds.width));
  const y1 = Math.min(height, Math.ceil(bounds.y + bounds.height));
  if (x1 <= x0 || y1 <= y0) return null;

  const counts = new Map<number, number>();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const off = (y * width + x) * channels;
      const key = ((data[off]! >> 4) << 8) | ((data[off + 1]! >> 4) << 4) | (data[off + 2]! >> 4);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let bestKey = -1;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount || (count === bestCount && key < bestKey)) {
      bestKey = key;
      bestCount = count;
    }
  }
  if (bestKey < 0) return null;

  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const off = (y * width + x) * channels;
      const key = ((data[off]! >> 4) << 8) | ((data[off + 1]! >> 4) << 4) | (data[off + 2]! >> 4);
      if (key === bestKey) {
        r += data[off]!;
        g += data[off + 1]!;
        b += data[off + 2]!;
        n++;
      }
    }
  }
  const toHex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}
