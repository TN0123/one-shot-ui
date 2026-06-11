import { describe, it, expect } from "bun:test";
import { bboxIoU, matchElements, findMissingStructure, normalizeText } from "./matching.js";
import type { ReferenceData } from "./matching.js";
import type { ElementInfo } from "./types.js";

function el(partial: Partial<ElementInfo> & { selector: string }): ElementInfo {
  return {
    tag: "div",
    classes: [],
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    area: 10000,
    depth: 1,
    text: null,
    styles: {},
    ...partial,
  };
}

const ref: ReferenceData = {
  layout: [
    { id: "region-1", bounds: { x: 0, y: 0, width: 100, height: 100 }, fill: "#112233", borderRadius: 8 },
    { id: "region-2", bounds: { x: 500, y: 500, width: 200, height: 50 }, fill: "#445566", borderRadius: null },
  ],
  text: [
    { text: "Hello World", bounds: { x: 10, y: 10, width: 60, height: 14 }, typography: { fontSize: 13, fontWeight: 600 }, color: "#ffffff" },
    { text: "Far away", bounds: { x: 900, y: 900, width: 50, height: 12 }, typography: { fontSize: 12, fontWeight: 400 }, color: null },
  ],
};

describe("bboxIoU", () => {
  it("is 1 for identical boxes and 0 for disjoint", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(bboxIoU(a, a)).toBe(1);
    expect(bboxIoU(a, { x: 100, y: 100, width: 10, height: 10 })).toBe(0);
  });
});

describe("normalizeText", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeText("  Hello\n  WORLD ")).toBe("hello world");
  });
});

describe("matchElements", () => {
  it("matches an element exactly overlapping a region", () => {
    const m = matchElements([el({ selector: ".a" })], ref);
    expect(m[0]!.region?.id).toBe("region-1");
    expect(m[0]!.iou).toBe(1);
  });

  it("returns null region below the IoU threshold", () => {
    const m = matchElements([el({ selector: ".b", bounds: { x: 80, y: 80, width: 100, height: 100 }, area: 10000 })], ref);
    expect(m[0]!.region).toBeNull();
  });

  it("attaches text blocks contained within the element (with tolerance)", () => {
    const m = matchElements([el({ selector: ".a" })], ref);
    expect(m[0]!.textBlocks.length).toBe(1);
    expect(m[0]!.textBlocks[0]!.text).toBe("Hello World");
    expect(m[0]!.textBlocks[0]!.fontSize).toBe(13);
    expect(m[0]!.textBlocks[0]!.color).toBe("#ffffff");
  });
});

describe("findMissingStructure", () => {
  it("reports regions no element covers", () => {
    const missing = findMissingStructure([el({ selector: ".a" })], ref);
    expect(missing.length).toBe(1);
    expect(missing[0]!.regionId).toBe("region-2");
  });

  it("reports nothing when all regions are covered", () => {
    const covered = [
      el({ selector: ".a" }),
      el({ selector: ".b", bounds: { x: 500, y: 500, width: 200, height: 50 }, area: 10000 }),
    ];
    expect(findMissingStructure(covered, ref).length).toBe(0);
  });

  it("ignores tiny regions", () => {
    const tinyRef: ReferenceData = {
      layout: [{ id: "tiny", bounds: { x: 0, y: 0, width: 10, height: 10 }, fill: null, borderRadius: null }],
      text: [],
    };
    expect(findMissingStructure([], tinyRef).length).toBe(0);
  });
});
