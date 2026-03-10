import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { VERSION, compareReportSchema, type CompareIssue, type CompareReport } from "@one-shot-ui/core";
import { loadImage } from "@one-shot-ui/image-io";
import { detectLayoutBoxes } from "@one-shot-ui/vision-layout";
import { extractText } from "@one-shot-ui/vision-text";

export async function compareImages(
  referencePath: string,
  implementationPath: string,
  heatmapPath?: string
): Promise<CompareReport> {
  const [referenceImage, implementationImage, referenceText, implementationText] = await Promise.all([
    loadImage(referencePath),
    loadImage(implementationPath),
    extractText(referencePath),
    extractText(implementationPath)
  ]);

  const width = Math.min(referenceImage.width, implementationImage.width);
  const height = Math.min(referenceImage.height, implementationImage.height);
  const referencePng = new PNG({ width, height });
  const implementationPng = new PNG({ width, height });

  for (let y = 0; y < height; y++) {
    const referenceRowOffset = y * referenceImage.width * referenceImage.channels;
    const implementationRowOffset = y * implementationImage.width * implementationImage.channels;
    const pngRowOffset = y * width * 4;

    referencePng.data.set(
      referenceImage.data.slice(referenceRowOffset, referenceRowOffset + width * referenceImage.channels),
      pngRowOffset
    );
    implementationPng.data.set(
      implementationImage.data.slice(
        implementationRowOffset,
        implementationRowOffset + width * implementationImage.channels
      ),
      pngRowOffset
    );
  }

  const diff = new PNG({ width, height });
  const mismatchPixels = pixelmatch(referencePng.data, implementationPng.data, diff.data, width, height, {
    threshold: 0.12,
    alpha: 0.6,
    diffColor: [255, 64, 64],
    diffColorAlt: [64, 160, 255]
  });

  const issues: CompareIssue[] = [];
  if (referenceImage.width !== implementationImage.width || referenceImage.height !== implementationImage.height) {
    issues.push({
      code: "DIMENSION_MISMATCH",
      severity: "high",
      message: "Reference and implementation images have different dimensions.",
      reference: { width: referenceImage.width, height: referenceImage.height },
      implementation: { width: implementationImage.width, height: implementationImage.height }
    });
  }

  const mismatchRatio = width * height === 0 ? 0 : mismatchPixels / (width * height);
  if (mismatchRatio > 0.01) {
    issues.push({
      code: "PIXEL_DIFFERENCE",
      severity: mismatchRatio > 0.08 ? "high" : "medium",
      message: `Pixel mismatch ratio is ${(mismatchRatio * 100).toFixed(2)}%.`,
      reference: { mismatchPixels },
      implementation: { mismatchRatio }
    });
  }

  const referenceLayoutCount = detectLayoutBoxes(referenceImage).length;
  const implementationLayoutCount = detectLayoutBoxes(implementationImage).length;
  if (referenceLayoutCount !== implementationLayoutCount) {
    issues.push({
      code: "LAYOUT_COUNT_MISMATCH",
      severity: "medium",
      message: "Detected layout region counts do not match.",
      reference: { layoutNodes: referenceLayoutCount },
      implementation: { layoutNodes: implementationLayoutCount }
    });
  }

  if (referenceText.length !== implementationText.length) {
    issues.push({
      code: "TEXT_COUNT_MISMATCH",
      severity: "low",
      message: "OCR text block counts do not match.",
      reference: { textBlocks: referenceText.length },
      implementation: { textBlocks: implementationText.length }
    });
  }

  let normalizedHeatmapPath: string | null = null;
  if (heatmapPath) {
    normalizedHeatmapPath = resolve(heatmapPath);
    await mkdir(dirname(normalizedHeatmapPath), { recursive: true });
    await writeFile(normalizedHeatmapPath, PNG.sync.write(diff));
  }

  return compareReportSchema.parse({
    version: VERSION,
    referenceImage,
    implementationImage,
    summary: {
      mismatchPixels,
      mismatchRatio,
      widthDelta: implementationImage.width - referenceImage.width,
      heightDelta: implementationImage.height - referenceImage.height
    },
    issues,
    artifacts: {
      heatmapPath: normalizedHeatmapPath
    }
  });
}

