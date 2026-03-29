import type { Bounds, LayoutNode } from "@one-shot-ui/core";

export interface SegmentedMismatch {
  total: number;
  structural: number;
  content: number;
  structuralRatio: number;
  contentRatio: number;
  contentRegions: Array<{ bounds: Bounds; area: number }>;
}

/**
 * Compute the average RGB variance within a node's bounds from the reference image data.
 */
function computeColorVariance(
  refData: { readonly [index: number]: number },
  refWidth: number,
  refChannels: number,
  bounds: Bounds,
  startX: number,
  startY: number
): number {
  const x0 = bounds.x - startX;
  const y0 = bounds.y - startY;
  const x1 = x0 + bounds.width;
  const y1 = y0 + bounds.height;

  // Sample pixels (skip every other for perf)
  let sumR = 0, sumG = 0, sumB = 0;
  let sumR2 = 0, sumG2 = 0, sumB2 = 0;
  let count = 0;

  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const idx = (y * refWidth + x) * refChannels;
      const r = refData[idx] ?? 0;
      const g = refData[idx + 1] ?? 0;
      const b = refData[idx + 2] ?? 0;
      sumR += r;
      sumG += g;
      sumB += b;
      sumR2 += r * r;
      sumG2 += g * g;
      sumB2 += b * b;
      count++;
    }
  }

  if (count === 0) return 0;

  const varR = sumR2 / count - (sumR / count) ** 2;
  const varG = sumG2 / count - (sumG / count) ** 2;
  const varB = sumB2 / count - (sumB / count) ** 2;

  return (varR + varG + varB) / 3;
}

/**
 * Segment mismatch pixels from a pixelmatch diff into structural vs content categories.
 *
 * Content regions are layout nodes with high internal color variance (variance > 2500, area > 400px).
 * Structural mismatches are those outside content regions.
 */
export function segmentMismatch(
  diffData: { readonly [index: number]: number },
  width: number,
  height: number,
  referenceData: { readonly [index: number]: number },
  refWidth: number,
  refChannels: number,
  layoutNodes: LayoutNode[],
  startX = 0,
  startY = 0
): SegmentedMismatch {
  const totalPixels = width * height;

  // Identify content regions: high-variance nodes with area > 400
  const contentRegions: Array<{ bounds: Bounds; area: number }> = [];

  for (const node of layoutNodes) {
    const area = node.bounds.width * node.bounds.height;
    if (area <= 400) continue;

    const variance = computeColorVariance(referenceData, refWidth, refChannels, node.bounds, startX, startY);
    if (variance > 2500) {
      contentRegions.push({ bounds: node.bounds, area });
    }
  }

  // Build content mask
  const contentMask = new Uint8Array(totalPixels);
  for (const region of contentRegions) {
    const rx0 = region.bounds.x - startX;
    const ry0 = region.bounds.y - startY;
    const rx1 = Math.min(width, rx0 + region.bounds.width);
    const ry1 = Math.min(height, ry0 + region.bounds.height);

    for (let y = Math.max(0, ry0); y < ry1; y++) {
      for (let x = Math.max(0, rx0); x < rx1; x++) {
        contentMask[y * width + x] = 1;
      }
    }
  }

  // Count mismatched pixels, splitting by content vs structural
  let total = 0;
  let structural = 0;
  let content = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = diffData[idx] ?? 0;
      const g = diffData[idx + 1] ?? 0;

      // Diff pixels: red [255,64,64] (r>200 && g<100) or blue [64,160,255] (r<100 && g>120)
      const isMismatch = (r > 200 && g < 100) || (r < 100 && g > 120);
      if (!isMismatch) continue;

      total++;
      if (contentMask[y * width + x]) {
        content++;
      } else {
        structural++;
      }
    }
  }

  return {
    total,
    structural,
    content,
    structuralRatio: totalPixels === 0 ? 0 : structural / totalPixels,
    contentRatio: totalPixels === 0 ? 0 : content / totalPixels,
    contentRegions
  };
}
