import { describe, it, expect } from "bun:test";
import { resolveFixTarget } from "./fix-target.js";

describe("resolveFixTarget", () => {
  it("does not fabricate a class selector from OCR anchor text in screenshot-only mode", () => {
    // Manually-built HTML / screenshot input: there is no real DOM, so the only
    // selector we *could* emit is a slug of OCR'd text — which never matches the
    // user's actual classes. We must refuse to invent one.
    const target = resolveFixTarget(
      {
        code: "SIZE_MISMATCH",
        anchorName: "main-content search accounts status reg 2",
        issueBounds: { x: 100, y: 200, width: 640, height: 288 },
      },
      /* isScaffoldGenerated */ false
    );

    expect(target.cssSelector).toBeUndefined();
    expect(target.confidenceCap).toBeLessThanOrEqual(0.5);
    // ...but it must still hand the agent a usable, real signal: where the element is.
    expect(target.region).toEqual({ x: 100, y: 200, width: 640, height: 288 });
    expect(target.descriptor).toContain("640x288");
  });

  it("preserves a real DOM selector when one is available", () => {
    const target = resolveFixTarget({ code: "COLOR_MISMATCH", cssSelector: ".stat-card" }, false);
    expect(target.cssSelector).toBe(".stat-card");
    expect(target.confidenceCap).toBe(1);
  });

  it("uses a real data-node attribute selector for tool-scaffolded output", () => {
    const target = resolveFixTarget(
      { code: "SIZE_MISMATCH", nodeId: "region-29", anchorName: "main-content item 24" },
      /* isScaffoldGenerated */ true
    );
    expect(target.cssSelector).toBe('[data-node="region-29"]');
    expect(target.confidenceCap).toBe(1);
  });
});
