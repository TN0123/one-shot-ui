import { describe, it, expect } from "bun:test";
import { candidatesFor, containerCandidates, groupCandidates, refinementValues, rgbToHex } from "./candidates.js";
import type { MatchedElement } from "./types.js";

function matched(overrides: {
  styles?: Record<string, string>;
  bounds?: { x: number; y: number; width: number; height: number };
  region?: { id: string; bounds: { x: number; y: number; width: number; height: number }; fill: string | null; borderRadius: number | null } | null;
  textBlocks?: MatchedElement["textBlocks"];
}): MatchedElement {
  return {
    element: {
      selector: ".target",
      tag: "div",
      classes: ["target"],
      bounds: overrides.bounds ?? { x: 0, y: 0, width: 100, height: 50 },
      area: 5000,
      depth: 2,
      text: "Sample",
      styles: {
        width: "100px",
        height: "50px",
        backgroundColor: "rgb(17, 34, 51)",
        color: "rgb(255, 255, 255)",
        fontSize: "14px",
        fontWeight: "400",
        borderRadius: "4px",
        marginLeft: "0px",
        marginTop: "0px",
        ...overrides.styles,
      },
    },
    region:
      overrides.region === undefined
        ? { id: "r1", bounds: { x: 0, y: 0, width: 100, height: 50 }, fill: "#112233", borderRadius: 4 }
        : overrides.region,
    textBlocks: overrides.textBlocks ?? [],
    iou: 0.9,
  };
}

describe("rgbToHex", () => {
  it("converts rgb() to uppercase hex", () => {
    expect(rgbToHex("rgb(17, 34, 51)")).toBe("#112233");
  });
  it("returns null for transparent", () => {
    expect(rgbToHex("rgba(0, 0, 0, 0)")).toBeNull();
  });
});

describe("refinementValues", () => {
  it("produces ±1, ±2, ±4 around the base", () => {
    expect(refinementValues(20, "px")).toEqual(["21px", "19px", "22px", "18px", "24px", "16px"]);
  });
});

describe("candidatesFor — geometry", () => {
  it("emits width/height targets when the region differs by >2px", () => {
    const m = matched({ region: { id: "r1", bounds: { x: 0, y: 0, width: 120, height: 50 }, fill: null, borderRadius: null } });
    const c = candidatesFor(m, "geometry");
    const width = c.find((x) => x.property === "width");
    expect(width?.value).toBe("120px");
    expect(width?.numeric).toEqual({ base: 120, unit: "px" });
    expect(c.find((x) => x.property === "height")).toBeUndefined();
  });

  it("emits a margin-left adjustment for a horizontal offset", () => {
    const m = matched({ region: { id: "r1", bounds: { x: 12, y: 0, width: 100, height: 50 }, fill: null, borderRadius: null } });
    const c = candidatesFor(m, "geometry");
    const ml = c.find((x) => x.property === "margin-left");
    expect(ml?.value).toBe("12px");
  });

  it("emits nothing when geometry matches", () => {
    expect(candidatesFor(matched({ region: { id: "r1", bounds: { x: 0, y: 0, width: 100, height: 50 }, fill: null, borderRadius: null } }), "geometry")).toEqual([]);
  });
});

describe("candidatesFor — color", () => {
  it("targets the region fill when background differs", () => {
    const m = matched({ region: { id: "r1", bounds: { x: 0, y: 0, width: 100, height: 50 }, fill: "#22232E", borderRadius: null } });
    const c = candidatesFor(m, "color");
    expect(c.find((x) => x.property === "background-color")?.value).toBe("#22232E");
  });

  it("emits nothing when the background already matches (case-insensitive)", () => {
    const m = matched({ region: { id: "r1", bounds: { x: 0, y: 0, width: 100, height: 50 }, fill: "#112233", borderRadius: null } });
    expect(candidatesFor(m, "color")).toEqual([]);
  });

  it("targets dominant text color when it differs", () => {
    const m = matched({
      textBlocks: [
        { text: "Sample", bounds: { x: 0, y: 0, width: 50, height: 14 }, fontSize: 14, fontWeight: 400, color: "#A1A1AA" },
      ],
      region: null,
    });
    const c = candidatesFor(m, "color");
    expect(c.find((x) => x.property === "color")?.value).toBe("#A1A1AA");
  });
});

