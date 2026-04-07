#!/usr/bin/env bun
import { dirname, resolve, extname, join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";
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
import { captureScreenshot, BlankCaptureError } from "@one-shot-ui/browser-capture";
import { compareImages, type CompareImagesOptions } from "@one-shot-ui/diff-engine";
import { calculateActivePixelRatio, detectBackgroundColor, loadImage, readImageDimensions } from "@one-shot-ui/image-io";
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
  .argument("[imagePath]", "Path to the reference screenshot")
  .option("--image <path>", "Path to the reference screenshot (alternative to positional argument)")
  .option("--json", "Print full JSON report", false)
  .option("--compact", "Output compact, actionable layout summary (default: true)", true)
  .option("--no-compact", "Output full detailed report")
  .option("--no-ocr", "Disable OCR text extraction")
  .option("--label", "Enable semantic node labeling (heuristic; provide adapter for LLM)", false)
  .option("--overlay", "Include structured overlay annotations for LLM vision cross-referencing", false)
  .option("--fine", "Use fine-grained (4px) layout detection for small details", false)
  .action(async (imagePath, options) => {
    const resolvedImagePath = imagePath ?? options.image;
    if (!resolvedImagePath) {
      console.error("Error: missing image path. Usage:\n  one-shot-ui extract <imagePath>\n  one-shot-ui extract --image <path>");
      process.exit(1);
    }
    const report = await extractImageReport(resolvedImagePath, {
      disableOcr: options.ocr === false,
      enableLabeling: options.label,
      enableOverlay: options.overlay,
      fineGrid: options.fine
    });

    if (options.json && options.compact) {
      // Compact JSON: summarized, ≤200 lines
      const compact = buildCompactExtract(report);
      console.log(JSON.stringify(compact, null, 2));
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (options.compact) {
      // Compact text output
      const compact = buildCompactExtract(report);
      console.log(`Image: ${compact.image.width}x${compact.image.height}`);
      console.log(`Background: ${compact.background}`);
      console.log(`\nColors (${compact.colors.length}):`);
      for (const c of compact.colors) {
        console.log(`  ${c.hex} — ${(c.frequency * 100).toFixed(1)}%`);
      }
      if (compact.fontSizes.length) {
        console.log(`\nFont sizes: ${compact.fontSizes.map(f => `${f.size}px (${f.count}x)`).join(", ")}`);
      }
      if (compact.layoutStrategy) {
        console.log(`\nLayout: ${compact.layoutStrategy.type} (${(compact.layoutStrategy.confidence * 100).toFixed(0)}% confidence)`);
      }
      if (compact.gridStructure) {
        console.log(`Grid: ${compact.gridStructure.columns} columns, ${compact.gridStructure.rows} rows`);
      }
      console.log(`\nRegions (${compact.regions.length}):`);
      for (const r of compact.regions) {
        const text = r.textPreview ? ` — "${r.textPreview}"` : "";
        console.log(`  ${r.role} ${r.width}x${r.height} at (${r.x}, ${r.y})${text}`);
      }
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
  .argument("[referencePath]", "Path to the reference screenshot or HTML file")
  .argument("[implementationPath]", "Path to the implementation screenshot or HTML file")
  .option("--reference <path>", "Path to reference screenshot or HTML file (alternative to positional arg)")
  .option("--implementation <path>", "Path to the implementation screenshot or HTML file (alternative to positional arg)")
  .option("--json", "Print full JSON report", false)
  .option("--heatmap <path>", "Path to write the diff heatmap")
  .option("--top <n>", "Maximum number of issues to report", "20")
  .option("--no-ocr", "Disable OCR text extraction")
  .option("--region <anchorName>", "Compare only a named semantic anchor from the reference image")
  .option("--crop <x,y,width,height>", "Compare only a cropped rectangle")
  .option("--dom-diff <url>", "Enable DOM-level comparison against a live URL or file path")
  .option("--auto-resize", "Auto-resize the implementation screenshot to match reference dimensions before comparing", false)
  .option("--previous-mismatch <ratios>", "Comma-separated previous mismatch ratios (e.g. '0.15,0.10') for regression/plateau detection")
  .option("--summary", "Print a single human-readable summary line", false)
  .option("--top-fixes <n>", "Print N highest-impact actionable fixes as plain text", "0")
  .addHelpText("after", `
Examples:
  one-shot-ui compare reference.png implementation.png
  one-shot-ui compare --reference reference.png --implementation implementation.png
  one-shot-ui compare reference.png implementation.html --heatmap diff.png
  one-shot-ui compare reference.png impl.png --top-fixes 5 --summary`)
  .action(async (referencePath, implementationPath, options) => {
    // Resolve reference path from positional arg or --reference flag
    const resolvedRefPath = referencePath ?? options.reference;
    if (!resolvedRefPath) {
      console.error("Error: reference path is required.");
      console.error("");
      console.error("Usage: one-shot-ui compare <reference.png> <implementation.png>");
      console.error("   or: one-shot-ui compare --reference reference.png --implementation implementation.png");
      process.exit(1);
    }

    // Resolve implementation path from positional arg or --implementation flag
    const resolvedImplPath = implementationPath ?? options.implementation;
    if (!resolvedImplPath) {
      console.error("Error: implementation path is required.");
      console.error("");
      console.error("Usage: one-shot-ui compare <reference.png> <implementation.png>");
      console.error("   or: one-shot-ui compare --reference reference.png --implementation implementation.png");
      process.exit(1);
    }

    // Auto-capture HTML/HTM files to screenshots before comparing
    const htmlExts = [".html", ".htm"];
    const tmpCaptures: string[] = [];

    let effectiveRefPath = resolvedRefPath;
    if (htmlExts.some(ext => resolvedRefPath.toLowerCase().endsWith(ext))) {
      // Reference is HTML — capture it (use default 1280x800 viewport)
      const captureDest = resolvedRefPath.replace(/\.(html|htm)$/i, ".ref-capture.png");
      console.error(`Auto-capturing reference HTML: ${resolvedRefPath} → ${captureDest}`);
      await captureScreenshot({ filePath: resolve(resolvedRefPath), outputPath: resolve(captureDest), width: 1280, height: 800, deviceScaleFactor: 1, skipBlankCheck: false });
      effectiveRefPath = captureDest;
      tmpCaptures.push(captureDest);
    }

    let effectiveImplPathResolved = resolvedImplPath;
    if (htmlExts.some(ext => resolvedImplPath.toLowerCase().endsWith(ext))) {
      // Implementation is HTML — capture at reference dimensions
      let captureWidth = 1280;
      let captureHeight = 800;
      try {
        const refDims = await readImageDimensions(resolve(effectiveRefPath));
        captureWidth = refDims.width;
        captureHeight = refDims.height;
      } catch {}
      const captureDest = resolvedImplPath.replace(/\.(html|htm)$/i, ".impl-capture.png");
      console.error(`Auto-capturing implementation HTML: ${resolvedImplPath} → ${captureDest}`);
      await captureScreenshot({ filePath: resolve(resolvedImplPath), outputPath: resolve(captureDest), width: captureWidth, height: captureHeight, deviceScaleFactor: 1, skipBlankCheck: false });
      effectiveImplPathResolved = captureDest;
      tmpCaptures.push(captureDest);
    }

    const finalRefPath = effectiveRefPath;

    // Auto-resize: if enabled, check dimensions and resize implementation to match reference
    let effectiveImplPath = effectiveImplPathResolved;
    if (options.autoResize) {
      const refDims = await readImageDimensions(resolve(finalRefPath));
      const implDims = await readImageDimensions(resolve(resolvedImplPath));
      if (refDims.width !== implDims.width || refDims.height !== implDims.height) {
        const sharp = (await import("sharp")).default;
        const resizedPath = resolvedImplPath.replace(/(\.\w+)$/, `-resized$1`);
        await sharp(resolve(resolvedImplPath))
          .resize(refDims.width, refDims.height, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
          .toFile(resolve(resizedPath));
        console.error(`⚠ Auto-resized implementation from ${implDims.width}x${implDims.height} to ${refDims.width}x${refDims.height} (saved to ${resizedPath})`);
        effectiveImplPath = resizedPath;
      }
    }

    const compareOpts: CompareImagesOptions = {
      heatmapPath: options.heatmap,
      top: Number.parseInt(options.top, 10),
      disableOcr: options.ocr === false,
      region: options.region,
      crop: parseCropBounds(options.crop)
    };

    const report = await compareImages(finalRefPath, effectiveImplPath, compareOpts);

    // DOM-level comparison if requested
    if (options.domDiff) {
      try {
        const referenceReport = await extractImageReport(finalRefPath, {
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

    // Regression and plateau detection from previous mismatch ratios
    const regressionInfo: { regressionWarning?: string; regressionDelta?: number; plateauDetected?: boolean; plateauBreakdown?: string; sessionBestWarning?: string } = {};
    if (options.previousMismatch) {
      const previousRatios = options.previousMismatch
        .split(",")
        .map((s: string) => Number.parseFloat(s.trim()))
        .filter((n: number) => !Number.isNaN(n));
      const currentRatio = report.summary.mismatchRatio;

      if (previousRatios.length > 0) {
        const lastRatio = previousRatios[previousRatios.length - 1]!;
        // Regression: current is worse than last pass
        if (currentRatio > lastRatio) {
          const delta = currentRatio - lastRatio;
          regressionInfo.regressionWarning = `Mismatch increased by ${(delta * 100).toFixed(2)}pp (${(lastRatio * 100).toFixed(2)}% → ${(currentRatio * 100).toFixed(2)}%). Consider reverting the last change.`;
          regressionInfo.regressionDelta = delta;
        }

        // Session-best regression: warn when current is worse than ANY prior pass
        const sessionBest = Math.min(...previousRatios);
        const sessionBestPassIdx = previousRatios.indexOf(sessionBest) + 1; // 1-indexed pass number
        if (currentRatio > sessionBest) {
          const topRegion = report.summary.gridBreakdown?.[0]?.label;
          const regionHint = topRegion ? ` Top regressed region: ${topRegion}.` : "";
          regressionInfo.sessionBestWarning = `⚠ REGRESSION: ${(currentRatio * 100).toFixed(1)}% is worse than your session best of ${(sessionBest * 100).toFixed(1)}% (pass ${sessionBestPassIdx}). Revert recent changes before continuing.${regionHint}`;
        }
      }

      // Plateau: last 2+ previous ratios + current are within 0.5% of each other
      const allRatios = [...previousRatios, currentRatio];
      if (allRatios.length >= 3) {
        const recent = allRatios.slice(-3);
        const maxR = Math.max(...recent);
        const minR = Math.min(...recent);
        if ((maxR - minR) < 0.005) {
          regressionInfo.plateauDetected = true;
          const seg = report.summary.segmented;
          regressionInfo.plateauBreakdown = seg
            ? `Structural: ${(seg.structuralMismatch * 100).toFixed(2)}%, Content: ${(seg.contentMismatch * 100).toFixed(2)}% (${seg.contentRegionCount} regions)`
            : `Remaining mismatch: ${(currentRatio * 100).toFixed(2)}% (no segmented breakdown available)`;
        }
      }
    }

    if (options.summary) {
      const adjustedMismatch = report.summary.adjustedMismatch ?? report.summary.mismatchRatio;
      const rawMismatch = report.summary.rawMismatch ?? report.summary.mismatchRatio;
      const hierarchyScore = report.summary.hierarchyScore ?? 100;
      const ratio = (adjustedMismatch * 100).toFixed(1);
      const dimStatus = report.issues.find(i => i.code === "DIMENSION_MISMATCH") ? "MISMATCH" : "OK";
      const topIssues = report.issues
        .filter(i => i.code !== "DIMENSION_MISMATCH" && i.code !== "PIXEL_DIFFERENCE")
        .slice(0, 3)
        .map(i => i.anchorName ?? i.code.toLowerCase().replace(/_/g, "-"))
        .join(", ");
      const segInfo = report.summary.segmented
        ? ` | Structural: ${(report.summary.segmented.structuralMismatch * 100).toFixed(1)}%`
        : "";
      // Show both adjusted and raw when they differ significantly
      const adjustedTag = Math.abs(adjustedMismatch - rawMismatch) > 0.005
        ? ` (raw: ${(rawMismatch * 100).toFixed(1)}%, adjusted for low structural complexity)`
        : "";
      let summaryLine = `Mismatch: ${ratio}%${adjustedTag} | Dimensions: ${dimStatus}${segInfo} | Top issues: ${topIssues || "none"}`;
      if (hierarchyScore < 50) {
        summaryLine += ` | Warning: Low visual hierarchy score (${hierarchyScore}/100) — implementation may be missing structural content.`;
      }
      // Surface large node count gap in summary line
      {
        const lcIssue = report.issues.find(i => i.code === "LAYOUT_COUNT_MISMATCH");
        if (lcIssue) {
          const rcSumm = (lcIssue.reference as any)?.layoutNodes as number | undefined;
          const icSumm = (lcIssue.implementation as any)?.layoutNodes as number | undefined;
          if (rcSumm != null && icSumm != null && rcSumm - icSumm > 10) {
            summaryLine += ` | STRUCTURE: ${rcSumm} ref nodes vs ${icSumm} built — ${rcSumm - icSumm} may be missing`;
          }
        }
      }
      // Top mismatch region in summary
      if (report.summary.gridBreakdown?.length) {
        const top = report.summary.gridBreakdown[0]!;
        summaryLine += ` | TOP_REGION: ${top.label} (${(top.mismatchRatio * 100).toFixed(1)}% mismatch, ${(top.contribution * 100).toFixed(0)}% of total)`;
      }
      if (regressionInfo.sessionBestWarning) {
        summaryLine += ` | ${regressionInfo.sessionBestWarning}`;
      } else if (regressionInfo.regressionWarning) {
        summaryLine += ` | REGRESSION_WARNING: ${regressionInfo.regressionWarning}`;
      }
      if (regressionInfo.plateauDetected) {
        summaryLine += ` | PLATEAU_DETECTED: ${regressionInfo.plateauBreakdown}`;
      }
      console.log(summaryLine);
      return;
    }

    if (options.json) {
      const output: any = { ...report };
      if (regressionInfo.regressionWarning || regressionInfo.plateauDetected || regressionInfo.sessionBestWarning) {
        output.regressionDetection = regressionInfo;
      }
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    // Surface regression/plateau warnings before other output
    if (regressionInfo.sessionBestWarning) {
      console.log(regressionInfo.sessionBestWarning);
    } else if (regressionInfo.regressionWarning) {
      console.log(`⚠ REGRESSION_WARNING: ${regressionInfo.regressionWarning}`);
    }
    if (regressionInfo.plateauDetected) {
      console.log(`⚠ PLATEAU_DETECTED: Improvement over recent passes < 0.5%. ${regressionInfo.plateauBreakdown}`);
      console.log(`  Remaining mismatch may be irreducible (font rendering, photographic content). Consider stopping.\n`);
    }

    // Surface dimension warning prominently before other output
    const dimIssue = report.issues.find(i => i.code === "DIMENSION_MISMATCH");
    if (dimIssue) {
      const ref = dimIssue.reference as { width: number; height: number } | undefined;
      const impl = dimIssue.implementation as { width: number; height: number } | undefined;
      console.log(`⚠ DIMENSION WARNING: Reference is ${ref?.width}x${ref?.height} but implementation is ${impl?.width}x${impl?.height}.`);
      console.log(`  This inflates the mismatch ratio. Re-capture with:`);
      console.log(`    one-shot-ui capture --file <impl> --output <out> --match-reference ${finalRefPath}`);
      console.log(`  Or manually: one-shot-ui capture --file <impl> --output <out> --width ${ref?.width} --height ${ref?.height}\n`);
    }

    {
      const cmpAdjusted = report.summary.adjustedMismatch ?? report.summary.mismatchRatio;
      const cmpRaw = report.summary.rawMismatch ?? report.summary.mismatchRatio;
      const cmpHierarchy = report.summary.hierarchyScore ?? 100;
      if (report.summary.segmented?.irreducibleEstimate != null) {
        const seg = report.summary.segmented;
        const actionable = Math.max(0, cmpAdjusted - (seg.irreducibleEstimate ?? 0));
        if (Math.abs(cmpAdjusted - cmpRaw) > 0.005) {
          console.log(`Mismatch: ${(cmpAdjusted * 100).toFixed(1)}% (raw: ${(cmpRaw * 100).toFixed(1)}%, adjusted for low structural complexity)`);
        } else {
          console.log(`Mismatch: ${(cmpAdjusted * 100).toFixed(1)}%`);
        }
        console.log(`  Estimated actionable: ~${(actionable * 100).toFixed(1)}%, irreducible content: ~${((seg.irreducibleEstimate ?? 0) * 100).toFixed(1)}%`);
        console.log(`  Structural: ${(seg.structuralMismatch * 100).toFixed(2)}% | Content: ${(seg.contentMismatch * 100).toFixed(2)}% (${seg.contentRegionCount} regions)`);
      } else {
        if (Math.abs(cmpAdjusted - cmpRaw) > 0.005) {
          console.log(`Mismatch: ${(cmpAdjusted * 100).toFixed(2)}% (raw: ${(cmpRaw * 100).toFixed(2)}%, adjusted for low structural complexity)`);
        } else {
          console.log(`Mismatch ratio: ${(cmpAdjusted * 100).toFixed(2)}%`);
        }
        if (report.summary.segmented) {
          const seg = report.summary.segmented;
          console.log(`  Structural: ${(seg.structuralMismatch * 100).toFixed(2)}% | Content (irreducible): ${(seg.contentMismatch * 100).toFixed(2)}% (${seg.contentRegionCount} regions)`);
        }
      }
      if (cmpHierarchy < 50) {
        console.log(`Warning: Low visual hierarchy score (${cmpHierarchy}/100) — implementation may be missing structural content.`);
      }
    }
    console.log(`Issues: ${report.issues.length}`);
    for (const issue of report.issues.slice(0, Math.min(8, report.issues.length))) {
      const prefix = issue.anchorName ? `${issue.anchorName}: ` : "";
      const categoryTag = issue.category ? ` [${issue.category}]` : "";
      const actionableTag = issue.actionable === false ? " (non-actionable)" : "";
      console.log(`- [${issue.severity}]${categoryTag} ${prefix}${issue.message}${actionableTag}`);
      if (issue.suggestedFix && issue.actionable !== false) {
        console.log(`  fix: ${issue.suggestedFix}`);
      }
    }
    if (report.topEditCandidates?.length) {
      console.log(`\nTop edit candidates:`);
      for (const candidate of report.topEditCandidates) {
        const selector = candidate.cssSelector ? ` (${candidate.cssSelector})` : "";
        const riskLabel = (candidate as any).risk === "high"
          ? ` [CAUTION — affects ${(candidate as any).affectedAreaPercent ?? "?"}% of page]`
          : (candidate as any).risk === "medium"
          ? ` [CAUTION — affects ${(candidate as any).affectedAreaPercent ?? "?"}% of page]`
          : "";
        console.log(`  ${candidate.rank}. [${candidate.estimatedImpact}]${riskLabel}${selector} ${candidate.description}`);
        for (const css of candidate.cssChanges) {
          console.log(`     ${css}`);
        }
      }
    }
    // Surface layout node count gap prominently when reference has 10+ more nodes
    const layoutCountIssue = report.issues.find(i => i.code === "LAYOUT_COUNT_MISMATCH");
    if (layoutCountIssue) {
      const refCount = (layoutCountIssue.reference as any)?.layoutNodes as number | undefined;
      const implCount = (layoutCountIssue.implementation as any)?.layoutNodes as number | undefined;
      if (refCount != null && implCount != null && refCount - implCount > 10) {
        console.log(`Structure: ${refCount} reference nodes vs ${implCount} built nodes — ${refCount - implCount} elements may be missing.`);
      }
    }

    // Per-region mismatch breakdown (3×3 grid, top 4 by contribution)
    if (report.summary.gridBreakdown?.length) {
      const top4 = report.summary.gridBreakdown.slice(0, 4);
      console.log(`\nRegion breakdown (top 4 by mismatch contribution):`);
      const maxBarWidth = 12;
      for (const r of top4) {
        const barLen = Math.max(0, Math.round(r.contribution * maxBarWidth));
        const bar = "█".repeat(barLen);
        console.log(`  ${r.label.padEnd(16)} ${(r.mismatchRatio * 100).toFixed(1).padStart(5)}%  ${bar}`);
      }
    }

    if (report.artifacts.heatmapPath) {
      console.log(`Heatmap: ${report.artifacts.heatmapPath}`);
    }

    // --top-fixes: print N highest-impact actionable fixes as plain text
    const topFixesCount = Number.parseInt(options.topFixes, 10);
    if (topFixesCount > 0 && report.topEditCandidates?.length) {
      // Suppress fixes when mismatch is within 2× irreducible estimate
      const irrEst = report.summary.segmented?.irreducibleEstimate;
      const tfAdjusted = report.summary.adjustedMismatch ?? report.summary.mismatchRatio;
      const tfHierarchy = report.summary.hierarchyScore ?? 100;
      if (tfHierarchy < 30) {
        console.log(`\n⚠ Implementation appears structurally incomplete (hierarchy score: ${tfHierarchy}/100) — add missing sections, text content, and visual hierarchy before fine-tuning spacing/colors.`);
      }
      if (irrEst != null && tfAdjusted < 1.4 * irrEst) {
        const topRegionHint = report.summary.gridBreakdown?.[0]?.label;
        const nearMsg = topRegionHint
          ? ` Near convergence floor — 1-2 targeted passes recommended, focusing on: ${topRegionHint}.`
          : "";
        console.log(`\nMismatch (${(tfAdjusted * 100).toFixed(1)}%) is within 1.4× of irreducible floor (${(irrEst * 100).toFixed(1)}%). Remaining differences are likely font rendering, anti-aliasing, and image content. No further CSS changes recommended.${nearMsg}`);
      } else {
        console.log(`\n── Top ${topFixesCount} Actionable Fixes ──`);
        for (const candidate of report.topEditCandidates.slice(0, topFixesCount)) {
          const selector = candidate.cssSelector ? ` on ${candidate.cssSelector}` : "";
          const anchor = candidate.anchorName ? ` (${candidate.anchorName})` : "";
          const riskWarning = (candidate as any).risk === "high"
            ? ` [CAUTION — affects ${(candidate as any).affectedAreaPercent ?? "?"}% of page]`
            : "";
          console.log(`${candidate.rank}. ${candidate.cssChanges[0] ?? candidate.description}${selector}${anchor}${riskWarning}`);
          for (const css of candidate.cssChanges.slice(1)) {
            console.log(`   ${css}`);
          }
        }
      }
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
  .command("run")
  .argument("[referencePath]", "Path to the reference screenshot")
  .argument("[implementationPath]", "Path to implementation HTML file or URL (alternative to --impl)")
  .option("--impl <path>", "Path to implementation HTML file or URL")
  .option("--implementation <path>", "Alias for --impl")
  .option("--file <path>", "Alias for --impl")
  .option("--reference <path>", "Alias for the referencePath argument (alternative to positional arg)")
  .option("--output <path>", "Path to output HTML file (alias for implementation path)")
  .option("--workdir <dir>", "Working directory for intermediate files", "./one-shot-run")
  .option("--max-passes <n>", "Maximum refinement passes", "5")
  .option("--threshold <ratio>", "Convergence threshold (mismatch ratio)", "0.02")
  .option("--no-ocr", "Disable OCR text extraction")
  .option("--json", "Print session log as JSON", false)
  .option("--dry-run", "Print detailed suggested edits for each pass", false)
  .addHelpText("after", `
Examples:
  one-shot-ui run reference.png output.html
  one-shot-ui run --reference reference.png --output output.html
  one-shot-ui run --reference reference.png --implementation output.html
  one-shot-ui run reference.png --impl output.html --max-passes 10
  one-shot-ui run reference.png http://localhost:3000 --threshold 0.05`)
  .action(async (referencePath, implementationPathArg, options) => {
    ensureChromium();
    const refPath = referencePath ?? options.reference;
    if (!refPath) {
      console.error("Error: reference path is required.");
      console.error("");
      console.error("Usage: one-shot-ui run <reference.png> <output.html>");
      console.error("   or: one-shot-ui run --reference reference.png --output output.html");
      process.exit(1);
    }
    let implPath = options.output ?? options.impl ?? options.implementation ?? options.file ?? implementationPathArg;
    if (!implPath) {
      console.error("Error: implementation/output path is required.");
      console.error("");
      console.error("Usage: one-shot-ui run <reference.png> <output.html>");
      console.error("   or: one-shot-ui run --reference reference.png --output output.html");
      console.error("");
      console.error("Examples:");
      console.error("  one-shot-ui run reference.png output.html");
      console.error("  one-shot-ui run --reference reference.png --output output.html");
      console.error("  one-shot-ui run --reference reference.png --implementation output.html");
      console.error("  one-shot-ui run reference.png --impl output.html --max-passes 10");
      process.exit(1);
    }

    // Resolve implPath: if it's a directory or lacks a file extension, append index.html
    if (!implPath.startsWith("http")) {
      const resolvedImpl = resolve(implPath);
      let isDir = false;
      try { isDir = (await stat(resolvedImpl)).isDirectory(); } catch { /* doesn't exist yet */ }
      if (isDir || implPath.endsWith("/") || !extname(implPath)) {
        const original = implPath;
        implPath = join(implPath, "index.html");
        console.error(`Output path resolved to ${implPath} (was directory: ${original})`);
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outputDir = resolve(options.workdir, `run-${timestamp}`);
    await mkdir(outputDir, { recursive: true });

    const maxPasses = Number.parseInt(options.maxPasses, 10);
    const threshold = Number.parseFloat(options.threshold);
    const sessionLog: SessionEntry[] = [];

    // Auto-detect reference image dimensions for viewport matching
    const refDimensions = await readImageDimensions(resolve(refPath));
    const captureWidth = refDimensions.width;
    const captureHeight = refDimensions.height;

    console.error(`Starting multi-pass orchestration...`);
    console.error(`Reference: ${refPath} (${captureWidth}x${captureHeight})`);
    console.error(`Implementation: ${implPath}`);
    console.error(`Capture viewport: ${captureWidth}x${captureHeight} (auto-matched to reference)`);
    console.error(`Max passes: ${maxPasses}, Convergence threshold: ${(threshold * 100).toFixed(1)}%`);
    console.error();

    // Step 1: Extract reference
    console.error(`[Pass 0] Extracting reference...`);
    let referenceReport;
    try {
      referenceReport = await extractImageReport(resolve(refPath), {
        disableOcr: options.ocr === false
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[run] Step 'extract' failed: ${msg}`);
      sessionLog.push({
        pass: 0,
        phase: "extract",
        timestamp: new Date().toISOString(),
        error: msg
      });
      process.exit(1);
    }

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

    // If implementation file doesn't exist, write extract.json and exit
    if (!implPath.startsWith("http") && !existsSync(resolve(implPath))) {
      await mkdir(dirname(resolve(implPath)), { recursive: true });

      // Write extract data as structured JSON for the builder
      const extractData = {
        layout: referenceReport.layout,
        text: referenceReport.text,
        colors: referenceReport.colors ?? [],
        tokens: referenceReport.tokens ?? [],
        semanticAnchors: referenceReport.semanticAnchors ?? [],
        components: referenceReport.components ?? [],
        implementationPlan: referenceReport.implementationPlan ?? null
      };
      const extractJsonPath = join(dirname(resolve(implPath)), "extract.json");
      await writeFile(extractJsonPath, JSON.stringify(extractData, null, 2), "utf-8");
      console.error(`[Pass 0] Extract data written to ${extractJsonPath}`);
      console.error(`No implementation found at ${implPath}. Extract data written to ${extractJsonPath}. Create the HTML implementation from extract.json and re-run.`);
      process.exit(0);
    }

    let currentMismatchRatio = 1;
    let passNumber = 0;
    let sessionBestRatio = Infinity;
    let sessionBestPass = 0;

    while (passNumber < maxPasses && currentMismatchRatio > threshold) {
      passNumber++;
      console.error(`[Pass ${passNumber}] Capturing implementation...`);

      // Capture
      const captureOutput = resolve(outputDir, `pass-${passNumber}-capture.png`);
      try {
        const isFile = !implPath.startsWith("http");
        const captureOpts = {
          url: isFile ? undefined : implPath,
          filePath: isFile ? resolve(implPath) : undefined,
          outputPath: captureOutput,
          width: captureWidth,
          height: captureHeight,
          deviceScaleFactor: 1,
          skipBlankCheck: false
        };
        try {
          await captureScreenshot(captureOpts);
        } catch (firstErr) {
          if (firstErr instanceof BlankCaptureError) {
            console.error(`  Blank capture detected, retrying with --skip-blank-check...`);
            if (firstErr.consoleErrors.length > 0) {
              console.error(`  Browser errors: ${firstErr.consoleErrors.join("; ")}`);
            }
            // Retry with blank check disabled — the page may have a white background
            await new Promise(r => setTimeout(r, 2000));
            await captureScreenshot({ ...captureOpts, skipBlankCheck: true });
          } else {
            throw firstErr;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[run] Step 'capture' failed (pass ${passNumber}): ${msg}`);
        if (err instanceof BlankCaptureError && err.consoleErrors.length > 0) {
          console.error(`  Browser console errors: ${err.consoleErrors.join("; ")}`);
        }
        sessionLog.push({
          pass: passNumber,
          phase: "capture",
          timestamp: new Date().toISOString(),
          error: msg
        });
        break;
      }

      // Compare
      console.error(`[Pass ${passNumber}] Comparing...`);
      const heatmapPath = resolve(outputDir, `pass-${passNumber}-heatmap.png`);
      let compareReport;
      try {
        compareReport = await compareImages(resolve(refPath), captureOutput, {
          heatmapPath,
          top: 20,
          disableOcr: options.ocr === false
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[run] Step 'compare' failed (pass ${passNumber}): ${msg}`);
        sessionLog.push({
          pass: passNumber,
          phase: "compare",
          timestamp: new Date().toISOString(),
          error: msg
        });
        break;
      }

      // Use adjustedMismatch as primary metric (falls back to mismatchRatio)
      const rawMismatch = compareReport.summary.mismatchRatio;
      currentMismatchRatio = compareReport.summary.adjustedMismatch ?? rawMismatch;
      const currentHierarchyScore = compareReport.summary.hierarchyScore ?? 100;

      // Hierarchy score gate: low structural complexity means mismatch is misleadingly low
      let hierarchyGated = false;
      if (currentHierarchyScore < 25) {
        console.error(`  Warning: Implementation has low structural complexity (hierarchy score: ${currentHierarchyScore}/100). Mismatch ratio may be misleadingly low — likely missing content.`);
        hierarchyGated = true;
      }

      sessionLog.push({
        pass: passNumber,
        phase: "compare",
        timestamp: new Date().toISOString(),
        result: {
          mismatchRatio: currentMismatchRatio,
          rawMismatch,
          hierarchyScore: currentHierarchyScore,
          hierarchyGated,
          issueCount: compareReport.issues.length,
          topIssues: compareReport.issues.slice(0, 5).map(i => ({
            code: i.code,
            severity: i.severity,
            message: i.message
          }))
        }
      });

      // Regression detection
      const previousRatios = sessionLog
        .filter(e => e.phase === "compare" && e.result?.mismatchRatio != null)
        .map(e => e.result.mismatchRatio as number);
      // Note: previousRatios includes the current pass since we just pushed it
      const priorRatios = previousRatios.slice(0, -1);

      // Update session best
      const isSessionRegression = sessionBestPass > 0 && currentMismatchRatio > sessionBestRatio;
      if (currentMismatchRatio < sessionBestRatio) {
        sessionBestRatio = currentMismatchRatio;
        sessionBestPass = passNumber;
      }

      if (priorRatios.length > 0) {
        const prevRatio = priorRatios[priorRatios.length - 1]!;
        if (currentMismatchRatio > prevRatio) {
          const delta = currentMismatchRatio - prevRatio;
          console.error(`  REGRESSION_WARNING: Mismatch increased by ${(delta * 100).toFixed(2)}pp (${(prevRatio * 100).toFixed(2)}% -> ${(currentMismatchRatio * 100).toFixed(2)}%)`);
          console.error(`  Consider reverting the last change or trying a smaller adjustment.`);
        }
      }

      // Session-best regression: stronger warning when current is worse than any prior pass
      if (isSessionRegression) {
        console.error(`  ⚠ REGRESSION: ${(currentMismatchRatio * 100).toFixed(2)}% is worse than your session best of ${(sessionBestRatio * 100).toFixed(2)}% (pass ${sessionBestPass})`);
        console.error(`  Revert recent changes before continuing. Top regressed region: ${compareReport.summary.gridBreakdown?.[0]?.label ?? "unknown"}`);
      }

      // Plateau detection (skip on regressed passes — don't count regressions toward plateau)
      if (previousRatios.length >= 3 && !isSessionRegression) {
        const recent = previousRatios.slice(-3);
        const maxRecent = Math.max(...recent);
        const minRecent = Math.min(...recent);
        if ((maxRecent - minRecent) < 0.005) {
          console.error(`  PLATEAU_REACHED: Last ${recent.length} passes within ${((maxRecent - minRecent) * 100).toFixed(2)}pp of each other.`);
          console.error(`  Remaining mismatch may be irreducible (font rendering, photographic content). Consider stopping.`);
        }
      }

      // Oscillation detection
      if (previousRatios.length >= 3) {
        const r = previousRatios.slice(-3);
        const oscillating = (r[1]! > r[0]! && r[1]! > r[2]!) || (r[1]! < r[0]! && r[1]! < r[2]!);
        if (oscillating) {
          const avg = (r[0]! + r[1]! + r[2]!) / 3;
          console.error(`  OSCILLATION_DETECTED: Mismatch alternating around ${(avg * 100).toFixed(2)}%. Try splitting the difference on changed values.`);
        }
      }

      // Show both adjusted and raw when they differ significantly
      if (Math.abs(currentMismatchRatio - rawMismatch) > 0.005) {
        console.error(`  Mismatch: ${(currentMismatchRatio * 100).toFixed(2)}% (raw: ${(rawMismatch * 100).toFixed(2)}%, adjusted for low structural complexity)`);
      } else {
        console.error(`  Mismatch: ${(currentMismatchRatio * 100).toFixed(2)}%`);
      }
      console.error(`  Issues: ${compareReport.issues.length}`);

      // Don't count hierarchy-gated passes toward convergence
      if (!hierarchyGated && currentMismatchRatio <= threshold) {
        console.error(`\nConverged! Mismatch ratio ${(currentMismatchRatio * 100).toFixed(2)}% <= threshold ${(threshold * 100).toFixed(1)}%`);
        break;
      }
      if (hierarchyGated && currentMismatchRatio <= threshold) {
        console.error(`  Mismatch is below threshold but hierarchy score is too low (${currentHierarchyScore}/100) — not converging.`);
      }

      // Converge when remaining mismatch is within 1.4× irreducible estimate (requires ≥4 passes)
      const runIrr = compareReport.summary?.segmented?.irreducibleEstimate;
      if (runIrr != null && runIrr > 0 && currentMismatchRatio < 1.4 * runIrr) {
        if (passNumber >= 4) {
          console.error(`\nConverged — mismatch (${(currentMismatchRatio * 100).toFixed(2)}%) is within 1.4× of irreducible floor (${(runIrr * 100).toFixed(1)}%). Remaining differences are font rendering, anti-aliasing, and image content.`);
          sessionLog.push({
            pass: passNumber,
            phase: "quality-gate",
            timestamp: new Date().toISOString(),
            result: { action: "irreducible-converge", mismatch: currentMismatchRatio, irreducibleEstimate: runIrr }
          });
          break;
        } else {
          const topRegion = compareReport.summary.gridBreakdown?.[0]?.label ?? "top mismatch region";
          console.error(`  Near convergence floor — 1-2 targeted passes recommended, focusing on: ${topRegion}`);
        }
      }

      // After first pass, warn if mismatch is very high
      if (passNumber === 1 && currentMismatchRatio > 0.60) {
        console.error(`  High initial mismatch (${(currentMismatchRatio * 100).toFixed(1)}%). Builder should use extract.json for layout data.`);
      }

      // Stall detection — if 3 consecutive passes show < 0.5% improvement and mismatch > 20%, bail
      if (previousRatios.length >= 3 && currentMismatchRatio > 0.20) {
        const lastThree = previousRatios.slice(-3);
        const improvement = lastThree[0]! - lastThree[lastThree.length - 1]!;
        if (Math.abs(improvement) < 0.005) {
          console.error(`\nStalled: 3 consecutive passes with < 0.5% improvement at ${(currentMismatchRatio * 100).toFixed(2)}% mismatch.`);
          console.error(`Use 'one-shot-ui extract <ref>' to get layout data and refine manually.`);
          sessionLog.push({
            pass: passNumber,
            phase: "quality-gate",
            timestamp: new Date().toISOString(),
            result: { action: "stall-bail", mismatch: currentMismatchRatio }
          });
          break;
        }
      }

      // Region drill-down after first pass
      if (passNumber >= 2 && referenceReport.semanticAnchors) {
        console.error(`[Pass ${passNumber}] Drilling into regions...`);
        const regionIssues: Array<{ region: string; mismatchRatio: number; issues: any[] }> = [];

        for (const anchor of referenceReport.semanticAnchors.filter(a => a.parentId === null)) {
          try {
            const regionCompare = await compareImages(resolve(refPath), captureOutput, {
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

          console.error(`  Region drill-down:`);
          for (const ri of regionIssues.sort((a, b) => b.mismatchRatio - a.mismatchRatio)) {
            console.error(`    ${ri.region}: ${(ri.mismatchRatio * 100).toFixed(1)}% mismatch`);
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

      console.error(`  ${nextActions.summary}`);
      if (options.dryRun) {
        console.error(`\n[Dry Run] Suggested edits for pass ${passNumber}:`);
        for (const edit of nextActions.edits) {
          console.error(`\n${edit.cssRuleBlock}`);
        }
        if (nextActions.missingElements.length > 0) {
          console.error(`\nMissing elements to add:`);
          for (const missing of nextActions.missingElements) {
            console.error(`  ${missing.description}`);
            if (missing.referenceStyles) {
              const styles = Object.entries(missing.referenceStyles).map(([k, v]) => `${k}: ${v}`).join("; ");
              console.error(`  Styles: ${styles}`);
            }
          }
        }
      }
      console.error(`  Heatmap: ${heatmapPath}`);
      console.error();
    }

    // Write session log
    const convergenceSummary = buildConvergenceSummary(sessionLog, threshold);
    const sessionReport = {
      version: VERSION,
      reference: resolve(refPath),
      implementation: implPath,
      totalPasses: passNumber,
      finalMismatchRatio: currentMismatchRatio,
      converged: currentMismatchRatio <= threshold,
      threshold: threshold,
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
      console.error(`\nSession complete.`);
      console.error(`  Passes: ${passNumber}`);
      console.error(`  Final mismatch: ${(currentMismatchRatio * 100).toFixed(2)}%`);
      console.error(`  Converged: ${currentMismatchRatio <= threshold ? "yes" : "no"}`);
      console.error(`  Trend: ${convergenceSummary.trend}`);
      if (convergenceSummary.message) {
        console.error(`  ${convergenceSummary.message}`);
      }
      console.error(`  Session log: ${resolve(outputDir, "session.json")}`);
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
  .option("--framework <framework>", "Output format: react (Tailwind classes) or vanilla (CSS)", "react")
  .option("--styling <styling>", "Styling approach: tailwind or css", "tailwind")
  .option("--session-best <ratio>", "Session best mismatch ratio — suppresses forward fixes and advises revert when current is worse")
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

    // Session-best regression check: suppress forward fixes and advise revert
    if (options.sessionBest != null) {
      const sessionBestVal = Number.parseFloat(options.sessionBest);
      if (!Number.isNaN(sessionBestVal) && report.summary.mismatchRatio > sessionBestVal) {
        const topRegion = report.summary.gridBreakdown?.[0]?.label ?? "unknown";
        const msg = `Revert recent changes before continuing. Session best: ${(sessionBestVal * 100).toFixed(1)}%. Current: ${(report.summary.mismatchRatio * 100).toFixed(1)}%. Top regressed region: ${topRegion}.`;
        if (options.json) {
          console.log(JSON.stringify({ version: VERSION, regressed: true, message: msg, fixes: [] }, null, 2));
        } else {
          console.log(`⚠ REGRESSION: ${(report.summary.mismatchRatio * 100).toFixed(1)}% is worse than session best of ${(sessionBestVal * 100).toFixed(1)}%.`);
          console.log(msg);
        }
        return;
      }
    }

    // Early exit: if mismatch is within 1.4× irreducible estimate, no further fixes recommended
    if (report.summary.segmented?.irreducibleEstimate != null) {
      const irr = report.summary.segmented.irreducibleEstimate;
      if (report.summary.mismatchRatio < 1.4 * irr) {
        const topRegionHint = report.summary.gridBreakdown?.[0]?.label;
        const nearMsg = topRegionHint
          ? ` Near convergence floor — 1-2 targeted passes recommended, focusing on: ${topRegionHint}.`
          : "";
        const msg = `Mismatch (${(report.summary.mismatchRatio * 100).toFixed(1)}%) is within 1.4× of irreducible floor (${(irr * 100).toFixed(1)}%). Remaining differences are likely font rendering, anti-aliasing, and image content. No further CSS changes recommended.${nearMsg}`;
        if (options.json) {
          console.log(JSON.stringify({ version: VERSION, converged: true, message: msg, fixes: [] }, null, 2));
        } else {
          console.log(msg);
        }
        return;
      }
    }

    // Structural incompleteness warning when hierarchy score is very low
    const sfHierarchyScore = report.summary.hierarchyScore ?? 100;
    const structuralWarning = sfHierarchyScore < 30
      ? "Implementation appears structurally incomplete — add missing sections, text content, and visual hierarchy before fine-tuning spacing/colors."
      : null;

    // Deprioritize content-category (photographic/irreducible) issues in suggestions
    const actionableReport = {
      ...report,
      issues: report.issues.filter(i => i.actionable !== false)
    };
    const allFixes = generateImplementationGuidance(actionableReport);

    // Filter out low-confidence noise: suppress fixes for issues whose visual weight
    // is below 2% (sub-pixel noise, e.g. blog-article's "white background as missing").
    // Also suppress MISSING_NODE / EXTRA_NODE issues that reference tiny regions.
    const fixes = allFixes.filter(fix => {
      // Always keep high-priority fixes
      if (fix.priority === "high") return true;
      // Filter out MISSING_NODE noise: issues that are purely tiny background region mismatches
      if (fix.category === "structure" && fix.confidence < 0.3) return false;
      // Filter out low-confidence pixel-region fallbacks with no CSS selector
      if (!fix.cssSelector && !fix.css && fix.confidence <= 0.2) return false;
      return true;
    });

    const useTailwind = (options.framework === "react" && options.styling === "tailwind") ||
                        (options.framework === "react" && !options.styling) ||
                        (!options.framework && options.styling === "tailwind");

    // Convert CSS suggestions to Tailwind class suggestions when appropriate
    if (useTailwind) {
      const { cssToTailwindClass } = await import("@one-shot-ui/core/tailwind");
      for (const fix of fixes) {
        if (fix.css) {
          // Parse CSS declarations and convert each to Tailwind
          const tailwindClasses = fix.css
            .split(";")
            .map(decl => decl.trim())
            .filter(decl => decl && !decl.startsWith("/*"))
            .map(decl => {
              const colonIdx = decl.indexOf(":");
              if (colonIdx < 0) return null;
              const prop = decl.slice(0, colonIdx).trim();
              const val = decl.slice(colonIdx + 1).trim().replace(/;$/, "");
              // Handle "current -> target" arrow format
              const arrowIdx = val.indexOf(" -> ");
              const targetVal = arrowIdx >= 0 ? val.slice(arrowIdx + 4).trim() : val;
              return cssToTailwindClass(prop, targetVal);
            })
            .filter(Boolean);
          if (tailwindClasses.length > 0) {
            (fix as any).tailwind = tailwindClasses.join(" ");
          }
        }
        // Convert cssSelector to className suggestion
        if (fix.cssSelector) {
          (fix as any).classNameHint = fix.cssSelector.replace(/^\./, "").replace(/\[data-[^\]]+\]/g, "");
        }
      }
    }

    // Force-surface suggestions when zero actionable fixes remain but reducible mismatch > 0.5%
    let forceSurfaced: typeof fixes = [];
    if (fixes.length === 0 && report.summary.segmented?.irreducibleEstimate != null) {
      const reducible = report.summary.mismatchRatio - (report.summary.segmented.irreducibleEstimate ?? 0);
      if (reducible > 0.005) {
        // Surface top 3 issues by score regardless of actionability, with their CSS suggestions
        const allIssuesFixes = generateImplementationGuidance(report);
        forceSurfaced = allIssuesFixes
          .filter(f => f.css || f.cssSelector)
          .slice(0, 3);
      }
    }

    if (options.json) {
      const jsonOutput: any = { version: VERSION, framework: useTailwind ? "react" : "vanilla", styling: useTailwind ? "tailwind" : "css", fixes: [...fixes, ...forceSurfaced.map(f => ({ ...f, forceSurfaced: true }))] };
      if (structuralWarning) jsonOutput.structuralWarning = structuralWarning;
      console.log(JSON.stringify(jsonOutput, null, 2));
      return;
    }

    if (structuralWarning) {
      console.log(`⚠ ${structuralWarning}\n`);
    }

    const filteredCount = allFixes.length - fixes.length;
    console.log(`${fixes.length} suggested fixes (ordered by priority)${filteredCount > 0 ? ` (${filteredCount} low-confidence noise items filtered)` : ""}:\n`);
    for (const fix of fixes) {
      const label = fix.anchorName ? `${fix.anchorName} · ` : "";
      console.log(`[${fix.priority}] ${fix.category}: ${label}${fix.description} (confidence: ${(fix.confidence * 100).toFixed(0)}%)`);
      if (useTailwind && (fix as any).tailwind) {
        console.log(`  Tailwind: className="${(fix as any).tailwind}"`);
      } else if (fix.css && fix.cssSelector) {
        // Output as a CSS rule block for direct applicability
        console.log(`  ${fix.cssSelector} { ${fix.css} }`);
      } else if (fix.css) {
        console.log(`  CSS: ${fix.css}`);
      }
      if (fix.cssSelector && !(fix.css && fix.cssSelector && !useTailwind)) {
        console.log(`  Selector: ${fix.cssSelector}`);
      }
      console.log();
    }

    // Surface lower-confidence suggestions when reducible mismatch remains
    if (forceSurfaced.length > 0) {
      const reducible = report.summary.mismatchRatio - (report.summary.segmented?.irreducibleEstimate ?? 0);
      console.log(`~${(reducible * 100).toFixed(1)}% mismatch may still be reducible — these suggestions are lower-confidence but worth trying:\n`);
      for (const fix of forceSurfaced) {
        const label = fix.anchorName ? `${fix.anchorName} · ` : "";
        console.log(`[Possibly fixable] ${fix.category}: ${label}${fix.description} (confidence: ${(fix.confidence * 100).toFixed(0)}%)`);
        if (fix.css && fix.cssSelector) {
          console.log(`  ${fix.cssSelector} { ${fix.css} }`);
        } else if (fix.css) {
          console.log(`  CSS: ${fix.css}`);
        }
        console.log();
      }
    }
  });

program
  .command("capture")
  .option("--url <url>", "HTTP URL to capture")
  .option("--file <filePath>", "Local HTML file or .tsx React component to capture")
  .requiredOption("--output <outputPath>", "Screenshot output path")
  .option("--width <width>", "Viewport width", "1440")
  .option("--height <height>", "Viewport height", "1024")
  .option("--scale <scale>", "Device scale factor", "1")
  .option("--match-reference <path>", "Auto-detect viewport dimensions from a reference image")
  .option("--skip-blank-check", "Skip the blank-capture validation heuristic", false)
  .option("--json", "Print full JSON report", false)
  .action(async (options) => {
    ensureChromium();
    const outputPath = resolve(options.output);
    await mkdir(dirname(outputPath), { recursive: true });

    // Auto-detect dimensions from reference image if --match-reference is provided
    let captureWidth = Number.parseInt(options.width, 10);
    let captureHeight = Number.parseInt(options.height, 10);
    if (options.matchReference) {
      try {
        const refDims = await readImageDimensions(resolve(options.matchReference));
        captureWidth = refDims.width;
        captureHeight = refDims.height;
        console.error(`Auto-matched viewport to reference: ${captureWidth}x${captureHeight}`);
      } catch (err) {
        console.error(`Warning: Could not read reference dimensions from ${options.matchReference}: ${err instanceof Error ? err.message : String(err)}`);
        console.error(`Falling back to --width ${captureWidth} --height ${captureHeight}`);
      }
    }

    let filePath = options.file ? resolve(options.file) : undefined;

    // If the file is a .tsx/.jsx, wrap it as plain HTML with Tailwind CDN for capture
    let tmpHtmlPath: string | undefined;
    if (filePath && (filePath.endsWith(".tsx") || filePath.endsWith(".jsx"))) {
      const tsxContent = await readFile(filePath, "utf8");
      const htmlWrapped = wrapAsStaticHtml(tsxContent);
      tmpHtmlPath = filePath.replace(/\.tsx$|\.jsx$/, ".capture-tmp.html");
      await writeFile(tmpHtmlPath, htmlWrapped, "utf8");
      filePath = tmpHtmlPath;
    }

    const result = await captureScreenshot({
      url: options.url,
      filePath,
      outputPath,
      width: captureWidth,
      height: captureHeight,
      deviceScaleFactor: Number.parseFloat(options.scale),
      skipBlankCheck: options.skipBlankCheck
    });

    // Clean up temporary HTML wrapper
    if (tmpHtmlPath) {
      try { await rm(tmpHtmlPath); } catch {}
    }

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

function buildCompactExtract(report: any) {
  // Dominant colors (max 8)
  const colors = (report.colors ?? []).slice(0, 8).map((c: any) => ({
    hex: c.hex,
    frequency: c.frequency ?? c.ratio ?? 0
  }));

  // Font sizes sorted by frequency
  const fontSizeMap = new Map<number, number>();
  for (const text of report.text ?? []) {
    const fs = text.typography?.fontSize;
    if (fs) fontSizeMap.set(fs, (fontSizeMap.get(fs) ?? 0) + 1);
  }
  const fontSizes = [...fontSizeMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([size, count]) => ({ size, count }));

  // Semantic anchors as regions with roles and text previews
  const anchors = report.semanticAnchors ?? [];
  const regions = anchors.slice(0, 30).map((a: any) => {
    // Find text blocks overlapping this anchor
    const overlappingText = (report.text ?? []).filter((t: any) => {
      if (!t.bounds || !a.bounds) return false;
      return t.bounds.x >= a.bounds.x && t.bounds.y >= a.bounds.y &&
        t.bounds.x + t.bounds.width <= a.bounds.x + a.bounds.width + 10 &&
        t.bounds.y + t.bounds.height <= a.bounds.y + a.bounds.height + 10;
    });
    const textPreview = overlappingText
      .slice(0, 2)
      .map((t: any) => (t.text ?? "").split(/\s+/).slice(0, 5).join(" "))
      .filter(Boolean)
      .join("; ") || undefined;
    return {
      role: a.role ?? a.name ?? "section",
      x: a.bounds.x,
      y: a.bounds.y,
      width: a.bounds.width,
      height: a.bounds.height,
      textPreview
    };
  });

  // If no semantic anchors, fall back to layout nodes grouped by position
  if (regions.length === 0) {
    const layoutNodes = (report.layout ?? []).slice(0, 20);
    for (const node of layoutNodes) {
      const overlappingText = (report.text ?? []).filter((t: any) => {
        if (!t.bounds || !node.bounds) return false;
        return t.bounds.x >= node.bounds.x && t.bounds.y >= node.bounds.y &&
          t.bounds.x + t.bounds.width <= node.bounds.x + node.bounds.width + 10 &&
          t.bounds.y + t.bounds.height <= node.bounds.y + node.bounds.height + 10;
      });
      const textPreview = overlappingText
        .slice(0, 2)
        .map((t: any) => (t.text ?? "").split(/\s+/).slice(0, 5).join(" "))
        .filter(Boolean)
        .join("; ") || undefined;
      regions.push({
        role: "block",
        x: node.bounds.x,
        y: node.bounds.y,
        width: node.bounds.width,
        height: node.bounds.height,
        textPreview
      });
    }
  }

  // Grid/column structure detection
  let gridStructure: { columns: number; rows: number } | undefined;
  if (report.layoutStrategy?.type === "grid" || report.layoutStrategy?.type === "columns") {
    const ls = report.layoutStrategy;
    gridStructure = {
      columns: ls.columns ?? ls.columnCount ?? 1,
      rows: ls.rows ?? Math.ceil((report.layout?.length ?? 0) / Math.max(1, ls.columns ?? ls.columnCount ?? 1))
    };
  }

  return {
    image: { width: report.image.width, height: report.image.height },
    background: report.diagnostics?.background ?? colors[0]?.hex ?? "#ffffff",
    colors,
    fontSizes,
    layoutStrategy: report.layoutStrategy ? {
      type: report.layoutStrategy.type,
      confidence: report.layoutStrategy.confidence
    } : undefined,
    gridStructure,
    regions
  };
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

/**
 * Infer a CSS selector from an element's bounding box position and size.
 * Infer a CSS selector from an element's bounding box position and size.
 * Provides actionable selectors based on semantic role inference.
 */
function inferSelectorFromBounds(bounds: Bounds): string | null {
  // Use common viewport dimensions as reference (1440x900)
  const viewportWidth = 1440;
  const viewportHeight = 900;

  const widthRatio = bounds.width / viewportWidth;
  const heightRatio = bounds.height / viewportHeight;
  const topRatio = bounds.y / viewportHeight;
  const bottomEdge = (bounds.y + bounds.height) / viewportHeight;

  // Full-width top element = likely header/nav
  if (widthRatio > 0.8 && heightRatio < 0.15 && topRatio < 0.05) {
    return "header, nav, [class*='header'], [class*='nav']";
  }
  // Full-width bottom element = likely footer
  if (widthRatio > 0.8 && heightRatio < 0.15 && bottomEdge > 0.9) {
    return "footer, [class*='footer']";
  }
  // Tall narrow element on left/right = sidebar
  if (heightRatio > 0.4 && widthRatio < 0.25) {
    return "aside, [class*='sidebar'], [class*='side']";
  }
  // Large central element = main content
  if (widthRatio > 0.5 && heightRatio > 0.3) {
    return "main, [class*='main'], [class*='content']";
  }
  // Small square element = likely card, button, or icon
  if (bounds.width < 300 && bounds.height < 300 && Math.abs(bounds.width - bounds.height) < 50) {
    return `div:nth-child(n) /* ~${bounds.width}x${bounds.height} element at (${bounds.x},${bounds.y}) */`;
  }

  return null;
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
  confidence: number;
};

function inferCssCategory(issueCode: string): string | undefined {
  const map: Record<string, string> = {
    POSITION_MISMATCH: "position/margin/padding",
    SIZE_MISMATCH: "width/height",
    SPACING_MISMATCH: "margin/padding/gap",
    BORDER_RADIUS_MISMATCH: "border-radius",
    COLOR_MISMATCH: "background-color",
    COLOR_MISMATCH_AT_POSITION: "background-color",
    SHADOW_MISMATCH: "box-shadow",
    GRADIENT_MISMATCH: "background",
    FONT_SIZE_MISMATCH: "font-size",
    FONT_WEIGHT_MISMATCH: "font-weight",
    FONT_FAMILY_MISMATCH: "font-family",
  };
  return map[issueCode];
}

function generateImplementationGuidance(report: { issues: Array<{ code: string; nodeId?: string; anchorName?: string; anchorId?: string; severity: string; message: string; suggestedFix?: string; cssProperty?: string; cssSelector?: string; reference?: unknown; implementation?: unknown; issueBounds?: Bounds }> }): ImplementationFix[] {
  const fixes: ImplementationFix[] = [];

  // Detect whether the HTML was generated by checking for
  // attributes in the issues. If no issues reference data-anchor or data-node selectors,
  // the HTML is likely manually built and we should avoid region anchors.
  const isScaffoldGenerated = report.issues.some(
    (i) => i.cssSelector?.includes("data-anchor") || i.cssSelector?.includes("data-node")
  );

  for (const issue of report.issues) {
    const fix: ImplementationFix = {
      priority: issue.severity as "high" | "medium" | "low",
      category: issueCategoryMap[issue.code] ?? "general",
      nodeId: issue.nodeId,
      anchorName: issue.anchorName,
      description: issue.message,
      cssSelector: issue.cssSelector,
      confidence: 0.2
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
          fix.description = `${issue.message} Expected color: ${ref.fill}`;
        }
        break;
      }
      case "COLOR_MISMATCH_AT_POSITION": {
        const ref = issue.reference as { fill: string } | undefined;
        if (ref?.fill) {
          fix.css = `background-color: ${ref.fill};`;
          fix.description = `${issue.message} Expected color: ${ref.fill}`;
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

    // Ensure every fix has a CSS selector
    if (!fix.cssSelector && issue.cssSelector) {
      fix.cssSelector = issue.cssSelector;
    }
    if (!fix.cssSelector && issue.anchorName) {
      if (isScaffoldGenerated) {
        // Use data-anchor attribute selectors when available
        fix.cssSelector = `.${issue.anchorName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      } else {
        // Manually-built HTML: derive a semantic class name suggestion
        // without referencing data-anchor attributes
        fix.cssSelector = `.${issue.anchorName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      }
    }
    if (!fix.cssSelector && issue.nodeId) {
      if (isScaffoldGenerated) {
        fix.cssSelector = `[data-node="${issue.nodeId}"]`;
      } else {
        // For manually-built HTML, fall back to CSS property category instead of node IDs
        const cssProp = issue.cssProperty ?? inferCssCategory(issue.code);
        if (cssProp) {
          fix.description = `${fix.description} (target element with ${cssProp})`;
        }
      }
    }

    // For manually-built HTML with issueBounds but no selector, use bounding-box
    // overlap to infer a meaningful semantic selector
    if (!fix.cssSelector && !isScaffoldGenerated && issue.issueBounds) {
      const b = issue.issueBounds;
      const cssProp = issue.cssProperty ?? inferCssCategory(issue.code);
      // Infer a semantic selector from the element's position and size on the page
      const inferredSelector = inferSelectorFromBounds(b);
      if (inferredSelector) {
        fix.cssSelector = inferredSelector;
        fix.confidence = Math.max(fix.confidence, 0.5);
      }
      fix.description = `${fix.description} (element near ${b.x},${b.y} ${b.width}x${b.height}${cssProp ? `, adjust ${cssProp}` : ""})`;
    }

    // Fallback: always provide at least a color suggestion
    if (!fix.css && issue.reference) {
      const ref = issue.reference as any;
      if (ref.fill) {
        fix.css = `background-color: ${ref.fill};`;
      } else if (ref.bounds && isScaffoldGenerated) {
        fix.css = `/* Position: (${ref.bounds.x}, ${ref.bounds.y}) ${ref.bounds.width}x${ref.bounds.height} */`;
      } else if (ref.bounds) {
        // For manually-built HTML, suggest CSS properties instead of raw pixel coordinates
        const cssProp = issue.cssProperty ?? inferCssCategory(issue.code);
        fix.css = cssProp
          ? `/* Adjust ${cssProp} for element at approximately (${ref.bounds.x}, ${ref.bounds.y}) */`
          : `/* Check element near (${ref.bounds.x}, ${ref.bounds.y}) ${ref.bounds.width}x${ref.bounds.height} */`;
      }
    }

    // Assign confidence based on specificity
    fix.confidence = fix.css && fix.cssSelector ? 0.9 :
                     fix.css ? 0.6 :
                     fix.cssSelector ? 0.4 : 0.2;

    fixes.push(fix);
  }

  // Pixel-region fallback: for issues with bounds but no CSS suggestion
  for (const fix of fixes) {
    if (fix.css) continue;

    const issue = report.issues.find(
      (i) => i.nodeId === fix.nodeId && i.code !== "PIXEL_DIFFERENCE" && i.code !== "DIMENSION_MISMATCH"
    );
    if (!issue) continue;

    const ref = issue.reference as { bounds?: { x: number; y: number; width: number; height: number }; fill?: string; borderRadius?: number } | undefined;
    if (!ref?.bounds) continue;

    const cssLines: string[] = [];
    cssLines.push(`/* Region at (${ref.bounds.x}, ${ref.bounds.y}) ${ref.bounds.width}x${ref.bounds.height} */`);
    if (ref.fill) cssLines.push(`background-color: ${ref.fill};`);
    cssLines.push(`width: ${ref.bounds.width}px;`);
    cssLines.push(`height: ${ref.bounds.height}px;`);
    if (ref.borderRadius) cssLines.push(`border-radius: ${ref.borderRadius}px;`);

    fix.css = cssLines.join(" ");
    fix.description = `${fix.description} (pixel-region fallback at ${ref.bounds.x},${ref.bounds.y})`;
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
  COLOR_MISMATCH_AT_POSITION: "style",
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
  const mismatchRatio = compareReport.summary?.mismatchRatio ?? 0;

  // Build structured, agent-applicable edits grouped by CSS selector
  const editMap = new Map<string, {
    selector: string;
    anchorName?: string;
    properties: Record<string, string>;
    reasons: string[];
  }>();

  let filteredHighRisk = 0;
  let filteredNonActionable = 0;
  let filteredNoSelector = 0;
  const structuralMismatchCodes = new Set(["POSITION_MISMATCH", "SIZE_MISMATCH", "SPACING_MISMATCH"]);

  for (const [idx, issue] of issues.entries()) {
    if (idx >= 10) break;
    // Skip non-actionable issues (content/typography that can't be fixed with CSS)
    if (issue.actionable === false) { filteredNonActionable++; continue; }

    // Skip high-risk issues in auto-apply: large-area or container-resizing changes
    // that are likely to cascade into child element misalignment
    const boundsArea = issue.issueBounds ? issue.issueBounds.width * issue.issueBounds.height : 0;
    const imgArea = (compareReport.referenceImage?.width ?? 1) * (compareReport.referenceImage?.height ?? 1);
    const areaRatio = imgArea > 0 ? boundsArea / imgArea : 0;
    if (areaRatio > 0.15) { filteredHighRisk++; continue; }

    const selector = issue.cssSelector
      ?? (issue.anchorName ? `.${issue.anchorName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : undefined);
    if (!selector) { filteredNoSelector++; continue; }

    let cssProps = extractCssProperties(issue);
    // For structural mismatches without extracted CSS, generate fallback CSS comments from raw offset data
    if (Object.keys(cssProps).length === 0 && structuralMismatchCodes.has(issue.code)) {
      const ref = issue.reference;
      const impl = issue.implementation;
      if (issue.code === "POSITION_MISMATCH") {
        const dY = issue.deltaY ?? (ref?.y != null && impl?.y != null ? impl.y - ref.y : 0);
        const dX = issue.deltaX ?? (ref?.x != null && impl?.x != null ? impl.x - ref.x : 0);
        if (Math.abs(dY) > 4) {
          const dir = dY > 0 ? "reduce" : "increase";
          cssProps[`/* ${issue.cssProperty ?? "margin-top"} */`] = `/* ${dir} by ~${Math.abs(dY)}px (ref y: ${ref?.y ?? "?"}, impl y: ${impl?.y ?? "?"}) */`;
        }
        if (Math.abs(dX) > 4) {
          const dir = dX > 0 ? "reduce" : "increase";
          const hProp = dX > 0 ? "margin-left" : "margin-right";
          cssProps[`/* ${issue.cssProperty ?? hProp} */`] = `/* ${dir} by ~${Math.abs(dX)}px (ref x: ${ref?.x ?? "?"}, impl x: ${impl?.x ?? "?"}) */`;
        }
      } else if (issue.code === "SIZE_MISMATCH") {
        const dW = issue.deltaWidth ?? (ref?.width != null && impl?.width != null ? impl.width - ref.width : 0);
        const dH = issue.deltaHeight ?? (ref?.height != null && impl?.height != null ? impl.height - ref.height : 0);
        if (Math.abs(dW) > 4) {
          cssProps["/* width */"] = `/* set to ${ref?.width ?? "?"}px (currently ${impl?.width ?? "?"}px, ${dW > 0 ? "too wide" : "too narrow"} by ~${Math.abs(dW)}px) */`;
        }
        if (Math.abs(dH) > 4) {
          cssProps["/* height */"] = `/* set to ${ref?.height ?? "?"}px (currently ${impl?.height ?? "?"}px, ${dH > 0 ? "too tall" : "too short"} by ~${Math.abs(dH)}px) */`;
        }
      } else if (issue.code === "SPACING_MISMATCH") {
        if (ref?.distance != null && impl?.distance != null) {
          cssProps[`/* ${issue.cssProperty ?? "gap"} */`] = `/* set to ${ref.distance}px (currently ~${impl.distance}px) */`;
        }
      }
    }
    if (Object.keys(cssProps).length === 0 && issue.code !== "MISSING_NODE") continue;

    const existing = editMap.get(selector);
    if (existing) {
      Object.assign(existing.properties, cssProps);
      existing.reasons.push(`${issue.code}: ${issue.message}`);
    } else {
      editMap.set(selector, {
        selector,
        anchorName: issue.anchorName,
        properties: { ...cssProps },
        reasons: [`${issue.code}: ${issue.message}`]
      });
    }
  }

  // Build complete CSS rule blocks that agents can copy-paste into stylesheets
  const edits = [...editMap.values()].map((edit, idx) => {
    // Target-only properties for CSS rule blocks (agent copy-paste)
    const targetProps: Record<string, string> = {};
    for (const [prop, value] of Object.entries(edit.properties)) {
      const arrowIdx = value.indexOf(" -> ");
      targetProps[prop] = arrowIdx >= 0 ? value.slice(arrowIdx + 4) : value;
    }

    const propsBlock = Object.entries(targetProps)
      .map(([prop, value]) => `  ${prop}: ${value};`)
      .join("\n");
    return {
      priority: idx + 1,
      selector: edit.selector,
      anchorName: edit.anchorName,
      cssRuleBlock: `${edit.selector} {\n${propsBlock}\n}`,
      properties: edit.properties,
      targetProperties: targetProps,
      reasons: edit.reasons,
    };
  });

  // One-line summary for agents
  const topSelectors = edits.slice(0, 3).map(e => e.selector).join(", ");
  const totalFiltered = filteredHighRisk + filteredNonActionable + filteredNoSelector;
  const filterNote = totalFiltered > 0
    ? ` | ${totalFiltered} issues filtered (${filteredHighRisk} high-risk, ${filteredNonActionable} non-actionable, ${filteredNoSelector} missing CSS data)`
    : "";
  const summary = `Mismatch: ${(mismatchRatio * 100).toFixed(2)}% | ${edits.length} edits needed | Top targets: ${topSelectors || "none"}${filterNote}`;

  // MISSING_NODE entries as "add element" instructions
  const missingNodes = issues
    .filter((i: any) => i.code === "MISSING_NODE" && i.actionable !== false)
    .slice(0, 5)
    .map((issue: any) => ({
      action: "add-element",
      anchorName: issue.anchorName,
      selector: issue.cssSelector ?? (issue.anchorName ? `.${issue.anchorName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : undefined),
      description: issue.message,
      referenceStyles: issue.reference ? {
        ...(issue.reference.bounds ? {
          left: `${issue.reference.bounds.x}px`,
          top: `${issue.reference.bounds.y}px`,
          width: `${issue.reference.bounds.width}px`,
          height: `${issue.reference.bounds.height}px`,
          position: "absolute"
        } : {}),
        ...(issue.reference.fill ? { "background-color": issue.reference.fill } : {}),
        ...(issue.reference.borderRadius ? { "border-radius": `${issue.reference.borderRadius}px` } : {})
      } : {}
    }));

  const searchReplaceEdits = edits.map(e => ({
    selector: e.selector,
    cssProperties: e.targetProperties,
    description: e.reasons.join("; ")
  }));

  return {
    version: VERSION,
    pass: passNumber,
    summary,
    mismatchRatio,
    editCount: edits.length,
    edits,
    searchReplaceEdits,
    missingElements: missingNodes,
    topEditCandidates: topEditCandidates.slice(0, 5),
    referenceColors: compareReport.referenceColors ?? []
  };
}

function describeAction(code: string): string {
  switch (code) {
    case "POSITION_MISMATCH": return "adjust-position";
    case "SIZE_MISMATCH": return "adjust-size";
    case "COLOR_MISMATCH": return "change-color";
    case "COLOR_MISMATCH_AT_POSITION": return "change-color";
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
  const impl = issue.implementation;

  switch (issue.code) {
    case "POSITION_MISMATCH":
      if (ref?.x != null) {
        props["left"] = impl?.x != null ? `${impl.x}px -> ${ref.x}px` : `${ref.x}px`;
      }
      if (ref?.y != null) {
        props["top"] = impl?.y != null ? `${impl.y}px -> ${ref.y}px` : `${ref.y}px`;
      }
      break;
    case "SIZE_MISMATCH":
      if (ref?.width != null) {
        props["width"] = impl?.width != null ? `${impl.width}px -> ${ref.width}px` : `${ref.width}px`;
      }
      if (ref?.height != null) {
        props["height"] = impl?.height != null ? `${impl.height}px -> ${ref.height}px` : `${ref.height}px`;
      }
      break;
    case "COLOR_MISMATCH":
      if (ref?.fill) {
        props["background-color"] = impl?.fill ? `${impl.fill} -> ${ref.fill}` : ref.fill;
      }
      break;
    case "COLOR_MISMATCH_AT_POSITION":
      if (ref?.fill) {
        props["background-color"] = impl?.fill ? `${impl.fill} -> ${ref.fill}` : ref.fill;
      }
      break;
    case "BORDER_RADIUS_MISMATCH":
      if (ref?.borderRadius != null) {
        props["border-radius"] = impl?.borderRadius != null
          ? `${impl.borderRadius}px -> ${ref.borderRadius}px`
          : `${ref.borderRadius}px`;
      }
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
      if (ref?.fontSize) {
        props["font-size"] = impl?.fontSize
          ? `${impl.fontSize}px -> ${ref.fontSize}px`
          : `${ref.fontSize}px`;
      }
      break;
    case "FONT_WEIGHT_MISMATCH":
      if (ref?.fontWeight) {
        props["font-weight"] = impl?.fontWeight
          ? `${impl.fontWeight} -> ${ref.fontWeight}`
          : `${ref.fontWeight}`;
      }
      break;
    case "SPACING_MISMATCH":
      if (ref?.distance != null) {
        props["gap"] = impl?.distance != null
          ? `${impl.distance}px -> ${ref.distance}px`
          : `${ref.distance}px`;
      }
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

  // Plateau: last 3+ passes within 0.5%, but only if reducible mismatch is small
  const rawPlateau = ratios.length >= 3 && (() => {
    const recent = ratios.slice(-3);
    return (Math.max(...recent) - Math.min(...recent)) < 0.005;
  })();

  // Check if there's still reducible mismatch — don't declare plateau if > 0.5% reducible
  const lastComparePass = comparePasses[comparePasses.length - 1];
  const irreducible = lastComparePass?.result?.segmented?.irreducibleEstimate ?? 0;
  const reducibleMismatch = lastRatio - irreducible;
  const plateau = rawPlateau && reducibleMismatch <= 0.005;

  // Oscillation: alternating up/down in last 3 passes
  const oscillating = ratios.length >= 3 && (() => {
    const r = ratios.slice(-3);
    return (r[1]! > r[0]! && r[1]! > r[2]!) || (r[1]! < r[0]! && r[1]! < r[2]!);
  })();

  const trend = lastRatio <= threshold ? "converged" :
    oscillating ? "oscillating" :
    plateau ? "plateau" :
    stalled ? "stalled" :
    totalImprovement > 0 ? "improving" : "regressing";

  return {
    trend,
    improvementRate: Math.round(improvementRate * 100) / 100,
    stalled,
    plateau,
    oscillating,
    ratioHistory: ratios,
    message: trend === "converged"
      ? `Converged at ${(lastRatio * 100).toFixed(2)}% mismatch after ${ratios.length} passes.`
      : trend === "stalled" && rawPlateau && reducibleMismatch > 0.005
      ? `Scores leveled off at ${(lastRatio * 100).toFixed(2)}% but ~${(reducibleMismatch * 100).toFixed(1)}% may still be reducible. Try lower-confidence suggestions.`
      : trend === "stalled"
      ? `Progress stalled at ${(lastRatio * 100).toFixed(2)}% mismatch. Consider a different approach for remaining issues.`
      : trend === "oscillating"
      ? `Oscillating around ${(lastRatio * 100).toFixed(2)}% mismatch. Try splitting the difference on changed properties.`
      : trend === "plateau"
      ? `Plateau at ${(lastRatio * 100).toFixed(2)}% mismatch. Remaining differences may be irreducible.`
      : trend === "improving"
      ? `Improving: ${(firstRatio * 100).toFixed(2)}% → ${(lastRatio * 100).toFixed(2)}% (${(improvementRate * 100).toFixed(0)}% improvement).`
      : `Regression detected: ${(firstRatio * 100).toFixed(2)}% → ${(lastRatio * 100).toFixed(2)}%.`
  };
}

/**
 * Scan HTML for Tailwind utility classes and emit equivalent inline CSS rules
 * so the page renders correctly even when the Tailwind CDN fails to load.
 */
function generateInlineStyles(html: string): string {
  // Collect all class="..." values
  const classAttrRe = /class="([^"]*)"/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = classAttrRe.exec(html)) !== null) {
    for (const cls of m[1].split(/\s+/).filter(Boolean)) {
      seen.add(cls);
    }
  }
  if (seen.size === 0) return "";

  // Tailwind spacing scale (rem)
  const spacingScale: Record<string, string> = {
    "0": "0px", "0.5": "0.125rem", "1": "0.25rem", "1.5": "0.375rem",
    "2": "0.5rem", "2.5": "0.625rem", "3": "0.75rem", "3.5": "0.875rem",
    "4": "1rem", "5": "1.25rem", "6": "1.5rem", "7": "1.75rem",
    "8": "2rem", "9": "2.25rem", "10": "2.5rem", "11": "2.75rem",
    "12": "3rem", "14": "3.5rem", "16": "4rem", "20": "5rem",
    "24": "6rem", "32": "8rem", "40": "10rem", "48": "12rem",
    "56": "14rem", "64": "16rem",
  };

  const rules: string[] = [];

  const escapeCls = (c: string) => c.replace(/([[\]#%().\/,])/g, "\\$1");

  for (const cls of seen) {
    let decl: string | null = null;

    // Layout
    if (cls === "w-full") decl = "width:100%";
    else if (cls === "h-full") decl = "height:100%";
    else if (cls === "min-h-screen") decl = "min-height:100vh";
    else if (cls === "max-w-full") decl = "max-width:100%";
    // Arbitrary values: w-[N%], w-[Npx], min-h-[Npx], h-[Npx], max-w-[Npx]
    else if (/^w-\[.+\]$/.test(cls)) decl = `width:${cls.slice(3, -1)}`;
    else if (/^h-\[.+\]$/.test(cls)) decl = `height:${cls.slice(3, -1)}`;
    else if (/^min-h-\[.+\]$/.test(cls)) decl = `min-height:${cls.slice(7, -1)}`;
    else if (/^max-w-\[.+\]$/.test(cls)) decl = `max-width:${cls.slice(7, -1)}`;

    // Flex
    else if (cls === "flex") decl = "display:flex";
    else if (cls === "inline-flex") decl = "display:inline-flex";
    else if (cls === "flex-col") decl = "flex-direction:column";
    else if (cls === "flex-row") decl = "flex-direction:row";
    else if (cls === "flex-wrap") decl = "flex-wrap:wrap";
    else if (cls === "flex-nowrap") decl = "flex-wrap:nowrap";
    else if (cls === "flex-1") decl = "flex:1 1 0%";
    else if (cls === "flex-none") decl = "flex:none";
    else if (cls === "items-center") decl = "align-items:center";
    else if (cls === "items-start") decl = "align-items:flex-start";
    else if (cls === "items-end") decl = "align-items:flex-end";
    else if (cls === "items-stretch") decl = "align-items:stretch";
    else if (cls === "justify-center") decl = "justify-content:center";
    else if (cls === "justify-between") decl = "justify-content:space-between";
    else if (cls === "justify-start") decl = "justify-content:flex-start";
    else if (cls === "justify-end") decl = "justify-content:flex-end";
    else if (cls === "justify-around") decl = "justify-content:space-around";

    // Grid
    else if (cls === "grid") decl = "display:grid";
    else if (/^grid-cols-(\d+)$/.test(cls)) {
      const n = cls.match(/^grid-cols-(\d+)$/)![1];
      decl = `grid-template-columns:repeat(${n},minmax(0,1fr))`;
    }

    // Gap
    else if (/^gap-\[.+\]$/.test(cls)) decl = `gap:${cls.slice(5, -1)}`;
    else if (/^gap-(\d+(?:\.\d+)?)$/.test(cls)) {
      const val = cls.match(/^gap-(.+)$/)![1];
      decl = spacingScale[val] ? `gap:${spacingScale[val]}` : null;
    }

    // Box
    else if (cls === "box-border") decl = "box-sizing:border-box";
    else if (cls === "overflow-hidden") decl = "overflow:hidden";
    else if (cls === "overflow-auto") decl = "overflow:auto";
    else if (cls === "relative") decl = "position:relative";
    else if (cls === "absolute") decl = "position:absolute";
    else if (cls === "hidden") decl = "display:none";
    else if (cls === "block") decl = "display:block";
    else if (cls === "inline-block") decl = "display:inline-block";

    // Background: bg-[#hex]
    else if (/^bg-\[#[0-9a-fA-F]+\]$/.test(cls)) decl = `background-color:${cls.slice(4, -1)}`;
    else if (/^bg-\[rgb/.test(cls)) decl = `background-color:${cls.slice(4, -1)}`;
    else if (cls === "bg-white") decl = "background-color:#ffffff";
    else if (cls === "bg-black") decl = "background-color:#000000";
    else if (cls === "bg-transparent") decl = "background-color:transparent";

    // Text color
    else if (/^text-\[#[0-9a-fA-F]+\]$/.test(cls)) decl = `color:${cls.slice(6, -1)}`;
    else if (cls === "text-white") decl = "color:#ffffff";
    else if (cls === "text-black") decl = "color:#000000";

    // Text size (arbitrary)
    else if (/^text-\[\d/.test(cls)) decl = `font-size:${cls.slice(6, -1)}`;
    // Text size (named)
    else if (cls === "text-xs") decl = "font-size:0.75rem;line-height:1rem";
    else if (cls === "text-sm") decl = "font-size:0.875rem;line-height:1.25rem";
    else if (cls === "text-base") decl = "font-size:1rem;line-height:1.5rem";
    else if (cls === "text-lg") decl = "font-size:1.125rem;line-height:1.75rem";
    else if (cls === "text-xl") decl = "font-size:1.25rem;line-height:1.75rem";
    else if (cls === "text-2xl") decl = "font-size:1.5rem;line-height:2rem";
    else if (cls === "text-3xl") decl = "font-size:1.875rem;line-height:2.25rem";
    else if (cls === "text-4xl") decl = "font-size:2.25rem;line-height:2.5rem";

    // Font weight
    else if (cls === "font-bold") decl = "font-weight:700";
    else if (cls === "font-semibold") decl = "font-weight:600";
    else if (cls === "font-medium") decl = "font-weight:500";
    else if (cls === "font-normal") decl = "font-weight:400";
    else if (cls === "font-light") decl = "font-weight:300";

    // Text align
    else if (cls === "text-center") decl = "text-align:center";
    else if (cls === "text-left") decl = "text-align:left";
    else if (cls === "text-right") decl = "text-align:right";

    // Padding: p-N, px-N, py-N, pt/pr/pb/pl-N, arbitrary p-[Npx]
    else if (/^p-\[.+\]$/.test(cls)) decl = `padding:${cls.slice(3, -1)}`;
    else if (/^p-(\d+(?:\.\d+)?)$/.test(cls)) {
      const val = cls.match(/^p-(.+)$/)![1];
      decl = spacingScale[val] ? `padding:${spacingScale[val]}` : null;
    }
    else if (/^px-(\d+(?:\.\d+)?)$/.test(cls)) {
      const val = cls.match(/^px-(.+)$/)![1];
      decl = spacingScale[val] ? `padding-left:${spacingScale[val]};padding-right:${spacingScale[val]}` : null;
    }
    else if (/^py-(\d+(?:\.\d+)?)$/.test(cls)) {
      const val = cls.match(/^py-(.+)$/)![1];
      decl = spacingScale[val] ? `padding-top:${spacingScale[val]};padding-bottom:${spacingScale[val]}` : null;
    }
    else if (/^pt-(\d+(?:\.\d+)?)$/.test(cls)) {
      const val = cls.match(/^pt-(.+)$/)![1];
      decl = spacingScale[val] ? `padding-top:${spacingScale[val]}` : null;
    }
    else if (/^pb-(\d+(?:\.\d+)?)$/.test(cls)) {
      const val = cls.match(/^pb-(.+)$/)![1];
      decl = spacingScale[val] ? `padding-bottom:${spacingScale[val]}` : null;
    }
    else if (/^pl-(\d+(?:\.\d+)?)$/.test(cls)) {
      const val = cls.match(/^pl-(.+)$/)![1];
      decl = spacingScale[val] ? `padding-left:${spacingScale[val]}` : null;
    }
    else if (/^pr-(\d+(?:\.\d+)?)$/.test(cls)) {
      const val = cls.match(/^pr-(.+)$/)![1];
      decl = spacingScale[val] ? `padding-right:${spacingScale[val]}` : null;
    }
    // Arbitrary padding
    else if (/^px-\[.+\]$/.test(cls)) decl = `padding-left:${cls.slice(4, -1)};padding-right:${cls.slice(4, -1)}`;
    else if (/^py-\[.+\]$/.test(cls)) decl = `padding-top:${cls.slice(4, -1)};padding-bottom:${cls.slice(4, -1)}`;

    // Margin: m-N, mx-N, my-N, mx-auto
    else if (cls === "mx-auto") decl = "margin-left:auto;margin-right:auto";
    else if (/^m-(\d+(?:\.\d+)?)$/.test(cls)) {
      const val = cls.match(/^m-(.+)$/)![1];
      decl = spacingScale[val] ? `margin:${spacingScale[val]}` : null;
    }
    else if (/^mx-(\d+(?:\.\d+)?)$/.test(cls)) {
      const val = cls.match(/^mx-(.+)$/)![1];
      decl = spacingScale[val] ? `margin-left:${spacingScale[val]};margin-right:${spacingScale[val]}` : null;
    }
    else if (/^my-(\d+(?:\.\d+)?)$/.test(cls)) {
      const val = cls.match(/^my-(.+)$/)![1];
      decl = spacingScale[val] ? `margin-top:${spacingScale[val]};margin-bottom:${spacingScale[val]}` : null;
    }
    else if (/^mt-(\d+(?:\.\d+)?)$/.test(cls)) {
      const val = cls.match(/^mt-(.+)$/)![1];
      decl = spacingScale[val] ? `margin-top:${spacingScale[val]}` : null;
    }
    else if (/^mb-(\d+(?:\.\d+)?)$/.test(cls)) {
      const val = cls.match(/^mb-(.+)$/)![1];
      decl = spacingScale[val] ? `margin-bottom:${spacingScale[val]}` : null;
    }

    // Rounded
    else if (cls === "rounded") decl = "border-radius:0.25rem";
    else if (cls === "rounded-lg") decl = "border-radius:0.5rem";
    else if (cls === "rounded-xl") decl = "border-radius:0.75rem";
    else if (cls === "rounded-2xl") decl = "border-radius:1rem";
    else if (cls === "rounded-full") decl = "border-radius:9999px";
    else if (/^rounded-\[.+\]$/.test(cls)) decl = `border-radius:${cls.slice(9, -1)}`;

    // Border
    else if (cls === "border") decl = "border-width:1px";
    else if (/^border-\[#[0-9a-fA-F]+\]$/.test(cls)) decl = `border-color:${cls.slice(8, -1)}`;

    // Shadow
    else if (cls === "shadow") decl = "box-shadow:0 1px 3px 0 rgba(0,0,0,0.1),0 1px 2px -1px rgba(0,0,0,0.1)";
    else if (cls === "shadow-lg") decl = "box-shadow:0 10px 15px -3px rgba(0,0,0,0.1),0 4px 6px -4px rgba(0,0,0,0.1)";

    // Inset positioning
    else if (cls === "inset-0") decl = "top:0;right:0;bottom:0;left:0";
    else if (/^top-\[.+\]$/.test(cls)) decl = `top:${cls.slice(5, -1)}`;
    else if (/^left-\[.+\]$/.test(cls)) decl = `left:${cls.slice(6, -1)}`;
    else if (/^right-\[.+\]$/.test(cls)) decl = `right:${cls.slice(7, -1)}`;
    else if (/^bottom-\[.+\]$/.test(cls)) decl = `bottom:${cls.slice(8, -1)}`;

    if (decl) {
      rules.push(`.${escapeCls(cls)}{${decl}}`);
    }
  }

  if (rules.length === 0) return "";
  return `<style>/* Tailwind fallback — renders without CDN */\n${rules.join("\n")}\n</style>`;
}

/**
 * Convert Tailwind+React TSX to plain HTML that renders
 * without React, Babel, or any runtime transpilation.
 * Keeps Tailwind CDN for utility classes but emits plain HTML (not JSX).
 * Includes inline CSS fallback so styling works even when CDN is unavailable.
 */
function wrapAsStaticHtml(tsx: string): string {
  // Extract the JSX body from the component function
  let body = tsx
    // Remove React import
    .replace(/^import\s+React\s+from\s+["']react["'];?\s*\n?/m, "")
    // Remove component wrapper: "export default function Page() {\n  return (\n"
    .replace(/^export\s+default\s+function\s+\w+\(\)\s*\{\s*\n\s*return\s*\(\s*\n?/m, "")
    // Remove closing ");\n}" at the end
    .replace(/\s*\);\s*\}\s*$/, "");

  // Convert JSX to HTML:
  // 1. className → class
  body = body.replace(/\bclassName=/g, "class=");
  // 2. Self-closing tags like <div class="..." /> → <div class="..."></div>
  body = body.replace(/<(\w+)(\s[^>]*?)\s*\/>/g, "<$1$2></$1>");
  // 3. JSX escaped braces &#123; &#125; back to { }
  body = body.replace(/&#123;/g, "{").replace(/&#125;/g, "}");

  // Generate inline CSS fallback from Tailwind classes used in the body
  const inlineStyles = generateInlineStyles(body);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UI Scaffold</title>
  ${inlineStyles}
  <script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * @deprecated Use wrapAsStaticHtml instead. Kept for backward compatibility with .tsx/.jsx capture.
 */
function wrapTailwindReactAsHtml(tsx: string): string {
  return wrapAsStaticHtml(tsx);
}
