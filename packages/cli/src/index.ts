#!/usr/bin/env bun
import { dirname, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { Command } from "commander";

function ensureChromium(): void {
  try {
    execSync("npx playwright install --dry-run chromium", { stdio: "ignore" });
  } catch {
    console.error(
      "Chromium is not installed. Run:\n\n  npx playwright install chromium\n"
    );
    process.exit(1);
  }
}
import {
  VERSION,
  benchmarkManifestSchema,
  benchmarkSuiteReportSchema,
  buildImplementationPlan,
  buildSemanticAnchors,
  extractReportSchema,
  type BenchmarkCaseResult,
  type BenchmarkRegionResult,
  type Bounds,
  type LayoutNode
} from "@one-shot-ui/core";
import { generateDesignTokens } from "@one-shot-ui/core/tokens";
import { captureScreenshot } from "@one-shot-ui/browser-capture";
import { compareImages, type CompareImagesOptions } from "@one-shot-ui/diff-engine";
import { calculateActivePixelRatio, detectBackgroundColor, loadImage } from "@one-shot-ui/image-io";
import { clusterComponents } from "@one-shot-ui/vision-components";
import { buildLayoutHierarchy, detectLayoutBoxes, detectLayoutBoxesFine, detectLayoutStrategy, measureSpacing } from "@one-shot-ui/vision-layout";
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
  .option("--overlay", "Include structured overlay annotations for LLM vision cross-referencing", false)
  .option("--fine", "Use fine-grained (4px) layout detection for small details", false)
  .action(async (imagePath, options) => {
    const report = await extractImageReport(imagePath, {
      disableOcr: options.ocr === false,
      enableLabeling: options.label,
      enableOverlay: options.overlay,
      fineGrid: options.fine
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
    if (report.topEditCandidates?.length) {
      console.log(`\nTop edit candidates:`);
      for (const candidate of report.topEditCandidates) {
        const selector = candidate.cssSelector ? ` (${candidate.cssSelector})` : "";
        console.log(`  ${candidate.rank}. [${candidate.estimatedImpact}]${selector} ${candidate.description}`);
        for (const css of candidate.cssChanges) {
          console.log(`     ${css}`);
        }
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
  .command("scaffold")
  .argument("<imagePath>", "Path to the reference screenshot")
  .option("--json", "Print full JSON report", false)
  .option("--react", "Generate React component hierarchy", false)
  .option("--no-ocr", "Disable OCR text extraction")
  .option("--output <dir>", "Directory to write scaffold files")
  .option("--mode <mode>", "Scaffold layout mode: absolute or structured", "structured")
  .action(async (imagePath, options) => {
    const report = await extractImageReport(imagePath, {
      disableOcr: options.ocr === false
    });

    const { generateHtmlScaffold, generateReactScaffold } = await import("@one-shot-ui/core/scaffold");

    const scaffold = generateHtmlScaffold(
      report.implementationPlan!,
      report.semanticAnchors ?? [],
      report.tokens ?? [],
      report.layout,
      report.text,
      options.mode ?? "structured"
    );

    if (options.react) {
      const reactOutput = generateReactScaffold(
        report.implementationPlan!,
        report.semanticAnchors ?? [],
        report.tokens ?? [],
        report.layout,
        report.text,
        report.components
      );
      scaffold.react = reactOutput;
    }

    if (options.output) {
      const outputDir = resolve(options.output);
      await mkdir(outputDir, { recursive: true });
      await writeFile(resolve(outputDir, "index.html"), scaffold.html, "utf8");
      await writeFile(resolve(outputDir, "styles.css"), scaffold.css, "utf8");

      if (scaffold.react) {
        for (const file of scaffold.react.files) {
          const filePath = resolve(outputDir, file.path);
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, file.content, "utf8");
        }
      }

      console.log(`Scaffold written to ${outputDir}`);
      if (scaffold.react) {
        console.log(`React files: ${scaffold.react.files.length}`);
      }
      return;
    }

    if (options.json) {
      console.log(JSON.stringify({ version: VERSION, scaffold }, null, 2));
      return;
    }

    console.log(scaffold.html);
  });

program
  .command("run")
  .argument("<referencePath>", "Path to the reference screenshot")
  .requiredOption("--impl <path>", "Path to implementation HTML file or URL")
  .option("--output <dir>", "Working directory for intermediate files", "./one-shot-run")
  .option("--max-passes <n>", "Maximum refinement passes", "5")
  .option("--threshold <ratio>", "Convergence threshold (mismatch ratio)", "0.02")
  .option("--no-ocr", "Disable OCR text extraction")
  .option("--json", "Print session log as JSON", false)
  .action(async (referencePath, options) => {
    ensureChromium();
    const outputDir = resolve(options.output);
    await mkdir(outputDir, { recursive: true });

    const maxPasses = Number.parseInt(options.maxPasses, 10);
    const threshold = Number.parseFloat(options.threshold);
    const sessionLog: SessionEntry[] = [];

    console.log(`Starting multi-pass orchestration...`);
    console.log(`Reference: ${referencePath}`);
    console.log(`Implementation: ${options.impl}`);
    console.log(`Max passes: ${maxPasses}, Convergence threshold: ${(threshold * 100).toFixed(1)}%`);
    console.log();

    // Step 1: Extract reference
    console.log(`[Pass 0] Extracting reference...`);
    const referenceReport = await extractImageReport(resolve(referencePath), {
      disableOcr: options.ocr === false
    });

    sessionLog.push({
      pass: 0,
      phase: "extract",
      timestamp: new Date().toISOString(),
      result: {
        layoutNodes: referenceReport.layout.length,
        textBlocks: referenceReport.text.length,
        anchors: referenceReport.semanticAnchors?.length ?? 0
      }
    });

    let currentMismatchRatio = 1;
    let passNumber = 0;

    while (passNumber < maxPasses && currentMismatchRatio > threshold) {
      passNumber++;
      console.log(`[Pass ${passNumber}] Capturing implementation...`);

      // Capture
      const captureOutput = resolve(outputDir, `pass-${passNumber}-capture.png`);
      try {
        const isFile = !options.impl.startsWith("http");
        await captureScreenshot({
          url: isFile ? undefined : options.impl,
          filePath: isFile ? resolve(options.impl) : undefined,
          outputPath: captureOutput,
          width: 1440,
          height: 1024,
          deviceScaleFactor: 1
        });
      } catch (err) {
        console.error(`Capture failed: ${err instanceof Error ? err.message : String(err)}`);
        sessionLog.push({
          pass: passNumber,
          phase: "capture",
          timestamp: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err)
        });
        break;
      }

      // Compare
      console.log(`[Pass ${passNumber}] Comparing...`);
      const heatmapPath = resolve(outputDir, `pass-${passNumber}-heatmap.png`);
      const compareReport = await compareImages(resolve(referencePath), captureOutput, {
        heatmapPath,
        top: 20,
        disableOcr: options.ocr === false
      });

      currentMismatchRatio = compareReport.summary.mismatchRatio;

      sessionLog.push({
        pass: passNumber,
        phase: "compare",
        timestamp: new Date().toISOString(),
        result: {
          mismatchRatio: currentMismatchRatio,
          issueCount: compareReport.issues.length,
          topIssues: compareReport.issues.slice(0, 5).map(i => ({
            code: i.code,
            severity: i.severity,
            message: i.message
          }))
        }
      });

      console.log(`  Mismatch: ${(currentMismatchRatio * 100).toFixed(2)}%`);
      console.log(`  Issues: ${compareReport.issues.length}`);

      if (currentMismatchRatio <= threshold) {
        console.log(`\nConverged! Mismatch ratio ${(currentMismatchRatio * 100).toFixed(2)}% <= threshold ${(threshold * 100).toFixed(1)}%`);
        break;
      }

      // Region drill-down after first pass
      if (passNumber >= 2 && referenceReport.semanticAnchors) {
        console.log(`[Pass ${passNumber}] Drilling into regions...`);
        const regionIssues: Array<{ region: string; mismatchRatio: number; issues: any[] }> = [];

        for (const anchor of referenceReport.semanticAnchors.filter(a => a.parentId === null)) {
          try {
            const regionCompare = await compareImages(resolve(referencePath), captureOutput, {
              top: 8,
              disableOcr: options.ocr === false,
              region: anchor.name
            });

            if (regionCompare.summary.mismatchRatio > threshold) {
              regionIssues.push({
                region: anchor.name,
                mismatchRatio: regionCompare.summary.mismatchRatio,
                issues: regionCompare.issues.slice(0, 3)
              });
            }
          } catch {
            // Skip regions that fail
          }
        }

        if (regionIssues.length > 0) {
          sessionLog.push({
            pass: passNumber,
            phase: "drill-down",
            timestamp: new Date().toISOString(),
            result: { regionIssues }
          });

          console.log(`  Region drill-down:`);
          for (const ri of regionIssues.sort((a, b) => b.mismatchRatio - a.mismatchRatio)) {
            console.log(`    ${ri.region}: ${(ri.mismatchRatio * 100).toFixed(1)}% mismatch`);
          }
        }
      }

      // Write compare report for this pass
      await writeFile(
        resolve(outputDir, `pass-${passNumber}-report.json`),
        JSON.stringify(compareReport, null, 2),
        "utf8"
      );

      // Write next-actions artifact for this pass
      const nextActions = buildNextActions(compareReport, passNumber);
      await writeFile(
        resolve(outputDir, `pass-${passNumber}-next-actions.json`),
        JSON.stringify(nextActions, null, 2),
        "utf8"
      );

      console.log(`  Heatmap: ${heatmapPath}`);
      console.log();
    }

    // Write session log
    const convergenceSummary = buildConvergenceSummary(sessionLog, threshold);
    const sessionReport = {
      version: VERSION,
      reference: resolve(referencePath),
      implementation: options.impl,
      totalPasses: passNumber,
      finalMismatchRatio: currentMismatchRatio,
      converged: currentMismatchRatio <= threshold,
      threshold,
      convergenceSummary,
      log: sessionLog
    };

    await writeFile(
      resolve(outputDir, "session.json"),
      JSON.stringify(sessionReport, null, 2),
      "utf8"
    );

    if (options.json) {
      console.log(JSON.stringify(sessionReport, null, 2));
    } else {
      console.log(`\nSession complete.`);
      console.log(`  Passes: ${passNumber}`);
      console.log(`  Final mismatch: ${(currentMismatchRatio * 100).toFixed(2)}%`);
      console.log(`  Converged: ${currentMismatchRatio <= threshold ? "yes" : "no"}`);
      console.log(`  Trend: ${convergenceSummary.trend}`);
      if (convergenceSummary.message) {
        console.log(`  ${convergenceSummary.message}`);
      }
      console.log(`  Session log: ${resolve(outputDir, "session.json")}`);
    }
  });

program
  .command("benchmark")
  .argument("<manifestPath>", "Path to a benchmark manifest JSON file")
  .option("--json", "Print full JSON report", false)
  .option("--output <path>", "Path to write the benchmark report JSON")
  .option("--no-ocr", "Disable OCR text extraction")
  .action(async (manifestPath, options) => {
    const report = await runBenchmarkSuite(manifestPath, {
      disableOcr: options.ocr === false
    });

    if (options.output) {
      const outputPath = resolve(options.output);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
    }

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`Cases: ${report.summary.caseCount} total, ${report.summary.comparableCaseCount} comparable`);
    if (report.summary.averageMismatchRatio != null) {
      console.log(`Average mismatch ratio: ${(report.summary.averageMismatchRatio * 100).toFixed(2)}%`);
    }
    console.log(`Average planning usefulness: ${(report.summary.averagePlanningUsefulness * 100).toFixed(0)}%`);
    console.log(`Average anchor coverage: ${(report.summary.averageAnchorCoverage * 100).toFixed(0)}%`);
    if (report.summary.averageRoiReliability != null) {
      console.log(`Average ROI reliability: ${(report.summary.averageRoiReliability * 100).toFixed(0)}%`);
    }
    if (report.summary.averageDomSelectorIssueRatio != null) {
      console.log(`Average DOM selector issue ratio: ${(report.summary.averageDomSelectorIssueRatio * 100).toFixed(0)}%`);
    }

    for (const caseResult of report.cases) {
      const mismatch = caseResult.pixelMismatchRatio == null
        ? "n/a"
        : `${(caseResult.pixelMismatchRatio * 100).toFixed(2)}%`;
      console.log(`- ${caseResult.id}: mismatch ${mismatch}, plan ${(caseResult.planningUsefulness.score * 100).toFixed(0)}%, anchors ${(caseResult.anchorCoverage.realShare * 100).toFixed(0)}%`);
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
    ensureChromium();
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
  enableOverlay?: boolean;
  fineGrid?: boolean;
}

interface SessionEntry {
  pass: number;
  phase: string;
  timestamp: string;
  result?: any;
  error?: string;
}

async function extractImageReport(imagePath: string, options?: ExtractOptions) {
  const normalizedPath = resolve(imagePath);
  const image = await loadImage(normalizedPath);
  const backgroundHex = detectBackgroundColor(image);
  const rawNodes = options?.fineGrid ? detectLayoutBoxesFine(image) : detectLayoutBoxes(image);
  const layout = enrichLayoutNodes(image, rawNodes, backgroundHex);
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
  const hierarchy = buildLayoutHierarchy(clustered.nodes);
  let report: any = { ...baseReport, tokens, semanticAnchors, implementationPlan, hierarchy };

  // Semantic labeling
  if (options?.enableLabeling) {
    const labels = await labelNodes(normalizedPath, clustered.nodes);
    report = { ...report, semanticLabels: labels };
  }

  // Overlay annotations for LLM vision augmentation
  if (options?.enableOverlay) {
    const { buildOverlayAnnotations } = await import("@one-shot-ui/core/overlay");
    const annotations = buildOverlayAnnotations(clustered.nodes, semanticAnchors, baseReport.spacing, baseReport.text);
    report = { ...report, annotations };
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
  REGION_SEMANTIC_FALLBACK: "region",
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

async function runBenchmarkSuite(manifestPath: string, options: ExtractOptions): Promise<ReturnType<typeof benchmarkSuiteReportSchema.parse>> {
  const normalizedManifestPath = resolve(manifestPath);
  const rawManifest = await readFile(normalizedManifestPath, "utf8");
  const manifest = benchmarkManifestSchema.parse(JSON.parse(rawManifest));
  const caseResults: BenchmarkCaseResult[] = [];

  for (const benchmarkCase of manifest.cases) {
    const referencePath = resolve(benchmarkCase.referencePath);
    const referenceReport = await extractImageReport(referencePath, options);
    const anchorCoverage = summarizeAnchorCoverage(referenceReport.semanticAnchors ?? [], referenceReport.image.width, referenceReport.image.height);
    const planningUsefulness = summarizePlanningUsefulness(referenceReport.implementationPlan);
    const typographyReliability = referenceReport.implementationPlan?.typography.confidence ?? 0;

    let pixelMismatchRatio: number | null = null;
    let compareIssueCount = 0;
    let domSelectorIssueRatio: number | null = null;
    let domIssueCount: number | null = null;
    const regionResults: BenchmarkRegionResult[] = [];

    if (benchmarkCase.implementationPath) {
      const implementationPath = resolve(benchmarkCase.implementationPath);
      const fullCompare = await compareImages(referencePath, implementationPath, {
        disableOcr: options.disableOcr,
        top: 20
      });
      pixelMismatchRatio = fullCompare.summary.mismatchRatio;
      compareIssueCount = fullCompare.issues.length;

      if (benchmarkCase.domDiffPath) {
        try {
          const isFile = !benchmarkCase.domDiffPath.startsWith("http");
          const domTree = await extractDomTree({
            url: isFile ? undefined : benchmarkCase.domDiffPath,
            filePath: isFile ? resolve(benchmarkCase.domDiffPath) : undefined
          });
          const domIssues = compareDomToExtract(domTree, referenceReport.layout, referenceReport.semanticAnchors ?? []);
          domIssueCount = domIssues.length;
          domSelectorIssueRatio = domIssues.length === 0
            ? 0
            : domIssues.filter((issue) => Boolean(issue.cssSelector)).length / domIssues.length;
        } catch {
          domIssueCount = 0;
          domSelectorIssueRatio = 0;
        }
      }

      for (const region of benchmarkCase.regions ?? []) {
        const regionCompare = await compareImages(referencePath, implementationPath, {
          disableOcr: options.disableOcr,
          top: 12,
          region: region.name
        });
        const withinRegionIssueRatio = scoreRegionIssueContainment(regionCompare.issues, referenceReport.semanticAnchors ?? [], region.name);
        regionResults.push({
          name: region.name,
          mismatchRatio: regionCompare.summary.mismatchRatio,
          issueCount: regionCompare.issues.length,
          semanticCoverage: regionCompare.summary.focus?.semanticCoverage ?? 0,
          fallbackToPixelOnly: regionCompare.summary.focus?.fallbackToPixelOnly ?? false,
          withinRegionIssueRatio,
          passed: region.maxMismatchRatio == null
            ? null
            : regionCompare.summary.mismatchRatio <= region.maxMismatchRatio
        });
      }
    }

    caseResults.push({
      id: benchmarkCase.id,
      name: benchmarkCase.name,
      tags: benchmarkCase.tags ?? [],
      referencePath,
      implementationPath: benchmarkCase.implementationPath ? resolve(benchmarkCase.implementationPath) : null,
      pixelMismatchRatio,
      compareIssueCount,
      anchorCoverage,
      planningUsefulness,
      typographyReliability,
      domDiffUsefulness: {
        selectorIssueRatio: domSelectorIssueRatio,
        issueCount: domIssueCount
      },
      regions: regionResults
    });
  }

  const comparableCases = caseResults.filter((caseResult) => caseResult.pixelMismatchRatio != null);
  const roiCases = caseResults.flatMap((caseResult) => caseResult.regions).filter((region) => region.withinRegionIssueRatio != null);
  const domCases = caseResults.map((caseResult) => caseResult.domDiffUsefulness.selectorIssueRatio).filter((value): value is number => value != null);

  return benchmarkSuiteReportSchema.parse({
    version: VERSION,
    generatedAt: new Date().toISOString(),
    manifestPath: normalizedManifestPath,
    summary: {
      caseCount: caseResults.length,
      comparableCaseCount: comparableCases.length,
      averageMismatchRatio: average(comparableCases.map((caseResult) => caseResult.pixelMismatchRatio!)),
      averagePlanningUsefulness: average(caseResults.map((caseResult) => caseResult.planningUsefulness.score)) ?? 0,
      averageTypographyReliability: average(caseResults.map((caseResult) => caseResult.typographyReliability)) ?? 0,
      averageAnchorCoverage: average(caseResults.map((caseResult) => caseResult.anchorCoverage.realShare)) ?? 0,
      averageRoiReliability: average(roiCases.map((region) => region.withinRegionIssueRatio!)),
      averageDomSelectorIssueRatio: average(domCases)
    },
    cases: caseResults
  });
}

function summarizeAnchorCoverage(
  anchors: Array<{ nodeId: string | null; bounds: Bounds }>,
  pageWidth: number,
  pageHeight: number
) {
  const realAnchors = anchors.filter((anchor) => anchor.nodeId !== null);
  const syntheticAnchors = anchors.filter((anchor) => anchor.nodeId === null);
  const pageArea = Math.max(1, pageWidth * pageHeight);
  const realAreaRatio = Math.min(1, realAnchors.reduce((sum, anchor) => sum + (anchor.bounds.width * anchor.bounds.height), 0) / pageArea);
  const total = Math.max(1, anchors.length);
  return {
    realCount: realAnchors.length,
    syntheticCount: syntheticAnchors.length,
    realAreaRatio,
    realShare: realAnchors.length / total
  };
}

function summarizePlanningUsefulness(plan: Awaited<ReturnType<typeof extractImageReport>>["implementationPlan"]) {
  const nodeCount = plan?.nodes.length ?? 0;
  const cssPrimitiveCount = plan?.cssPrimitives.length ?? 0;
  const repeatedPatternCount = plan?.repeatedPatterns.length ?? 0;
  const typographyConfidence = plan?.typography.confidence ?? 0;
  const strategyScore = plan?.page.primaryStrategy && plan.page.primaryStrategy !== "unknown" ? 0.2 : 0;
  const score = Math.min(
    1,
    strategyScore +
      Math.min(0.35, nodeCount / 20) +
      Math.min(0.2, cssPrimitiveCount / 10) +
      Math.min(0.15, repeatedPatternCount / 8) +
      Math.min(0.1, typographyConfidence * 0.1) +
      (plan?.page.notes.length ? 0.1 : 0)
  );

  return {
    score,
    nodeCount,
    cssPrimitiveCount,
    repeatedPatternCount,
    typographyConfidence
  };
}

function scoreRegionIssueContainment(
  issues: Array<{ anchorName?: string }>,
  anchors: Array<{ name: string; parentId: string | null; id: string }>,
  regionName: string
): number | null {
  if (issues.length === 0) {
    return null;
  }
  const region = anchors.find((anchor) => anchor.name.toLowerCase() === regionName.toLowerCase());
  if (!region) {
    return null;
  }
  const relatedNames = new Set([
    region.name.toLowerCase(),
    ...anchors
      .filter((anchor) => anchor.parentId === region.id)
      .map((anchor) => anchor.name.toLowerCase())
  ]);
  const matchingIssues = issues.filter((issue) => {
    if (!issue.anchorName) {
      return false;
    }
    const normalized = issue.anchorName.toLowerCase();
    return relatedNames.has(normalized) || normalized.includes(region.name.toLowerCase());
  });
  return matchingIssues.length / issues.length;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildNextActions(compareReport: any, passNumber: number) {
  const issues = compareReport.issues ?? [];
  const topEditCandidates = compareReport.topEditCandidates ?? [];

  // Build machine-readable patches/suggestions
  const patches: Array<{
    priority: number;
    anchorName?: string;
    cssSelector?: string;
    action: string;
    cssProperties: Record<string, string>;
    issueCode: string;
  }> = [];

  for (const [idx, issue] of issues.entries()) {
    if (idx >= 10) break; // Cap at 10 patches per pass

    const patch: typeof patches[number] = {
      priority: idx + 1,
      anchorName: issue.anchorName,
      cssSelector: issue.cssSelector ?? (issue.anchorName ? `.${issue.anchorName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : undefined),
      action: describeAction(issue.code),
      cssProperties: extractCssProperties(issue),
      issueCode: issue.code
    };
    patches.push(patch);
  }

  return {
    version: VERSION,
    pass: passNumber,
    mismatchRatio: compareReport.summary?.mismatchRatio ?? 0,
    patchCount: patches.length,
    patches,
    topEditCandidates: topEditCandidates.slice(0, 5)
  };
}

function describeAction(code: string): string {
  switch (code) {
    case "POSITION_MISMATCH": return "adjust-position";
    case "SIZE_MISMATCH": return "adjust-size";
    case "COLOR_MISMATCH": return "change-color";
    case "BORDER_RADIUS_MISMATCH": return "adjust-border-radius";
    case "SHADOW_MISMATCH": return "adjust-shadow";
    case "GRADIENT_MISMATCH": return "adjust-gradient";
    case "SPACING_MISMATCH": return "adjust-spacing";
    case "FONT_SIZE_MISMATCH": return "adjust-font-size";
    case "FONT_WEIGHT_MISMATCH": return "adjust-font-weight";
    case "FONT_FAMILY_MISMATCH": return "change-font-family";
    case "MISSING_NODE": return "add-element";
    case "EXTRA_NODE": return "remove-element";
    case "DIMENSION_MISMATCH": return "resize-canvas";
    default: return "fix";
  }
}

function extractCssProperties(issue: any): Record<string, string> {
  const props: Record<string, string> = {};
  const ref = issue.reference;

  switch (issue.code) {
    case "POSITION_MISMATCH":
      if (ref?.x != null) props["left"] = `${ref.x}px`;
      if (ref?.y != null) props["top"] = `${ref.y}px`;
      break;
    case "SIZE_MISMATCH":
      if (ref?.width != null) props["width"] = `${ref.width}px`;
      if (ref?.height != null) props["height"] = `${ref.height}px`;
      break;
    case "COLOR_MISMATCH":
      if (ref?.fill) props["background-color"] = ref.fill;
      break;
    case "BORDER_RADIUS_MISMATCH":
      if (ref?.borderRadius != null) props["border-radius"] = `${ref.borderRadius}px`;
      break;
    case "SHADOW_MISMATCH":
      if (ref?.shadow) {
        const s = ref.shadow;
        props["box-shadow"] = `${s.xOffset}px ${s.yOffset}px ${s.blurRadius}px ${s.spread}px ${s.color}`;
      } else {
        props["box-shadow"] = "none";
      }
      break;
    case "FONT_SIZE_MISMATCH":
      if (ref?.fontSize) props["font-size"] = `${ref.fontSize}px`;
      break;
    case "FONT_WEIGHT_MISMATCH":
      if (ref?.fontWeight) props["font-weight"] = `${ref.fontWeight}`;
      break;
    case "SPACING_MISMATCH":
      if (ref?.distance != null) props["gap"] = `${ref.distance}px`;
      break;
  }

  return props;
}

function buildConvergenceSummary(log: SessionEntry[], threshold: number) {
  const comparePasses = log.filter(e => e.phase === "compare" && e.result?.mismatchRatio != null);
  const ratios = comparePasses.map(e => e.result.mismatchRatio as number);

  if (ratios.length < 2) {
    return {
      trend: "insufficient-data" as const,
      improvementRate: 0,
      stalled: false,
      message: ratios.length === 0
        ? "No comparison data available."
        : `Only one pass completed. Mismatch: ${(ratios[0]! * 100).toFixed(2)}%.`
    };
  }

  const firstRatio = ratios[0]!;
  const lastRatio = ratios[ratios.length - 1]!;
  const totalImprovement = firstRatio - lastRatio;
  const improvementRate = totalImprovement / firstRatio;

  // Check if stalled (last two passes within 0.5% of each other)
  const lastTwo = ratios.slice(-2);
  const stalled = Math.abs(lastTwo[0]! - lastTwo[1]!) < 0.005;

  const trend = lastRatio <= threshold ? "converged" :
    stalled ? "stalled" :
    totalImprovement > 0 ? "improving" : "regressing";

  return {
    trend,
    improvementRate: Math.round(improvementRate * 100) / 100,
    stalled,
    ratioHistory: ratios,
    message: trend === "converged"
      ? `Converged at ${(lastRatio * 100).toFixed(2)}% mismatch after ${ratios.length} passes.`
      : trend === "stalled"
      ? `Progress stalled at ${(lastRatio * 100).toFixed(2)}% mismatch. Consider a different approach for remaining issues.`
      : trend === "improving"
      ? `Improving: ${(firstRatio * 100).toFixed(2)}% → ${(lastRatio * 100).toFixed(2)}% (${(improvementRate * 100).toFixed(0)}% improvement).`
      : `Regression detected: ${(firstRatio * 100).toFixed(2)}% → ${(lastRatio * 100).toFixed(2)}%.`
  };
}
