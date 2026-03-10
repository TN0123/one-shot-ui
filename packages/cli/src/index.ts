#!/usr/bin/env bun
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { Command } from "commander";
import {
  VERSION,
  buildImplementationPlan,
  buildSemanticAnchors,
  extractReportSchema,
  type Bounds,
  type LayoutNode
} from "@one-shot-ui/core";
import { generateDesignTokens } from "@one-shot-ui/core/tokens";
import { captureScreenshot } from "@one-shot-ui/browser-capture";
import { compareImages, type CompareImagesOptions } from "@one-shot-ui/diff-engine";
import { calculateActivePixelRatio, detectBackgroundColor, loadImage } from "@one-shot-ui/image-io";
import { clusterComponents } from "@one-shot-ui/vision-components";
import { detectLayoutBoxes, detectLayoutStrategy, measureSpacing } from "@one-shot-ui/vision-layout";
import { detectGradient, detectShadow, estimateBorderRadius, estimateNodeFill, extractDominantColors } from "@one-shot-ui/vision-style";
import { extractText } from "@one-shot-ui/vision-text";
import { labelNodes } from "@one-shot-ui/semantic-label";
import { compareDomToExtract, extractDomTree } from "@one-shot-ui/dom-diff";

const program = new Command();
program.name("one-shot-ui").description("Deterministic UI extraction and diff toolkit").version(VERSION);

program
  .command("extract")
  .argument("<imagePath>", "Path to the reference screenshot")
  .option("--json", "Print full JSON report", false)
  .option("--no-ocr", "Disable OCR text extraction")
  .option("--label", "Enable semantic node labeling (heuristic; provide adapter for LLM)", false)
  .action(async (imagePath, options) => {
    const report = await extractImageReport(imagePath, {
      disableOcr: options.ocr === false,
      enableLabeling: options.label
    });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`Extracted ${report.layout.length} layout regions and ${report.text.length} text blocks from ${report.image.path}`);
    console.log(`Top colors: ${report.colors.slice(0, 4).map((color) => color.hex).join(", ")}`);
    if (report.layoutStrategy) {
      console.log(`Layout strategy: ${report.layoutStrategy.type} (confidence: ${(report.layoutStrategy.confidence * 100).toFixed(0)}%)`);
    }
    if (report.semanticAnchors?.length) {
      console.log(`Semantic anchors: ${report.semanticAnchors.slice(0, 4).map((anchor) => anchor.name).join(", ")}`);
    }
    if (report.semanticLabels?.length) {
      console.log(`Semantic labels: ${report.semanticLabels.length} nodes labeled`);
    }
  });

