import { describe, it, expect } from "bun:test";
import { collapseReflowCascade } from "./reflow.js";

// A predominantly-vertical POSITION_MISMATCH (dx, dy from a (0,0) reference).
const pos = (dx: number, dy: number): any => ({
  code: "POSITION_MISMATCH", severity: "medium", message: "shift",
  reference: { x: 0, y: 0 }, implementation: { x: dx, y: dy },
});

describe("collapseReflowCascade", () => {
  it("collapses many vertical shifts into one note when content was removed", () => {
    const issues = [
      { code: "MISSING_NODE", severity: "medium", message: "an element is missing" },
      pos(0, 100), pos(0, 116), pos(0, 132), pos(0, 148),
    ] as any;

    const out = collapseReflowCascade(issues);

    expect(out.some((i: any) => i.code === "REFLOW_CASCADE")).toBe(true);
    expect(out.filter((i: any) => i.code === "POSITION_MISMATCH").length).toBe(0);
    // the real root cause is kept
    expect(out.some((i: any) => i.code === "MISSING_NODE")).toBe(true);
  });

  it("leaves issues untouched when nothing was removed/added", () => {
    const issues = [pos(0, 100), pos(0, 116), pos(0, 132)] as any;
    const out = collapseReflowCascade(issues);
    expect(out).toHaveLength(3);
    expect(out.some((i: any) => i.code === "REFLOW_CASCADE")).toBe(false);
  });

  it("does not collapse a small number of shifts (not a cascade)", () => {
    const issues = [{ code: "MISSING_NODE", severity: "medium", message: "m" }, pos(0, 100)] as any;
    expect(collapseReflowCascade(issues).some((i: any) => i.code === "REFLOW_CASCADE")).toBe(false);
  });

  it("does not collapse predominantly-horizontal shifts (not reflow)", () => {
    const issues = [
      { code: "MISSING_NODE", severity: "medium", message: "m" },
      pos(120, 4), pos(120, 4), pos(120, 4),
    ] as any;
    expect(collapseReflowCascade(issues).some((i: any) => i.code === "REFLOW_CASCADE")).toBe(false);
  });
});
