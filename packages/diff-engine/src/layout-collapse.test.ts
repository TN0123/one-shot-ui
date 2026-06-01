import { describe, it, expect } from "bun:test";
import { detectLayoutCollapse } from "./layout-collapse.js";

describe("detectLayoutCollapse", () => {
  it("flags a loud high-severity issue when no reference regions matched", () => {
    // The dark-dashboard / mobile failure mode: segmentation produced regions but
    // matching collapsed to zero. Today this is silent and phantom fixes still flow.
    const issue = detectLayoutCollapse({ referenceNodeCount: 8, matchedNodeCount: 0 });
    expect(issue).not.toBeNull();
    expect(issue!.code).toBe("LAYOUT_COLLAPSE");
    expect(issue!.severity).toBe("high");
    expect(issue!.message).toContain("0 of 8");
  });

  it("returns null when layout matching succeeded", () => {
    expect(detectLayoutCollapse({ referenceNodeCount: 8, matchedNodeCount: 5 })).toBeNull();
  });

  it("flags near-total collapse (<=1 match across many regions)", () => {
    const issue = detectLayoutCollapse({ referenceNodeCount: 9, matchedNodeCount: 1 });
    expect(issue).not.toBeNull();
    expect(issue!.code).toBe("LAYOUT_COLLAPSE");
  });

  it("does not flag images with little structure to match", () => {
    // 1 region, 0 matched is not a 'collapse' — there was nothing to match.
    expect(detectLayoutCollapse({ referenceNodeCount: 1, matchedNodeCount: 0 })).toBeNull();
  });
});
