import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import {
  VERSION,
  buildSemanticAnchors,
  compareReportSchema,
  type Bounds,
  type CompareIssue,
  type LayoutNode,
  type SemanticAnchor,
  type TextBlock
} from "@one-shot-ui/core";
import { detectBackgroundColor, loadImage } from "@one-shot-ui/image-io";
import { clusterComponents } from "@one-shot-ui/vision-components";
import { detectLayoutBoxes, measureSpacing } from "@one-shot-ui/vision-layout";
import { detectGradient, detectShadow, estimateBorderRadius, estimateNodeFill, extractDominantColors } from "@one-shot-ui/vision-style";
import { extractText, type ExtractTextOptions } from "@one-shot-ui/vision-text";
import { segmentMismatch } from "./segmented-mismatch.js";
import { detectLayoutCollapse } from "./layout-collapse.js";
import { collapseReflowCascade } from "./reflow.js";

export interface CompareImagesOptions {
  heatmapPath?: string;
  top?: number;
  confidenceThreshold?: number;
  disableOcr?: boolean;
  region?: string;
  crop?: Bounds;
}

interface FocusDiagnostics {
  requestedRegion: string | null;
  bounds: Bounds | null;
  semanticCoverage: number;
  realAnchorCount: number;
  syntheticAnchorCount: number;
  fallbackToPixelOnly: boolean;
}

