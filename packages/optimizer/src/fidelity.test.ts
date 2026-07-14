import { describe, it, expect } from "bun:test";
import { computeFidelity, detectTextOverlaps, assignTextBlocks, type FidelityInput } from "./fidelity.js";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });
const OPTS = { canvasWidth: 1000, canvasHeight: 1000 };

// A small reference page: header + two body lines, on two regions.
const ref: FidelityInput = {
  layout: [
    { bounds: box(0, 0, 1000, 200), fill: "#ffffff" },
    { bounds: box(0, 200, 1000, 400), fill: "#f0f0f0" },
  ],
  text: [
    { text: "Welcome to the app", bounds: box(100, 40, 400, 60), color: "#111111" },
    { text: "Sign in below", bounds: box(100, 260, 300, 40), color: "#333333" },
    { text: "Forgot password", bounds: box(100, 320, 300, 40), color: "#3366cc" },
  ],
};

describe("computeFidelity", () => {
  it("scores a perfect reproduction near 100 with all gates passing", () => {
    const f = computeFidelity(ref, ref, OPTS);
    expect(f.score).toBeGreaterThan(97);
    expect(f.contentRecall).toBe(1);
    expect(f.gates.contentComplete).toBe(true);
    expect(f.gates.noOverlap).toBe(true);
    expect(f.overlapCount).toBe(0);
  });

  it("penalizes missing content and trips the content gate", () => {
    const impl: FidelityInput = { layout: ref.layout, text: [ref.text[0]!] }; // 1 of 3 blocks
    const f = computeFidelity(ref, impl, OPTS);
    expect(f.contentRecall).toBeCloseTo(1 / 3, 5);
    expect(f.gates.contentComplete).toBe(false);
    expect(f.score).toBeLessThan(60); // recall multiplies the score down
    // still ahead of an overlapping mess:
    expect(f.score).toBeGreaterThan(0);
  });

  it("collapses the score when text overlaps, even with perfect content", () => {
    // Same three strings, but the two body lines are stacked on top of each other.
    const impl: FidelityInput = {
      layout: ref.layout,
      text: [
        { text: "Welcome to the app", bounds: box(100, 40, 400, 60), color: "#111111" },
        { text: "Sign in below", bounds: box(100, 300, 300, 60), color: "#333333" },
        { text: "Forgot password", bounds: box(100, 300, 300, 60), color: "#3366cc" },
      ],
    };
    const f = computeFidelity(ref, impl, OPTS);
    expect(f.contentRecall).toBe(1); // all content present…
    expect(f.overlapCount).toBeGreaterThanOrEqual(1); // …but it overlaps
    expect(f.gates.noOverlap).toBe(false);
    expect(f.score).toBeLessThan(f.contentRecallArea * 100); // penalized below the no-overlap ceiling
  });

  it("normalizes per-side, so a taller impl render is not falsely 'shifted down'", () => {
    // Same layout, but the impl page rendered 50% taller (proportional positions).
    const scale = 1.5;
    const taller: FidelityInput = {
      layout: ref.layout.map((r) => ({ ...r, bounds: box(r.bounds.x, r.bounds.y * scale, r.bounds.width, r.bounds.height * scale) })),
      text: ref.text.map((t) => ({ ...t, bounds: box(t.bounds.x, t.bounds.y * scale, t.bounds.width, t.bounds.height) })),
    };
    const f = computeFidelity(ref, taller, { canvasWidth: 1000, canvasHeight: 1000, implCanvasWidth: 1000, implCanvasHeight: 1000 * scale });
    expect(f.positionScore).toBeGreaterThan(0.95); // proportional layout → still well-placed
    expect(f.score).toBeGreaterThan(90);
  });

  it("disambiguates duplicate strings to the spatially-correct block", () => {
    // Two identical "Email" labels; a naive text matcher could cross-pair them.
    const dupRef: FidelityInput = {
      layout: [],
      text: [
        { text: "Email address", bounds: box(100, 100, 200, 30) },
        { text: "Email address", bounds: box(100, 500, 200, 30) },
      ],
    };
    const dupImpl: FidelityInput = {
      layout: [],
      text: [
        { text: "Email address", bounds: box(105, 505, 200, 30) }, // near the second
        { text: "Email address", bounds: box(105, 105, 200, 30) }, // near the first
      ],
    };
    const f = computeFidelity(dupRef, dupImpl, OPTS);
    expect(f.contentRecall).toBe(1);
    expect(f.positionScore).toBeGreaterThan(0.95); // matched to the nearby ones, not crossed
  });

  it("rewards a well-placed build over a shifted one", () => {
    const shifted: FidelityInput = {
      layout: ref.layout,
      text: ref.text.map((t) => ({ ...t, bounds: box(t.bounds.x + 250, t.bounds.y + 250, t.bounds.width, t.bounds.height) })),
    };
    const good = computeFidelity(ref, ref, OPTS).score;
    const bad = computeFidelity(ref, shifted, OPTS).score;
    expect(good).toBeGreaterThan(bad);
    expect(bad).toBeGreaterThan(0); // shifted-but-present still beats missing/overlapping
  });
});

describe("assignTextBlocks", () => {
  it("marks a reference block present when a matching impl block exists, absent when it's gone", () => {
    const implFull: FidelityInput = {
      layout: [],
      text: [
        { text: "Welcome to the app", bounds: box(100, 40, 400, 60), label: "h1" },
        { text: "Sign in below", bounds: box(100, 260, 300, 40), label: "p.a" },
        { text: "Forgot password", bounds: box(100, 320, 300, 40), label: "p.b" },
      ],
    };
    const full = assignTextBlocks(ref, implFull, OPTS);
    expect(full.refTexts.length).toBe(3);
    expect(full.assignments.length).toBe(3);
    // implLabel (the DOM selector) is carried through so the gate can attribute loss.
    expect(new Set(full.assignments.map((a) => a.implLabel))).toEqual(new Set(["h1", "p.a", "p.b"]));

    // Drop the middle impl block (as collectElements would if a fix collapsed it).
    const implMissing: FidelityInput = { layout: [], text: [implFull.text[0]!, implFull.text[2]!] };
    const missing = assignTextBlocks(ref, implMissing, OPTS);
    const present = new Set(missing.assignments.map((a) => a.refIndex));
    expect(present.size).toBe(2);
    // The reference block "Sign in below" (index 1) is now unmatched — the gate's signal.
    expect(present.has(1)).toBe(false);
  });
});

describe("detectTextOverlaps", () => {
  it("flags two sibling text boxes that collide", () => {
    const overlaps = detectTextOverlaps([
      { text: "A line of text", bounds: box(100, 100, 200, 40), label: "a" },
      { text: "Another line", bounds: box(100, 110, 200, 40), label: "b" },
    ]);
    expect(overlaps.length).toBe(1);
    expect(overlaps[0]!.a).toBe("a");
  });

  it("does NOT flag a text label nested inside its container", () => {
    const overlaps = detectTextOverlaps([
      { text: "Card title", bounds: box(0, 0, 400, 300), label: "card" }, // container
      { text: "Card title", bounds: box(20, 20, 200, 40), label: "title" }, // nested label
    ]);
    expect(overlaps.length).toBe(0);
  });

  it("ignores non-text items and slivers", () => {
    const overlaps = detectTextOverlaps([
      { text: null, bounds: box(0, 0, 100, 100), label: "img" },
      { text: "hi", bounds: box(50, 50, 100, 100), label: "t" },
    ]);
    expect(overlaps.length).toBe(0);
  });
});
