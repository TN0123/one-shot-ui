import type { LayoutNode, SemanticLabel } from "@one-shot-ui/core";

/**
 * Adapter interface for LLM-based semantic labeling.
 * Implementations should send the screenshot and layout data to an LLM
 * and return semantic labels for each detected region.
 */
export interface SemanticLabelAdapter {
  labelNodes(input: {
    imagePath: string;
    nodes: LayoutNode[];
  }): Promise<SemanticLabel[]>;
}

export interface LabelNodesOptions {
  adapter?: SemanticLabelAdapter;
}

/**
 * Labels layout nodes with semantic names and component types.
 * When an LLM adapter is provided, sends the screenshot and layout data to the LLM.
 * Without an adapter, falls back to heuristic-based labeling using node geometry.
 */
export async function labelNodes(
  imagePath: string,
  nodes: LayoutNode[],
  options?: LabelNodesOptions
): Promise<SemanticLabel[]> {
  if (options?.adapter) {
    return options.adapter.labelNodes({ imagePath, nodes });
  }

  return heuristicLabels(nodes);
}

/**
 * Fallback heuristic labeling based on node position, size, and visual properties.
 * Produces approximate labels like "header", "sidebar", "card", "button" based
 * on geometry and common UI layout conventions.
 */
function heuristicLabels(nodes: LayoutNode[]): SemanticLabel[] {
  if (nodes.length === 0) return [];

  const pageWidth = Math.max(...nodes.map((n) => n.bounds.x + n.bounds.width));
  const pageHeight = Math.max(...nodes.map((n) => n.bounds.y + n.bounds.height));

  return nodes.map((node) => {
    const { bounds } = node;
    const relX = bounds.x / pageWidth;
    const relY = bounds.y / pageHeight;
    const relWidth = bounds.width / pageWidth;
    const relHeight = bounds.height / pageHeight;
    const aspectRatio = bounds.width / Math.max(1, bounds.height);

    const { label, componentType, confidence } = inferLabel(
      relX, relY, relWidth, relHeight, aspectRatio, bounds, node
    );

    return {
      nodeId: node.id,
      label,
      componentType,
      confidence
    };
  });
}

function inferLabel(
  relX: number,
  relY: number,
  relWidth: number,
  relHeight: number,
  aspectRatio: number,
  bounds: { x: number; y: number; width: number; height: number },
  node: LayoutNode
): { label: string; componentType: string; confidence: number } {
  // Full-width element at the top = header/navbar
  if (relY < 0.08 && relWidth > 0.8) {
    return { label: "header", componentType: "navbar", confidence: 0.6 };
  }

  // Full-width element at the bottom = footer
  if (relY > 0.85 && relWidth > 0.8) {
    return { label: "footer", componentType: "footer", confidence: 0.5 };
  }

  // Narrow tall element on the left = sidebar
  if (relX < 0.05 && relWidth < 0.25 && relHeight > 0.5) {
    return { label: "sidebar", componentType: "sidebar", confidence: 0.6 };
  }

  // Small element with high aspect ratio = button
  if (bounds.width < 300 && bounds.height < 80 && bounds.height >= 24 && aspectRatio > 1.5 && aspectRatio < 8) {
    return { label: `button-${node.id}`, componentType: "button", confidence: 0.4 };
  }

  // Small square-ish element = avatar or icon
  if (bounds.width < 80 && bounds.height < 80 && Math.abs(aspectRatio - 1) < 0.3) {
    return { label: `icon-${node.id}`, componentType: "icon", confidence: 0.35 };
  }

  // Medium-sized rectangle with border radius = card
  if (relWidth > 0.15 && relWidth < 0.6 && relHeight > 0.08 && relHeight < 0.5 && (node.borderRadius ?? 0) > 4) {
    return { label: `card-${node.id}`, componentType: "card", confidence: 0.45 };
  }

  // Wide element in the middle area = content section
  if (relWidth > 0.5 && relHeight > 0.1) {
    return { label: `section-${node.id}`, componentType: "section", confidence: 0.35 };
  }

  // Default: generic panel
  return { label: `panel-${node.id}`, componentType: "panel", confidence: 0.2 };
}