export async function compareImages(
  referencePath: string,
  implementationPath: string,
  heatmapPathOrOptions?: string | CompareImagesOptions
) {
  const options: CompareImagesOptions = typeof heatmapPathOrOptions === "string"
    ? { heatmapPath: heatmapPathOrOptions }
    : heatmapPathOrOptions ?? {};

  const top = options.top ?? 20;
  const confidenceThreshold = options.confidenceThreshold ?? 0.3;
  const textOptions: ExtractTextOptions = { disableOcr: options.disableOcr };

  const [referenceImage, implementationImage, referenceText, implementationText] = await Promise.all([
    loadImage(referencePath),
    loadImage(implementationPath),
    extractText(referencePath, textOptions),
    extractText(implementationPath, textOptions)
  ]);

  const refBg = detectBackgroundColor(referenceImage);
  const implBg = detectBackgroundColor(implementationImage);
  const fullReferenceLayout = clusterComponents(enrichLayoutNodes(referenceImage, detectLayoutBoxes(referenceImage), refBg)).nodes;
  const referenceColors = extractDominantColors(referenceImage);
  const fullImplementationLayout = clusterComponents(enrichLayoutNodes(implementationImage, detectLayoutBoxes(implementationImage), implBg)).nodes;
  const referenceAnchors = buildSemanticAnchors(fullReferenceLayout, referenceText, {
    width: referenceImage.width,
    height: referenceImage.height
  });
  const focusBounds = resolveFocusBounds(options.region, options.crop, referenceAnchors, referenceImage.width, referenceImage.height);
  const focusDiagnostics = analyzeFocusCoverage(referenceAnchors, focusBounds, options.region);
  const referenceLayout = filterNodesByBounds(fullReferenceLayout, focusBounds);
  const implementationLayout = filterNodesByBounds(fullImplementationLayout, focusBounds);
  const scopedReferenceText = filterTextByBounds(referenceText, focusBounds);
  const scopedImplementationText = filterTextByBounds(implementationText, focusBounds);
  const referenceSpacing = measureSpacing(referenceLayout);
  const implementationSpacing = measureSpacing(implementationLayout);

  const width = focusBounds
    ? Math.max(0, Math.min(focusBounds.width, referenceImage.width - focusBounds.x, implementationImage.width - focusBounds.x))
    : Math.min(referenceImage.width, implementationImage.width);
  const height = focusBounds
    ? Math.max(0, Math.min(focusBounds.height, referenceImage.height - focusBounds.y, implementationImage.height - focusBounds.y))
    : Math.min(referenceImage.height, implementationImage.height);
  const referencePng = new PNG({ width, height });
  const implementationPng = new PNG({ width, height });
  const startX = focusBounds?.x ?? 0;
  const startY = focusBounds?.y ?? 0;

  for (let y = 0; y < height; y++) {
    const sourceY = startY + y;
    const referenceRowOffset = (sourceY * referenceImage.width + startX) * referenceImage.channels;
    const implementationRowOffset = (sourceY * implementationImage.width + startX) * implementationImage.channels;
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

  const segmented = segmentMismatch(
    diff.data, width, height,
    referencePng.data, width, 4,
    referenceLayout, startX, startY
  );

  const gridBreakdown = computeGridRegionBreakdown(diff.data, width, height);
  const verticalShift = computeVerticalShift(diff.data, width, height);

  const issues: CompareIssue[] = [];
  if (referenceImage.width !== implementationImage.width || referenceImage.height !== implementationImage.height) {
    issues.push({
      code: "DIMENSION_MISMATCH",
      severity: "high",
      message: "Reference and implementation images have different dimensions.",
      suggestedFix: `Resize the implementation canvas to ${referenceImage.width}x${referenceImage.height}.`,
      reference: { width: referenceImage.width, height: referenceImage.height },
      implementation: { width: implementationImage.width, height: implementationImage.height }
    });
  }

  const rawMismatchRatio = width * height === 0 ? 0 : mismatchPixels / (width * height);

  // Structural similarity: compute edge density for reference and implementation
  // to detect "empty colored boxes" that color-match but lack structural detail
  const refEdgeCount = countEdgePixels(referencePng.data, width, height);
  const implEdgeCount = countEdgePixels(implementationPng.data, width, height);
  const refEdgeDensity = (width * height) > 0 ? refEdgeCount / (width * height) : 0;
  const implEdgeDensity = (width * height) > 0 ? implEdgeCount / (width * height) : 0;
  const edgeDensityRatio = refEdgeDensity > 0 ? implEdgeDensity / refEdgeDensity : 1;
  const lowComplexity = edgeDensityRatio < 0.4 && refEdgeDensity > 0.01;
  const complexityPenalty = lowComplexity ? 1.5 : 1.0;
  const mismatchRatio = Math.min(1, rawMismatchRatio * complexityPenalty);

  if (lowComplexity) {
    issues.push({
      code: "LOW_STRUCTURAL_COMPLEXITY",
      severity: "high",
      message: `Implementation has ${(edgeDensityRatio * 100).toFixed(0)}% of reference edge density — likely flat colored boxes without real content. Mismatch adjusted upward (${(rawMismatchRatio * 100).toFixed(2)}% raw → ${(mismatchRatio * 100).toFixed(2)}% adjusted).`,
      suggestedFix: "Add text content, borders, icons, and semantic HTML elements to match the reference structure.",
      reference: { edgeDensity: refEdgeDensity, edgePixels: refEdgeCount },
      implementation: { edgeDensity: implEdgeDensity, edgePixels: implEdgeCount }
    });
  }

  if (mismatchRatio > 0.01) {
    issues.push({
      code: "PIXEL_DIFFERENCE",
      severity: mismatchRatio > 0.08 ? "high" : "medium",
      message: `Pixel mismatch ratio is ${(mismatchRatio * 100).toFixed(2)}%${lowComplexity ? ` (raw: ${(rawMismatchRatio * 100).toFixed(2)}%, adjusted for low structural complexity)` : ""}.`,
      suggestedFix: "Use the structural issues below to correct layout and style mismatches before relying on pixel polish.",
      reference: { mismatchPixels },
      implementation: { mismatchRatio }
    });
  }

  if (focusDiagnostics.fallbackToPixelOnly) {
    issues.push({
      code: "REGION_SEMANTIC_FALLBACK",
      severity: "medium",
      anchorName: options.region,
      message: `Semantic coverage inside ${options.region} is too thin for trusted anchor-level issues.`,
      suggestedFix: `Falling back to scoped pixel diff only. Coverage is ${(focusDiagnostics.semanticCoverage * 100).toFixed(1)}% across ${focusDiagnostics.realAnchorCount} real anchors.`,
      reference: {
        semanticCoverage: focusDiagnostics.semanticCoverage,
        realAnchorCount: focusDiagnostics.realAnchorCount,
        syntheticAnchorCount: focusDiagnostics.syntheticAnchorCount
      }
    });
  }

  if (referenceLayout.length !== implementationLayout.length) {
    issues.push({
      code: "LAYOUT_COUNT_MISMATCH",
      severity: "medium",
      message: describeScope(`Detected layout region counts do not match`, focusBounds, options.region),
      reference: { layoutNodes: referenceLayout.length },
      implementation: { layoutNodes: implementationLayout.length }
    });
  }

  if (scopedReferenceText.length !== scopedImplementationText.length) {
    issues.push({
      code: "TEXT_COUNT_MISMATCH",
      severity: "low",
      message: describeScope("OCR text block counts do not match", focusBounds, options.region),
      reference: { textBlocks: scopedReferenceText.length },
      implementation: { textBlocks: scopedImplementationText.length }
    });
  }

  const layoutMatches = matchLayoutNodes(referenceLayout, implementationLayout);
  const matchedImplementationIds = new Set(layoutMatches.map((match) => match.implementation.id));

  // Loudly flag when layout matching collapsed (e.g. uniform dark fills, mobile surfaces)
  // instead of silently emitting phantom structural fixes from zero real matches.
  const layoutCollapse = detectLayoutCollapse({
    referenceNodeCount: referenceLayout.length,
    matchedNodeCount: layoutMatches.length,
  });
  if (layoutCollapse) {
    issues.push(layoutCollapse);
  }

  const totalImageArea = width * height;

  if (!focusDiagnostics.fallbackToPixelOnly) {
    for (const match of layoutMatches) {
      issues.push(...compareMatchedNodes(match.reference, match.implementation, referenceAnchors, totalImageArea, width, height));
    }

    for (const node of referenceLayout) {
      if (layoutMatches.some((match) => match.reference.id === node.id)) {
        continue;
      }
      // Check if this node overlaps significantly with a matched implementation node
      const overlapsMatched = layoutMatches.some((match) => {
        const overlapW = Math.max(0,
          Math.min(node.bounds.x + node.bounds.width, match.implementation.bounds.x + match.implementation.bounds.width) -
          Math.max(node.bounds.x, match.implementation.bounds.x));
        const overlapH = Math.max(0,
          Math.min(node.bounds.y + node.bounds.height, match.implementation.bounds.y + match.implementation.bounds.height) -
          Math.max(node.bounds.y, match.implementation.bounds.y));
        const overlapArea = overlapW * overlapH;
        const nodeArea = node.bounds.width * node.bounds.height;
        return nodeArea > 0 && overlapArea / nodeArea > 0.6;
      });

      if (overlapsMatched) {
        continue; // Skip — this node is mostly covered by an existing implementation node
      }

      // Check for "matched but imprecise": an unmatched impl node at roughly
      // the same position and size but with different color/gradient
      const nearbyImpl = implementationLayout.find(impl => {
        if (matchedImplementationIds.has(impl.id)) return false;
        const dx = Math.abs(impl.bounds.x - node.bounds.x);
        const dy = Math.abs(impl.bounds.y - node.bounds.y);
        const dw = Math.abs(impl.bounds.width - node.bounds.width);
        const dh = Math.abs(impl.bounds.height - node.bounds.height);
        return dx <= 20 && dy <= 20 && dw <= 20 && dh <= 20;
      });

      if (nearbyImpl) {
        const anchor = resolveAnchor(referenceAnchors, node);
        const nodeVw = Math.min(1, (node.bounds.width * node.bounds.height) / Math.max(1, totalImageArea));
        issues.push({
          code: "COLOR_MISMATCH_AT_POSITION",
          nodeId: node.id,
          anchorId: anchor?.id,
          anchorName: anchor?.name,
          contextPath: buildContextPath(anchor, referenceAnchors),
          severity: "medium",
          message: `${describeAnchor(anchor, node.id)} exists at the expected position but has wrong color/style.`,
          suggestedFix: `Change the fill color to ${node.fill ?? "match reference"}.`,
          reference: { bounds: node.bounds, fill: node.fill, borderRadius: node.borderRadius },
          implementation: { bounds: nearbyImpl.bounds, fill: nearbyImpl.fill, borderRadius: nearbyImpl.borderRadius },
          issueBounds: node.bounds,
          visualWeight: nodeVw
        });
        matchedImplementationIds.add(nearbyImpl.id);
        continue;
      }

      const anchor = resolveAnchor(referenceAnchors, node);
      const nodeVw = Math.min(1, (node.bounds.width * node.bounds.height) / Math.max(1, totalImageArea));
      const anchorLabel = describeAnchor(anchor, describeNodePosition(node.bounds, width, height));
      const fillDesc = node.fill ? ` with background ${node.fill}` : "";
      const sizeDesc = `${node.bounds.width}x${node.bounds.height}px`;
      const selectorHint = anchor
        ? `.${anchor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`
        : undefined;
      issues.push({
        code: "MISSING_NODE",
        nodeId: node.id,
        anchorId: anchor?.id,
        anchorName: anchor?.name,
        contextPath: buildContextPath(anchor, referenceAnchors),
        cssSelector: selectorHint,
        severity: "high",
        message: `Missing element in ${anchor?.name ?? "page"}: ${sizeDesc} ${describeNodePosition(node.bounds, width, height)} region${fillDesc}.`,
        suggestedFix: `Add a ${sizeDesc} element${fillDesc}${node.borderRadius ? ` with border-radius: ${node.borderRadius}px` : ""} inside ${anchor?.name ?? "the page layout"}.`,
        reference: { bounds: node.bounds, fill: node.fill, borderRadius: node.borderRadius },
        issueBounds: node.bounds,
        visualWeight: nodeVw
      });
    }

    for (const node of implementationLayout) {
      if (matchedImplementationIds.has(node.id)) {
        continue;
      }
      if (isSubElementArtifact(node, layoutMatches)) {
        continue;
      }
      const anchor = findClosestAnchor(referenceAnchors, node.bounds);
      const nodeVw = Math.min(1, (node.bounds.width * node.bounds.height) / Math.max(1, totalImageArea));
      issues.push({
        code: "EXTRA_NODE",
        nodeId: node.id,
        anchorId: anchor?.id,
        anchorName: anchor?.name,
        contextPath: buildContextPath(anchor, referenceAnchors),
        severity: "medium",
        message: `The implementation has an extra surface near ${describeAnchor(anchor, describeNodePosition(node.bounds, width, height))}.`,
        suggestedFix: "Remove the extra surface or merge it into an existing component.",
        implementation: { bounds: node.bounds, fill: node.fill, borderRadius: node.borderRadius },
        issueBounds: node.bounds,
        visualWeight: nodeVw
      });
    }

    issues.push(...compareSpacing(referenceSpacing, implementationSpacing, layoutMatches, referenceAnchors));
    issues.push(...compareText(scopedReferenceText, scopedImplementationText));
  }

  let normalizedHeatmapPath: string | null = null;
  const regionHeatmaps: Array<{ region: string; heatmapPath: string; bounds: Bounds; mismatchRatio: number }> = [];

  if (options.heatmapPath) {
    normalizedHeatmapPath = resolve(options.heatmapPath);
    await mkdir(dirname(normalizedHeatmapPath), { recursive: true });
    await writeFile(normalizedHeatmapPath, PNG.sync.write(diff));

    // Per-region heatmaps
    const topLevelAnchors = referenceAnchors.filter(a => a.parentId === null);
    const baseName = normalizedHeatmapPath.replace(/\.png$/i, "");

    for (const anchor of topLevelAnchors) {
      const rb = anchor.bounds;
      const regionStartX = Math.max(0, rb.x - startX);
      const regionStartY = Math.max(0, rb.y - startY);
      const regionWidth = Math.min(rb.width, width - regionStartX);
      const regionHeight = Math.min(rb.height, height - regionStartY);

      if (regionWidth <= 0 || regionHeight <= 0) continue;

      const regionDiff = new PNG({ width: regionWidth, height: regionHeight });
      for (let y = 0; y < regionHeight; y++) {
        for (let x = 0; x < regionWidth; x++) {
          const srcIdx = ((regionStartY + y) * width + (regionStartX + x)) * 4;
          const dstIdx = (y * regionWidth + x) * 4;
          regionDiff.data[dstIdx] = diff.data[srcIdx] ?? 0;
          regionDiff.data[dstIdx + 1] = diff.data[srcIdx + 1] ?? 0;
          regionDiff.data[dstIdx + 2] = diff.data[srcIdx + 2] ?? 0;
          regionDiff.data[dstIdx + 3] = diff.data[srcIdx + 3] ?? 255;
        }
      }

      // Count mismatched pixels in this region (diff color is [255, 64, 64])
      let regionMismatch = 0;
      for (let i = 0; i < regionDiff.data.length; i += 4) {
        if (regionDiff.data[i]! > 200 && regionDiff.data[i + 1]! < 100) {
          regionMismatch++;
        }
      }

      const regionSlug = anchor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const regionHeatmapPath = `${baseName}-${regionSlug}.png`;
      await mkdir(dirname(regionHeatmapPath), { recursive: true });
      await writeFile(regionHeatmapPath, PNG.sync.write(regionDiff));

      regionHeatmaps.push({
        region: anchor.name,
        heatmapPath: resolve(regionHeatmapPath),
        bounds: rb,
        mismatchRatio: regionWidth * regionHeight === 0 ? 0 : regionMismatch / (regionWidth * regionHeight)
      });
    }
  }

  // Categorize issues and tag actionability
  for (const issue of issues) {
    issue.category = categorizeIssue(issue, segmented.contentRegions, startX, startY);
    issue.actionable = issue.category !== "content" && issue.category !== "typography";
  }

  // Tag content-category issues as non-actionable with explanation
  for (const issue of issues) {
    if (issue.category === "content" && issue.actionable === false) {
      issue.message += " (non-actionable: photographic/dynamic content that cannot be replicated with CSS)";
    } else if (issue.category === "typography" && issue.actionable === false) {
      issue.message += " (non-actionable: font rendering differences are often irreducible)";
    }
  }

  // Collapse reflow: a removed/added element shifts everything below it; report that as one note
  // rather than N independent (often contradictory) position fixes.
  const dereflowed = collapseReflowCascade(issues);

  // Filter low-contribution issues: suppress issues whose mismatch contribution is <1% of total
  const filteredByContribution = dereflowed.filter(issue => {
    if (!issue.issueBounds) return true; // Keep issues without bounds (PIXEL_DIFFERENCE, etc.)
    if (issue.code === "DIMENSION_MISMATCH" || issue.code === "PIXEL_DIFFERENCE" || issue.code === "REGION_SEMANTIC_FALLBACK") return true;
    const issueBoundsArea = issue.issueBounds.width * issue.issueBounds.height;
    const totalArea = width * height;
    if (totalArea === 0) return true;
    const contribution = issueBoundsArea / totalArea;
    return contribution >= 0.01;
  });

  // Noise reduction: filter low-confidence issues and cap the list
  const filteredIssues = applyNoiseReduction(sortIssues(filteredByContribution), confidenceThreshold, top);

  // Compute irreducible mismatch estimate from content-category issues
  const contentIssueArea = filteredIssues
    .filter(i => i.category === "content" && i.issueBounds)
    .reduce((sum, i) => sum + (i.issueBounds!.width * i.issueBounds!.height), 0);
  const irreducibleEstimate = (width * height) > 0
    ? Math.min(segmented.contentRatio, contentIssueArea / (width * height)) + segmented.contentRatio * 0.5
    : segmented.contentRatio;
  // Cap at mismatchRatio (can't be more irreducible than total mismatch)
  const clampedIrreducible = Math.min(irreducibleEstimate, mismatchRatio);

  const groupedIssues = groupIssuesBySection(filteredIssues, referenceAnchors);
  const topEditCandidates = buildTopEditCandidates(filteredIssues, referenceAnchors, width, height);

  // Compute visual hierarchy score (0-100)
  const hierarchyScore = computeHierarchyScore(
    referencePng.data, implementationPng.data, width, height,
    referenceLayout, implementationLayout
  );

  return compareReportSchema.parse({
    version: VERSION,
    referenceImage,
    implementationImage,
    summary: {
      mismatchPixels,
      mismatchRatio,
      rawMismatch: rawMismatchRatio,
      adjustedMismatch: mismatchRatio,
      structuralComplexity: {
        referenceEdgeDensity: refEdgeDensity,
        implementationEdgeDensity: implEdgeDensity,
        edgeDensityRatio,
        penaltyApplied: lowComplexity,
        penaltyMultiplier: complexityPenalty,
      },
      matchedLayoutNodes: layoutMatches.length,
      widthDelta: implementationImage.width - referenceImage.width,
      heightDelta: implementationImage.height - referenceImage.height,
      focus: focusDiagnostics,
      segmented: {
        structuralMismatch: segmented.structuralRatio,
        contentMismatch: segmented.contentRatio,
        contentRegionCount: segmented.contentRegions.length,
        irreducibleEstimate: clampedIrreducible,
      },
      hierarchyScore,
      gridBreakdown: gridBreakdown.length > 0 ? gridBreakdown : undefined,
      verticalShift: verticalShift.confidence > 0 ? verticalShift : undefined,
    },
    issues: filteredIssues,
    groupedIssues,
    topEditCandidates,
    referenceColors: referenceColors.slice(0, 8),
    artifacts: {
      heatmapPath: normalizedHeatmapPath,
      regionHeatmaps: regionHeatmaps.length > 0 ? regionHeatmaps : undefined
    }
  });
}

/**
 * Detect global vertical displacement by projecting the diff onto the Y axis.
 * Returns the estimated pixel offset and a confidence score (0–1) indicating how
 * "banded" (i.e. shift-like) the mismatch is versus uniformly spread.
 * Positive pixelOffset means content appears shifted downward in the implementation.
 */
function computeVerticalShift(
  diffData: { readonly [index: number]: number },
  width: number,
  height: number
): { pixelOffset: number; confidence: number } {
  if (width === 0 || height === 0) return { pixelOffset: 0, confidence: 0 };

  // Project mismatch pixel counts onto the Y axis
  const rowCounts = new Array<number>(height).fill(0);
  let totalMismatch = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = diffData[idx] ?? 0;
      const g = diffData[idx + 1] ?? 0;
      const isMismatch = (r > 200 && g < 100) || (r < 100 && g > 120);
      if (isMismatch) {
        rowCounts[y]!++;
        totalMismatch++;
      }
    }
  }

  if (totalMismatch === 0) return { pixelOffset: 0, confidence: 0 };

  // Find highest-density band using a sliding window of 20 rows
  const windowSize = Math.min(20, height);
  let bestBandStart = 0;
  let bestBandCount = 0;

  // Compute initial window sum
  let windowSum = 0;
  for (let i = 0; i < windowSize; i++) windowSum += rowCounts[i]!;
  bestBandCount = windowSum;

  for (let start = 1; start <= height - windowSize; start++) {
    windowSum -= rowCounts[start - 1]!;
    windowSum += rowCounts[start + windowSize - 1]!;
    if (windowSum > bestBandCount) {
      bestBandCount = windowSum;
      bestBandStart = start;
    }
  }

  // Median Y of the top band
  const bandMidY = bestBandStart + Math.floor(windowSize / 2);
  const pixelOffset = bandMidY - Math.floor(height / 2);

  // Confidence: fraction of all mismatch pixels that fall within the top band
  const confidence = totalMismatch > 0 ? bestBandCount / totalMismatch : 0;

  return { pixelOffset, confidence };
}

