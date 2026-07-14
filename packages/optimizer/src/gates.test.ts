import { describe, it, expect } from "bun:test";
import {
  isBoxAffecting,
  isColorFix,
  containsBounds,
  overlapKey,
  freshOverlapCulprits,
  lostContentCulprits,
  type LostBlock,
} from "./gates.js";
import type { AcceptedFix } from "./types.js";

const fix = (selector: string, property: string, source: string): AcceptedFix => ({
  selector,
  property,
  value: "0px",
  source,
  gainPixels: 10,
});
const box = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });

describe("isBoxAffecting", () => {
  it("flags geometry and typography, spares color and everything else", () => {
    expect(isBoxAffecting("geometry:pixel-offset(2,4)")).toBe(true);
    expect(isBoxAffecting("typography")).toBe(true);
    expect(isBoxAffecting("color")).toBe(false);
    expect(isBoxAffecting("surface")).toBe(false);
  });
});

describe("overlapKey", () => {
  it("is order-independent", () => {
    expect(overlapKey("a", "b")).toBe(overlapKey("b", "a"));
  });
});

describe("freshOverlapCulprits", () => {
  const accepted = [
    fix("div.card > p", "margin", "geometry:offset"),
    fix("div.other", "color", "color"),
  ];

  it("reverts a box-affecting fix that caused a NEW overlap", () => {
    const overlaps = [{ a: "div.card > p", b: "div.card > span", area: 500 }];
    const culprits = freshOverlapCulprits(overlaps, new Set(), accepted);
    expect(culprits.map((f) => f.selector)).toEqual(["div.card > p"]);
  });

  it("ignores overlaps that already existed at baseline", () => {
    const overlaps = [{ a: "div.card > p", b: "div.card > span", area: 500 }];
    const baseline = new Set([overlapKey("div.card > p", "div.card > span")]);
    expect(freshOverlapCulprits(overlaps, baseline, accepted)).toEqual([]);
  });

  it("never reverts a non-box fix (color) even if its element overlaps", () => {
    const overlaps = [{ a: "div.other", b: "div.card > span", area: 500 }];
    expect(freshOverlapCulprits(overlaps, new Set(), accepted)).toEqual([]);
  });

  it("reverts a fix on an ANCESTOR of an overlapping element", () => {
    const acc = [fix("div.card", "padding", "geometry:container")];
    const overlaps = [{ a: "div.card > p", b: "div.card > span", area: 500 }];
    expect(freshOverlapCulprits(overlaps, new Set(), acc).map((f) => f.selector)).toEqual(["div.card"]);
  });
});

describe("isColorFix / containsBounds", () => {
  it("classifies color sources and geometric enclosure", () => {
    expect(isColorFix("color:text")).toBe(true);
    expect(isColorFix("geometry:offset")).toBe(false);
    expect(containsBounds(box(0, 0, 100, 100), box(10, 10, 20, 20))).toBe(true);
    expect(containsBounds(box(0, 0, 100, 100), box(90, 90, 40, 40))).toBe(false);
  });
});

describe("lostContentCulprits", () => {
  // The card sits at (0,0,300,200); its text leaf at (20,20,100,20) is enclosed by it.
  const leaf = { selector: "#t", bounds: box(20, 20, 100, 20) };
  const boundsOf = (sel: string): ReturnType<typeof box> | undefined =>
    ({ ".card": box(0, 0, 300, 200), "#t": box(20, 20, 100, 20) }[sel]);

  it("blames the COLOR fix on an enclosing element for an ILLEGIBLE block", () => {
    // The recolor was applied to the card; the text leaf inherited it and vanished.
    const lost: LostBlock[] = [{ ...leaf, reason: "illegible" }];
    const accepted = [fix(".card", "color", "color:text"), fix(".card", "width", "geometry:width")];
    expect(lostContentCulprits(lost, accepted, boundsOf).map((f) => f.property)).toEqual(["color"]);
  });

  it("blames the BOX fix on an enclosing element for a GONE block", () => {
    const lost: LostBlock[] = [{ ...leaf, reason: "gone" }];
    const accepted = [fix(".card", "height", "geometry:container"), fix(".card", "color", "color:text")];
    expect(lostContentCulprits(lost, accepted, boundsOf).map((f) => f.property)).toEqual(["height"]);
  });

  it("does not cross families: a color fix never repairs a GONE block", () => {
    const lost: LostBlock[] = [{ ...leaf, reason: "gone" }];
    expect(lostContentCulprits(lost, [fix(".card", "color", "color:text")], boundsOf)).toEqual([]);
  });

  it("does not cross families: a box fix never repairs an ILLEGIBLE block", () => {
    const lost: LostBlock[] = [{ ...leaf, reason: "illegible" }];
    expect(lostContentCulprits(lost, [fix(".card", "width", "geometry:width")], boundsOf)).toEqual([]);
  });

  it("blames a fix on the lost element itself", () => {
    const lost: LostBlock[] = [{ ...leaf, reason: "illegible" }];
    expect(lostContentCulprits(lost, [fix("#t", "color", "color:text")], boundsOf).map((f) => f.selector)).toEqual([
      "#t",
    ]);
  });

  it("does not blame a fix on a non-enclosing element", () => {
    const lost: LostBlock[] = [{ ...leaf, reason: "illegible" }];
    const boundsOf2 = (sel: string) => ({ ".sidebar": box(400, 0, 100, 200) }[sel]);
    expect(lostContentCulprits(lost, [fix(".sidebar", "color", "color:text")], boundsOf2)).toEqual([]);
  });

  it("does nothing when no content was lost", () => {
    expect(lostContentCulprits([], [fix(".card", "color", "color:text")], boundsOf)).toEqual([]);
  });
});
