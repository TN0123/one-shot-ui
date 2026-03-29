import { describe, expect, test } from "bun:test";
import { segmentMismatch } from "./segmented-mismatch.js";
import type { LayoutNode } from "@one-shot-ui/core";

function makeNode(id: string, x: number, y: number, w: number, h: number): LayoutNode {
  return {
    id,
    kind: "region",
    bounds: { x, y, width: w, height: h },
    fill: null,
    opacity: 1,
    borderRadius: 0,
    shadow: null,
    gradient: null
  } as LayoutNode;
}

describe("segmentMismatch", () => {
  test("zero mismatch for empty diff data", () => {
    const width = 10;
    const height = 10;
    // All-black diff (no mismatch pixels)
    const diffData = new Uint8Array(width * height * 4);
    const refData = new Uint8Array(width * height * 4);
    const nodes: LayoutNode[] = [makeNode("a", 0, 0, 10, 10)];

    const result = segmentMismatch(diffData, width, height, refData, width, 4, nodes);

    expect(result.total).toBe(0);
    expect(result.structural).toBe(0);
    expect(result.content).toBe(0);
    expect(result.structuralRatio).toBe(0);
    expect(result.contentRatio).toBe(0);
  });

  test("all-mismatch in high-variance region classified as content", () => {
    const width = 30;
    const height = 30;

    // Build reference data with high color variance inside the node
    // Use block-based pattern to ensure variance is captured even with step-2 sampling
    const refData = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        // Top half red, bottom half blue — large blocks avoid sampling alias
        if (y < height / 2) {
          refData[idx] = 255;     // R
          refData[idx + 1] = 0;   // G
          refData[idx + 2] = 0;   // B
        } else {
          refData[idx] = 0;       // R
          refData[idx + 1] = 0;   // G
          refData[idx + 2] = 255; // B
        }
        refData[idx + 3] = 255; // A
      }
    }

    // Build diff data: all pixels are mismatch (red [255,64,64])
    const diffData = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      diffData[i * 4] = 255;
      diffData[i * 4 + 1] = 64;
      diffData[i * 4 + 2] = 64;
      diffData[i * 4 + 3] = 255;
    }

    // Node covers the entire area (area = 900 > 400)
    const nodes: LayoutNode[] = [makeNode("big", 0, 0, 30, 30)];

    const result = segmentMismatch(diffData, width, height, refData, width, 4, nodes);

    expect(result.total).toBe(width * height);
    expect(result.content).toBe(width * height);
    expect(result.structural).toBe(0);
    expect(result.contentRegions.length).toBe(1);
    expect(result.contentRatio).toBeGreaterThan(0);
    expect(result.structuralRatio).toBe(0);
  });

  test("all-mismatch in low-variance (solid color) region classified as structural", () => {
    const width = 30;
    const height = 30;

    // Build reference data with solid color (zero variance)
    const refData = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      refData[i * 4] = 128;
      refData[i * 4 + 1] = 128;
      refData[i * 4 + 2] = 128;
      refData[i * 4 + 3] = 255;
    }

    // Build diff data: all pixels are mismatch (blue [64,160,255])
    const diffData = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      diffData[i * 4] = 64;
      diffData[i * 4 + 1] = 160;
      diffData[i * 4 + 2] = 255;
      diffData[i * 4 + 3] = 255;
    }

    // Node covers entire area but has low variance, so it should NOT be a content region
    const nodes: LayoutNode[] = [makeNode("solid", 0, 0, 30, 30)];

    const result = segmentMismatch(diffData, width, height, refData, width, 4, nodes);

    expect(result.total).toBe(width * height);
    expect(result.structural).toBe(width * height);
    expect(result.content).toBe(0);
    expect(result.contentRegions.length).toBe(0);
    expect(result.structuralRatio).toBeGreaterThan(0);
    expect(result.contentRatio).toBe(0);
  });
});
