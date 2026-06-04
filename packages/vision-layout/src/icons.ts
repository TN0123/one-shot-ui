import { colorDistance, type ImageAsset } from "@one-shot-ui/image-io";
import { measureRulers } from "./rulers.js";

/**
 * Cheap, deterministic detection of *icon-sized* regions in a screenshot.
 *
 * It does NOT try to recognize which glyph an icon is — only to bucket small,
 * roughly-square, line-art regions so the tool can tell an agent "this is an icon,
 * use an icon library; don't hand-draw it." Hand-drawn CSS glyphs are the single
 * thing agents most reliably fail to pixel-match.
 *
 * All bounds are raw image px; the CLI applies DPR to convert to CSS px.
 */

export interface IconBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IconCandidate {
  bounds: IconBounds;
  /** Fraction of the bounding box covered by ink (line-art icons sit ~0.1–0.85). */
  fillRatio: number;
  confidence: number;
}

export interface DetectIconOptions {
  /** OCR/text boxes to exclude — letters are glyph-sized but are not icons. */
  textBounds?: IconBounds[];
  /** Smallest icon edge in raw px (default 10). */
  minSize?: number;
  /** Largest icon edge in raw px (default 44). */
  maxSize?: number;
  /** Background hex; defaults to the frame's dominant background. */
  background?: string;
  /** Color distance for the ink mask (default 40). */
  colorTolerance?: number;
}

type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { r: 255, g: 255, b: 255 };
  return { r: parseInt(m[1]!, 16), g: parseInt(m[2]!, 16), b: parseInt(m[3]!, 16) };
}

/** Fraction of `a`'s area covered by `b`. */
function overlapFraction(a: IconBounds, b: IconBounds): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const area = a.width * a.height;
  return area === 0 ? 0 : inter / area;
}

export function detectIconCandidates(image: ImageAsset, opts: DetectIconOptions = {}): IconCandidate[] {
  const { width, height, channels } = image;
  const minSize = opts.minSize ?? 10;
  const maxSize = opts.maxSize ?? 44;
  const tol = opts.colorTolerance ?? 40;
  const bg = opts.background ? hexToRgb(opts.background) : (() => {
    const hex = measureRulers(image).background;
    return hexToRgb(hex);
  })();

  // Binary ink mask (differs from background). Process at full resolution but
  // bail out of any component whose bbox grows past an icon's plausible size.
  const visited = new Uint8Array(width * height);
  const isInk = (idx: number): boolean => {
    const o = idx * channels;
    return colorDistance(image.data[o] ?? 0, image.data[o + 1] ?? 0, image.data[o + 2] ?? 0, bg.r, bg.g, bg.b) > tol;
  };
  const bailEdge = maxSize * 3; // a real icon never has a bbox edge this large

  const candidates: IconCandidate[] = [];
  const stack: number[] = [];
  for (let start = 0; start < width * height; start++) {
    if (visited[start] || !isInk(start)) continue;
    // Flood fill (8-connectivity) this component.
    let minX = width, minY = height, maxX = 0, maxY = 0, count = 0;
    let bailed = false;
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    while (stack.length) {
      const idx = stack.pop()!;
      const x = idx % width;
      const y = (idx - x) / width;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      count++;
      if (maxX - minX > bailEdge || maxY - minY > bailEdge) { bailed = true; }
      if (bailed) continue; // keep draining the stack (mark visited) but stop measuring
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (visited[nIdx] || !isInk(nIdx)) continue;
          visited[nIdx] = 1;
          stack.push(nIdx);
        }
      }
    }
    if (bailed) continue;

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (w < minSize || h < minSize || w > maxSize || h > maxSize) continue;
    const aspect = w / h;
    if (aspect < 0.5 || aspect > 2.0) continue;
    const fillRatio = count / (w * h);
    // Line-art icons are neither sparse noise nor solid blocks (swatches/buttons).
    if (fillRatio < 0.08 || fillRatio > 0.9) continue;

    const bounds: IconBounds = { x: minX, y: minY, width: w, height: h };
    // Exclude only when the region sits mostly *inside* a text box (a letter);
    // an icon beside its label barely overlaps the label's box and survives.
    if (opts.textBounds?.some(t => overlapFraction(bounds, t) > 0.5)) continue;

    // Confidence: squarer + mid fill-ratio reads more icon-like.
    const squareness = 1 - Math.abs(1 - aspect);
    const fillCenter = 1 - Math.abs(0.4 - fillRatio) / 0.5;
    const confidence = Math.max(0.5, Math.min(0.9, 0.5 + 0.25 * squareness + 0.15 * fillCenter));
    candidates.push({ bounds, fillRatio: Math.round(fillRatio * 100) / 100, confidence: Math.round(confidence * 100) / 100 });
  }

  return candidates;
}