program
  .command("compare")
  .argument("<referencePath>", "Path to the reference screenshot")
  .argument("<implementationPath>", "Path to the implementation screenshot")
  .option("--json", "Print full JSON report", false)
  .option("--heatmap <path>", "Path to write the diff heatmap")
  .option("--top <n>", "Maximum number of issues to report", "20")
  .option("--no-ocr", "Disable OCR text extraction")
  .option("--region <anchorName>", "Compare only a named semantic anchor from the reference image")
  .option("--crop <x,y,width,height>", "Compare only a cropped rectangle")
  .option("--dom-diff <url>", "Enable DOM-level comparison against a live URL or file path")
  .action(async (referencePath, implementationPath, options) => {
    const compareOpts: CompareImagesOptions = {
      heatmapPath: options.heatmap,
      top: Number.parseInt(options.top, 10),
      disableOcr: options.ocr === false,
      region: options.region,
      crop: parseCropBounds(options.crop)
    };

    const report = await compareImages(referencePath, implementationPath, compareOpts);

    // DOM-level comparison if requested
    if (options.domDiff) {
      try {
        const referenceReport = await extractImageReport(referencePath, {
          disableOcr: options.ocr === false
        });
        const isFile = !options.domDiff.startsWith("http");
        const domTree = await extractDomTree({
          url: isFile ? undefined : options.domDiff,
          filePath: isFile ? resolve(options.domDiff) : undefined
        });
        const scopedLayout = scopeLayout(referenceReport.layout, compareOpts.crop, compareOpts.region, referenceReport.semanticAnchors ?? []);
        const domIssues = compareDomToExtract(domTree, scopedLayout, referenceReport.semanticAnchors ?? []);
        report.issues = prioritizeDomIssues(domIssues, report.issues, Number.parseInt(options.top, 10));
      } catch (err) {
        console.error(`DOM diff failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`Mismatch ratio: ${(report.summary.mismatchRatio * 100).toFixed(2)}%`);
    console.log(`Issues: ${report.issues.length}`);
    for (const issue of report.issues.slice(0, Math.min(8, report.issues.length))) {
      const prefix = issue.anchorName ? `${issue.anchorName}: ` : "";
      console.log(`- [${issue.severity}] ${prefix}${issue.message}`);
      if (issue.suggestedFix) {
        console.log(`  fix: ${issue.suggestedFix}`);
      }
    }
    if (report.artifacts.heatmapPath) {
      console.log(`Heatmap: ${report.artifacts.heatmapPath}`);
    }
  });

program
  .command("tokens")
  .argument("<imagePath>", "Path to the reference screenshot")
  .option("--json", "Print full JSON report", false)
  .option("--no-ocr", "Disable OCR text extraction")
  .action(async (imagePath, options) => {
    const report = await extractImageReport(imagePath, {
      disableOcr: options.ocr === false
    });
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
  .command("plan")
  .argument("<imagePath>", "Path to the reference screenshot")
  .option("--json", "Print full JSON report", false)
  .option("--no-ocr", "Disable OCR text extraction")
  .action(async (imagePath, options) => {
    const report = await extractImageReport(imagePath, {
      disableOcr: options.ocr === false
    });

    if (options.json) {
      console.log(JSON.stringify({ version: VERSION, implementationPlan: report.implementationPlan }, null, 2));
      return;
    }

    const plan = report.implementationPlan;
    if (!plan) {
      console.log("No implementation plan was generated.");
      return;
    }
    console.log(`Primary strategy: ${plan.page.primaryStrategy ?? report.layoutStrategy?.type ?? "unknown"}`);
    for (const note of plan.page.notes) {
      console.log(`- Note: ${note}`);
    }
    for (const primitive of plan.cssPrimitives) {
      console.log(`- CSS: ${primitive}`);
    }
    for (const pattern of plan.repeatedPatterns) {
      console.log(`- Pattern: ${pattern}`);
    }
    if (plan.typography.weak) {
      console.log(`- Typography warning: ${plan.typography.notes.join(" ")}`);
    }
  });

program
  .command("suggest-fixes")
  .argument("<referencePath>", "Path to the reference screenshot")
  .argument("<implementationPath>", "Path to the implementation screenshot")
  .option("--json", "Print full JSON report", false)
  .option("--top <n>", "Maximum number of fixes to report", "20")
  .option("--no-ocr", "Disable OCR text extraction")
  .option("--region <anchorName>", "Suggest fixes for a named semantic anchor only")
  .option("--crop <x,y,width,height>", "Suggest fixes for a cropped rectangle only")
  .option("--dom-diff <url>", "Enable DOM-level comparison against a live URL or file path")
  .action(async (referencePath, implementationPath, options) => {
    const compareOpts: CompareImagesOptions = {
      top: Number.parseInt(options.top, 10),
      disableOcr: options.ocr === false,
      region: options.region,
      crop: parseCropBounds(options.crop)
    };

    const report = await compareImages(referencePath, implementationPath, compareOpts);

    // DOM-level comparison if requested
    if (options.domDiff) {
      try {
        const referenceReport = await extractImageReport(referencePath, {
          disableOcr: options.ocr === false
        });
        const isFile = !options.domDiff.startsWith("http");
        const domTree = await extractDomTree({
          url: isFile ? undefined : options.domDiff,
          filePath: isFile ? resolve(options.domDiff) : undefined
        });
        const scopedLayout = scopeLayout(referenceReport.layout, compareOpts.crop, compareOpts.region, referenceReport.semanticAnchors ?? []);
        const domIssues = compareDomToExtract(domTree, scopedLayout, referenceReport.semanticAnchors ?? []);
        report.issues = prioritizeDomIssues(domIssues, report.issues, Number.parseInt(options.top, 10));
      } catch (err) {
        console.error(`DOM diff failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const fixes = generateImplementationGuidance(report);
    if (options.json) {
      console.log(JSON.stringify({ version: VERSION, fixes }, null, 2));
      return;
    }

    console.log(`${fixes.length} suggested fixes (ordered by priority):\n`);
    for (const fix of fixes) {
      const label = fix.anchorName ? `${fix.anchorName} · ` : "";
      console.log(`[${fix.priority}] ${fix.category}: ${label}${fix.description}`);
      if (fix.css) console.log(`  CSS: ${fix.css}`);
      if (fix.cssSelector) console.log(`  Selector: ${fix.cssSelector}`);
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

interface ExtractOptions {
  disableOcr?: boolean;
  enableLabeling?: boolean;
}

async function extractImageReport(imagePath: string, options?: ExtractOptions) {
  const normalizedPath = resolve(imagePath);
  const image = await loadImage(normalizedPath);
  const backgroundHex = detectBackgroundColor(image);
  const layout = enrichLayoutNodes(image, detectLayoutBoxes(image), backgroundHex);
  const clustered = clusterComponents(layout);
  const layoutStrategy = detectLayoutStrategy(clustered.nodes);

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
    text: await extractText(normalizedPath, { disableOcr: options?.disableOcr }),
    spacing: measureSpacing(clustered.nodes),
    components: clustered.components,
    layoutStrategy,
    diagnostics: {
      background: backgroundHex,
      activePixelRatio: calculateActivePixelRatio(image)
    }
  };

  const tokens = generateDesignTokens(baseReport as any);
  const semanticAnchors = buildSemanticAnchors(clustered.nodes, baseReport.text, {
    width: image.width,
    height: image.height
  });
  const implementationPlan = buildImplementationPlan({
    layout: clustered.nodes,
    text: baseReport.text,
    layoutStrategy,
    semanticAnchors
  });
  let report: any = { ...baseReport, tokens, semanticAnchors, implementationPlan };

  // Semantic labeling
  if (options?.enableLabeling) {
    const labels = await labelNodes(normalizedPath, clustered.nodes);
    report = { ...report, semanticLabels: labels };
  }

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

function parseCropBounds(raw: string | undefined): Bounds | undefined {
  if (!raw) {
    return undefined;
  }
  const parts = raw.split(",").map((value) => Number.parseInt(value.trim(), 10));
  if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) {
    throw new Error(`Invalid crop value "${raw}". Expected x,y,width,height.`);
  }
  return {
    x: parts[0]!,
    y: parts[1]!,
    width: parts[2]!,
    height: parts[3]!
  };
}

function scopeLayout(
  layout: LayoutNode[],
  crop: Bounds | undefined,
  region: string | undefined,
  anchors: Array<{ name: string; bounds: Bounds }>
): LayoutNode[] {
  const focus = crop ?? resolveRegionBounds(region, anchors);
  if (!focus) {
    return layout;
  }
  return layout.filter((node) => intersects(node.bounds, focus));
}

function resolveRegionBounds(region: string | undefined, anchors: Array<{ name: string; bounds: Bounds }>): Bounds | undefined {
  if (!region) {
    return undefined;
  }
  const normalized = region.trim().toLowerCase();
  const match = anchors.find((anchor) => anchor.name.toLowerCase() === normalized) ??
    anchors.find((anchor) => anchor.name.toLowerCase().includes(normalized));
  return match?.bounds;
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
}

function prioritizeDomIssues<T extends { code: string }>(domIssues: T[], fallbackIssues: T[], top: number): T[] {
  const deduped = new Map<string, T>();
  for (const issue of [...domIssues, ...fallbackIssues]) {
    const key = JSON.stringify([issue.code, (issue as any).anchorName, (issue as any).cssSelector, (issue as any).message]);
    if (!deduped.has(key)) {
      deduped.set(key, issue);
    }
  }
  return [...deduped.values()].slice(0, top);
}

type ImplementationFix = {
  priority: "high" | "medium" | "low";
  category: string;
  nodeId?: string;
  anchorName?: string;
  description: string;
  css?: string;
  cssSelector?: string;
};

function generateImplementationGuidance(report: { issues: Array<{ code: string; nodeId?: string; anchorName?: string; severity: string; message: string; suggestedFix?: string; cssProperty?: string; cssSelector?: string; reference?: unknown; implementation?: unknown }> }): ImplementationFix[] {
  const fixes: ImplementationFix[] = [];

  for (const issue of report.issues) {
    const fix: ImplementationFix = {
      priority: issue.severity as "high" | "medium" | "low",
      category: issueCategoryMap[issue.code] ?? "general",
      nodeId: issue.nodeId,
      anchorName: issue.anchorName,
      description: issue.message,
      cssSelector: issue.cssSelector
    };

    // DOM-level issues already have CSS-specific suggestions
    if (issue.code.startsWith("DOM_") && issue.suggestedFix) {
      fix.css = issue.suggestedFix;
      fixes.push(fix);
      continue;
    }

    // Generate CSS-specific guidance based on issue type
    switch (issue.code) {
      case "POSITION_MISMATCH": {
        if (issue.suggestedFix) {
          fix.css = issue.suggestedFix;
        }
        break;
      }
      case "SIZE_MISMATCH": {
        if (issue.suggestedFix) {
          fix.css = issue.suggestedFix;
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
          fix.css = issue.suggestedFix;
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
  TEXT_COUNT_MISMATCH: "structure",
  DOM_POSITION_MISMATCH: "dom-layout",
  DOM_SIZE_MISMATCH: "dom-layout",
  DOM_STYLE_MISMATCH: "dom-style"
};
