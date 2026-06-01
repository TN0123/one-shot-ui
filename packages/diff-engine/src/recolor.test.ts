import { describe, it, expect } from "bun:test";
import { isMeaningfulRecolor } from "./recolor.js";

describe("isMeaningfulRecolor", () => {
  it("flags a recolor between two non-background fills", () => {
    // blue button -> red button on a white page
    expect(isMeaningfulRecolor("#5b5ef0", "#e8513a", "#ffffff")).toBe(true);
  });

  it("ignores a change where one side is the page background (content moved in/out, not a recolor)", () => {
    // a dark text block now sits where white background was — not a recolor
    expect(isMeaningfulRecolor("#ffffff", "#101030", "#ffffff")).toBe(false);
    expect(isMeaningfulRecolor("#101030", "#ffffff", "#ffffff")).toBe(false);
  });

  it("ignores background-adjacent changes on a dark theme", () => {
    // dark panel vs near-background dark — noise, not a recolor
    expect(isMeaningfulRecolor("#202020", "#303040", "#13141b")).toBe(false);
  });

  it("ignores sub-threshold differences", () => {
    expect(isMeaningfulRecolor("#ffffff", "#fefefe", "#000000")).toBe(false);
  });

  it("requires both fills to be present", () => {
    expect(isMeaningfulRecolor(null, "#e8513a", "#ffffff")).toBe(false);
    expect(isMeaningfulRecolor("#5b5ef0", undefined, "#ffffff")).toBe(false);
  });
});
