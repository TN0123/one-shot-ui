import { describe, it, expect } from "bun:test";

function checkNearPositionMatch(
  refNode: { bounds: { x: number; y: number; width: number; height: number }; fill: string | null },
  implNodes: Array<{ bounds: { x: number; y: number; width: number; height: number }; fill: string | null }>
): "missing" | "color-mismatch-at-position" {
  for (const impl of implNodes) {
    const dx = Math.abs(impl.bounds.x - refNode.bounds.x);
    const dy = Math.abs(impl.bounds.y - refNode.bounds.y);
    const dw = Math.abs(impl.bounds.width - refNode.bounds.width);
    const dh = Math.abs(impl.bounds.height - refNode.bounds.height);
    if (dx <= 20 && dy <= 20 && dw <= 20 && dh <= 20) {
      return "color-mismatch-at-position";
    }
  }
  return "missing";
}

describe("MISSING_NODE false positive detection", () => {
  it("reports color-mismatch-at-position when node exists with wrong color", () => {
    const ref = { bounds: { x: 100, y: 200, width: 300, height: 150 }, fill: "#FF0000" };
    const impls = [{ bounds: { x: 102, y: 198, width: 300, height: 150 }, fill: "#00FF00" }];
    expect(checkNearPositionMatch(ref, impls)).toBe("color-mismatch-at-position");
  });

  it("reports missing when no node is near the position", () => {
    const ref = { bounds: { x: 100, y: 200, width: 300, height: 150 }, fill: "#FF0000" };
    const impls = [{ bounds: { x: 500, y: 500, width: 300, height: 150 }, fill: "#FF0000" }];
    expect(checkNearPositionMatch(ref, impls)).toBe("missing");
  });

  it("reports color-mismatch-at-position when dimensions are close", () => {
    const ref = { bounds: { x: 100, y: 200, width: 300, height: 150 }, fill: "#FF0000" };
    const impls = [{ bounds: { x: 105, y: 205, width: 310, height: 145 }, fill: "#0000FF" }];
    expect(checkNearPositionMatch(ref, impls)).toBe("color-mismatch-at-position");
  });
});
