import { describe, it, expect } from "bun:test";
import { keepIssueByContribution } from "./issue-filter.js";

const totalArea = 1440 * 1024; // ~1.47M px

describe("keepIssueByContribution", () => {
  it("keeps a small COLOR_MISMATCH even though it's under the 1% area threshold", () => {
    // A recoloured 128x48 button is 0.42% of the image — color is actionable regardless of size.
    const cta = { code: "COLOR_MISMATCH", severity: "medium", message: "m", issueBounds: { x: 1264, y: 16, width: 128, height: 48 } } as any;
    expect(keepIssueByContribution(cta, totalArea)).toBe(true);
  });

  it("still drops a small POSITION_MISMATCH under the 1% threshold (filter intact)", () => {
    const pos = { code: "POSITION_MISMATCH", severity: "low", message: "m", issueBounds: { x: 0, y: 0, width: 128, height: 48 } } as any;
    expect(keepIssueByContribution(pos, totalArea)).toBe(false);
  });

  it("keeps a large POSITION_MISMATCH above the threshold", () => {
    const pos = { code: "POSITION_MISMATCH", severity: "high", message: "m", issueBounds: { x: 0, y: 0, width: 600, height: 400 } } as any;
    expect(keepIssueByContribution(pos, totalArea)).toBe(true);
  });

  it("keeps issues with no bounds", () => {
    const px = { code: "PIXEL_DIFFERENCE", severity: "high", message: "m" } as any;
    expect(keepIssueByContribution(px, totalArea)).toBe(true);
  });
});
