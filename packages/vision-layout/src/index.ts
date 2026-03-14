import type { LayoutNode, LayoutStrategy, SpacingMeasurement } from "@one-shot-ui/core";
import { detectBackgroundColor, rgbToHex, samplePixel, type ImageAsset } from "@one-shot-ui/image-io";

const GRID_SIZE = 8;

export function detectLayoutBoxes(image: ImageAsset): LayoutNode[] {
  const cols = Math.ceil(image.width / GRID_SIZE);
  const rows = Math.ceil(image.height / GRID_SIZE);
  const background = hexToRgb(detectBackgroundColor(image));
  const active = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      active[row]![col] = isActiveCell(image, col, row, background);
    }
  }

  const visited = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  const nodes: LayoutNode[] = [];
  let index = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!active[row]![col] || visited[row]![col]) {
        continue;
      }

      const component = floodFill(active, visited, col, row);
      if (component.length < 4) {
        continue;
      }

      const xs = component.map(([x]) => x);
      const ys = component.map(([, y]) => y);
      const minCol = Math.min(...xs);
      const maxCol = Math.max(...xs);
      const minRow = Math.min(...ys);
      const maxRow = Math.max(...ys);
      const centerX = Math.min(image.width - 1, Math.floor((minCol + maxCol + 1) * GRID_SIZE * 0.5));
      const centerY = Math.min(image.height - 1, Math.floor((minRow + maxRow + 1) * GRID_SIZE * 0.5));
      const [r, g, b] = samplePixel(image, centerX, centerY);

      nodes.push({
        id: `region-${++index}`,
        kind: "region",
        bounds: {
          x: minCol * GRID_SIZE,
          y: minRow * GRID_SIZE,
          width: Math.min(image.width - minCol * GRID_SIZE, (maxCol - minCol + 1) * GRID_SIZE),
          height: Math.min(image.height - minRow * GRID_SIZE, (maxRow - minRow + 1) * GRID_SIZE)
        },
        fill: rgbToHex(r, g, b),
        borderRadius: null,
        componentId: null,
        confidence: Math.min(0.95, 0.45 + component.length / (rows * cols))
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.bounds.y === b.bounds.y) {
      return a.bounds.x - b.bounds.x;
    }
    return a.bounds.y - b.bounds.y;
  });
}

export function measureSpacing(nodes: LayoutNode[]): SpacingMeasurement[] {
  const measurements: SpacingMeasurement[] = [];
  const seen = new Set<string>();
  let index = 0;

  for (const node of nodes) {
    const nearestHorizontal = findNearestSpacing(node, nodes, "horizontal");
    if (nearestHorizontal) {
      const key = `h:${nearestHorizontal.fromId}:${nearestHorizontal.toId}`;
      if (!seen.has(key)) {
        seen.add(key);
        measurements.push({
          id: `space-${++index}`,
          ...nearestHorizontal
        });
      }
    }

    const nearestVertical = findNearestSpacing(node, nodes, "vertical");
    if (nearestVertical) {
      const key = `v:${nearestVertical.fromId}:${nearestVertical.toId}`;
      if (!seen.has(key)) {
        seen.add(key);
        measurements.push({
          id: `space-${++index}`,
          ...nearestVertical
        });
      }
    }
  }

  return measurements
    .filter((measurement) => measurement.distance >= 0)
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
}

export function detectLayoutStrategy(nodes: LayoutNode[]): LayoutStrategy {
  if (nodes.length < 2) {
    return { type: "unknown", confidence: 0.1 };
  }

  const gridResult = detectGridPattern(nodes);
  const flexResult = detectFlexPattern(nodes);
  const sidebarResult = detectSidebarPattern(nodes);

  // Return the highest-confidence detection
  const candidates = [gridResult, flexResult, sidebarResult].sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0]!;

  if (best.confidence < 0.3) {
    return { type: "absolute", confidence: 0.2 };
  }

  return best;
}

