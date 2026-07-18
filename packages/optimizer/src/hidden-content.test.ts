import { describe, it, expect } from "bun:test";
import { hiddenContentBlocks } from "./hidden-content.js";
import { visibleLeafText } from "./text-elements.js";
import type { ElementInfo } from "./types.js";
import type { FidelityInput, FidelityOptions } from "./fidelity.js";

const OPTS: FidelityOptions = { canvasWidth: 400, canvasHeight: 300 };

function el(
  selector: string,
  text: string,
  bounds: ElementInfo["bounds"],
  hidden: "clip" | null = null,
): ElementInfo {
  return {
    selector,
    tag: "p",
    classes: [],
    bounds,
    area: bounds.width * bounds.height,
    depth: 2,
    text,
    styles: { color: "#000000" },
    hidden,
  };
}

const ref: FidelityInput = {
  layout: [],
  text: [
    { text: "Welcome to the dashboard", bounds: { x: 20, y: 20, width: 200, height: 20 } },
    { text: "Your recent activity summary", bounds: { x: 20, y: 60, width: 220, height: 20 } },
  ],
};

describe("hiddenContentBlocks", () => {
  it("reports a reference block whose only DOM match is clipped", () => {
    const elements = [
      el("p.a", "Welcome to the dashboard", { x: 20, y: 20, width: 200, height: 20 }),
      el("p.b", "Your recent activity summary", { x: 20, y: 60, width: 220, height: 20 }, "clip"),
    ];
    const hidden = hiddenContentBlocks(ref, elements, OPTS);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]!.mechanism).toBe("clip");
    expect(hidden[0]!.selector).toBe("p.b");
    expect(hidden[0]!.refText).toBe("Your recent activity summary");
  });

  it("reports every clipped reference block", () => {
    const elements = [
      el("p.a", "Welcome to the dashboard", { x: 20, y: 20, width: 200, height: 20 }, "clip"),
      el("p.b", "Your recent activity summary", { x: 20, y: 60, width: 220, height: 20 }, "clip"),
    ];
    const hidden = hiddenContentBlocks(ref, elements, OPTS);
    expect(hidden.map((h) => h.mechanism)).toEqual(["clip", "clip"]);
  });

  it("does not report content that is also shown by a visible element", () => {
    const elements = [
      // Same text rendered twice: once clipped, once visible → visibly present, not hidden.
      el("p.hidden", "Welcome to the dashboard", { x: 20, y: 20, width: 200, height: 20 }, "clip"),
      el("p.visible", "Welcome to the dashboard", { x: 20, y: 120, width: 200, height: 20 }),
      el("p.b", "Your recent activity summary", { x: 20, y: 60, width: 220, height: 20 }),
    ];
    expect(hiddenContentBlocks(ref, elements, OPTS)).toHaveLength(0);
  });

  it("returns nothing when no element is hidden", () => {
    const elements = [
      el("p.a", "Welcome to the dashboard", { x: 20, y: 20, width: 200, height: 20 }),
      el("p.b", "Your recent activity summary", { x: 20, y: 60, width: 220, height: 20 }),
    ];
    expect(hiddenContentBlocks(ref, elements, OPTS)).toEqual([]);
  });
});

describe("visibleLeafText", () => {
  it("drops hidden text elements, keeps visible leaves", () => {
    const elements = [
      el("p.a", "Welcome to the dashboard", { x: 20, y: 20, width: 200, height: 20 }),
      el("p.b", "Your recent activity summary", { x: 20, y: 60, width: 220, height: 20 }, "clip"),
    ];
    const visible = visibleLeafText(elements);
    expect(visible.map((e) => e.selector)).toEqual(["p.a"]);
  });
});
