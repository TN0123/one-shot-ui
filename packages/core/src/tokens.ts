import type { DesignToken, ExtractReport } from "./index.js";

export function generateDesignTokens(report: ExtractReport): DesignToken[] {
  const tokens: DesignToken[] = [];

  tokens.push(...generateColorTokens(report));
  tokens.push(...generateSpacingTokens(report));
  tokens.push(...generateRadiusTokens(report));
  tokens.push(...generateFontSizeTokens(report));
  tokens.push(...generateFontWeightTokens(report));
  tokens.push(...generateShadowTokens(report));

  return tokens;
}

function generateColorTokens(report: ExtractReport): DesignToken[] {
  const colorUsage = new Map<string, string[]>();

  for (const node of report.layout) {
    if (node.fill) {
      const normalized = node.fill.toUpperCase();
      const list = colorUsage.get(normalized) ?? [];
      list.push(node.id);
      colorUsage.set(normalized, list);
    }
  }

  // Cluster similar colors (within distance 24)
  const clusters: Array<{ representative: string; members: string[]; usedBy: string[] }> = [];
  const assigned = new Set<string>();

  for (const [color, usedBy] of colorUsage) {
    if (assigned.has(color)) continue;
    assigned.add(color);
    const cluster = { representative: color, members: [color], usedBy: [...usedBy] };

    for (const [other, otherUsedBy] of colorUsage) {
      if (assigned.has(other)) continue;
      if (hexDistance(color, other) < 24) {
        assigned.add(other);
        cluster.members.push(other);
        cluster.usedBy.push(...otherUsedBy);
      }
    }

    clusters.push(cluster);
  }

  const bg = report.diagnostics.background.toUpperCase();
  let colorIndex = 0;

  return clusters
    .filter((c) => c.usedBy.length >= 1)
    .sort((a, b) => b.usedBy.length - a.usedBy.length)
    .map((cluster) => {
      const isBg = hexDistance(cluster.representative, bg) < 24;
      const name = isBg ? "--color-background" : `--color-${colorIndex++}`;
      return {
        name,
        type: "color" as const,
        value: cluster.representative,
        usedBy: cluster.usedBy,
        count: cluster.usedBy.length
      };
    });
}

function generateSpacingTokens(report: ExtractReport): DesignToken[] {
  const spacingValues = new Map<number, string[]>();

  for (const measurement of report.spacing) {
    const quantized = quantize(measurement.distance, 4);
    const list = spacingValues.get(quantized) ?? [];
    list.push(measurement.id);
    spacingValues.set(quantized, list);
  }

  return [...spacingValues.entries()]
    .filter(([, usedBy]) => usedBy.length >= 2)
    .sort((a, b) => a[0] - b[0])
    .map(([value, usedBy], i) => ({
      name: `--spacing-${i}`,
      type: "spacing" as const,
      value: `${value}px`,
      usedBy,
      count: usedBy.length
    }));
}

function generateRadiusTokens(report: ExtractReport): DesignToken[] {
  const radiusValues = new Map<number, string[]>();

  for (const node of report.layout) {
    if (node.borderRadius !== null && node.borderRadius > 0) {
      const quantized = quantize(node.borderRadius, 2);
      const list = radiusValues.get(quantized) ?? [];
      list.push(node.id);
      radiusValues.set(quantized, list);
    }
  }

  return [...radiusValues.entries()]
    .filter(([, usedBy]) => usedBy.length >= 2)
    .sort((a, b) => a[0] - b[0])
    .map(([value, usedBy], i) => ({
      name: `--radius-${i}`,
      type: "radius" as const,
      value: `${value}px`,
      usedBy,
      count: usedBy.length
    }));
}

function generateFontSizeTokens(report: ExtractReport): DesignToken[] {
  const sizeValues = new Map<number, string[]>();

  for (const block of report.text) {
    if (block.typography?.fontSize) {
      const quantized = quantize(block.typography.fontSize, 2);
      const list = sizeValues.get(quantized) ?? [];
      list.push(block.id);
      sizeValues.set(quantized, list);
    }
  }

  return [...sizeValues.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, usedBy], i) => ({
      name: `--font-size-${i}`,
      type: "fontSize" as const,
      value: `${value}px`,
      usedBy,
      count: usedBy.length
    }));
}

function generateFontWeightTokens(report: ExtractReport): DesignToken[] {
  const weightValues = new Map<number, string[]>();

  for (const block of report.text) {
    if (block.typography?.fontWeight) {
      const list = weightValues.get(block.typography.fontWeight) ?? [];
      list.push(block.id);
      weightValues.set(block.typography.fontWeight, list);
    }
  }

  return [...weightValues.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, usedBy], i) => ({
      name: `--font-weight-${i}`,
      type: "fontWeight" as const,
      value,
      usedBy,
      count: usedBy.length
    }));
}

function generateShadowTokens(report: ExtractReport): DesignToken[] {
  const shadowSignatures = new Map<string, string[]>();

  for (const node of report.layout) {
    if (node.shadow) {
      const key = `${node.shadow.xOffset}:${node.shadow.yOffset}:${quantize(node.shadow.blurRadius, 2)}`;
      const list = shadowSignatures.get(key) ?? [];
      list.push(node.id);
      shadowSignatures.set(key, list);
    }
  }

  return [...shadowSignatures.entries()]
    .filter(([, usedBy]) => usedBy.length >= 1)
    .map(([key, usedBy], i) => {
      const [x, y, blur] = key.split(":").map(Number);
      // Find the first node with this shadow to get the color
      const refNode = report.layout.find((n) => n.shadow && n.id === usedBy[0]);
      const color = refNode?.shadow?.color ?? "rgba(0, 0, 0, 0.1)";
      return {
        name: `--shadow-${i}`,
        type: "shadow" as const,
        value: `${x}px ${y}px ${blur}px ${color}`,
        usedBy,
        count: usedBy.length
      };
    });
}

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function hexDistance(a: string, b: string): number {
  const parse = (hex: string, start: number) => {
    const val = Number.parseInt(hex.replace("#", "").slice(start, start + 2), 16);
    return Number.isFinite(val) ? Math.max(0, Math.min(255, val)) : 0;
  };
  return Math.abs(parse(a, 0) - parse(b, 0)) + Math.abs(parse(a, 2) - parse(b, 2)) + Math.abs(parse(a, 4) - parse(b, 4));
}