/**
 * Divide the diff image into a 3×3 grid and compute per-cell mismatch ratios.
 * Returns cells sorted descending by contribution (share of total mismatch pixels).
 */
function computeGridRegionBreakdown(
  diffData: { readonly [index: number]: number },
  width: number,
  height: number,
  cols = 3,
  rows = 3
): Array<{ label: string; mismatchRatio: number; contribution: number }> {
  if (width === 0 || height === 0) return [];

  const regionLabels = [
    ["top-left", "top-center", "top-right"],
    ["center-left", "center", "center-right"],
    ["bottom-left", "bottom-center", "bottom-right"]
  ];

  const cellMismatch = new Array<number>(cols * rows).fill(0);
  const cellPixels = new Array<number>(cols * rows).fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const col = Math.min(cols - 1, Math.floor((x * cols) / width));
      const row = Math.min(rows - 1, Math.floor((y * rows) / height));
      const cellIdx = row * cols + col;
      const idx = (y * width + x) * 4;
      const r = diffData[idx] ?? 0;
      const g = diffData[idx + 1] ?? 0;
      const isMismatch = (r > 200 && g < 100) || (r < 100 && g > 120);
      cellPixels[cellIdx]!++;
      if (isMismatch) cellMismatch[cellIdx]!++;
    }
  }

  const totalMismatch = cellMismatch.reduce((a, b) => a + b, 0);

  return cellMismatch
    .map((mismatch, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const label = regionLabels[row]?.[col] ?? `region-${i}`;
      const pixels = cellPixels[i] ?? 1;
      return {
        label,
        mismatchRatio: pixels > 0 ? mismatch / pixels : 0,
        contribution: totalMismatch > 0 ? mismatch / totalMismatch : 0
      };
    })
    .sort((a, b) => b.contribution - a.contribution);
}

function analyzeFocusCoverage(
  anchors: SemanticAnchor[],
  focusBounds: Bounds | undefined,
  regionName: string | undefined
): FocusDiagnostics {
  if (!focusBounds) {
    return {
      requestedRegion: regionName ?? null,
      bounds: null,
      semanticCoverage: 1,
      realAnchorCount: anchors.filter((anchor) => anchor.nodeId !== null).length,
      syntheticAnchorCount: anchors.filter((anchor) => anchor.nodeId === null).length,
      fallbackToPixelOnly: false
    };
  }

  const overlappingAnchors = anchors.filter((anchor) => overlaps(anchor.bounds, focusBounds));
  const realAnchors = overlappingAnchors.filter((anchor) => anchor.nodeId !== null);
  const syntheticAnchors = overlappingAnchors.filter((anchor) => anchor.nodeId === null);
  const focusArea = Math.max(1, focusBounds.width * focusBounds.height);
  const realCoverageArea = realAnchors.reduce((sum, anchor) => sum + overlapArea(anchor.bounds, focusBounds), 0);
  const semanticCoverage = clamp(realCoverageArea / focusArea, 0, 1);
  const fallbackToPixelOnly = Boolean(regionName) && (realAnchors.length < 2 || semanticCoverage < 0.12);

  return {
    requestedRegion: regionName ?? null,
    bounds: focusBounds,
    semanticCoverage,
    realAnchorCount: realAnchors.length,
    syntheticAnchorCount: syntheticAnchors.length,
    fallbackToPixelOnly
  };
}

/**
 * Noise reduction: filter out EXTRA_NODE issues where the extra region is small
 * and fully contained within a matched implementation node (sub-element artifact).
 */
function isSubElementArtifact(
  node: LayoutNode,
  matches: Array<{ reference: LayoutNode; implementation: LayoutNode }>
): boolean {
  const nodeArea = node.bounds.width * node.bounds.height;

  for (const match of matches) {
    const impl = match.implementation;
    const implArea = impl.bounds.width * impl.bounds.height;

    // Check if the extra node is fully contained within a matched node
    const contained =
      node.bounds.x >= impl.bounds.x &&
      node.bounds.y >= impl.bounds.y &&
      node.bounds.x + node.bounds.width <= impl.bounds.x + impl.bounds.width &&
      node.bounds.y + node.bounds.height <= impl.bounds.y + impl.bounds.height;

    if (contained && nodeArea < implArea * 0.5) {
      return true;
    }
  }

  return false;
}

/**
 * Applies noise reduction heuristics:
 * - Merges nearby small regions that likely represent the same issue
 * - Filters issues below confidence threshold based on severity
 * - Caps the issue list at the specified maximum
 */
function applyNoiseReduction(
  issues: CompareIssue[],
  confidenceThreshold: number,
  maxIssues: number
): CompareIssue[] {
  let filtered = issues;

  // Suppress low-value EXTRA_NODE issues when they dominate the list
  const extraNodeCount = filtered.filter((i) => i.code === "EXTRA_NODE").length;
  const nonExtraCount = filtered.length - extraNodeCount;
  if (extraNodeCount > nonExtraCount * 2 && extraNodeCount > 5) {
    // Keep only the largest EXTRA_NODE issues
    const extraNodes = filtered.filter((i) => i.code === "EXTRA_NODE");
    const nonExtraNodes = filtered.filter((i) => i.code !== "EXTRA_NODE");

    const sortedExtra = extraNodes.sort((a, b) => {
      const aArea = getIssueBoundsArea(a);
      const bArea = getIssueBoundsArea(b);
      return bArea - aArea;
    });

    filtered = [...nonExtraNodes, ...sortedExtra.slice(0, Math.max(5, nonExtraCount))];
    filtered = sortIssues(filtered);
  }

  // Suppress small MISSING_NODE issues that are likely detection noise
  const minMissingArea = 400; // 20x20 px minimum
  filtered = filtered.filter((issue) => {
    if (issue.code !== "MISSING_NODE") return true;
    const ref = issue.reference as { bounds?: { width: number; height: number } } | undefined;
    if (!ref?.bounds) return true;
    return ref.bounds.width * ref.bounds.height >= minMissingArea;
  });

  // Suppress MISSING_NODE when the count exceeds structural nodes
  const missingCount = filtered.filter((i) => i.code === "MISSING_NODE").length;
  const structuralCodes = ["POSITION_MISMATCH", "SIZE_MISMATCH", "COLOR_MISMATCH", "BORDER_RADIUS_MISMATCH"];
  const structuralCount = filtered.filter((i) => structuralCodes.includes(i.code)).length;
  if (missingCount > structuralCount * 3 && missingCount > 5) {
    const missing = filtered.filter((i) => i.code === "MISSING_NODE");
    const nonMissing = filtered.filter((i) => i.code !== "MISSING_NODE");
    const sortedMissing = missing.sort((a, b) => getIssueBoundsArea(b) - getIssueBoundsArea(a));
    filtered = [...nonMissing, ...sortedMissing.slice(0, Math.max(3, structuralCount))];
    filtered = sortIssues(filtered);
  }

  // Cap at max issues
  return filtered.slice(0, maxIssues);
}