function detectGridPattern(nodes: LayoutNode[]): LayoutStrategy {
  // Find groups of nodes that share similar y positions (rows) and x positions (columns)
  const yGroups = groupByProximity(nodes.map((n) => n.bounds.y), 12);
  const xGroups = groupByProximity(nodes.map((n) => n.bounds.x), 12);

  if (yGroups.length < 2 || xGroups.length < 2) {
    return { type: "grid", confidence: 0.1 };
  }

  // Check for consistent column widths
  const columnWidths = xGroups.map((group) => {
    const nodesInColumn = nodes.filter((n) => group.includes(n.bounds.x));
    if (nodesInColumn.length === 0) return 0;
    return Math.round(nodesInColumn.reduce((sum, n) => sum + n.bounds.width, 0) / nodesInColumn.length);
  });

  // Check for consistent row heights
  const rowHeights = yGroups.map((group) => {
    const nodesInRow = nodes.filter((n) => group.includes(n.bounds.y));
    if (nodesInRow.length === 0) return 0;
    return Math.round(nodesInRow.reduce((sum, n) => sum + n.bounds.height, 0) / nodesInRow.length);
  });

  // Calculate horizontal gaps between adjacent columns
  const sortedXStarts = [...new Set(xGroups.map((g) => Math.min(...g)))].sort((a, b) => a - b);
  const hGaps: number[] = [];
  for (let i = 1; i < sortedXStarts.length; i++) {
    const prevColNodes = nodes.filter((n) => Math.abs(n.bounds.x - sortedXStarts[i - 1]!) <= 12);
    if (prevColNodes.length === 0) continue;
    const prevRight = Math.max(...prevColNodes.map((n) => n.bounds.x + n.bounds.width));
    hGaps.push(sortedXStarts[i]! - prevRight);
  }

  // Calculate vertical gaps between adjacent rows
  const sortedYStarts = [...new Set(yGroups.map((g) => Math.min(...g)))].sort((a, b) => a - b);
  const vGaps: number[] = [];
  for (let i = 1; i < sortedYStarts.length; i++) {
    const prevRowNodes = nodes.filter((n) => Math.abs(n.bounds.y - sortedYStarts[i - 1]!) <= 12);
    if (prevRowNodes.length === 0) continue;
    const prevBottom = Math.max(...prevRowNodes.map((n) => n.bounds.y + n.bounds.height));
    vGaps.push(sortedYStarts[i]! - prevBottom);
  }

  // Score: consistent gaps and multiple rows/columns = grid
  const hGapConsistency = hGaps.length > 0 ? coefficientOfVariation(hGaps) : 1;
  const vGapConsistency = vGaps.length > 0 ? coefficientOfVariation(vGaps) : 1;
  const isConsistent = hGapConsistency < 0.4 || vGapConsistency < 0.4;
  const hasMultipleRowsAndCols = yGroups.length >= 2 && xGroups.length >= 2;

  let confidence = 0.15;
  if (hasMultipleRowsAndCols) confidence += 0.25;
  if (isConsistent) confidence += 0.25;
  if (xGroups.length >= 3) confidence += 0.1;
  if (yGroups.length >= 3) confidence += 0.1;

  const avgHGap = hGaps.length > 0 ? Math.max(0, Math.round(hGaps.reduce((s, g) => s + g, 0) / hGaps.length)) : null;
  const avgVGap = vGaps.length > 0 ? Math.max(0, Math.round(vGaps.reduce((s, g) => s + g, 0) / vGaps.length)) : null;

  return {
    type: "grid",
    columns: columnWidths,
    rows: rowHeights,
    gaps: { horizontal: avgHGap, vertical: avgVGap },
    confidence: Math.min(0.9, confidence)
  };
}

function detectFlexPattern(nodes: LayoutNode[]): LayoutStrategy {
  // Check if nodes are arranged primarily in a single axis
  const horizontalRow = areNodesInRow(nodes, 16);
  const verticalColumn = areNodesInColumn(nodes, 16);

  if (!horizontalRow && !verticalColumn) {
    return { type: "flex", confidence: 0.1 };
  }

  if (horizontalRow) {
    // Nodes are in a horizontal row — flex row
    const sorted = [...nodes].sort((a, b) => a.bounds.x - b.bounds.x);
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(sorted[i]!.bounds.x - (sorted[i - 1]!.bounds.x + sorted[i - 1]!.bounds.width));
    }

    const gapConsistency = gaps.length > 0 ? coefficientOfVariation(gaps.filter((g) => g >= 0)) : 1;
    const avgGap = gaps.length > 0 ? Math.max(0, Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length)) : null;

    let confidence = 0.3;
    if (gapConsistency < 0.3) confidence += 0.3;
    if (nodes.length >= 3) confidence += 0.15;

    return {
      type: "flex",
      gaps: { horizontal: avgGap, vertical: null },
      confidence: Math.min(0.85, confidence)
    };
  }

  // Vertical column
  const sorted = [...nodes].sort((a, b) => a.bounds.y - b.bounds.y);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i]!.bounds.y - (sorted[i - 1]!.bounds.y + sorted[i - 1]!.bounds.height));
  }

  const gapConsistency = gaps.length > 0 ? coefficientOfVariation(gaps.filter((g) => g >= 0)) : 1;
  const avgGap = gaps.length > 0 ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null;

  let confidence = 0.3;
  if (gapConsistency < 0.3) confidence += 0.3;
  if (nodes.length >= 3) confidence += 0.15;

  return {
    type: "flex",
    gaps: { horizontal: null, vertical: avgGap },
    confidence: Math.min(0.85, confidence)
  };
}

