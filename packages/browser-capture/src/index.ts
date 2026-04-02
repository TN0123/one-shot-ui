import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { VERSION, captureOptionsSchema, captureResultSchema, type CaptureOptions, type CaptureResult } from "@one-shot-ui/core";
import { calculateActivePixelRatio, loadImage } from "@one-shot-ui/image-io";

export class BlankCaptureError extends Error {
  public consoleErrors: string[];
  constructor(message: string, consoleErrors: string[] = []) {
    super(message);
    this.name = "BlankCaptureError";
    this.consoleErrors = consoleErrors;
  }
}

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

    // Collect browser console errors during page load
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const target = parsed.url ?? pathToFileURL(resolve(parsed.filePath!)).href;
    await page.goto(target, { waitUntil: "networkidle" });
    await page.screenshot({
      path: parsed.outputPath,
      fullPage: true
    });

    // Validate the capture is not blank
    if (!parsed.skipBlankCheck) {
      const image = await loadImage(parsed.outputPath);
      const activeRatio = calculateActivePixelRatio(image);
      if (activeRatio < 0.01) {
        // Check DOM content before throwing — pages with real content but white
        // backgrounds (blogs, docs) can have very low active pixel ratios
        const bodyChildCount = await page.evaluate(() => document.body.children.length);
        if (bodyChildCount > 2 && consoleErrors.length === 0) {
          // Page has DOM content and no errors — likely a legitimate white-background page
        } else {
          const pct = (activeRatio * 100).toFixed(1);
          const errorLines = [
            `Capture appears blank: ${pct}% active pixels, threshold is 1%. The HTML may not have rendered. Check for missing assets, CDN failures, or JS errors.`,
          ];
          if (consoleErrors.length > 0) {
            errorLines.push(`Browser console errors: ${consoleErrors.join("; ")}`);
          }
          throw new BlankCaptureError(errorLines.join(" "), consoleErrors);
        }
      }
    }

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
