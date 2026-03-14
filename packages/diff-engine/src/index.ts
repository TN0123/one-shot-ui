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
import { detectGradient, detectShadow, estimateBorderRadius, estimateNodeFill } from "@one-shot-ui/vision-style";
import { extractText, type ExtractTextOptions } from "@one-shot-ui/vision-text";

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

  const mismatchRatio = width * height === 0 ? 0 : mismatchPixels / (width * height);
  if (mismatchRatio > 0.01) {
    issues.push({
      code: "PIXEL_DIFFERENCE",
      severity: mismatchRatio > 0.08 ? "high" : "medium",
      message: `Pixel mismatch ratio is ${(mismatchRatio * 100).toFixed(2)}%.`,
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

  const totalImageArea = width * height;

  if (!focusDiagnostics.fallbackToPixelOnly) {
    for (const match of layoutMatches) {
      issues.push(...compareMatchedNodes(match.reference, match.implementation, referenceAnchors, totalImageArea));
    }

    for (const node of referenceLayout) {
      if (layoutMatches.some((match) => match.reference.id === node.id)) {
        continue;
      }
      const anchor = resolveAnchor(referenceAnchors, node);
      const nodeVw = Math.min(1, (node.bounds.width * node.bounds.height) / Math.max(1, totalImageArea));
      issues.push({
        code: "MISSING_NODE",
        nodeId: node.id,
        anchorId: anchor?.id,
        anchorName: anchor?.name,
        contextPath: buildContextPath(anchor, referenceAnchors),
        severity: "high",
        message: `${describeAnchor(anchor, node.id)} is missing from the implementation.`,
        suggestedFix: `Add the missing ${describeAnchor(anchor, "region")} using the same fill, size, and border treatment as the reference.`,
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
        message: `The implementation has an extra surface near ${describeAnchor(anchor, "this area")}.`,
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

  // Noise reduction: filter low-confidence issues and cap the list
  const filteredIssues = applyNoiseReduction(sortIssues(issues), confidenceThreshold, top);

  const groupedIssues = groupIssuesBySection(filteredIssues, referenceAnchors);
  const topEditCandidates = buildTopEditCandidates(filteredIssues, referenceAnchors);

  return compareReportSchema.parse({
    version: VERSION,
    referenceImage,
    implementationImage,
    summary: {
      mismatchPixels,
      mismatchRatio,
      matchedLayoutNodes: layoutMatches.length,
      widthDelta: implementationImage.width - referenceImage.width,
      heightDelta: implementationImage.height - referenceImage.height,
      focus: focusDiagnostics
    },
    issues: filteredIssues,
    groupedIssues,
    topEditCandidates,
    artifacts: {
      heatmapPath: normalizedHeatmapPath,
      regionHeatmaps: regionHeatmaps.length > 0 ? regionHeatmaps : undefined
    }
  });
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

  // Cap at max issues
  return filtered.slice(0, maxIssues);
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

function compareMatchedNodes(reference: LayoutNode, implementation: LayoutNode, anchors: SemanticAnchor[], totalImageArea = 1): CompareIssue[] {
  const issues: CompareIssue[] = [];
  const anchor = resolveAnchor(anchors, reference);
  const anchorName = describeAnchor(anchor, reference.id);
  const contextPath = buildContextPath(anchor, anchors);
  const nodeArea = reference.bounds.width * reference.bounds.height;
  const vw = Math.min(1, nodeArea / Math.max(1, totalImageArea));
  const deltaX = implementation.bounds.x - reference.bounds.x;
  const deltaY = implementation.bounds.y - reference.bounds.y;
  if (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6) {
    issues.push({
      code: "POSITION_MISMATCH",
      nodeId: reference.id,
      anchorId: anchor?.id,
      anchorName: anchor?.name,
      contextPath,
      severity: Math.abs(deltaX) > 16 || Math.abs(deltaY) > 16 ? "high" : "medium",
      message: `${anchorName} is offset from the reference.`,
      suggestedFix: buildRelativePositionFix(deltaX, deltaY),
      reference: { x: reference.bounds.x, y: reference.bounds.y },
      implementation: { x: implementation.bounds.x, y: implementation.bounds.y },
      issueBounds: reference.bounds,
      visualWeight: vw
    });
  }

  const widthDelta = implementation.bounds.width - reference.bounds.width;
  const heightDelta = implementation.bounds.height - reference.bounds.height;
  if (Math.abs(widthDelta) > 6 || Math.abs(heightDelta) > 6) {
    issues.push({
      code: "SIZE_MISMATCH",
      nodeId: reference.id,
      anchorId: anchor?.id,
      anchorName: anchor?.name,
      contextPath,
      severity: Math.abs(widthDelta) > 16 || Math.abs(heightDelta) > 16 ? "high" : "medium",
      message: `${anchorName} size differs from the reference.`,
      suggestedFix: buildRelativeSizeFix(widthDelta, heightDelta, reference.bounds),
      reference: { width: reference.bounds.width, height: reference.bounds.height },
      implementation: { width: implementation.bounds.width, height: implementation.bounds.height },
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

    issues.push({
      code: "SPACING_MISMATCH",
      nodeId: measurement.fromId,
      anchorId: resolveAnchor(anchors, matches.find((match) => match.reference.id === measurement.fromId)?.reference)?.id,
      anchorName: resolveAnchor(anchors, matches.find((match) => match.reference.id === measurement.fromId)?.reference)?.name,
      contextPath: buildSpacingContext(measurement, anchors),
      severity: Math.abs(delta) >= 16 ? "medium" : "low",
      message: `Spacing between ${describeAnchor(resolveAnchor(anchors, matches.find((match) => match.reference.id === measurement.fromId)?.reference), measurement.fromId)} and ${describeAnchor(resolveAnchor(anchors, matches.find((match) => match.reference.id === measurement.toId)?.reference), measurement.toId)} differs from the reference.`,
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

function buildRelativePositionFix(deltaX: number, deltaY: number): string {
  const suggestions: string[] = [];
  if (Math.abs(deltaX) > 6) {
    suggestions.push(`${deltaX > 0 ? "move it left" : "move it right"} by ${Math.abs(deltaX)}px`);
  }
  if (Math.abs(deltaY) > 6) {
    suggestions.push(`${deltaY > 0 ? "move it up" : "move it down"} by ${Math.abs(deltaY)}px`);
  }
  return suggestions.join(" and ");
}

function buildRelativeSizeFix(widthDelta: number, heightDelta: number, referenceBounds: Bounds): string {
  const suggestions: string[] = [];
  if (Math.abs(widthDelta) > 6) {
    suggestions.push(`${widthDelta > 0 ? "narrow it" : "widen it"} by ${Math.abs(widthDelta)}px toward ${referenceBounds.width}px`);
  }
  if (Math.abs(heightDelta) > 6) {
    suggestions.push(`${heightDelta > 0 ? "reduce its height" : "increase its height"} by ${Math.abs(heightDelta)}px toward ${referenceBounds.height}px`);
  }
  return suggestions.join(" and ");
}

function buildSpacingFix(axis: "horizontal" | "vertical", delta: number, target: number): string {
  const direction = delta > 0 ? "reduce" : "increase";
  return `${direction} the ${axis} gap by ${Math.abs(delta)}px so it lands near ${target}px.`;
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
  return best?.anchor;
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

function buildTopEditCandidates(issues: CompareIssue[], anchors: SemanticAnchor[]): Array<{
  rank: number;
  anchorName?: string;
  cssSelector?: string;
  description: string;
  cssChanges: string[];
  estimatedImpact: "low" | "medium" | "high";
}> {
  // Score each issue by visual weight and severity, pick top 5
  const scored = issues
    .filter(i => i.suggestedFix)
    .map(i => {
      const severityScore = i.severity === "high" ? 3 : i.severity === "medium" ? 2 : 1;
      const vwScore = (i.visualWeight ?? 0.1) * 10;
      return { issue: i, score: severityScore + vwScore };
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
    if (i.suggestedFix) cssChanges.push(i.suggestedFix);
    if (i.cssProperty) cssChanges.push(`${i.cssProperty}: /* see fix */`);

    return {
      rank: idx + 1,
      anchorName: i.anchorName,
      cssSelector: selectorHint,
      description: i.message,
      cssChanges,
      estimatedImpact: i.severity
    };
  });
}
