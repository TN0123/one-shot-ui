#!/usr/bin/env bun
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { Command } from "commander";
import { VERSION, extractReportSchema, type LayoutNode } from "@one-shot-ui/core";
import { generateDesignTokens } from "@one-shot-ui/core/tokens";
import { captureScreenshot } from "@one-shot-ui/browser-capture";
import { compareImages } from "@one-shot-ui/diff-engine";
import { calculateActivePixelRatio, detectBackgroundColor, loadImage } from "@one-shot-ui/image-io";
import { clusterComponents } from "@one-shot-ui/vision-components";
import { detectLayoutBoxes, measureSpacing } from "@one-shot-ui/vision-layout";
import { detectGradient, detectShadow, estimateBorderRadius, estimateNodeFill, extractDominantColors } from "@one-shot-ui/vision-style";
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
  .command("tokens")
  .argument("<imagePath>", "Path to the reference screenshot")
  .option("--json", "Print full JSON report", false)
  .action(async (imagePath, options) => {
    const report = await extractImageReport(imagePath);
    const tokens = generateDesignTokens(report);
    if (options.json) {
      console.log(JSON.stringify({ version: VERSION, tokens }, null, 2));
      return;
    }

    console.log(`Generated ${tokens.length} design tokens from ${report.image.path}`);
    for (const token of tokens) {
      console.log(`  ${token.name}: ${token.value} (used ${token.count}x)`);
    }
  });