/**
 * Categorize an issue into: layout, color, typography, or content.
 *
 * Content regions are areas with high color variance (photographic).
 * Issues that fall inside content regions are classified as "content".
 */
function categorizeIssue(
  issue: CompareIssue,
  contentRegions: Array<{ bounds: Bounds; area: number }>,
  startX: number,
  startY: number
): "layout" | "color" | "typography" | "content" {
  // POSITION_MISMATCH and SIZE_MISMATCH are always CSS-fixable — never classify as content
  if (issue.code === "POSITION_MISMATCH" || issue.code === "SIZE_MISMATCH") {
    return "layout";
  }

  // Check if the issue falls inside a content region (photographic)
  // Only classify as content if >=80% of the issue overlaps with photographic regions
  if (issue.issueBounds) {
    for (const region of contentRegions) {
      const oArea = computeOverlapArea(issue.issueBounds, region.bounds);
      const issueArea = issue.issueBounds.width * issue.issueBounds.height;
      if (issueArea > 0 && oArea / issueArea > 0.8) {
        return "content";
      }
    }
  }

  // Typography issues
  if (issue.code === "FONT_SIZE_MISMATCH" || issue.code === "FONT_WEIGHT_MISMATCH" || issue.code === "FONT_FAMILY_MISMATCH") {
    return "typography";
  }

  // Color issues
  if (issue.code === "COLOR_MISMATCH" || issue.code === "COLOR_MISMATCH_AT_POSITION" || issue.code === "GRADIENT_MISMATCH") {
    return "color";
  }

  // Layout issues (position, size, spacing, missing/extra nodes, shadows, border-radius)
  return "layout";
}

