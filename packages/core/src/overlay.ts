import type { LayoutNode, SemanticAnchor, SpacingMeasurement, TextBlock, OverlayAnnotation } from "./index.js";

/**
 * Build structured overlay annotations that pair each detected region with
 * its precise pixel measurements. Designed to be cross-referenced with the
 * screenshot by an LLM vision model — the agent's own vision handles semantics,
 * while these annotations provide exact measurements that vision models are bad at.
 */
export function buildOverlayAnnotations(
  nodes: LayoutNode[],
  anchors: SemanticAnchor[],
  spacing: SpacingMeasurement[],
  textBlocks: TextBlock[]
): OverlayAnnotation[] {
  const anchorByNodeId = new Map(anchors.filter(a => a.nodeId).map(a => [a.nodeId!, a]));

  return nodes.map(node => {
    const anchor = anchorByNodeId.get(node.id);
    const label = anchor?.name ?? node.id;

    // Find text blocks within this node for typography measurements
    const containedText = textBlocks.find(tb =>
      tb.bounds.x >= node.bounds.x && tb.bounds.y >= node.bounds.y &&
      tb.bounds.x + tb.bounds.width <= node.bounds.x + node.bounds.width &&
      tb.bounds.y + tb.bounds.height <= node.bounds.y + node.bounds.height
    );

    // Get spacing measurements involving this node
    const nodeSpacing = spacing
      .filter(s => s.fromId === node.id || s.toId === node.id)
      .map(s => {
        const targetId = s.fromId === node.id ? s.toId : s.fromId;
        const targetAnchor = anchors.find(a => a.nodeId === targetId);
        return {
          targetId,
          targetLabel: targetAnchor?.name ?? targetId,
          axis: s.axis,
          distance: s.distance
        };
      });

    return {
      nodeId: node.id,
      label,
      bounds: node.bounds,
      measurements: {
        exactX: node.bounds.x,
        exactY: node.bounds.y,
        exactWidth: node.bounds.width,
        exactHeight: node.bounds.height,
        fill: node.fill,
        borderRadius: node.borderRadius,
        fontSize: containedText?.typography?.fontSize ?? null,
        fontWeight: containedText?.typography?.fontWeight ?? null,
        lineHeight: containedText?.typography?.lineHeight ?? null,
        letterSpacing: containedText?.typography?.letterSpacing ?? null
      },
      spacingToNeighbors: nodeSpacing
    };
  });
}
