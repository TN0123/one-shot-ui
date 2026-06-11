import type { Bounds } from "@one-shot-ui/core";
import type { ElementInfo, MatchedElement, MissingStructure } from "./types.js";

export interface ReferenceData {
  layout: Array<{
    id: string;
    bounds: Bounds;
    fill?: string | null;
    borderRadius?: number | null;
  }>;
  text: Array<{
    text: string;
    bounds: Bounds;
    typography?: { fontSize?: number | null; fontWeight?: number | null } | null;
    color?: string | null;
  }>;
}

export function bboxIoU(a: Bounds, b: Bounds): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

const TEXT_TOLERANCE_PX = 6;

function containsWithTolerance(outer: Bounds, inner: Bounds, tol = TEXT_TOLERANCE_PX): boolean {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.width <= outer.x + outer.width + tol &&
    inner.y + inner.height <= outer.y + outer.height + tol
  );
}

export function matchElements(
  elements: ElementInfo[],
  ref: ReferenceData,
  minIoU = 0.25,
): MatchedElement[] {
  return elements.map((element) => {
    let bestIoU = 0;
    let best: ReferenceData["layout"][number] | null = null;
    for (const region of ref.layout) {
      const iou = bboxIoU(region.bounds, element.bounds);
      if (iou > bestIoU) {
        bestIoU = iou;
        best = region;
      }
    }
    const textBlocks = ref.text
      .filter((t) => containsWithTolerance(element.bounds, t.bounds))
      .map((t) => ({
        text: t.text,
        bounds: t.bounds,
        fontSize: t.typography?.fontSize ?? null,
        fontWeight: t.typography?.fontWeight ?? null,
        color: t.color ?? null,
      }));
    return {
      element,
      region:
        best && bestIoU >= minIoU
          ? {
              id: best.id,
              bounds: best.bounds,
              fill: best.fill ?? null,
              borderRadius: best.borderRadius ?? null,
            }
          : null,
      textBlocks,
      iou: bestIoU,
    };
  });
}

const MIN_MISSING_AREA_PX = 400;

export function findMissingStructure(
  elements: ElementInfo[],
  ref: ReferenceData,
  minIoU = 0.25,
): MissingStructure[] {
  const missing: MissingStructure[] = [];
  for (const region of ref.layout) {
    if (region.bounds.width * region.bounds.height < MIN_MISSING_AREA_PX) continue;
    const covered = elements.some((el) => bboxIoU(region.bounds, el.bounds) >= minIoU);
    if (!covered) {
      missing.push({
        regionId: region.id,
        bounds: region.bounds,
        note: `No implementation element overlaps this ${region.bounds.width}x${region.bounds.height}px region${region.fill ? ` (background ${region.fill})` : ""}. Build it, then re-run converge.`,
      });
    }
  }
  return missing;
}
