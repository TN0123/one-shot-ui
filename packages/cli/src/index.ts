#!/usr/bin/env bun
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { Command } from "commander";
import { VERSION, extractReportSchema, type LayoutNode } from "@one-shot-ui/core";
import { captureScreenshot } from "@one-shot-ui/browser-capture";
import { compareImages } from "@one-shot-ui/diff-engine";
import { calculateActivePixelRatio, detectBackgroundColor, loadImage } from "@one-shot-ui/image-io";
import { clusterComponents } from "@one-shot-ui/vision-components";
import { detectLayoutBoxes, measureSpacing } from "@one-shot-ui/vision-layout";
import { estimateBorderRadius, estimateNodeFill, extractDominantColors } from "@one-shot-ui/vision-style";
import { extractText } from "@one-shot-ui/vision-text";

const program = new Command();
program.name("one-shot-ui").description("Deterministic UI extraction and diff toolkit").version(VERSION);

program
  .command("extract")
  .argument("<imagePath>", "Path to the reference screenshot")
  .option("--json", "Print full JSON report", false)
  .action(async (imagePath, options) => {
    const report = await extractImageReport(imagePath);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`Extracted ${report.layout.length} layout regions and ${report.text.length} text blocks from ${report.image.path}`);
    console.log(`Top colors: ${report.colors.slice(0, 4).map((color) => color.hex).join(", ")}`);
  });

program
  .command("compare")
  .argument("<referencePath>", "Path to the reference screenshot")
  .argument("<implementationPath>", "Path to the implementation screenshot")
  .option("--json", "Print full JSON report", false)
  .option("--heatmap <path>", "Path to write the diff heatmap")
  .action(async (referencePath, implementationPath, options) => {
    const report = await compareImages(referencePath, implementationPath, options.heatmap);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`Mismatch ratio: ${(report.summary.mismatchRatio * 100).toFixed(2)}%`);
    console.log(`Issues: ${report.issues.length}`);
    if (report.artifacts.heatmapPath) {
      console.log(`Heatmap: ${report.artifacts.heatmapPath}`);
    }
  });

program
  .command("capture")
  .option("--url <url>", "HTTP URL to capture")
  .option("--file <filePath>", "Local HTML file to capture")
  .requiredOption("--output <outputPath>", "Screenshot output path")
  .option("--width <width>", "Viewport width", "1440")
  .option("--height <height>", "Viewport height", "1024")
  .option("--scale <scale>", "Device scale factor", "1")
  .option("--json", "Print full JSON report", false)
  .action(async (options) => {
    const outputPath = resolve(options.output);
    await mkdir(dirname(outputPath), { recursive: true });

    const result = await captureScreenshot({
      url: options.url,
      filePath: options.file ? resolve(options.file) : undefined,
      outputPath,
      width: Number.parseInt(options.width, 10),
      height: Number.parseInt(options.height, 10),
      deviceScaleFactor: Number.parseFloat(options.scale)
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Captured screenshot to ${result.outputPath}`);
  });

program.parseAsync(process.argv);

async function extractImageReport(imagePath: string) {
  const normalizedPath = resolve(imagePath);
  const image = await loadImage(normalizedPath);
  const layout = enrichLayoutNodes(image, detectLayoutBoxes(image));
  const clustered = clusterComponents(layout);
  const report = {
    version: VERSION,
    image: {
      path: normalizedPath,
      width: image.width,
      height: image.height,
      channels: image.channels,
      trimmedBounds: image.trimmedBounds
    },
    colors: extractDominantColors(image),
    layout: clustered.nodes,
    text: await extractText(normalizedPath),
    spacing: measureSpacing(clustered.nodes),
    components: clustered.components,
    diagnostics: {
      background: detectBackgroundColor(image),
      activePixelRatio: calculateActivePixelRatio(image)
    }
  };

  return extractReportSchema.parse(report);
}

function enrichLayoutNodes(image: Awaited<ReturnType<typeof loadImage>>, nodes: LayoutNode[]): LayoutNode[] {
  return nodes.map((node) => {
    const fill = estimateNodeFill(image, node.bounds) ?? node.fill;
    return {
      ...node,
      fill,
      borderRadius: estimateBorderRadius(image, node.bounds, fill),
      componentId: null
    };
  });
}