describe("candidatesFor — typography", () => {
  it("targets the median text font size when it differs by >1px", () => {
    const m = matched({
      region: null,
      textBlocks: [
        { text: "Sample", bounds: { x: 0, y: 0, width: 50, height: 18 }, fontSize: 18, fontWeight: 400, color: null },
      ],
    });
    const c = candidatesFor(m, "typography");
    const fs = c.find((x) => x.property === "font-size");
    expect(fs?.value).toBe("18px");
    expect(fs?.numeric).toEqual({ base: 18, unit: "px" });
  });

  it("orders font-weight candidates by closeness to the reference weight", () => {
    const m = matched({
      region: null,
      textBlocks: [
        { text: "Sample", bounds: { x: 0, y: 0, width: 50, height: 14 }, fontSize: 14, fontWeight: 700, color: null },
      ],
    });
    const weights = candidatesFor(m, "typography")
      .filter((x) => x.property === "font-weight")
      .map((x) => x.value);
    expect(weights[0]).toBe("700");
  });

  it("emits nothing without matched text", () => {
    expect(candidatesFor(matched({ region: null, textBlocks: [] }), "typography")).toEqual([]);
  });
});

describe("candidatesFor — effects", () => {
  it("targets region border radius when it differs by >2px", () => {
    const m = matched({ region: { id: "r1", bounds: { x: 0, y: 0, width: 100, height: 50 }, fill: null, borderRadius: 12 } });
    const c = candidatesFor(m, "effects");
    expect(c.find((x) => x.property === "border-radius")?.value).toBe("12px");
  });

  it("emits nothing when radius is close", () => {
    const m = matched({ region: { id: "r1", bounds: { x: 0, y: 0, width: 100, height: 50 }, fill: null, borderRadius: 5 } });
    expect(candidatesFor(m, "effects")).toEqual([]);
  });
});

describe("containerCandidates", () => {
  function container(styles: Record<string, string> = {}): MatchedElement {
    return {
      element: {
        selector: ".content",
        tag: "div",
        classes: ["content"],
        bounds: { x: 0, y: 56, width: 900, height: 500 },
        area: 450000,
        depth: 1,
        text: null,
        styles: { paddingTop: "32px", paddingLeft: "32px", display: "flex", gap: "28px", ...styles },
      },
      region: null,
      textBlocks: [],
      iou: 0,
    };
  }
  function child(selector: string, bounds: { x: number; y: number; width: number; height: number }, region: { x: number; y: number; width: number; height: number }): MatchedElement {
    return {
      element: { selector, tag: "div", classes: [], bounds, area: bounds.width * bounds.height, depth: 3, text: null, styles: {} },
      region: { id: selector, bounds: region, fill: null, borderRadius: null },
      textBlocks: [],
      iou: 0.8,
    };
  }

  it("proposes padding corrections from the children's uniform offset", () => {
    const kids = [
      child(".a", { x: 32, y: 88, width: 268, height: 120 }, { x: 24, y: 80, width: 268, height: 120 }),
      child(".b", { x: 32, y: 224, width: 852, height: 280 }, { x: 24, y: 216, width: 852, height: 280 }),
    ];
    const c = containerCandidates(container(), kids);
    expect(c.find((x) => x.property === "padding-top")?.value).toBe("24px");
    expect(c.find((x) => x.property === "padding-left")?.value).toBe("24px");
  });

  it("proposes a gap correction from adjacent children's reference gaps", () => {
    const kids = [
      child(".a", { x: 24, y: 80, width: 268, height: 120 }, { x: 24, y: 80, width: 268, height: 120 }),
      child(".b", { x: 320, y: 80, width: 268, height: 120 }, { x: 308, y: 80, width: 268, height: 120 }),
      child(".c", { x: 616, y: 80, width: 268, height: 120 }, { x: 592, y: 80, width: 268, height: 120 }),
    ];
    const c = containerCandidates(container({ paddingTop: "0px", paddingLeft: "0px" }), kids);
    expect(c.find((x) => x.property === "gap")?.value).toBe("16px");
  });

  it("proposes nothing when children are aligned", () => {
    const kids = [
      child(".a", { x: 24, y: 80, width: 268, height: 120 }, { x: 24, y: 80, width: 268, height: 120 }),
    ];
    expect(containerCandidates(container({ gap: "16px" }), kids)).toEqual([]);
  });

  it("ignores children outside the container bounds", () => {
    const kids = [
      child(".far", { x: 0, y: 2000, width: 100, height: 100 }, { x: 50, y: 2050, width: 100, height: 100 }),
    ];
    expect(containerCandidates(container(), kids)).toEqual([]);
  });
});