function detectSidebarPattern(nodes: LayoutNode[]): LayoutStrategy {
  if (nodes.length < 2) {
    return { type: "grid", confidence: 0 };
  }

  // Look for a narrow fixed-width column adjacent to a fluid wider column
  const sorted = [...nodes].sort((a, b) => a.bounds.x - b.bounds.x);
  const leftMost = sorted[0]!;
  const remaining = sorted.slice(1);

  if (remaining.length === 0) {
    return { type: "grid", confidence: 0 };
  }

  const rightBounds = remaining.reduce(
    (acc, n) => ({
      x: Math.min(acc.x, n.bounds.x),
      width: Math.max(acc.x + acc.width, n.bounds.x + n.bounds.width) - Math.min(acc.x, n.bounds.x)
    }),
    { x: remaining[0]!.bounds.x, width: remaining[0]!.bounds.width }
  );

  const leftWidth = leftMost.bounds.width;
  const rightWidth = rightBounds.width;
  const isSidebar = leftWidth < rightWidth * 0.4 && leftWidth < 400;

  if (!isSidebar) {
    return { type: "grid", confidence: 0.05 };
  }

  const gap = rightBounds.x - (leftMost.bounds.x + leftMost.bounds.width);

  return {
    type: "grid",
    columns: [leftWidth, rightWidth],
    gaps: { horizontal: Math.max(0, gap), vertical: null },
    confidence: Math.min(0.8, 0.4 + (leftWidth < 300 ? 0.2 : 0) + (gap >= 0 && gap < 40 ? 0.15 : 0))
  };
}

function areNodesInRow(nodes: LayoutNode[], tolerance: number): boolean {
  if (nodes.length < 2) return false;
  const ys = nodes.map((n) => n.bounds.y + n.bounds.height / 2);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return maxY - minY <= tolerance;
}

function areNodesInColumn(nodes: LayoutNode[], tolerance: number): boolean {
  if (nodes.length < 2) return false;
  const xs = nodes.map((n) => n.bounds.x + n.bounds.width / 2);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  return maxX - minX <= tolerance;
}