function getIssueBoundsArea(issue: CompareIssue): number {
  const impl = issue.implementation as { bounds?: { width: number; height: number } } | undefined;
  if (impl?.bounds) {
    return impl.bounds.width * impl.bounds.height;
  }
  const ref = issue.reference as { bounds?: { width: number; height: number } } | undefined;
  if (ref?.bounds) {
    return ref.bounds.width * ref.bounds.height;
  }
  return 0;
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

function matchLayoutNodes(referenceNodes: LayoutNode[], implementationNodes: LayoutNode[]) {
  const available = new Set(implementationNodes.map((node) => node.id));
  const matches: Array<{ reference: LayoutNode; implementation: LayoutNode; score: number }> = [];

  for (const reference of referenceNodes) {
    let best: { node: LayoutNode; score: number } | null = null;

    for (const implementation of implementationNodes) {
      if (!available.has(implementation.id)) {
        continue;
      }
      const score = layoutSimilarity(reference, implementation);
      if (score > 0.5 && (!best || score > best.score)) {
        best = { node: implementation, score };
      }
    }

    if (best) {
      available.delete(best.node.id);
      matches.push({ reference, implementation: best.node, score: best.score });
    }
  }

  return matches;
}

function compareMatchedNodes(reference: LayoutNode, implementation: LayoutNode, anchors: SemanticAnchor[], totalImageArea = 1, imageWidth = 0, imageHeight = 0): CompareIssue[] {
  const issues: CompareIssue[] = [];
  const anchor = resolveAnchor(anchors, reference);
  const anchorName = describeAnchor(anchor, reference.id);
  const contextPath = buildContextPath(anchor, anchors);
  const nodeArea = reference.bounds.width * reference.bounds.height;
  const vw = Math.min(1, nodeArea / Math.max(1, totalImageArea));
  const deltaX = implementation.bounds.x - reference.bounds.x;
  const deltaY = implementation.bounds.y - reference.bounds.y;
  if (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6) {
    const cssProp = inferPositionCssProperty(deltaX, deltaY, reference.bounds, imageWidth, imageHeight);
    const regionDesc = anchor?.name ? ` on the ${anchor.name} region (y: ${reference.bounds.y}-${reference.bounds.y + reference.bounds.height})` : "";
    issues.push({
      code: "POSITION_MISMATCH",
      nodeId: reference.id,
      anchorId: anchor?.id,
      anchorName: anchor?.name,
      contextPath,
      cssProperty: cssProp,
      severity: Math.abs(deltaX) > 16 || Math.abs(deltaY) > 16 ? "high" : "medium",
      message: `${anchorName} is offset by ${Math.abs(deltaY) > 6 ? `${Math.abs(deltaY)}px vertically` : ""}${Math.abs(deltaX) > 6 && Math.abs(deltaY) > 6 ? " and " : ""}${Math.abs(deltaX) > 6 ? `${Math.abs(deltaX)}px horizontally` : ""} — likely ${cssProp}${regionDesc}.`,
      suggestedFix: buildRelativePositionFix(deltaX, deltaY, reference.bounds, imageWidth, imageHeight),
      reference: { x: reference.bounds.x, y: reference.bounds.y },
      implementation: { x: implementation.bounds.x, y: implementation.bounds.y },
      deltaX,
      deltaY,
      issueBounds: reference.bounds,
      visualWeight: vw
    });
  }

  const widthDelta = implementation.bounds.width - reference.bounds.width;
  const heightDelta = implementation.bounds.height - reference.bounds.height;
  if (Math.abs(widthDelta) > 6 || Math.abs(heightDelta) > 6) {
    const cssProp = inferSizeCssProperty(widthDelta, heightDelta);
    issues.push({
      code: "SIZE_MISMATCH",
      nodeId: reference.id,
      anchorId: anchor?.id,
      anchorName: anchor?.name,
      contextPath,
      cssProperty: cssProp,
      severity: Math.abs(widthDelta) > 16 || Math.abs(heightDelta) > 16 ? "high" : "medium",
      message: `${anchorName} is ${Math.abs(widthDelta) > 6 ? `~${Math.abs(widthDelta)}px too ${widthDelta > 0 ? "wide" : "narrow"}` : ""}${Math.abs(widthDelta) > 6 && Math.abs(heightDelta) > 6 ? " and " : ""}${Math.abs(heightDelta) > 6 ? `~${Math.abs(heightDelta)}px too ${heightDelta > 0 ? "tall" : "short"}` : ""} (ref: ${reference.bounds.width}x${reference.bounds.height}, impl: ${implementation.bounds.width}x${implementation.bounds.height}) — adjust ${cssProp}.`,
      suggestedFix: buildRelativeSizeFix(widthDelta, heightDelta, reference.bounds),
      reference: { width: reference.bounds.width, height: reference.bounds.height },
      implementation: { width: implementation.bounds.width, height: implementation.bounds.height },
      deltaWidth: widthDelta,
      deltaHeight: heightDelta,
      issueBounds: reference.bounds,
      visualWeight: vw
    });
  }

  if (reference.borderRadius !== null && implementation.borderRadius !== null) {
    const radiusDelta = implementation.borderRadius - reference.borderRadius;
    if (Math.abs(radiusDelta) >= 2) {
      issues.push({
        code: "BORDER_RADIUS_MISMATCH",
        nodeId: reference.id,
        anchorId: anchor?.id,
        anchorName: anchor?.name,
        contextPath,
        severity: Math.abs(radiusDelta) >= 6 ? "medium" : "low",
        message: `${anchorName} border radius differs from the reference.`,
        suggestedFix: `Set border-radius to ${reference.borderRadius}px.`,
        reference: { borderRadius: reference.borderRadius },
        implementation: { borderRadius: implementation.borderRadius },
        issueBounds: reference.bounds,
        visualWeight: vw
      });
    }
  }

  if (reference.fill && implementation.fill) {
    const colorDelta = hexDistance(reference.fill, implementation.fill);
    if (colorDelta >= 24) {
      issues.push({
        code: "COLOR_MISMATCH",
        nodeId: reference.id,
        anchorId: anchor?.id,
        anchorName: anchor?.name,
        contextPath,
        severity: colorDelta >= 64 ? "medium" : "low",
        message: `${anchorName} fill color differs from the reference.`,
        suggestedFix: `Change the fill color to ${reference.fill}.`,
        reference: { fill: reference.fill },
        implementation: { fill: implementation.fill },
        issueBounds: reference.bounds,
        visualWeight: vw
      });
    }
  }

  // Shadow comparison
  if (reference.shadow && !implementation.shadow) {
    issues.push({
      code: "SHADOW_MISMATCH",
      nodeId: reference.id,
      anchorId: anchor?.id,
      anchorName: anchor?.name,
      contextPath,
      severity: "medium",
      message: `${anchorName} is missing a shadow present in the reference.`,
      suggestedFix: `Add box-shadow: ${reference.shadow.xOffset}px ${reference.shadow.yOffset}px ${reference.shadow.blurRadius}px ${reference.shadow.spread}px ${reference.shadow.color}.`,
      reference: { shadow: reference.shadow },
      implementation: { shadow: null },
      issueBounds: reference.bounds,
      visualWeight: vw
    });
  } else if (!reference.shadow && implementation.shadow) {
    issues.push({
      code: "SHADOW_MISMATCH",
      nodeId: reference.id,
      anchorId: anchor?.id,
      anchorName: anchor?.name,
      contextPath,
      severity: "low",
      message: `${anchorName} has an extra shadow not present in the reference.`,
      suggestedFix: "Remove the box-shadow from this element.",
      reference: { shadow: null },
      implementation: { shadow: implementation.shadow },
      issueBounds: reference.bounds,
      visualWeight: vw
    });
  } else if (reference.shadow && implementation.shadow) {
    const blurDelta = Math.abs(reference.shadow.blurRadius - implementation.shadow.blurRadius);
    const offsetDelta =
      Math.abs(reference.shadow.xOffset - implementation.shadow.xOffset) +
      Math.abs(reference.shadow.yOffset - implementation.shadow.yOffset);
    if (blurDelta >= 3 || offsetDelta >= 3) {
      issues.push({
        code: "SHADOW_MISMATCH",
        nodeId: reference.id,
        anchorId: anchor?.id,
        anchorName: anchor?.name,
        contextPath,
        severity: blurDelta >= 6 || offsetDelta >= 6 ? "medium" : "low",
        message: `${anchorName} shadow differs from the reference.`,
        suggestedFix: `Set box-shadow to ${reference.shadow.xOffset}px ${reference.shadow.yOffset}px ${reference.shadow.blurRadius}px ${reference.shadow.spread}px ${reference.shadow.color}.`,
        reference: { shadow: reference.shadow },
        implementation: { shadow: implementation.shadow },
        issueBounds: reference.bounds,
        visualWeight: vw
      });
    }
  }

  // Gradient comparison
  if (reference.gradient && !implementation.gradient) {
    const stops = reference.gradient.stops.map((s) => `${s.color} ${Math.round(s.position * 100)}%`).join(", ");
    const direction = reference.gradient.type === "linear" ? `${reference.gradient.angle}deg, ` : "";
    issues.push({
      code: "GRADIENT_MISMATCH",
      nodeId: reference.id,
      anchorId: anchor?.id,
      anchorName: anchor?.name,
      contextPath,
      severity: "medium",
      message: `${anchorName} is missing a gradient present in the reference.`,
      suggestedFix: `Add background: ${reference.gradient.type}-gradient(${direction}${stops}).`,
      reference: { gradient: reference.gradient },
      implementation: { gradient: null },
      issueBounds: reference.bounds,
      visualWeight: vw
    });
  } else if (!reference.gradient && implementation.gradient) {
    issues.push({
      code: "GRADIENT_MISMATCH",
      nodeId: reference.id,
      anchorId: anchor?.id,
      anchorName: anchor?.name,
      contextPath,
      severity: "low",
      message: `${anchorName} has a gradient not present in the reference.`,
      suggestedFix: "Replace the gradient with a solid fill.",
      reference: { gradient: null },
      implementation: { gradient: implementation.gradient },
      issueBounds: reference.bounds,
      visualWeight: vw
    });
  } else if (reference.gradient && implementation.gradient) {
    const refStops = reference.gradient.stops;
    const implStops = implementation.gradient.stops;
    let colorDelta = 0;
    const minStops = Math.min(refStops.length, implStops.length);
    for (let i = 0; i < minStops; i++) {
      colorDelta += hexDistance(refStops[i]!.color, implStops[i]!.color);
    }
    if (
      reference.gradient.type !== implementation.gradient.type ||
      refStops.length !== implStops.length ||
      colorDelta > 48
    ) {
      const stops = refStops.map((s) => `${s.color} ${Math.round(s.position * 100)}%`).join(", ");
      const direction = reference.gradient.type === "linear" ? `${reference.gradient.angle}deg, ` : "";
      issues.push({
        code: "GRADIENT_MISMATCH",
        nodeId: reference.id,
        anchorId: anchor?.id,
        anchorName: anchor?.name,
        contextPath,
        severity: colorDelta > 96 ? "medium" : "low",
        message: `${anchorName} gradient differs from the reference.`,
        suggestedFix: `Set background to ${reference.gradient.type}-gradient(${direction}${stops}).`,
        reference: { gradient: reference.gradient },
        implementation: { gradient: implementation.gradient },
        issueBounds: reference.bounds,
        visualWeight: vw
      });
    }
  }

  return issues;
}

function compareSpacing(
  referenceSpacing: ReturnType<typeof measureSpacing>,
  implementationSpacing: ReturnType<typeof measureSpacing>,
  matches: Array<{ reference: LayoutNode; implementation: LayoutNode }>,
  anchors: SemanticAnchor[]
): CompareIssue[] {
  const mappedIds = new Map(matches.map((match) => [match.reference.id, match.implementation.id]));
  const implementationLookup = new Map(
    implementationSpacing.map((measurement) => [`${measurement.axis}:${measurement.fromId}:${measurement.toId}`, measurement] as const)
  );
  const issues: CompareIssue[] = [];

  for (const measurement of referenceSpacing) {
    const implementationFromId = mappedIds.get(measurement.fromId);
    const implementationToId = mappedIds.get(measurement.toId);
    if (!implementationFromId || !implementationToId) {
      continue;
    }

    const implementationMeasurement =
      implementationLookup.get(`${measurement.axis}:${implementationFromId}:${implementationToId}`) ??
      implementationLookup.get(`${measurement.axis}:${implementationToId}:${implementationFromId}`);

    if (!implementationMeasurement) {
      continue;
    }

    const delta = implementationMeasurement.distance - measurement.distance;
    if (Math.abs(delta) < 6) {
      continue;
    }

    const spacingCssProp = inferSpacingCssProperty(measurement.axis, true);
    const fromAnchor = resolveAnchor(anchors, matches.find((match) => match.reference.id === measurement.fromId)?.reference);
    const toAnchor = resolveAnchor(anchors, matches.find((match) => match.reference.id === measurement.toId)?.reference);
    issues.push({
      code: "SPACING_MISMATCH",
      nodeId: measurement.fromId,
      anchorId: fromAnchor?.id,
      anchorName: fromAnchor?.name,
      contextPath: buildSpacingContext(measurement, anchors),
      cssProperty: spacingCssProp,
      severity: Math.abs(delta) >= 16 ? "medium" : "low",
      message: `Spacing between ${describeAnchor(fromAnchor, measurement.fromId)} and ${describeAnchor(toAnchor, measurement.toId)} differs by ${Math.abs(delta)}px — adjust ${spacingCssProp}.`,
      suggestedFix: buildSpacingFix(measurement.axis, delta, measurement.distance),
      reference: { distance: measurement.distance, alignment: measurement.alignment },
      implementation: { distance: implementationMeasurement.distance, alignment: implementationMeasurement.alignment }
    });
  }

  return issues;
}

function compareText(referenceText: TextBlock[], implementationText: TextBlock[]): CompareIssue[] {
  const issues: CompareIssue[] = [];
  const matches = matchTextBlocks(referenceText, implementationText);

  for (const match of matches) {
    if (match.reference.typography?.fontSize && match.implementation.typography?.fontSize) {
      const delta = match.implementation.typography.fontSize - match.reference.typography.fontSize;
      if (Math.abs(delta) >= 2) {
        issues.push({
          code: "FONT_SIZE_MISMATCH",
          nodeId: match.reference.id,
          severity: Math.abs(delta) >= 4 ? "medium" : "low",
          message: `Text block ${match.reference.id} font size differs from the reference.`,
          suggestedFix: `Set font-size to ${match.reference.typography.fontSize}px.`,
          reference: { fontSize: match.reference.typography.fontSize, text: match.reference.text },
          implementation: { fontSize: match.implementation.typography.fontSize, text: match.implementation.text }
        });
      }
    }

    if (match.reference.typography?.fontWeight && match.implementation.typography?.fontWeight) {
      const delta = match.implementation.typography.fontWeight - match.reference.typography.fontWeight;
      if (Math.abs(delta) >= 100) {
        issues.push({
          code: "FONT_WEIGHT_MISMATCH",
          nodeId: match.reference.id,
          severity: "low",
          message: `Text block ${match.reference.id} font weight differs from the reference.`,
          suggestedFix: `Set font-weight to ${match.reference.typography.fontWeight}.`,
          reference: { fontWeight: match.reference.typography.fontWeight, text: match.reference.text },
          implementation: { fontWeight: match.implementation.typography.fontWeight, text: match.implementation.text }
        });
      }
    }

    // Font family comparison
    const refCandidates = match.reference.typography?.fontFamilyCandidates;
    const implCandidates = match.implementation.typography?.fontFamilyCandidates;
    if (refCandidates?.length && implCandidates?.length) {
      const refTop = refCandidates[0]!.family;
      const implTop = implCandidates[0]!.family;
      if (refTop !== implTop) {
        const refTopFamilies = refCandidates.slice(0, 3).map((c) => c.family);
        const implTopFamily = implTop;
        const isCloseMatch = refTopFamilies.includes(implTopFamily);
        if (!isCloseMatch) {
          const candidates = refCandidates.slice(0, 3).map((c) => `${c.family} (${Math.round(c.confidence * 100)}%)`).join(", ");
          issues.push({
            code: "FONT_FAMILY_MISMATCH",
            nodeId: match.reference.id,
            severity: "low",
            message: `Text block ${match.reference.id} likely uses a different font family.`,
            suggestedFix: `Consider using font-family: "${refTop}", sans-serif. Top candidates: ${candidates}.`,
            reference: { fontFamilyCandidates: refCandidates.slice(0, 3), text: match.reference.text },
            implementation: { fontFamilyCandidates: implCandidates.slice(0, 3), text: match.implementation.text }
          });
        }
      }
    }
  }

  // Add font classification hints to font-related issues
  for (const match of matches) {
    if (match.reference.typography?.fontSize) {
      const size = match.reference.typography.fontSize;
      const weight = match.reference.typography.fontWeight ?? 400;
      const classification = size >= 28 ? "heading" : size >= 20 ? "subheading" : "body";
      const weightLabel = weight >= 700 ? "bold" : weight >= 500 ? "medium" : "regular";
      const candidates = match.reference.typography.fontFamilyCandidates;
      const familyHint = candidates?.length ? candidates[0]!.family : "unknown";
      const serifHint = familyHint.match(/serif|georgia|times/i) ? "serif" :
                        familyHint.match(/mono|courier|consolas/i) ? "monospace" : "sans-serif";

      for (const issue of issues) {
        if (issue.nodeId === match.reference.id && issue.code.startsWith("FONT_")) {
          issue.message += ` (${classification}, ${weightLabel} ${serifHint}, ~${size}px)`;
        }
      }
    }
  }

  return issues;
}

function matchTextBlocks(referenceBlocks: TextBlock[], implementationBlocks: TextBlock[]) {
  const available = new Set(implementationBlocks.map((block) => block.id));
  const matches: Array<{ reference: TextBlock; implementation: TextBlock }> = [];

  for (const reference of referenceBlocks) {
    let best: { block: TextBlock; score: number } | null = null;
    for (const implementation of implementationBlocks) {
      if (!available.has(implementation.id)) {
        continue;
      }
      const textScore = reference.text === implementation.text ? 1 : stringSimilarity(reference.text, implementation.text);
      const geometryScore = 1 - Math.min(1, centerDistance(reference.bounds, implementation.bounds) / 120);
      const score = textScore * 0.7 + geometryScore * 0.3;
      if (score > 0.55 && (!best || score > best.score)) {
        best = { block: implementation, score };
      }
    }
    if (best) {
      available.delete(best.block.id);
      matches.push({ reference, implementation: best.block });
    }
  }

  return matches;
}

function layoutSimilarity(reference: LayoutNode, implementation: LayoutNode): number {
  const positionScore = 1 - Math.min(1, centerDistance(reference.bounds, implementation.bounds) / 180);
  const sizeScore =
    1 -
    Math.min(
      1,
      (Math.abs(reference.bounds.width - implementation.bounds.width) +
        Math.abs(reference.bounds.height - implementation.bounds.height)) /
        Math.max(reference.bounds.width + reference.bounds.height, 1)
    );
  const fillScore =
    reference.fill && implementation.fill ? 1 - Math.min(1, hexDistance(reference.fill, implementation.fill) / 255) : 0.5;
  return positionScore * 0.45 + sizeScore * 0.4 + fillScore * 0.15;
}

function centerDistance(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function stringSimilarity(a: string, b: string) {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || !right) {
    return 0;
  }
  const leftTokens = new Set(left.split(/\s+/));
  const rightTokens = new Set(right.split(/\s+/));
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function hexDistance(left: string, right: string) {
  const a = hexToRgb(left);
  const b = hexToRgb(right);
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/**
 * Simple edge detection: counts pixels with high gradient magnitude (Sobel-like).
 * Works on RGBA PNG data. Returns the number of edge pixels.
 */
function countEdgePixels(data: Buffer | Uint8Array, width: number, height: number): number {
  let edgeCount = 0;
  const threshold = 30; // gradient magnitude threshold
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      // Compute luminance for center and neighbors (horizontal and vertical)
      const lum = (data[idx]! * 0.299 + data[idx + 1]! * 0.587 + data[idx + 2]! * 0.114);
      const leftIdx = (y * width + (x - 1)) * 4;
      const rightIdx = (y * width + (x + 1)) * 4;
      const topIdx = ((y - 1) * width + x) * 4;
      const bottomIdx = ((y + 1) * width + x) * 4;
      const lumLeft = (data[leftIdx]! * 0.299 + data[leftIdx + 1]! * 0.587 + data[leftIdx + 2]! * 0.114);
      const lumRight = (data[rightIdx]! * 0.299 + data[rightIdx + 1]! * 0.587 + data[rightIdx + 2]! * 0.114);
      const lumTop = (data[topIdx]! * 0.299 + data[topIdx + 1]! * 0.587 + data[topIdx + 2]! * 0.114);
      const lumBottom = (data[bottomIdx]! * 0.299 + data[bottomIdx + 1]! * 0.587 + data[bottomIdx + 2]! * 0.114);
      const gx = Math.abs(lumRight - lumLeft);
      const gy = Math.abs(lumBottom - lumTop);
      if (gx + gy > threshold) {
        edgeCount++;
      }
    }
  }
  return edgeCount;
}

/**
 * Compute a 0-100 visual hierarchy score comparing structural quality
 * between reference and implementation images. Uses three signals:
 * 1. Zone similarity - horizontal band detection at similar vertical positions
 * 2. Content distribution entropy - Shannon entropy of pixel variance per 8x8 grid cell
 * 3. Edge density distribution - spatial distribution of edges across quadrants
 */
function computeHierarchyScore(
  refData: Buffer | Uint8Array,
  implData: Buffer | Uint8Array,
  width: number,
  height: number,
  refLayout: LayoutNode[],
  implLayout: LayoutNode[]
): number {
  if (width === 0 || height === 0) return 50;

  // 1. Zone similarity (0-100): Check horizontal bands match
  const zoneSimilarity = computeZoneSimilarity(refData, implData, width, height);

  // 2. Content distribution entropy correlation (0-100)
  const entropyCorrelation = computeEntropyCorrelation(refData, implData, width, height);

  // 3. Edge density distribution match across quadrants (0-100)
  const edgeDistributionMatch = computeEdgeDistributionMatch(refData, implData, width, height);

  return Math.round(
    0.4 * zoneSimilarity + 0.3 * entropyCorrelation + 0.3 * edgeDistributionMatch
  );
}

/**
 * Detect horizontal bands by computing average luminance per row-band,
 * finding transition points, and comparing between ref and impl.
 */
function computeZoneSimilarity(
  refData: Buffer | Uint8Array,
  implData: Buffer | Uint8Array,
  width: number,
  height: number
): number {
  const bandCount = 20; // divide into 20 horizontal bands
  const bandHeight = Math.max(1, Math.floor(height / bandCount));

  const refBandLum: number[] = [];
  const implBandLum: number[] = [];

  for (let b = 0; b < bandCount; b++) {
    const yStart = b * bandHeight;
    const yEnd = Math.min(yStart + bandHeight, height);
    let refSum = 0, implSum = 0, count = 0;
    for (let y = yStart; y < yEnd; y++) {
      for (let x = 0; x < width; x += 4) { // sample every 4th pixel for speed
        const idx = (y * width + x) * 4;
        refSum += refData[idx]! * 0.299 + refData[idx + 1]! * 0.587 + refData[idx + 2]! * 0.114;
        implSum += implData[idx]! * 0.299 + implData[idx + 1]! * 0.587 + implData[idx + 2]! * 0.114;
        count++;
      }
    }
    refBandLum.push(count > 0 ? refSum / count : 0);
    implBandLum.push(count > 0 ? implSum / count : 0);
  }

  // Find transitions (significant luminance changes between adjacent bands)
  const refTransitions = findTransitions(refBandLum);
  const implTransitions = findTransitions(implBandLum);

  // Score: how many reference transitions have a nearby match in implementation
  if (refTransitions.length === 0) return 80; // no structure to compare
  let matched = 0;
  for (const rt of refTransitions) {
    const closest = implTransitions.reduce((best, it) => Math.abs(it - rt) < Math.abs(best - rt) ? it : best, implTransitions[0] ?? -999);
    if (Math.abs(closest - rt) <= 2) matched++;
  }
  const transitionScore = matched / refTransitions.length;

  // Also compare band luminance correlation
  const lumCorr = pearsonCorrelation(refBandLum, implBandLum);

  return Math.round(50 * transitionScore + 50 * Math.max(0, lumCorr));
}

function findTransitions(bandLum: number[]): number[] {
  const transitions: number[] = [];
  const threshold = 15; // luminance change threshold
  for (let i = 1; i < bandLum.length; i++) {
    if (Math.abs(bandLum[i]! - bandLum[i - 1]!) > threshold) {
      transitions.push(i);
    }
  }
  return transitions;
}

/**
 * Compute Shannon entropy of pixel variance in an 8x8 grid,
 * then correlate between reference and implementation.
 */
function computeEntropyCorrelation(
  refData: Buffer | Uint8Array,
  implData: Buffer | Uint8Array,
  width: number,
  height: number
): number {
  const gridSize = 8;
  const cellW = Math.max(1, Math.floor(width / gridSize));
  const cellH = Math.max(1, Math.floor(height / gridSize));

  const refEntropy: number[] = [];
  const implEntropy: number[] = [];

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const xStart = gx * cellW;
      const yStart = gy * cellH;
      const xEnd = Math.min(xStart + cellW, width);
      const yEnd = Math.min(yStart + cellH, height);

      refEntropy.push(computeCellEntropy(refData, width, xStart, yStart, xEnd, yEnd));
      implEntropy.push(computeCellEntropy(implData, width, xStart, yStart, xEnd, yEnd));
    }
  }

  const corr = pearsonCorrelation(refEntropy, implEntropy);
  return Math.round(Math.max(0, corr) * 100);
}

