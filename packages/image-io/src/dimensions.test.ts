import { describe, it, expect } from "bun:test";
import { readImageDimensions } from "./index.js";
import { resolve } from "node:path";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import sharp from "sharp";

const tmpDir = resolve(import.meta.dir, "../../../.test-tmp");

describe("readImageDimensions", () => {
  it("reads dimensions of a PNG image", async () => {
    await mkdir(tmpDir, { recursive: true });
    const testPath = resolve(tmpDir, "test-dim.png");

    // Create a 320x240 PNG
    await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 128, g: 128, b: 128 } }
    }).png().toFile(testPath);

    const dims = await readImageDimensions(testPath);
    expect(dims.width).toBe(320);
    expect(dims.height).toBe(240);

    await unlink(testPath).catch(() => {});
  });

  it("reads dimensions of a non-square image", async () => {
    await mkdir(tmpDir, { recursive: true });
    const testPath = resolve(tmpDir, "test-dim-wide.png");

    await sharp({
      create: { width: 1280, height: 900, channels: 3, background: { r: 0, g: 0, b: 0 } }
    }).png().toFile(testPath);

    const dims = await readImageDimensions(testPath);
    expect(dims.width).toBe(1280);
    expect(dims.height).toBe(900);

    await unlink(testPath).catch(() => {});
  });

  it("throws for non-existent file", async () => {
    await expect(readImageDimensions("/nonexistent/path.png")).rejects.toThrow();
  });
});