function groupByProximity(values: number[], tolerance: number): number[][] {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  let currentGroup: number[] = [];

  for (const value of sorted) {
    if (currentGroup.length === 0 || value - currentGroup[currentGroup.length - 1]! <= tolerance) {
      currentGroup.push(value);
    } else {
      groups.push(currentGroup);
      currentGroup = [value];
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }
  return groups;
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

function isActiveCell(
  image: ImageAsset,
  col: number,
  row: number,
  background: { r: number; g: number; b: number }
): boolean {
  const startX = col * GRID_SIZE;
  const startY = row * GRID_SIZE;
  let delta = 0;
  let count = 0;

  for (let y = startY; y < Math.min(startY + GRID_SIZE, image.height); y++) {
    for (let x = startX; x < Math.min(startX + GRID_SIZE, image.width); x++) {
      const [r, g, b, a] = samplePixel(image, x, y);
      if (a < 8) {
        continue;
      }
      delta += Math.abs(r - background.r) + Math.abs(g - background.g) + Math.abs(b - background.b);
      count += 1;
    }
  }

  return count > 0 && delta / count > 32;
}

function floodFill(active: boolean[][], visited: boolean[][], startX: number, startY: number): Array<[number, number]> {
  const queue: Array<[number, number]> = [[startX, startY]];
  const points: Array<[number, number]> = [];
  visited[startY]![startX] = true;

  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    points.push([x, y]);
    const neighbors: Array<[number, number]> = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (ny < 0 || ny >= active.length || nx < 0 || nx >= active[0]!.length) {
        continue;
      }
      if (!active[ny]![nx] || visited[ny]![nx]) {
        continue;
      }
      visited[ny]![nx] = true;
      queue.push([nx, ny]);
    }
  }

  return points;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function findNearestSpacing(
  source: LayoutNode,
  nodes: LayoutNode[],
  axis: "horizontal" | "vertical"
): Omit<SpacingMeasurement, "id"> | null {
  let best: Omit<SpacingMeasurement, "id"> | null = null;

  for (const candidate of nodes) {
    if (candidate.id === source.id) {
      continue;
    }

    if (axis === "horizontal") {
      const distance = directionalHorizontalDistance(source, candidate);
      if (distance === null) {
        continue;
      }
      const measurement = {
        fromId: source.id,
        toId: candidate.id,
        axis,
        distance,
        alignment: resolveAlignment(source.bounds.y, source.bounds.height, candidate.bounds.y, candidate.bounds.height)
      } as const;
      if (!best || measurement.distance < best.distance) {
        best = measurement;
      }
      continue;
    }

    const distance = directionalVerticalDistance(source, candidate);
    if (distance === null) {
      continue;
    }
    const measurement = {
      fromId: source.id,
      toId: candidate.id,
      axis,
      distance,
      alignment: resolveAlignment(source.bounds.x, source.bounds.width, candidate.bounds.x, candidate.bounds.width)
    } as const;
    if (!best || measurement.distance < best.distance) {
      best = measurement;
    }
  }

  return best;
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return Math.min(endA, endB) - Math.max(startA, startB) > 0;
}

function directionalHorizontalDistance(source: LayoutNode, candidate: LayoutNode): number | null {
  if (!rangesOverlap(source.bounds.y, source.bounds.y + source.bounds.height, candidate.bounds.y, candidate.bounds.y + candidate.bounds.height)) {
    return null;
  }
  if (candidate.bounds.x < source.bounds.x) {
    return null;
  }
  return Math.max(0, candidate.bounds.x - (source.bounds.x + source.bounds.width));
}

function directionalVerticalDistance(source: LayoutNode, candidate: LayoutNode): number | null {
  if (!rangesOverlap(source.bounds.x, source.bounds.x + source.bounds.width, candidate.bounds.x, candidate.bounds.x + candidate.bounds.width)) {
    return null;
  }
  if (candidate.bounds.y < source.bounds.y) {
    return null;
  }
  return Math.max(0, candidate.bounds.y - (source.bounds.y + source.bounds.height));
}

function resolveAlignment(startA: number, sizeA: number, startB: number, sizeB: number): "start" | "center" | "end" | "overlap" {
  const endA = startA + sizeA;
  const endB = startB + sizeB;
  const centerA = startA + sizeA / 2;
  const centerB = startB + sizeB / 2;
  if (Math.abs(startA - startB) <= 4) {
    return "start";
  }
  if (Math.abs(endA - endB) <= 4) {
    return "end";
  }
  if (Math.abs(centerA - centerB) <= 4) {
    return "center";
  }
  return "overlap";
}

export interface HierarchicalLayoutNode {
  id: string;
  kind: string;
  bounds: { x: number; y: number; width: number; height: number };
  fill: string | null;
  gradient?: any;
  borderRadius: number | null;
  shadow?: any;
  componentId: string | null;
  confidence: number;
  children: HierarchicalLayoutNode[];
  parentId: string | null;
  depth: number;
}

export function buildLayoutHierarchy(nodes: LayoutNode[]): HierarchicalLayoutNode[] {
  const sorted = [...nodes].sort((a, b) => {
    const areaA = a.bounds.width * a.bounds.height;
    const areaB = b.bounds.width * b.bounds.height;
    return areaB - areaA;
  });

  const hierarchyNodes: Map<string, HierarchicalLayoutNode> = new Map();
  const roots: HierarchicalLayoutNode[] = [];

  for (const node of sorted) {
    hierarchyNodes.set(node.id, {
      id: node.id,
      kind: node.kind,
      bounds: node.bounds,
      fill: node.fill,
      gradient: (node as any).gradient ?? undefined,
      borderRadius: node.borderRadius,
      shadow: (node as any).shadow ?? undefined,
      componentId: node.componentId,
      confidence: node.confidence,
      children: [],
      parentId: null,
      depth: 0
    });
  }

  for (const node of sorted) {
    const hNode = hierarchyNodes.get(node.id)!;
    let bestParent: HierarchicalLayoutNode | null = null;
    let bestParentArea = Infinity;

    for (const candidate of sorted) {
      if (candidate.id === node.id) continue;
      const candidateArea = candidate.bounds.width * candidate.bounds.height;
      const nodeArea = node.bounds.width * node.bounds.height;
      if (candidateArea <= nodeArea) continue;
      if (!hierarchyContains(candidate.bounds, node.bounds)) continue;
      if (candidateArea < bestParentArea) {
        bestParent = hierarchyNodes.get(candidate.id)!;
        bestParentArea = candidateArea;
      }
    }

    if (bestParent) {
      hNode.parentId = bestParent.id;
      bestParent.children.push(hNode);
    } else {
      roots.push(hNode);
    }
  }

  function setDepth(node: HierarchicalLayoutNode, depth: number) {
    node.depth = depth;
    for (const child of node.children) {
      setDepth(child, depth + 1);
    }
  }
  for (const root of roots) {
    setDepth(root, 0);
  }

  function sortChildren(node: HierarchicalLayoutNode) {
    node.children.sort((a, b) => {
      if (Math.abs(a.bounds.y - b.bounds.y) > 8) return a.bounds.y - b.bounds.y;
      return a.bounds.x - b.bounds.x;
    });
    for (const child of node.children) {
      sortChildren(child);
    }
  }
  for (const root of roots) {
    sortChildren(root);
  }

  return roots;
}

function hierarchyContains(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    inner.x >= outer.x - 2 &&
    inner.y >= outer.y - 2 &&
    inner.x + inner.width <= outer.x + outer.width + 2 &&
    inner.y + inner.height <= outer.y + outer.height + 2
  );
}

