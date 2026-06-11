import { describe, it, expect } from "bun:test";
import { candidatesFor, containerCandidates, refinementValues, rgbToHex } from "./candidates.js";
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
      element: { selector, tag: "div", bounds, area: bounds.width * bounds.height, depth: 3, text: null, styles: {} },
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