function computeCellEntropy(
  data: Buffer | Uint8Array,
  width: number,
  xStart: number, yStart: number, xEnd: number, yEnd: number
): number {
  // Compute variance of luminance values as a proxy for content density
  const lums: number[] = [];
  for (let y = yStart; y < yEnd; y += 2) { // sample every 2nd pixel
    for (let x = xStart; x < xEnd; x += 2) {
      const idx = (y * width + x) * 4;
      lums.push(data[idx]! * 0.299 + data[idx + 1]! * 0.587 + data[idx + 2]! * 0.114);
    }
  }
  if (lums.length === 0) return 0;
  const mean = lums.reduce((s, v) => s + v, 0) / lums.length;
  const variance = lums.reduce((s, v) => s + (v - mean) ** 2, 0) / lums.length;
  return Math.sqrt(variance); // standard deviation as entropy proxy
}

/**
 * Compare edge density distribution across 4 quadrants.
 */
function computeEdgeDistributionMatch(
  refData: Buffer | Uint8Array,
  implData: Buffer | Uint8Array,
  width: number,
  height: number
): number {
  const halfW = Math.floor(width / 2);
  const halfH = Math.floor(height / 2);
  const quadrants = [
    { x: 0, y: 0, w: halfW, h: halfH },
    { x: halfW, y: 0, w: width - halfW, h: halfH },
    { x: 0, y: halfH, w: halfW, h: height - halfH },
    { x: halfW, y: halfH, w: width - halfW, h: height - halfH },
  ];

  const refQuadEdges: number[] = [];
  const implQuadEdges: number[] = [];

  for (const q of quadrants) {
    refQuadEdges.push(countEdgePixelsInRegion(refData, width, height, q.x, q.y, q.w, q.h));
    implQuadEdges.push(countEdgePixelsInRegion(implData, width, height, q.x, q.y, q.w, q.h));
  }

  // Normalize to proportions
  const refTotal = refQuadEdges.reduce((s, v) => s + v, 0) || 1;
  const implTotal = implQuadEdges.reduce((s, v) => s + v, 0) || 1;
  const refProps = refQuadEdges.map(v => v / refTotal);
  const implProps = implQuadEdges.map(v => v / implTotal);

  // Compute similarity as 1 - mean absolute difference of proportions
  const diff = refProps.reduce((s, v, i) => s + Math.abs(v - implProps[i]!), 0) / 4;
  // Also factor in overall edge density ratio
  const densityRatio = Math.min(refTotal, implTotal) / Math.max(refTotal, implTotal);

  return Math.round((1 - diff) * 60 + densityRatio * 40);
}

