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

/**
 * A text block belongs to an element when most of its area overlaps it. Strict
 * containment breaks whenever the element is still offset by a few px — exactly
 * the state converge starts from — which would starve typography candidates.
 */
const TEXT_OVERLAP_RATIO = 0.5;

function overlapsEnough(outer: Bounds, inner: Bounds, ratio = TEXT_OVERLAP_RATIO): boolean {
  const x1 = Math.max(outer.x, inner.x);
  const y1 = Math.max(outer.y, inner.y);
  const x2 = Math.min(outer.x + outer.width, inner.x + inner.width);
  const y2 = Math.min(outer.y + outer.height, inner.y + inner.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const innerArea = inner.width * inner.height;
  return innerArea > 0 && inter / innerArea >= ratio;
}

export function matchElements(
  elements: ElementInfo[],
  ref: ReferenceData,
  minIoU = 0.25,
): MatchedElement[] {
  // One-to-one (mutual-best) assignment: an element gets a region only when it
  // is also that region's best element. Without this, a row/section container
  // overlapping a child-sized region (IoU just over threshold) is handed that
  // region's geometry, and the greedy loop accepts pathological "fixes"
  // (e.g. width: 268px on a 836px-wide flex row) that strand the search.
  const bestElementForRegion = new Map<string, { selector: string; iou: number }>();
  for (const region of ref.layout) {
    let best: { selector: string; iou: number } | null = null;
    for (const element of elements) {
      const iou = bboxIoU(region.bounds, element.bounds);
      if (!best || iou > best.iou) best = { selector: element.selector, iou };
    }
    if (best && best.iou > 0) bestElementForRegion.set(region.id, best);
  }

  return elements.map((element) => {
    let bestIoU = 0;
    let best: ReferenceData["layout"][number] | null = null;
    for (const region of ref.layout) {
      const iou = bboxIoU(region.bounds, element.bounds);
      if (iou > bestIoU && bestElementForRegion.get(region.id)?.selector === element.selector) {
        bestIoU = iou;
        best = region;
      }
    }
    const textBlocks = ref.text
      .filter((t) => overlapsEnough(element.bounds, t.bounds))
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
