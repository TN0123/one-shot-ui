import type { ComponentCluster, LayoutNode } from "@one-shot-ui/core";

export function clusterComponents(nodes: LayoutNode[]): { nodes: LayoutNode[]; components: ComponentCluster[] } {
  const groups = new Map<string, LayoutNode[]>();

  for (const node of nodes) {
    const key = [
      quantize(node.bounds.width, 12),
      quantize(node.bounds.height, 12),
      node.fill ?? "none",
      node.borderRadius === null ? "none" : quantize(node.borderRadius, 4)
    ].join(":");
    const group = groups.get(key) ?? [];
    group.push(node);
    groups.set(key, group);
  }

  const clusterByNodeId = new Map<string, string>();
  const components: ComponentCluster[] = [];
  let index = 0;

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const id = `component-${++index}`;
    for (const node of group) {
      clusterByNodeId.set(node.id, id);
    }

    components.push({
      id,
      memberIds: group.map((node) => node.id),
      signature: {
        width: average(group.map((node) => node.bounds.width)),
        height: average(group.map((node) => node.bounds.height)),
        fill: group[0]!.fill,
        borderRadius: group[0]!.borderRadius
      },
      confidence: Math.min(0.96, 0.45 + group.length * 0.12)
    });
  }

  return {
    nodes: nodes.map((node) => ({
      ...node,
      componentId: clusterByNodeId.get(node.id) ?? null
    })),
    components
  };
}

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
