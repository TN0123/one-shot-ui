import { describe, it, expect } from "bun:test";
import { compareStyleSystems } from "./style-conformance.js";
import type { StyleSystem, StyleSwatch } from "@one-shot-ui/core/style-system";

function sw(hex: string, s: number, l: number, count = 100): StyleSwatch {
  const rgb = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  return { hex, rgb, hsl: { h: 0, s, l }, count, role: null };
}

function system(p: Partial<StyleSystem> = {}): StyleSystem {
  return {
    colors: {
      neutrals: [sw("#FFFFFF", 0, 1), sw("#888888", 0, 0.5), sw("#111111", 0, 0.07)],
      accents: [sw("#3B82F6", 0.9, 0.6)],
    },
    spacing: { baseUnit: 8, scale: [8, 16, 24], confidence: 1 },
    typography: { sizes: [12, 16, 24], ratio: 1.41, weights: [400, 700], monospace: false, families: [] },
    radius: { scale: [{ name: "sm", value: 4 }, { name: "md", value: 8 }] },
    elevation: { tiers: [{ name: "sm", shadow: "0px 2px 4px rgba(0,0,0,0.1)" }] },
    source: "dom",
    ...p,
  };
}

describe("compareStyleSystems", () => {
  it("reports full conformance for identical systems", () => {
    const r = compareStyleSystems(system(), system());
    expect(r.conforms).toBe(true);
    expect(r.dimensions.every((d) => d.verdict === "match")).toBe(true);
  });

  it("flags a new dominant off-palette accent", () => {
    const impl = system({ colors: { neutrals: system().colors.neutrals, accents: [sw("#E8513A", 0.8, 0.57)] } });
    const r = compareStyleSystems(system(), impl);
    const palette = r.dimensions.find((d) => d.name === "palette")!;
    expect(palette.verdict).toBe("drift");
    expect(palette.drifts.join(" ")).toContain("#E8513A");
    expect(r.conforms).toBe(false);
  });

  it("does NOT flag rare (insignificant) accent colors — the sparse/dense asymmetry fix", () => {
    // A faithful DOM build keeps the dominant accent but also surfaces rare badge/chart hues.
    const accents = [
      sw("#3B82F6", 0.9, 0.6, 100), // dominant — matches reference
      sw("#4ADE80", 0.7, 0.7, 2), // rare status green
      sw("#FACC15", 0.9, 0.7, 1), // rare status yellow
      sw("#A78BFA", 0.6, 0.75, 1), // rare chart purple
    ];
    const impl = system({ colors: { neutrals: system().colors.neutrals, accents } });
    const r = compareStyleSystems(system(), impl);
    expect(r.dimensions.find((d) => d.name === "palette")!.verdict).toBe("match");
    expect(r.conforms).toBe(true);
  });

  it("does NOT flag extra gray shades (neutrals are a continuous ramp)", () => {
    const neutrals = [...system().colors.neutrals, sw("#A0A0A0", 0, 0.63), sw("#C0C0C0", 0, 0.75)];
    const impl = system({ colors: { neutrals, accents: system().colors.accents } });
    expect(compareStyleSystems(system(), impl).dimensions.find((d) => d.name === "palette")!.verdict).toBe("match");
  });

  it("flags an incompatible spacing rhythm but tolerates a harmonic grid", () => {
    const incompatible = compareStyleSystems(system(), system({ spacing: { baseUnit: 5, scale: [5, 10, 15], confidence: 1 } }));
    expect(incompatible.dimensions.find((d) => d.name === "spacing")!.verdict).toBe("drift");
    expect(incompatible.dimensions.find((d) => d.name === "spacing")!.drifts.join(" ")).toContain("5");

    // 4px is a harmonic of the reference's 8px grid — not a drift.
    const harmonic = compareStyleSystems(system(), system({ spacing: { baseUnit: 4, scale: [4, 8, 12, 16], confidence: 1 } }));
    expect(harmonic.dimensions.find((d) => d.name === "spacing")!.verdict).toBe("match");
  });

  it("flags a typographic scale-ratio drift", () => {
    const impl = system({ typography: { sizes: [10, 20, 40], ratio: 2.0, weights: [400], monospace: false, families: [] } });
    expect(compareStyleSystems(system(), impl).dimensions.find((d) => d.name === "typography")!.verdict).toBe("drift");
  });

  it("treats radius/elevation as advisory (low-confidence) when the reference is a screenshot", () => {
    const ref = system({ source: "screenshot", radius: { scale: [{ name: "sharp", value: 2 }] }, elevation: { tiers: [{ name: "sm", shadow: "x" }] } });
    const impl = system({ source: "dom", radius: { scale: [{ name: "lg", value: 20 }] }, elevation: { tiers: [] } });
    const r = compareStyleSystems(ref, impl);
    const radius = r.dimensions.find((d) => d.name === "radius")!;
    const elevation = r.dimensions.find((d) => d.name === "elevation")!;
    expect(radius.verdict).toBe("drift");
    expect(radius.confidence).toBe("low");
    expect(elevation.verdict).toBe("drift");
    expect(elevation.confidence).toBe("low");
    // Advisory drifts must NOT fail the verdict.
    expect(r.conforms).toBe(true);
    expect(r.advisories).toBe(2);
  });

  it("lets radius/elevation fail the verdict when the reference is itself DOM-measured", () => {
    const ref = system({ source: "dom", radius: { scale: [{ name: "sharp", value: 2 }] } });
    const impl = system({ source: "dom", radius: { scale: [{ name: "lg", value: 20 }] } });
    const r = compareStyleSystems(ref, impl);
    expect(r.dimensions.find((d) => d.name === "radius")!.confidence).toBe("high");
    expect(r.conforms).toBe(false);
  });
});
