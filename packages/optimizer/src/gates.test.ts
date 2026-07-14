import { describe, it, expect } from "bun:test";
import {
  isBoxAffecting,
  overlapKey,
  freshOverlapCulprits,
  missingContentCulprits,
} from "./gates.js";
import type { AcceptedFix } from "./types.js";

const fix = (selector: string, property: string, source: string): AcceptedFix => ({
  selector,
  property,
  value: "0px",
  source,
  gainPixels: 10,
});

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

describe("missingContentCulprits", () => {
  // Baseline: ref block 0 was held by "div.card > p", block 1 by "div.panel > h2".
  const baselineMatches = new Map<number, string>([
    [0, "div.card > p"],
    [1, "div.panel > h2"],
  ]);

  it("reverts the box-affecting fix on a text block that VANISHED", () => {
    const accepted = [
      fix("div.card", "height", "geometry:container"), // ancestor of the lost block's holder
      fix("div.panel > h2", "color", "color"),
    ];
    const present = new Set([1]); // block 0 lost
    expect(missingContentCulprits(baselineMatches, present, accepted).map((f) => f.selector)).toEqual([
      "div.card",
    ]);
  });

  it("does nothing when all baseline content is still present", () => {
    const accepted = [fix("div.card", "height", "geometry:container")];
    const present = new Set([0, 1]);
    expect(missingContentCulprits(baselineMatches, present, accepted)).toEqual([]);
  });

  it("does not blame a color fix for missing content", () => {
    const accepted = [fix("div.card > p", "color", "color")];
    const present = new Set([1]); // block 0 lost
    expect(missingContentCulprits(baselineMatches, present, accepted)).toEqual([]);
  });

  it("does not blame a box fix on an unrelated element", () => {
    const accepted = [fix("div.footer", "margin", "geometry:offset")];
    const present = new Set([1]); // block 0 lost, but no fix touches its subtree
    expect(missingContentCulprits(baselineMatches, present, accepted)).toEqual([]);
  });

  it("reverts a fix on the vanished element ITSELF (e.g. font-size collapse)", () => {
    const accepted = [fix("div.card > p", "font-size", "typography")];
    const present = new Set([1]);
    expect(missingContentCulprits(baselineMatches, present, accepted).map((f) => f.selector)).toEqual([
      "div.card > p",
    ]);
  });
});