export function detectLayoutBoxesFine(image: ImageAsset): LayoutNode[] {
  const FINE_GRID = 4;
  const cols = Math.ceil(image.width / FINE_GRID);
  const rows = Math.ceil(image.height / FINE_GRID);
  const background = hexToRgb(detectBackgroundColor(image));
  const active = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      active[row]![col] = isActiveCellAtGrid(image, col, row, background, FINE_GRID);
    }
  }

  const visited = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  const nodes: LayoutNode[] = [];
  let index = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!active[row]![col] || visited[row]![col]) continue;
      const component = floodFill(active, visited, col, row);
      if (component.length < 2) continue;

      const xs = component.map(([x]) => x);
      const ys = component.map(([, y]) => y);
      const minCol = Math.min(...xs);
      const maxCol = Math.max(...xs);
      const minRow = Math.min(...ys);
      const maxRow = Math.max(...ys);
      const centerX = Math.min(image.width - 1, Math.floor((minCol + maxCol + 1) * FINE_GRID * 0.5));
      const centerY = Math.min(image.height - 1, Math.floor((minRow + maxRow + 1) * FINE_GRID * 0.5));
      const [r, g, b] = samplePixel(image, centerX, centerY);

      nodes.push({
        id: `region-${++index}`,
        kind: "region",
        bounds: {
          x: minCol * FINE_GRID,
          y: minRow * FINE_GRID,
          width: Math.min(image.width - minCol * FINE_GRID, (maxCol - minCol + 1) * FINE_GRID),
          height: Math.min(image.height - minRow * FINE_GRID, (maxRow - minRow + 1) * FINE_GRID)
        },
        fill: rgbToHex(r, g, b),
        borderRadius: null,
        componentId: null,
        confidence: Math.min(0.95, 0.45 + component.length / (rows * cols))
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.bounds.y === b.bounds.y) return a.bounds.x - b.bounds.x;
    return a.bounds.y - b.bounds.y;
  });
}

function isActiveCellAtGrid(
  image: ImageAsset,
  col: number,
  row: number,
  background: { r: number; g: number; b: number },
  gridSize: number
): boolean {
  const startX = col * gridSize;
  const startY = row * gridSize;
  let delta = 0;
  let count = 0;

  for (let y = startY; y < Math.min(startY + gridSize, image.height); y++) {
    for (let x = startX; x < Math.min(startX + gridSize, image.width); x++) {
      const [r, g, b, a] = samplePixel(image, x, y);
      if (a < 8) continue;
      delta += Math.abs(r - background.r) + Math.abs(g - background.g) + Math.abs(b - background.b);
      count += 1;
    }
  }

  return count > 0 && delta / count > 32;
}
