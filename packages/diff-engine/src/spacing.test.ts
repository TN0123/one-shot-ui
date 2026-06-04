import { describe, it, expect } from "bun:test";
import { compareRulers } from "./spacing.js";
import type { RulerReport } from "@one-shot-ui/vision-layout";

function ref(): RulerReport {
  return {
    background: "#0C1117",
    bands: [
      { start: 0, end: 96, size: 96, background: "#020408", inkDensity: 0.05 },
      { start: 96, end: 948, size: 852, background: "#0C1117", inkDensity: 0.12 }
    ],
    contentRegion: { start: 96, end: 948 },
    columns: [
      { start: 246, end: 544, size: 298, inkDensity: 0.39 },
      { start: 567, end: 1314, size: 747, inkDensity: 0.09 }
    ],
    gutters: [{ start: 544, end: 567, size: 23 }]
  };
}

describe("compareRulers", () => {
  it("reports a top-band height delta with a directional fix", () => {
    const impl = ref();
    impl.bands[0] = { start: 0, end: 110, size: 110, background: "#010409", inkDensity: 0.04 };
    const issues = compareRulers(ref(), impl);
    const band = issues.find(i => i.code === "BAND_HEIGHT_DELTA");
    expect(band).toBeDefined();
    expect(band!.delta).toBe(14); // impl - ref, too tall
    expect(band!.axis).toBe("y");
    expect(band!.suggestedFix.toLowerCase()).toContain("14px");
  });

  it("reports a content column left-edge shift", () => {
    const impl = ref();
    impl.columns[0] = { start: 262, end: 560, size: 298, inkDensity: 0.39 };
    const issues = compareRulers(ref(), impl);
    const edge = issues.find(i => i.code === "EDGE_X_DELTA");
    expect(edge).toBeDefined();
    expect(edge!.delta).toBe(16); // shifted right
    expect(edge!.suggestedFix.toLowerCase()).toContain("16px");
  });

  it("reports a gutter width delta", () => {
    const impl = ref();
    impl.gutters = [{ start: 544, end: 584, size: 40 }];
    const issues = compareRulers(ref(), impl);
    const gut = issues.find(i => i.code === "GUTTER_DELTA");
    expect(gut).toBeDefined();
    expect(gut!.delta).toBe(17); // 40 - 23, too wide
  });

  it("is silent when geometry matches within tolerance", () => {
    const impl = ref();
    impl.bands[0]!.end = 98;
    impl.bands[0]!.size = 98; // 2px — under tolerance
    const issues = compareRulers(ref(), impl);
    expect(issues.length).toBe(0);
  });

  it("scales reported values to CSS px when a dpr is given", () => {
    // Raw 2x rulers: a 192px raw top band vs 220px raw -> 96 vs 110 css, delta 14.
    const r2: RulerReport = { ...ref(), bands: [
      { start: 0, end: 192, size: 192, background: "#020408", inkDensity: 0.05 },
      { start: 192, end: 1896, size: 1704, background: "#0C1117", inkDensity: 0.12 }
    ], contentRegion: { start: 192, end: 1896 }, columns: [], gutters: [] };
    const i2: RulerReport = { ...r2, bands: [
      { start: 0, end: 220, size: 220, background: "#010409", inkDensity: 0.05 },
      { start: 220, end: 1896, size: 1676, background: "#0C1117", inkDensity: 0.12 }
    ] };
    const issues = compareRulers(r2, i2, { dpr: 2 });
    const band = issues.find(i => i.code === "BAND_HEIGHT_DELTA");
    expect(band!.reference.size).toBe(96);
    expect(band!.implementation.size).toBe(110);
    expect(band!.delta).toBe(14);
  });
});
