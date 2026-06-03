import { describe, it, expect } from "bun:test";
import { isLikelyScreenshotTempPath, describeMissingImagePath } from "./screenshot-path.js";

describe("isLikelyScreenshotTempPath", () => {
  it("flags a macOS screenshot floating-thumbnail temp path", () => {
    expect(
      isLikelyScreenshotTempPath(
        "/var/folders/wx/dkbf3dgx37z/T/TemporaryItems/NSIRD_screencaptureui_2at6LA/Screenshot 2026-06-03 at 3.49.54 PM.png"
      )
    ).toBe(true);
  });

  it("flags any path under a TemporaryItems dir", () => {
    expect(isLikelyScreenshotTempPath("/private/var/folders/x/y/T/TemporaryItems/foo.png")).toBe(true);
  });

  it("flags an NSIRD_screencaptureui path", () => {
    expect(isLikelyScreenshotTempPath("/tmp/NSIRD_screencaptureui_abc/Screenshot 2026.png")).toBe(true);
  });

  it("does NOT flag a screenshot already saved to the Desktop", () => {
    expect(isLikelyScreenshotTempPath("/Users/me/Desktop/Screenshot 2026-06-03 at 3.49.54 PM.png")).toBe(false);
  });

  it("does NOT flag an ordinary project image path", () => {
    expect(isLikelyScreenshotTempPath("/Users/me/proj/reference.png")).toBe(false);
  });
});

describe("describeMissingImagePath", () => {
  it("gives macOS screenshot-specific guidance for a temp path", () => {
    const msg = describeMissingImagePath(
      "image_path",
      "/var/folders/x/T/TemporaryItems/NSIRD_screencaptureui_z/Screenshot 1.png"
    );
    expect(msg).toContain("image_path");
    expect(msg).toMatch(/Desktop/);
    expect(msg).toMatch(/screenshot/i);
  });

  it("gives a generic not-found message for an ordinary path", () => {
    const msg = describeMissingImagePath("reference_path", "/Users/me/proj/ref.png");
    expect(msg).toContain("reference_path");
    expect(msg).toContain("/Users/me/proj/ref.png");
    expect(msg).toMatch(/absolute path/i);
    expect(msg).not.toMatch(/TemporaryItems|floating thumbnail/);
  });
});