function countEdgePixelsInRegion(
  data: Buffer | Uint8Array,
  width: number, height: number,
  rx: number, ry: number, rw: number, rh: number
): number {
  let edgeCount = 0;
  const threshold = 30;
  for (let y = Math.max(1, ry); y < Math.min(height - 1, ry + rh); y++) {
    for (let x = Math.max(1, rx); x < Math.min(width - 1, rx + rw); x++) {
      const idx = (y * width + x) * 4;
      const lum = data[idx]! * 0.299 + data[idx + 1]! * 0.587 + data[idx + 2]! * 0.114;
      const leftIdx = (y * width + (x - 1)) * 4;
      const rightIdx = (y * width + (x + 1)) * 4;
      const topIdx = ((y - 1) * width + x) * 4;
      const bottomIdx = ((y + 1) * width + x) * 4;
      const gx = Math.abs(
        (data[rightIdx]! * 0.299 + data[rightIdx + 1]! * 0.587 + data[rightIdx + 2]! * 0.114) -
        (data[leftIdx]! * 0.299 + data[leftIdx + 1]! * 0.587 + data[leftIdx + 2]! * 0.114)
      );
      const gy = Math.abs(
        (data[bottomIdx]! * 0.299 + data[bottomIdx + 1]! * 0.587 + data[bottomIdx + 2]! * 0.114) -
        (data[topIdx]! * 0.299 + data[topIdx + 1]! * 0.587 + data[topIdx + 2]! * 0.114)
      );
      if (gx + gy > threshold) edgeCount++;
    }
  }
  return edgeCount;
}

/**
 * Pearson correlation coefficient between two arrays.
 */
function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function signedPixels(value: number) {
  if (value === 0) {
    return "0px";
  }
  return `${value > 0 ? "+" : ""}${value}px`;
}

function inferPositionCssProperty(deltaX: number, deltaY: number, refBounds: Bounds, imageWidth: number, imageHeight: number): string {
  // If offset is at top of page, likely padding-top or margin-top
  if (Math.abs(deltaY) > 6 && refBounds.y < imageHeight * 0.15) {
    return deltaY > 0 ? "padding-top" : "margin-top";
  }
  // Full-region vertical shift
  if (Math.abs(deltaY) > 6 && Math.abs(deltaX) <= 6) {
    return refBounds.y < imageHeight * 0.5 ? "margin-top" : "margin-bottom";
  }
  // Horizontal shift
  if (Math.abs(deltaX) > 6 && Math.abs(deltaY) <= 6) {
    return refBounds.x < imageWidth * 0.5 ? "margin-left" : "margin-right";
  }
  return "top";
}

function buildRelativePositionFix(deltaX: number, deltaY: number, refBounds?: Bounds, imageWidth = 0, imageHeight = 0): string {
  const suggestions: string[] = [];
  if (refBounds && imageWidth > 0) {
    const cssProp = inferPositionCssProperty(deltaX, deltaY, refBounds, imageWidth, imageHeight);
    if (Math.abs(deltaY) > 6) {
      const implValue = Math.abs(deltaY);
      suggestions.push(`Reduce ${cssProp} by ~${implValue}px on the region (y: ${refBounds.y}-${refBounds.y + refBounds.height})`);
    }
    if (Math.abs(deltaX) > 6) {
      const hProp = deltaX > 0 ? "margin-left" : "margin-right";
      suggestions.push(`Reduce ${hProp} by ~${Math.abs(deltaX)}px`);
    }
  } else {
    if (Math.abs(deltaX) > 6) {
      suggestions.push(`${deltaX > 0 ? "move it left" : "move it right"} by ${Math.abs(deltaX)}px`);
    }
    if (Math.abs(deltaY) > 6) {
      suggestions.push(`${deltaY > 0 ? "move it up" : "move it down"} by ${Math.abs(deltaY)}px`);
    }
  }
  return suggestions.join(" and ");
}

function inferSizeCssProperty(widthDelta: number, heightDelta: number): string {
  if (Math.abs(widthDelta) > 6 && Math.abs(heightDelta) <= 6) return "width";
  if (Math.abs(heightDelta) > 6 && Math.abs(widthDelta) <= 6) return heightDelta > 0 ? "height" : "min-height";
  return "width/height";
}

function buildRelativeSizeFix(widthDelta: number, heightDelta: number, referenceBounds: Bounds): string {
  const suggestions: string[] = [];
  if (Math.abs(widthDelta) > 6) {
    suggestions.push(`Set width to ${referenceBounds.width}px (currently ${referenceBounds.width + widthDelta}px)`);
  }
  if (Math.abs(heightDelta) > 6) {
    const prop = heightDelta > 0 ? "height" : "min-height";
    suggestions.push(`Set ${prop} to ${referenceBounds.height}px (currently ${referenceBounds.height + heightDelta}px)`);
  }
  return suggestions.join(" and ");
}

function inferSpacingCssProperty(axis: "horizontal" | "vertical", isBetweenSiblings: boolean): string {
  if (isBetweenSiblings) return "gap";
  return axis === "vertical" ? "margin-bottom" : "margin-right";
}

function buildSpacingFix(axis: "horizontal" | "vertical", delta: number, target: number): string {
  const direction = delta > 0 ? "Reduce" : "Increase";
  const cssProp = axis === "vertical" ? "gap or margin-bottom" : "gap or margin-right";
  return `${direction} ${cssProp} by ${Math.abs(delta)}px to ~${target}px.`;
}

function resolveFocusBounds(
  region: string | undefined,
  crop: Bounds | undefined,
  anchors: SemanticAnchor[],
  width: number,
  height: number
): Bounds | undefined {
  if (crop) {
    return crop;
  }
  if (!region) {
    return undefined;
  }
  const normalized = region.trim().toLowerCase();
  const anchor = anchors.find((candidate) => candidate.name.toLowerCase() === normalized) ??
    anchors.find((candidate) => candidate.name.toLowerCase().includes(normalized));
  if (!anchor) {
    return undefined;
  }
  return {
    x: clamp(anchor.bounds.x, 0, width),
    y: clamp(anchor.bounds.y, 0, height),
    width: clamp(anchor.bounds.width, 0, width - anchor.bounds.x),
    height: clamp(anchor.bounds.height, 0, height - anchor.bounds.y)
  };
}

function filterNodesByBounds(nodes: LayoutNode[], focusBounds?: Bounds): LayoutNode[] {
  if (!focusBounds) {
    return nodes;
  }
  return nodes.filter((node) => overlaps(node.bounds, focusBounds));
}

function filterTextByBounds(blocks: TextBlock[], focusBounds?: Bounds): TextBlock[] {
  if (!focusBounds) {
    return blocks;
  }
  return blocks.filter((block) => overlaps(block.bounds, focusBounds));
}

function findAnchorForNode(anchors: SemanticAnchor[], nodeId: string): SemanticAnchor | undefined {
  return anchors.find((anchor) => anchor.nodeId === nodeId);
}

function resolveAnchor(anchors: SemanticAnchor[], node: LayoutNode | undefined): SemanticAnchor | undefined {
  if (!node) {
    return undefined;
  }
  return findAnchorForNode(anchors, node.id) ?? findClosestAnchor(anchors, node.bounds);
}

function findClosestAnchor(anchors: SemanticAnchor[], bounds: Bounds): SemanticAnchor | undefined {
  let best: { anchor: SemanticAnchor; score: number } | null = null;
  for (const anchor of anchors) {
    const score = overlapScore(anchor.bounds, bounds);
    if (score > 0.1 && (!best || score > best.score)) {
      best = { anchor, score };
    }
  }
  if (best) return best.anchor;

  // Fallback: find the containing anchor (bounds inside anchor)
  for (const anchor of anchors) {
    if (anchor.bounds.x <= bounds.x &&
        anchor.bounds.y <= bounds.y &&
        anchor.bounds.x + anchor.bounds.width >= bounds.x + bounds.width &&
        anchor.bounds.y + anchor.bounds.height >= bounds.y + bounds.height) {
      return anchor;
    }
  }

  return undefined;
}

function describeNodePosition(bounds: Bounds, totalWidth: number, totalHeight: number): string {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const hPos = cx < totalWidth * 0.33 ? "left" : cx > totalWidth * 0.67 ? "right" : "center";
  const vPos = cy < totalHeight * 0.25 ? "top" : cy > totalHeight * 0.75 ? "bottom" : "middle";
  const w = bounds.width;
  const h = bounds.height;
  const shape = w > h * 3 ? "bar" : h > w * 3 ? "column" : w > h * 1.5 ? "wide-block" : "block";
  return `${vPos}-${hPos}-${shape}`;
}

