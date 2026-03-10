import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { VERSION, captureOptionsSchema, captureResultSchema, type CaptureOptions, type CaptureResult } from "@one-shot-ui/core";

export async function captureScreenshot(options: CaptureOptions): Promise<CaptureResult> {
  const parsed = captureOptionsSchema.parse(options);
  let browser;

  try {
    browser = await chromium.launch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Executable doesn't exist")) {
      throw new Error(
        "Playwright Chromium is not installed. Run `bun run install:browsers` and retry."
      );
    }
    throw error;
  }

  try {
    const page = await browser.newPage({
      viewport: {
        width: parsed.width,
        height: parsed.height
      },
      deviceScaleFactor: parsed.deviceScaleFactor
    });

    const target = parsed.url ?? pathToFileURL(resolve(parsed.filePath!)).href;
    await page.goto(target, { waitUntil: "networkidle" });
    await page.screenshot({
      path: parsed.outputPath,
      fullPage: true
    });

    return captureResultSchema.parse({
      version: VERSION,
      outputPath: parsed.outputPath,
      width: parsed.width,
      height: parsed.height
    });
  } finally {
    await browser.close();
  }
}
