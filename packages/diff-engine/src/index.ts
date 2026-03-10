import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { VERSION, compareReportSchema, type CompareIssue, type LayoutNode, type TextBlock } from "@one-shot-ui/core";
import { loadImage } from "@one-shot-ui/image-io";
import { clusterComponents } from "@one-shot-ui/vision-components";
import { detectLayoutBoxes, measureSpacing } from "@one-shot-ui/vision-layout";
import { estimateBorderRadius, estimateNodeFill } from "@one-shot-ui/vision-style";
import { extractText } from "@one-shot-ui/vision-text";

export async function compareImages(
  referencePath: string,
  implementationPath: string,
  heatmapPath?: string
) {
  const [referenceImage, implementationImage, referenceText, implementationText] = await Promise.all([
    loadImage(referencePath),
    loadImage(implementationPath),
    extractText(referencePath),
    extractText(implementationPath)
  ]);

  const referenceLayout = clusterComponents(enrichLayoutNodes(referenceImage, detectLayoutBoxes(referenceImage))).nodes;
  const implementationLayout = clusterComponents(enrichLayoutNodes(implementationImage, detectLayoutBoxes(implementationImage))).nodes;
  const referenceSpacing = measureSpacing(referenceLayout);
  const implementationSpacing = measureSpacing(implementationLayout);

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

  if (referenceLayout.length !== implementationLayout.length) {
    issues.push({
      code: "LAYOUT_COUNT_MISMATCH",
      severity: "medium",
      message: "Detected layout region counts do not match.",
      reference: { layoutNodes: referenceLayout.length },
      implementation: { layoutNodes: implementationLayout.length }
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

  const layoutMatches = matchLayoutNodes(referenceLayout, implementationLayout);
  const matchedImplementationIds = new Set(layoutMatches.map((match) => match.implementation.id));

  for (const match of layoutMatches) {
    issues.push(...compareMatchedNodes(match.reference, match.implementation));
  }

  for (const node of referenceLayout) {
    if (layoutMatches.some((match) => match.reference.id === node.id)) {
      continue;
    }
    issues.push({
      code: "MISSING_NODE",
      nodeId: node.id,
      severity: "high",
      message: `Reference node ${node.id} has no corresponding implementation node.`,
      suggestedFix: `Add a region near x=${node.bounds.x}, y=${node.bounds.y} with size ${node.bounds.width}x${node.bounds.height}.`,
      reference: { bounds: node.bounds, fill: node.fill, borderRadius: node.borderRadius }
    });
  }

  for (const node of implementationLayout) {
    if (matchedImplementationIds.has(node.id)) {
      continue;
    }
    issues.push({
      code: "EXTRA_NODE",
      nodeId: node.id,
      severity: "medium",
      message: `Implementation node ${node.id} does not match any reference node.`,
      suggestedFix: "Remove the extra surface or merge it into an existing component.",
      implementation: { bounds: node.bounds, fill: node.fill, borderRadius: node.borderRadius }
    });
  }

  issues.push(...compareSpacing(referenceSpacing, implementationSpacing, layoutMatches));
  issues.push(...compareText(referenceText, implementationText));

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
      matchedLayoutNodes: layoutMatches.length,
      widthDelta: implementationImage.width - referenceImage.width,
      heightDelta: implementationImage.height - referenceImage.height
    },
    issues: sortIssues(issues),
    artifacts: {
      heatmapPath: normalizedHeatmapPath
    }
  });
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

function compareMatchedNodes(reference: LayoutNode, implementation: LayoutNode): CompareIssue[] {
  const issues: CompareIssue[] = [];
  const deltaX = implementation.bounds.x - reference.bounds.x;
  const deltaY = implementation.bounds.y - reference.bounds.y;
  if (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6) {
    issues.push({
      code: "POSITION_MISMATCH",
      nodeId: reference.id,
      severity: Math.abs(deltaX) > 16 || Math.abs(deltaY) > 16 ? "high" : "medium",
      message: `Node ${reference.id} is offset from the reference position.`,
      suggestedFix: `Move the element ${signedPixels(-deltaX)} horizontally and ${signedPixels(-deltaY)} vertically.`,
      reference: { x: reference.bounds.x, y: reference.bounds.y },
      implementation: { x: implementation.bounds.x, y: implementation.bounds.y }
    });
  }

  const widthDelta = implementation.bounds.width - reference.bounds.width;
  const heightDelta = implementation.bounds.height - reference.bounds.height;
  if (Math.abs(widthDelta) > 6 || Math.abs(heightDelta) > 6) {
    issues.push({
      code: "SIZE_MISMATCH",
      nodeId: reference.id,
      severity: Math.abs(widthDelta) > 16 || Math.abs(heightDelta) > 16 ? "high" : "medium",
      message: `Node ${reference.id} size differs from the reference.`,
      suggestedFix: `Adjust the element size by ${signedPixels(-widthDelta)} width and ${signedPixels(-heightDelta)} height.`,
      reference: { width: reference.bounds.width, height: reference.bounds.height },
      implementation: { width: implementation.bounds.width, height: implementation.bounds.height }
    });
  }

  if (reference.borderRadius !== null && implementation.borderRadius !== null) {
    const radiusDelta = implementation.borderRadius - reference.borderRadius;
    if (Math.abs(radiusDelta) >= 2) {
      issues.push({
        code: "BORDER_RADIUS_MISMATCH",
        nodeId: reference.id,
        severity: Math.abs(radiusDelta) >= 6 ? "medium" : "low",
        message: `Node ${reference.id} border radius differs from the reference.`,
        suggestedFix: `Set border-radius to ${reference.borderRadius}px.`,
        reference: { borderRadius: reference.borderRadius },
        implementation: { borderRadius: implementation.borderRadius }
      });
    }
  }

  if (reference.fill && implementation.fill) {
    const colorDelta = hexDistance(reference.fill, implementation.fill);
    if (colorDelta >= 24) {
      issues.push({
        code: "COLOR_MISMATCH",
        nodeId: reference.id,
        severity: colorDelta >= 64 ? "medium" : "low",
        message: `Node ${reference.id} fill color differs from the reference.`,
        suggestedFix: `Change the fill color to ${reference.fill}.`,
        reference: { fill: reference.fill },
        implementation: { fill: implementation.fill }
      });
    }
  }

  return issues;
}

function compareSpacing(
  referenceSpacing: ReturnType<typeof measureSpacing>,
  implementationSpacing: ReturnType<typeof measureSpacing>,
  matches: Array<{ reference: LayoutNode; implementation: LayoutNode }>
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
      severity: Math.abs(delta) >= 16 ? "medium" : "low",
      message: `Spacing between ${measurement.fromId} and ${measurement.toId} differs from the reference.`,
      suggestedFix: `Change the ${measurement.axis} gap to ${measurement.distance}px.`,
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
