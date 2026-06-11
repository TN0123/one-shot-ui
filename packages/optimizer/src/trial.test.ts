import { describe, it, expect } from "bun:test";
import { rulesToCss } from "./trial.js";

describe("rulesToCss", () => {
  it("emits deterministic selector-grouped CSS with !important", () => {
    const rules = new Map<string, Map<string, string>>();
    const b = new Map<string, string>();
    b.set("width", "120px");
    b.set("background-color", "#112233");
    rules.set(".b", b);
    const a = new Map<string, string>();
    a.set("font-size", "14px");
    rules.set(".a", a);

    const css = rulesToCss(rules);
    expect(css).toBe(
      ".b { width: 120px !important; background-color: #112233 !important; }\n" +
        ".a { font-size: 14px !important; }",
    );
  });

  it("returns empty string for no rules", () => {
    expect(rulesToCss(new Map())).toBe("");
  });
});