describe("candidatesFor — pixel-sampled color", () => {
  it("targets the sampled reference color under the element when it differs", () => {
    const m = matched({ region: null });
    const c = candidatesFor(m, "color", { sampleFill: () => "#1C1D26" });
    const bg = c.find((x) => x.property === "background-color");
    expect(bg?.value).toBe("#1C1D26");
    expect(bg?.source).toBe("color:ref-pixels");
  });

  it("emits nothing when the sample matches the computed background", () => {
    const m = matched({ region: null });
    expect(candidatesFor(m, "color", { sampleFill: () => "#112233" })).toEqual([]);
  });

  it("dedupes the sampled color against the extract fill", () => {
    const m = matched({ region: { id: "r1", bounds: { x: 0, y: 0, width: 100, height: 50 }, fill: "#1C1D26", borderRadius: null } });
    const c = candidatesFor(m, "color", { sampleFill: () => "#1C1D26" });
    expect(c.filter((x) => x.property === "background-color").length).toBe(1);
  });
});

describe("candidatesFor — text-anchored geometry", () => {
  it("proposes margin shifts from the offset between element and reference text", () => {
    const m = matched({
      region: null,
      bounds: { x: 100, y: 100, width: 200, height: 20 },
      textBlocks: [
        { text: "Sample", bounds: { x: 92, y: 94, width: 60, height: 14 }, fontSize: 14, fontWeight: 400, color: null },
      ],
    });
    const c = candidatesFor(m, "geometry");
    expect(c.find((x) => x.property === "margin-left")?.value).toBe("-8px");
    expect(c.find((x) => x.property === "margin-top")?.value).toBe("-6px");
  });

  it("proposes nothing when reference text aligns with the element", () => {
    const m = matched({
      region: null,
      bounds: { x: 100, y: 100, width: 200, height: 20 },
      textBlocks: [
        { text: "Sample", bounds: { x: 101, y: 100, width: 60, height: 14 }, fontSize: 14, fontWeight: 400, color: null },
      ],
    });
    expect(candidatesFor(m, "geometry")).toEqual([]);
  });
});

describe("groupCandidates", () => {
  function item(selector: string, tag: string, classes: string[], property: string, value: string, numeric?: { base: number; unit: string }) {
    return {
      element: { selector, tag, classes, bounds: { x: 0, y: 0, width: 50, height: 20 }, area: 1000, depth: 4, text: null, styles: {} },
      candidate: { selector, property, value, source: "geometry:test", numeric },
    };
  }

  it("merges near-identical numeric fixes on same-class elements into one rule", () => {
    const groups = groupCandidates([
      item("tr:nth-of-type(1) > td:nth-of-type(1)", "td", [], "padding-top", "13px", { base: 13, unit: "px" }),
      item("tr:nth-of-type(2) > td:nth-of-type(1)", "td", [], "padding-top", "14px", { base: 14, unit: "px" }),
      item("tr:nth-of-type(3) > td:nth-of-type(1)", "td", [], "padding-top", "14px", { base: 14, unit: "px" }),
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0]!.selector).toBe("td");
    expect(groups[0]!.value).toBe("14px");
    expect(groups[0]!.source).toContain("grouped");
  });

  it("merges identical color fixes by class", () => {
    const groups = groupCandidates([
      item("tr:nth-of-type(1) > span.avatar", "span", ["avatar"], "background-color", "#1C1D26"),
      item("tr:nth-of-type(2) > span.avatar", "span", ["avatar"], "background-color", "#1C1D26"),
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0]!.selector).toBe("span.avatar");
    expect(groups[0]!.value).toBe("#1C1D26");
  });

  it("does not group a single element, divergent values, or unsafe class names", () => {
    expect(groupCandidates([item("a.x", "a", ["x"], "color", "#FFF")]).length).toBe(0);
    expect(
      groupCandidates([
        item("tr:nth-of-type(1) > td", "td", [], "padding-top", "4px", { base: 4, unit: "px" }),
        item("tr:nth-of-type(2) > td", "td", [], "padding-top", "30px", { base: 30, unit: "px" }),
      ]).length,
    ).toBe(0);
    expect(
      groupCandidates([
        item("div.a", "div", ["weird:cls"], "color", "#FFF"),
        item("div.b", "div", ["weird:cls"], "color", "#FFF"),
      ]).length,
    ).toBe(0);
  });

  it("groups divs only by class, never bare", () => {
    expect(
      groupCandidates([
        item("div:nth-of-type(1)", "div", [], "color", "#FFF"),
        item("div:nth-of-type(2)", "div", [], "color", "#FFF"),
      ]).length,
    ).toBe(0);
  });
});
