import type { LayoutNode, SpacingMeasurement } from "@one-shot-ui/core";
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
