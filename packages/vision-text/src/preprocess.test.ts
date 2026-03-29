import { describe, it, expect, afterAll } from "bun:test";
import { preprocessForOcr } from "./preprocess.js";
import { resolve } from "node:path";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import sharp from "sharp";

const tmpDir = resolve(import.meta.dir, "../../../.test-tmp");
const filesToClean: string[] = [];

afterAll(async () => {
  for (const f of filesToClean) {
    await unlink(f).catch(() => {});
  }
});

describe("preprocessForOcr", () => {
  it("inverts dark background images", async () => {
    await mkdir(tmpDir, { recursive: true });
    const inputPath = resolve(tmpDir, "dark-bg.png");
    const expectedOutput = resolve(tmpDir, "dark-bg-ocr-preprocessed.png");

    // Create a 50x50 dark PNG (near-black background)
    await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 20, g: 20, b: 20 } },
    })
      .png()
      .toFile(inputPath);

    filesToClean.push(inputPath, expectedOutput);

    const result = await preprocessForOcr(inputPath);
    expect(result).toBe(expectedOutput);
    expect(existsSync(result)).toBe(true);

    // Verify the output was inverted: dark input corners should now be light
    const outputMeta = await sharp(result).raw().toBuffer({ resolveWithObject: true });
    // After grayscale + negate + contrast, the originally dark pixels should be bright
    const firstPixel = outputMeta.data[0] ?? 0;
    expect(firstPixel).toBeGreaterThan(128);
  });

  it("upscales small images (height < 300px)", async () => {
    await mkdir(tmpDir, { recursive: true });
    const inputPath = resolve(tmpDir, "small-light.png");
    const expectedOutput = resolve(tmpDir, "small-light-ocr-preprocessed.png");

    // Create a 100x80 light PNG
    await sharp({
      create: { width: 100, height: 80, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .png()
      .toFile(inputPath);

    filesToClean.push(inputPath, expectedOutput);

    const result = await preprocessForOcr(inputPath);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(160);
  });

  it("does not upscale large images (height >= 300px)", async () => {
    await mkdir(tmpDir, { recursive: true });
    const inputPath = resolve(tmpDir, "large-light.png");
    const expectedOutput = resolve(tmpDir, "large-light-ocr-preprocessed.png");

    // Create an 800x600 light PNG
    await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .png()
      .toFile(inputPath);

    filesToClean.push(inputPath, expectedOutput);

    const result = await preprocessForOcr(inputPath);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });
});
