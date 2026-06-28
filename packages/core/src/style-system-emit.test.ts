import { describe, it, expect } from "bun:test";
import { emitStyleSystem, type StyleSystem } from "./style-system.js";

function sampleSystem(): StyleSystem {
  return {
    colors: {
      neutrals: [
        { hex: "#111111", rgb: { r: 17, g: 17, b: 17 }, hsl: { h: 0, s: 0, l: 0.07 }, count: 100, role: null },
        { hex: "#FFFFFF", rgb: { r: 255, g: 255, b: 255 }, hsl: { h: 0, s: 0, l: 1 }, count: 500, role: null },
      ],
      accents: [
        { hex: "#3B82F6", rgb: { r: 59, g: 130, b: 246 }, hsl: { h: 217, s: 0.9, l: 0.6 }, count: 80, role: null },
      ],
    },
    spacing: { baseUnit: 8, scale: [8, 16, 24], confidence: 1 },
    typography: { sizes: [12, 16, 24], ratio: 1.41, weights: [400, 700], monospace: false, families: [] },
    radius: { scale: [{ name: "sm", value: 4 }, { name: "md", value: 8 }] },
    elevation: { tiers: [{ name: "sm", shadow: "0px 2px 4px rgba(0,0,0,0.1)" }] },
    source: "screenshot",
  };
}

describe("emitStyleSystem", () => {
  it("emits valid JSON by default", () => {
    const out = emitStyleSystem(sampleSystem(), "json");
    const parsed = JSON.parse(out);
    expect(parsed.colors.accents[0].hex).toBe("#3B82F6");
  });

  it("emits a shadcn :root block with measured palette, radius, and a role TODO", () => {
    const out = emitStyleSystem(sampleSystem(), "shadcn");
    expect(out).toContain(":root {");
    expect(out).toContain("#3B82F6");
    expect(out.toLowerCase()).toContain("--radius");
    // Roles are the agent's job — the emit scaffolds them as a TODO.
    expect(out.toLowerCase()).toContain("todo");
  });

  it("emits a tailwind @theme block with colors and the base spacing unit", () => {
    const out = emitStyleSystem(sampleSystem(), "tailwind");
    expect(out).toContain("@theme {");
    expect(out).toContain("#3B82F6");
    expect(out).toContain("8px");
  });

  it("does not crash on an empty system", () => {
    const empty: StyleSystem = {
      colors: { neutrals: [], accents: [] },
      spacing: { baseUnit: null, scale: [], confidence: 0 },
      typography: { sizes: [], ratio: null, weights: [], monospace: false, families: [] },
      radius: { scale: [] },
      elevation: { tiers: [] },
      source: "screenshot",
    };
    expect(() => emitStyleSystem(empty, "shadcn")).not.toThrow();
    expect(() => emitStyleSystem(empty, "tailwind")).not.toThrow();
  });
});