function describeAnchor(anchor: SemanticAnchor | undefined, fallback: string): string {
  return anchor ? anchor.name : fallback;
}

function buildContextPath(anchor: SemanticAnchor | undefined, anchors: SemanticAnchor[]): string | undefined {
  if (!anchor) {
    return undefined;
  }
  const parts = [anchor.name];
  let current = anchor;
  while (current.parentId) {
    const parent = anchors.find((candidate) => candidate.id === current.parentId);
    if (!parent) {
      break;
    }
    parts.unshift(parent.name);
    current = parent;
  }
  return parts.join(" > ");
}

function buildSpacingContext(measurement: { fromId: string; toId: string }, anchors: SemanticAnchor[]): string | undefined {
  const from = findAnchorForNode(anchors, measurement.fromId);
  const to = findAnchorForNode(anchors, measurement.toId);
  if (!from && !to) {
    return undefined;
  }
  return [from?.name, to?.name].filter(Boolean).join(" <> ");
}

function describeScope(message: string, focusBounds?: Bounds, regionName?: string): string {
  if (regionName) {
    return `${message} inside ${regionName}.`;
  }
  if (focusBounds) {
    return `${message} inside the requested crop.`;
  }
  return `${message}.`;
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
}

function overlapScore(a: Bounds, b: Bounds): number {
  const overlapArea = computeOverlapArea(a, b);
  const unionArea = a.width * a.height + b.width * b.height - overlapArea;
  return unionArea === 0 ? 0 : overlapArea / unionArea;
}

function overlapArea(a: Bounds, b: Bounds): number {
  return computeOverlapArea(a, b);
}

function computeOverlapArea(a: Bounds, b: Bounds): number {
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return overlapX * overlapY;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sortIssues(issues: CompareIssue[]) {
  const severityOrder = { high: 0, medium: 1, low: 2 };
  return [...issues].sort((a, b) => {
    const severityDelta = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return a.code.localeCompare(b.code);
  });
}

function groupIssuesBySection(issues: CompareIssue[], anchors: SemanticAnchor[]): Array<{
  groupName: string;
  anchorName?: string;
  cssSelector?: string;
  severity: "low" | "medium" | "high";
  issueCount: number;
  summary: string;
  suggestedFixes: string[];
  memberIssueCodes: string[];
}> {
  // Group issues by their anchor name (section), or by issue code if no anchor
  const groups = new Map<string, CompareIssue[]>();

  for (const issue of issues) {
    const key = issue.anchorName ?? issue.code;
    const list = groups.get(key) ?? [];
    list.push(issue);
    groups.set(key, list);
  }

  const result: Array<{
    groupName: string;
    anchorName?: string;
    cssSelector?: string;
    severity: "low" | "medium" | "high";
    issueCount: number;
    summary: string;
    suggestedFixes: string[];
    memberIssueCodes: string[];
  }> = [];

  for (const [key, groupIssues] of groups) {
    if (groupIssues.length < 2) continue; // Only group when there are multiple related issues

    const severityOrder = { high: 0, medium: 1, low: 2 };
    const worstSeverity = groupIssues.reduce((worst, issue) =>
      severityOrder[issue.severity] < severityOrder[worst] ? issue.severity : worst,
      "low" as "low" | "medium" | "high"
    );

    const anchor = anchors.find(a => a.name === key);
    const selectorHint = anchor ? key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : undefined;
    const codes = [...new Set(groupIssues.map(i => i.code))];
    const fixes = groupIssues
      .filter(i => i.suggestedFix)
      .map(i => i.suggestedFix!)
      .slice(0, 5);

    const codeDescriptions = codes.map(c => {
      const count = groupIssues.filter(i => i.code === c).length;
      return `${count} ${c.toLowerCase().replace(/_/g, " ")} issue${count > 1 ? "s" : ""}`;
    });

    result.push({
      groupName: anchor ? `Section: ${key}` : `Issue type: ${key.toLowerCase().replace(/_/g, " ")}`,
      anchorName: anchor?.name,
      cssSelector: selectorHint ? `.${selectorHint}` : groupIssues[0]?.cssSelector,
      severity: worstSeverity,
      issueCount: groupIssues.length,
      summary: `${groupIssues.length} issues: ${codeDescriptions.join(", ")}`,
      suggestedFixes: fixes,
      memberIssueCodes: codes
    });
  }

  // Sort by severity then issue count
  return result.sort((a, b) => {
    const sev = { high: 0, medium: 1, low: 2 };
    const sevDelta = sev[a.severity] - sev[b.severity];
    if (sevDelta !== 0) return sevDelta;
    return b.issueCount - a.issueCount;
  });
}

function buildTopEditCandidates(issues: CompareIssue[], anchors: SemanticAnchor[], imageWidth: number, imageHeight: number): Array<{
  rank: number;
  anchorName?: string;
  cssSelector?: string;
  description: string;
  cssChanges: string[];
  estimatedImpact: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
  affectedAreaPercent: number;
}> {
  const totalArea = imageWidth * imageHeight;

  // Score each issue by visual weight and severity, pick top 5
  // Prioritize actionable issues over non-actionable ones
  const structuralCodes = new Set(["POSITION_MISMATCH", "SIZE_MISMATCH", "SPACING_MISMATCH"]);
  const scored = issues
    .filter(i => i.suggestedFix || structuralCodes.has(i.code))
    .map(i => {
      const severityScore = i.severity === "high" ? 3 : i.severity === "medium" ? 2 : 1;
      const vwScore = (i.visualWeight ?? 0.1) * 10;
      const actionableBonus = i.actionable !== false ? 5 : 0;

      // Compute affected area ratio for risk scoring
      const boundsArea = i.issueBounds ? i.issueBounds.width * i.issueBounds.height : 0;
      const affectedAreaRatio = totalArea > 0 ? boundsArea / totalArea : 0;

      // Cascade risk: container-level properties (width, height, min-height) on regions with children
      const containerProps = ["width", "height", "min-height"];
      const cascadeRisk = !!(i.cssProperty && containerProps.some(p => i.cssProperty!.includes(p))
        && (i.code === "SIZE_MISMATCH") && affectedAreaRatio > 0.05);

      const risk: "low" | "medium" | "high" =
        (affectedAreaRatio > 0.15 || cascadeRisk) ? "high" :
        affectedAreaRatio > 0.05 ? "medium" : "low";

      // Penalize high-risk suggestions in scoring so low-risk appear first
      const riskPenalty = risk === "high" ? -4 : risk === "medium" ? -1 : 0;

      return { issue: i, score: severityScore + vwScore + actionableBonus + riskPenalty, risk, affectedAreaPercent: Math.round(affectedAreaRatio * 1000) / 10 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return scored.map((entry, idx) => {
    const i = entry.issue;
    const anchor = i.anchorName ? anchors.find(a => a.name === i.anchorName) : undefined;
    const selectorHint = anchor
      ? `.${anchor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`
      : i.cssSelector;

    const cssChanges: string[] = [];
    const ref = i.reference as any;
    const impl = i.implementation as any;

    switch (i.code) {
      case "SIZE_MISMATCH": {
        const sizeProp = i.cssProperty ?? "width/height";
        if (ref?.width != null && impl?.width != null && Math.abs(impl.width - ref.width) > 6) {
          cssChanges.push(`width: ${ref.width}px; /* currently ${impl.width}px */`);
        }
        if (ref?.height != null && impl?.height != null && Math.abs(impl.height - ref.height) > 6) {
          const hProp = sizeProp.includes("min-height") ? "min-height" : "height";
          cssChanges.push(`${hProp}: ${ref.height}px; /* currently ${impl.height}px */`);
        }
        break;
      }
      case "POSITION_MISMATCH": {
        const posProp = i.cssProperty ?? "top";
        if (ref && impl) {
          if (ref.y != null && impl.y != null && Math.abs(impl.y - ref.y) > 6) {
            cssChanges.push(`${posProp}: /* reduce by ~${Math.abs(impl.y - ref.y)}px */;`);
          }
          if (ref.x != null && impl.x != null && Math.abs(impl.x - ref.x) > 6) {
            const hProp = impl.x > ref.x ? "margin-left" : "margin-right";
            cssChanges.push(`${hProp}: /* reduce by ~${Math.abs(impl.x - ref.x)}px */;`);
          }
        }
        break;
      }
      case "SPACING_MISMATCH": {
        const spaceProp = i.cssProperty ?? "gap";
        if (ref?.distance != null && impl?.distance != null) {
          cssChanges.push(`${spaceProp}: ${ref.distance}px; /* currently ~${impl.distance}px */`);
        }
        break;
      }
      case "COLOR_MISMATCH":
      case "COLOR_MISMATCH_AT_POSITION":
        if (ref?.fill) cssChanges.push(`background-color: ${ref.fill};`);
        break;
      case "BORDER_RADIUS_MISMATCH":
        if (ref?.borderRadius != null) cssChanges.push(`border-radius: ${ref.borderRadius}px;`);
        break;
      case "SHADOW_MISMATCH":
        if (ref?.shadow) {
          const s = ref.shadow;
          cssChanges.push(`box-shadow: ${s.xOffset}px ${s.yOffset}px ${s.blurRadius}px ${s.spread}px ${s.color};`);
        }
        break;
      default:
        if (i.suggestedFix) cssChanges.push(i.suggestedFix);
        break;
    }

    if (cssChanges.length === 0 && i.suggestedFix) {
      cssChanges.push(i.suggestedFix);
    }

    return {
      rank: idx + 1,
      anchorName: i.anchorName,
      cssSelector: selectorHint,
      description: i.message,
      cssChanges,
      estimatedImpact: i.severity,
      risk: entry.risk,
      affectedAreaPercent: entry.affectedAreaPercent,
    };
  });
}