program
  .command("suggest-fixes")
  .argument("<referencePath>", "Path to the reference screenshot")
  .argument("<implementationPath>", "Path to the implementation screenshot")
  .option("--json", "Print full JSON report", false)
  .action(async (referencePath, implementationPath, options) => {
    const report = await compareImages(referencePath, implementationPath);
    const fixes = generateImplementationGuidance(report);
    if (options.json) {
      console.log(JSON.stringify({ version: VERSION, fixes }, null, 2));
      return;
    }

    console.log(`${fixes.length} suggested fixes (ordered by priority):\n`);
    for (const fix of fixes) {
      console.log(`[${fix.priority}] ${fix.category}: ${fix.description}`);
      if (fix.css) console.log(`  CSS: ${fix.css}`);
      console.log();
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
  const backgroundHex = detectBackgroundColor(image);
  const layout = enrichLayoutNodes(image, detectLayoutBoxes(image), backgroundHex);
  const clustered = clusterComponents(layout);
  const baseReport = {
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
      background: backgroundHex,
      activePixelRatio: calculateActivePixelRatio(image)
    }
  };

  const tokens = generateDesignTokens(baseReport as any);
  const report = { ...baseReport, tokens };

  return extractReportSchema.parse(report);
}

function enrichLayoutNodes(image: Awaited<ReturnType<typeof loadImage>>, nodes: LayoutNode[], backgroundHex: string): LayoutNode[] {
  return nodes.map((node) => {
    const fill = estimateNodeFill(image, node.bounds) ?? node.fill;
    return {
      ...node,
      fill,
      gradient: detectGradient(image, node.bounds),
      borderRadius: estimateBorderRadius(image, node.bounds, fill),
      shadow: detectShadow(image, node.bounds, fill, backgroundHex),
      componentId: null
    };
  });
}

type ImplementationFix = {
  priority: "high" | "medium" | "low";
  category: string;
  nodeId?: string;
  description: string;
  css?: string;
};

function generateImplementationGuidance(report: { issues: Array<{ code: string; nodeId?: string; severity: string; message: string; suggestedFix?: string; reference?: unknown; implementation?: unknown }> }): ImplementationFix[] {
  const fixes: ImplementationFix[] = [];

  for (const issue of report.issues) {
    const fix: ImplementationFix = {
      priority: issue.severity as "high" | "medium" | "low",
      category: issueCategoryMap[issue.code] ?? "general",
      nodeId: issue.nodeId,
      description: issue.message
    };

    // Generate CSS-specific guidance based on issue type
    switch (issue.code) {
      case "POSITION_MISMATCH": {
        const ref = issue.reference as { x: number; y: number } | undefined;
        if (ref) {
          fix.css = `/* Adjust position */ top: ${ref.y}px; left: ${ref.x}px;`;
        }
        break;
      }
      case "SIZE_MISMATCH": {
        const ref = issue.reference as { width: number; height: number } | undefined;
        if (ref) {
          fix.css = `width: ${ref.width}px; height: ${ref.height}px;`;
        }
        break;
      }
      case "BORDER_RADIUS_MISMATCH": {
        const ref = issue.reference as { borderRadius: number } | undefined;
        if (ref) {
          fix.css = `border-radius: ${ref.borderRadius}px;`;
        }
        break;
      }
      case "COLOR_MISMATCH": {
        const ref = issue.reference as { fill: string } | undefined;
        if (ref) {
          fix.css = `background-color: ${ref.fill};`;
        }
        break;
      }
      case "SHADOW_MISMATCH": {
        const ref = issue.reference as { shadow: { xOffset: number; yOffset: number; blurRadius: number; spread: number; color: string } | null } | undefined;
        if (ref?.shadow) {
          fix.css = `box-shadow: ${ref.shadow.xOffset}px ${ref.shadow.yOffset}px ${ref.shadow.blurRadius}px ${ref.shadow.spread}px ${ref.shadow.color};`;
        } else {
          fix.css = "box-shadow: none;";
        }
        break;
      }
      case "GRADIENT_MISMATCH": {
        const ref = issue.reference as { gradient: { type: string; angle: number | null; stops: Array<{ color: string; position: number }> } | null } | undefined;
        if (ref?.gradient) {
          const stops = ref.gradient.stops.map((s) => `${s.color} ${Math.round(s.position * 100)}%`).join(", ");
          const direction = ref.gradient.type === "linear" && ref.gradient.angle != null ? `${ref.gradient.angle}deg, ` : "";
          fix.css = `background: ${ref.gradient.type}-gradient(${direction}${stops});`;
        } else {
          fix.css = "background: none; /* remove gradient */";
        }
        break;
      }
      case "FONT_SIZE_MISMATCH": {
        const ref = issue.reference as { fontSize: number } | undefined;
        if (ref) {
          fix.css = `font-size: ${ref.fontSize}px;`;
        }
        break;
      }
      case "FONT_WEIGHT_MISMATCH": {
        const ref = issue.reference as { fontWeight: number } | undefined;
        if (ref) {
          fix.css = `font-weight: ${ref.fontWeight};`;
        }
        break;
      }
      case "FONT_FAMILY_MISMATCH": {
        const ref = issue.reference as { fontFamilyCandidates: Array<{ family: string; confidence: number }> } | undefined;
        if (ref?.fontFamilyCandidates?.length) {
          const stack = ref.fontFamilyCandidates.slice(0, 2).map((c) => `"${c.family}"`).join(", ");
          fix.css = `font-family: ${stack}, sans-serif;`;
        }
        break;
      }
      case "SPACING_MISMATCH": {
        if (issue.suggestedFix) {
          fix.description = issue.suggestedFix;
        }
        break;
      }
    }

    fixes.push(fix);
  }

  return fixes;
}

const issueCategoryMap: Record<string, string> = {
  DIMENSION_MISMATCH: "layout",
  PIXEL_DIFFERENCE: "visual",
  POSITION_MISMATCH: "layout",
  SIZE_MISMATCH: "layout",
  SPACING_MISMATCH: "spacing",
  BORDER_RADIUS_MISMATCH: "style",
  FONT_SIZE_MISMATCH: "typography",
  FONT_WEIGHT_MISMATCH: "typography",
  FONT_FAMILY_MISMATCH: "typography",
  COLOR_MISMATCH: "style",
  SHADOW_MISMATCH: "style",
  GRADIENT_MISMATCH: "style",
  MISSING_NODE: "structure",
  EXTRA_NODE: "structure",
  LAYOUT_COUNT_MISMATCH: "structure",
  TEXT_COUNT_MISMATCH: "structure"
};
