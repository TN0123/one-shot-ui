import { describe, it, expect } from "bun:test";
import { resolveMatchReferenceViewport } from "./match-reference.js";

describe("resolveMatchReferenceViewport", () => {
  it("captures a Retina reference at CSS dimensions with a 2x device scale", () => {
    // The bug: a 3420x1896 Retina screenshot was captured at 3420x1896 @ 1x,
    // rendering everything at double size. It must be 1710x948 @ 2x.
    const v = resolveMatchReferenceViewport({ rawWidth: 3420, rawHeight: 1896, estimatedDpr: 2 });
    expect(v).toEqual({ width: 1710, height: 948, scale: 2, dpr: 2 });
  });

  it("leaves a 1x reference untouched", () => {
    const v = resolveMatchReferenceViewport({ rawWidth: 1280, rawHeight: 800, estimatedDpr: 1 });
    expect(v).toEqual({ width: 1280, height: 800, scale: 1, dpr: 1 });
  });

  it("honors an explicit reference DPR over the estimate", () => {
    const v = resolveMatchReferenceViewport({ rawWidth: 3000, rawHeight: 1500, estimatedDpr: 1, explicitDpr: 2 });
    expect(v).toEqual({ width: 1500, height: 750, scale: 2, dpr: 2 });
  });

  it("defaults to 1x when no dpr information is available", () => {
    const v = resolveMatchReferenceViewport({ rawWidth: 800, rawHeight: 600 });
    expect(v).toEqual({ width: 800, height: 600, scale: 1, dpr: 1 });
  });
});
