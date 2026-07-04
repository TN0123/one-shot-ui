import { describe, it, expect } from "bun:test";
import { extractHtml, applyPatchCss } from "./html.js";

describe("extractHtml", () => {
  it("pulls the doc out of a fenced ```html block", () => {
    const text = "Sure!\n```html\n<!doctype html><html><body>hi</body></html>\n```\nDone.";
    expect(extractHtml(text)).toBe("<!doctype html><html><body>hi</body></html>");
  });
  it("recovers a raw document with surrounding prose", () => {
    const text = "Here you go: <html><body>x</body></html> hope that helps";
    expect(extractHtml(text)).toBe("<html><body>x</body></html>");
  });
  it("returns trimmed text when no document markers exist", () => {
    expect(extractHtml("  <div>partial</div>  ")).toBe("<div>partial</div>");
  });
});

describe("applyPatchCss", () => {
  it("inserts the patch as the last style before </body>", () => {
    const out = applyPatchCss("<html><body><p>x</p></body></html>", ".a{color:red}");
    expect(out).toContain('<style data-osui-patch>');
    expect(out.indexOf("data-osui-patch")).toBeLessThan(out.indexOf("</body>"));
  });
  it("is a no-op for empty css", () => {
    expect(applyPatchCss("<html></html>", "   ")).toBe("<html></html>");
  });
});
