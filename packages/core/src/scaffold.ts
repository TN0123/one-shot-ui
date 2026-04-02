import type { LayoutNode, SemanticAnchor, DesignToken, ImplementationPlan, TextBlock, Bounds } from "./index.js";

export interface ScaffoldOptions {
  react?: boolean;
  tokens?: DesignToken[];
  textBlocks?: TextBlock[];
  mode?: "absolute" | "structured";
}

export type ScaffoldMode = "absolute" | "structured";
export type ScaffoldFramework = "react" | "vanilla";
export type ScaffoldStyling = "tailwind" | "css";

export interface ScaffoldOutput {
  html: string;
  css: string;
  react?: ReactScaffoldOutput;
  tailwindReact?: TailwindReactScaffoldOutput;
}

export interface ReactScaffoldOutput {
  componentTree: ReactComponent[];
  files: ReactFileEntry[];
}

export interface ReactComponent {
  name: string;
  props: Array<{ name: string; type: string; required: boolean }>;
  children: ReactComponent[];
  selectorHint: string;
}

export interface ReactFileEntry {
  path: string;
  content: string;
}

export interface TailwindReactScaffoldOutput {
  /** Single .tsx file content with Tailwind classes */
  tsx: string;
  /** File path for the component (default: Component.tsx) */
  filePath: string;
}

/**
 * Generate a complete, renderable HTML/CSS skeleton from the implementation plan.
 * Includes positioned containers with extracted colors, spacing tokens, and border-radius.
 *
 * When semantic anchor coverage is low, falls back to absolute-positioned divs
 * generated directly from raw layout nodes so the scaffold is always usable.
 */
export function generateHtmlScaffold(
  plan: ImplementationPlan,
  anchors: SemanticAnchor[],
  tokens: DesignToken[],
  nodes: LayoutNode[],
  textBlocks: TextBlock[],
  mode: ScaffoldMode = "structured"
): ScaffoldOutput {
  const cssVars = generateCssVariables(tokens);

  // Detect if anchor coverage is too sparse to produce useful output.
  // If real (non-synthetic) anchors cover less than 35% of total node area,
  // fall back to absolute-positioned layout from raw nodes.
  const useFallback = shouldUseFallback(anchors, nodes);

  let bodyContent = "";
  let css = "";

  if (useFallback) {
    const fallback = generateFallbackFromNodes(nodes, textBlocks, tokens);
    bodyContent = fallback.html;
    css = fallback.css;
  } else {
    const rootAnchors = anchors.filter(a => a.parentId === null);
    for (const anchor of rootAnchors) {
      bodyContent += generateHtmlNode(anchor, anchors, nodes, textBlocks, 2);
    }
    css = generateCssFromPlan(plan, anchors, nodes, tokens, mode);
  }

  const fullCss = `${cssVars}\n\n${css}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UI Scaffold</title>
  <style>
${fullCss}
  </style>
</head>
<body>
  <div class="page">
${bodyContent}  </div>
</body>
</html>`;

  return { html, css: fullCss };
}

/**
 * Determine whether anchor coverage is too low and we should fall back
 * to generating absolute-positioned divs from raw layout nodes.
 */
function shouldUseFallback(anchors: SemanticAnchor[], nodes: LayoutNode[]): boolean {
  if (nodes.length === 0) return false;
  if (anchors.length === 0) return true;

  // Count how many layout nodes are actually referenced by a non-synthetic anchor
  const realAnchors = anchors.filter(a => a.nodeId !== null);
  const anchoredNodeIds = new Set(realAnchors.map(a => a.nodeId));

  // Calculate area coverage of anchored nodes vs total node area
  const totalNodeArea = nodes.reduce((sum, n) => sum + n.bounds.width * n.bounds.height, 0);
  const anchoredArea = nodes
    .filter(n => anchoredNodeIds.has(n.id))
    .reduce((sum, n) => sum + n.bounds.width * n.bounds.height, 0);

  const coverage = totalNodeArea > 0 ? anchoredArea / totalNodeArea : 0;
  return coverage < 0.85;
}

function inferNodeRole(
  node: LayoutNode,
  allNodes: LayoutNode[]
): "header" | "footer" | "sidebar" | "main" | "section" {
  const maxWidth = Math.max(...allNodes.map(n => n.bounds.x + n.bounds.width));
  const maxHeight = Math.max(...allNodes.map(n => n.bounds.y + n.bounds.height));
  const widthRatio = node.bounds.width / Math.max(1, maxWidth);
  const heightRatio = node.bounds.height / Math.max(1, maxHeight);
  const topRatio = node.bounds.y / Math.max(1, maxHeight);
  const bottomEdgeRatio = (node.bounds.y + node.bounds.height) / Math.max(1, maxHeight);

  if (widthRatio > 0.6 && heightRatio < 0.18 && topRatio < 0.05) return "header";
  if (widthRatio > 0.6 && heightRatio < 0.18 && bottomEdgeRatio > 0.9) return "footer";
  if (heightRatio > 0.45 && widthRatio < 0.3) return "sidebar";
  if (widthRatio > 0.5 && heightRatio > 0.3) return "main";
  return "section";
}

function roleToTag(role: string): string {
  switch (role) {
    case "header": return "nav";
    case "footer": return "footer";
    case "sidebar": return "aside";
    case "main": return "main";
    default: return "section";
  }
}

/**
 * Cluster adjacent layout nodes into semantic groups by spatial hierarchy.
 * Groups nodes into bands (header, content rows, footer) and merges
 * small nodes within the same band. Caps output at maxGroups.
 */
function clusterNodesIntoGroups(
  nodes: LayoutNode[],
  maxGroups: number = 18
): Array<{ role: string; tag: string; nodes: LayoutNode[]; bounds: Bounds }> {
  if (nodes.length === 0) return [];

  const sorted = [...nodes].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  const pageWidth = Math.max(1, ...nodes.map(n => n.bounds.x + n.bounds.width));
  const pageHeight = Math.max(1, ...nodes.map(n => n.bounds.y + n.bounds.height));

  // Step 1: Assign each node a semantic role
  interface TaggedNode { node: LayoutNode; role: string; band: number }
  const bandHeight = pageHeight / Math.max(1, Math.min(8, Math.ceil(nodes.length / 3)));
  const tagged: TaggedNode[] = sorted.map(node => {
    const role = inferNodeRole(node, nodes);
    const band = Math.floor(node.bounds.y / bandHeight);
    return { node, role, band };
  });

  // Step 2: Group nodes that share the same role AND band
  const groupMap = new Map<string, TaggedNode[]>();
  for (const t of tagged) {
    const key = `${t.role}-${t.band}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(t);
  }

  // Step 3: Merge groups into semantic sections with combined bounds
  let groups = [...groupMap.entries()].map(([key, members]) => {
    const role = members[0]!.role;
    const tag = roleToTag(role);
    const memberNodes = members.map(m => m.node);
    const bounds: Bounds = {
      x: Math.min(...memberNodes.map(n => n.bounds.x)),
      y: Math.min(...memberNodes.map(n => n.bounds.y)),
      width: Math.max(...memberNodes.map(n => n.bounds.x + n.bounds.width)) - Math.min(...memberNodes.map(n => n.bounds.x)),
      height: Math.max(...memberNodes.map(n => n.bounds.y + n.bounds.height)) - Math.min(...memberNodes.map(n => n.bounds.y)),
    };
    return { role, tag, nodes: memberNodes, bounds };
  });

  // Sort by vertical position
  groups.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);

  // Step 4: Cap at maxGroups by merging smallest adjacent groups
  while (groups.length > maxGroups) {
    let smallestIdx = 0;
    let smallestArea = Infinity;
    for (let i = 0; i < groups.length; i++) {
      const area = groups[i]!.bounds.width * groups[i]!.bounds.height;
      if (area < smallestArea) {
        smallestArea = area;
        smallestIdx = i;
      }
    }
    // Merge with nearest neighbor (prefer next, fallback to previous)
    const mergeIdx = smallestIdx < groups.length - 1 ? smallestIdx + 1 : smallestIdx - 1;
    if (mergeIdx < 0) break;
    const a = groups[smallestIdx]!;
    const b = groups[mergeIdx]!;
    const merged = {
      role: b.nodes.length >= a.nodes.length ? b.role : a.role,
      tag: b.nodes.length >= a.nodes.length ? b.tag : a.tag,
      nodes: [...a.nodes, ...b.nodes],
      bounds: {
        x: Math.min(a.bounds.x, b.bounds.x),
        y: Math.min(a.bounds.y, b.bounds.y),
        width: Math.max(a.bounds.x + a.bounds.width, b.bounds.x + b.bounds.width) - Math.min(a.bounds.x, b.bounds.x),
        height: Math.max(a.bounds.y + a.bounds.height, b.bounds.y + b.bounds.height) - Math.min(a.bounds.y, b.bounds.y),
      },
    };
    const lo = Math.min(smallestIdx, mergeIdx);
    const hi = Math.max(smallestIdx, mergeIdx);
    groups.splice(hi, 1);
    groups[lo] = merged;
  }

  return groups;
}

/**
 * Generate semantic HTML from raw layout nodes when semantic
 * anchor coverage is too low for the structured scaffold to be useful.
 * Clusters nodes into semantic groups (~15-20 elements), uses semantic tags,
 * flexbox/grid layout, CSS custom properties, and placeholder text content.
 */
function generateFallbackFromNodes(
  nodes: LayoutNode[],
  textBlocks: TextBlock[],
  tokens: DesignToken[]
): { html: string; css: string } {
  let html = "";
  let css = `/* Semantic scaffold from layout detection + OCR */\n`;

  // Emit design tokens as CSS custom properties
  const colorTokens = tokens.filter(t => t.type === "color");
  if (colorTokens.length > 0) {
    css += `:root {\n`;
    for (const t of colorTokens) {
      css += `  ${t.name}: ${t.value};\n`;
    }
    css += `}\n\n`;
  }

  css += `.page {\n  display: flex;\n  flex-direction: column;\n  width: 100%;\n  min-height: 100vh;\n  box-sizing: border-box;\n}\n\n`;

  const groups = clusterNodesIntoGroups(nodes, 18);
  const placedText = new Set<string>();
  const pageWidth = Math.max(1, ...nodes.map(n => n.bounds.x + n.bounds.width));

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]!;
    const className = `${group.role}-${gi}`;

    // Find text blocks contained in this group's combined bounds
    const containedText = textBlocks.filter(
      tb => !placedText.has(tb.id) && scaffoldBoundsContain(group.bounds, tb.bounds)
    );
    for (const tb of containedText) placedText.add(tb.id);
    containedText.sort((a, b) => a.bounds.y - b.bounds.y);

    // Check if this group has horizontal children (cards/columns)
    const hasHorizontalChildren = group.nodes.length > 1 &&
      group.nodes.some(n => n.bounds.x > group.bounds.x + 20);

    let inner = "";
    if (containedText.length > 0) {
      for (const tb of containedText) {
        const fontSize = tb.typography?.fontSize ?? 0;
        const textTag = fontSize >= 28 ? "h1" : fontSize >= 20 ? "h2" : "p";
        inner += `      <${textTag}>${escapeHtml(tb.text)}</${textTag}>\n`;
      }
    } else {
      // Add placeholder content based on role
      if (group.role === "header") {
        inner += `      <h1>Page Title</h1>\n`;
      } else if (group.role === "footer") {
        inner += `      <p>Footer content</p>\n`;
      } else if (group.role === "sidebar") {
        inner += `      <p>Sidebar navigation</p>\n`;
      } else if (group.role === "main" || group.role === "section") {
        if (group.bounds.height > 200) {
          inner += `      <h2>Section Heading</h2>\n      <p>Content goes here.</p>\n`;
        }
      }
    }

    html += `    <${group.tag} class="${className}" data-node="${group.nodes.map(n => n.id).join(",")}">\n${inner}    </${group.tag}>\n`;

    css += `.${className} {\n`;
    css += `  box-sizing: border-box;\n`;

    const widthPct = Math.round((group.bounds.width / pageWidth) * 100);
    css += widthPct >= 95 ? `  width: 100%;\n` : `  width: ${widthPct}%;\n`;
    css += `  min-height: ${group.bounds.height}px;\n`;

    if (containedText.length > 0) {
      const firstText = containedText[0]!;
      const padLeft = Math.max(0, firstText.bounds.x - group.bounds.x);
      const padTop = Math.max(0, firstText.bounds.y - group.bounds.y);
      if (padLeft > 4 || padTop > 4) {
        css += `  padding: ${padTop}px ${padLeft}px;\n`;
      }
    }

    // Use CSS custom properties for colors instead of inline values
    const primaryNode = group.nodes.reduce((best, n) =>
      n.bounds.width * n.bounds.height > best.bounds.width * best.bounds.height ? n : best,
      group.nodes[0]!
    );

    if (primaryNode.fill) {
      const colorToken = tokens.find(t => t.type === "color" && String(t.value).toUpperCase() === primaryNode.fill?.toUpperCase());
      css += `  background-color: ${colorToken ? `var(${colorToken.name})` : primaryNode.fill};\n`;
    }

    if (primaryNode.borderRadius && primaryNode.borderRadius > 0) {
      const radiusToken = tokens.find(t => t.type === "radius" && t.value === `${primaryNode.borderRadius}px`);
      css += `  border-radius: ${radiusToken ? `var(${radiusToken.name})` : `${primaryNode.borderRadius}px`};\n`;
      css += `  overflow: hidden;\n`;
    }

    if (primaryNode.shadow) {
      css += `  box-shadow: ${primaryNode.shadow.xOffset}px ${primaryNode.shadow.yOffset}px ${primaryNode.shadow.blurRadius}px ${primaryNode.shadow.spread}px ${primaryNode.shadow.color};\n`;
    }

    // Use flex layout for groups with horizontal children
    if (hasHorizontalChildren) {
      css += `  display: flex;\n  flex-wrap: wrap;\n  gap: 16px;\n`;
    }

    css += `}\n\n`;
  }

  return { html, css };
}

/**
 * Generate a React component tree with props interfaces, CSS modules,
 * and a suggested file structure.
 */
export function generateReactScaffold(
  plan: ImplementationPlan,
  anchors: SemanticAnchor[],
  tokens: DesignToken[],
  nodes: LayoutNode[],
  textBlocks: TextBlock[],
  components: Array<{ id: string; memberIds: string[]; signature: any }>
): ReactScaffoldOutput {
  const componentTree = buildComponentTree(anchors, components, nodes);
  const files = generateReactFiles(componentTree, anchors, tokens, nodes, textBlocks, plan);
  return { componentTree, files };
}

function generateCssVariables(tokens: DesignToken[]): string {
  if (tokens.length === 0) return "";
  const vars = tokens.map(t => `  ${t.name}: ${t.value};`).join("\n");
  return `:root {\n${vars}\n}`;
}

function inferGap(children: SemanticAnchor[]): { gap: number; direction: "row" | "column" } {
  if (children.length < 2) return { gap: 0, direction: "column" };
  const sorted = [...children].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  const yRange = Math.max(...sorted.map(c => c.bounds.y)) - Math.min(...sorted.map(c => c.bounds.y));
  const xRange = Math.max(...sorted.map(c => c.bounds.x)) - Math.min(...sorted.map(c => c.bounds.x));
  const isRow = xRange > yRange;

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (isRow) {
      gaps.push(sorted[i]!.bounds.x - (sorted[i - 1]!.bounds.x + sorted[i - 1]!.bounds.width));
    } else {
      gaps.push(sorted[i]!.bounds.y - (sorted[i - 1]!.bounds.y + sorted[i - 1]!.bounds.height));
    }
  }
  const avg = gaps.length > 0 ? Math.round(gaps.reduce((s, g) => s + Math.max(0, g), 0) / gaps.length) : 0;
  return { gap: Math.max(0, avg), direction: isRow ? "row" : "column" };
}

function inferPadding(parent: SemanticAnchor, children: SemanticAnchor[]): { top: number; right: number; bottom: number; left: number } {
  if (children.length === 0) return { top: 0, right: 0, bottom: 0, left: 0 };
  const minX = Math.min(...children.map(c => c.bounds.x));
  const minY = Math.min(...children.map(c => c.bounds.y));
  const maxX = Math.max(...children.map(c => c.bounds.x + c.bounds.width));
  const maxY = Math.max(...children.map(c => c.bounds.y + c.bounds.height));
  return {
    top: Math.max(0, minY - parent.bounds.y),
    right: Math.max(0, (parent.bounds.x + parent.bounds.width) - maxX),
    bottom: Math.max(0, (parent.bounds.y + parent.bounds.height) - maxY),
    left: Math.max(0, minX - parent.bounds.x),
  };
}

function generateCssFromPlan(
  plan: ImplementationPlan,
  anchors: SemanticAnchor[],
  nodes: LayoutNode[],
  tokens: DesignToken[],
  mode: ScaffoldMode = "structured"
): string {
  let css = "";

  // Compute page bounds for relative sizing
  const pageWidth = Math.max(1, ...anchors.filter(a => a.parentId === null).map(a => a.bounds.x + a.bounds.width));

  // Page container
  css += `.page {\n`;
  css += `  position: relative;\n`;
  css += `  width: 100%;\n`;
  css += `  box-sizing: border-box;\n`;
  css += `  min-height: 100vh;\n`;
  if (plan.page.primaryStrategy === "grid") {
    css += `  display: grid;\n`;
  } else if (plan.page.primaryStrategy === "flex") {
    css += `  display: flex;\n  flex-direction: column;\n`;
  }
  css += `}\n\n`;

  for (const anchor of anchors) {
    const selector = toClassName(anchor.name);
    const node = nodes.find(n => n.id === anchor.nodeId);
    const planNode = plan.nodes.find(n => n.id === anchor.id);
    const children = anchors.filter(a => a.parentId === anchor.id);

    css += `.${selector} {\n`;

    // Position and size
    if (mode === "absolute") {
      // Absolute mode: use exact pixel positioning
      if (anchor.parentId === null) {
        css += `  position: absolute;\n`;
        css += `  left: ${anchor.bounds.x}px;\n`;
        css += `  top: ${anchor.bounds.y}px;\n`;
      }
      css += `  width: ${anchor.bounds.width}px;\n`;
      css += `  height: ${anchor.bounds.height}px;\n`;
    } else {
      // Structured mode: use relative sizing
      if (anchor.parentId === null) {
        // Root anchors: percentage of page width, min-height instead of fixed
        if (plan.page.primaryStrategy !== "grid" && plan.page.primaryStrategy !== "flex") {
          css += `  position: absolute;\n`;
          css += `  left: ${anchor.bounds.x}px;\n`;
          css += `  top: ${anchor.bounds.y}px;\n`;
        }
        const widthPct = Math.round((anchor.bounds.width / pageWidth) * 1000) / 10;
        css += `  width: ${widthPct}%;\n`;
        css += `  min-height: ${anchor.bounds.height}px;\n`;
      } else {
        // Child anchors: percentage of parent bounds
        const parent = anchors.find(a => a.id === anchor.parentId);
        if (parent) {
          const parentWidth = Math.max(1, parent.bounds.width);
          const widthPct = Math.round((anchor.bounds.width / parentWidth) * 1000) / 10;
          css += `  width: ${widthPct}%;\n`;
          css += `  min-height: ${anchor.bounds.height}px;\n`;
        } else {
          css += `  width: ${anchor.bounds.width}px;\n`;
          css += `  min-height: ${anchor.bounds.height}px;\n`;
        }
      }
    }

    // Fill color
    if (node?.fill) {
      const colorToken = tokens.find(t => t.type === "color" && String(t.value).toUpperCase() === node.fill?.toUpperCase());
      css += `  background-color: ${colorToken ? `var(${colorToken.name})` : node.fill};\n`;
    }

    // Border radius + overflow hidden
    if (node?.borderRadius && node.borderRadius > 0) {
      const radiusToken = tokens.find(t => t.type === "radius" && t.value === `${node.borderRadius}px`);
      css += `  border-radius: ${radiusToken ? `var(${radiusToken.name})` : `${node.borderRadius}px`};\n`;
      css += `  overflow: hidden;\n`;
    }

    // Shadow
    if (node?.shadow) {
      css += `  box-shadow: ${node.shadow.xOffset}px ${node.shadow.yOffset}px ${node.shadow.blurRadius}px ${node.shadow.spread}px ${node.shadow.color};\n`;
    }

    // Gradient
    if (node?.gradient) {
      const stops = node.gradient.stops.map((s: any) => `${s.color} ${Math.round(s.position * 100)}%`).join(", ");
      if (node.gradient.type === "linear") {
        css += `  background: linear-gradient(${node.gradient.angle}deg, ${stops});\n`;
      } else {
        css += `  background: radial-gradient(${stops});\n`;
      }
    }

    // Chart container styling
    if (anchor.role === "chart") {
      css += `  overflow: hidden;\n`;
      css += `  position: relative;\n`;
    }

    // Avatar styling
    if (anchor.role === "avatar") {
      css += `  border-radius: 50%;\n`;
      css += `  overflow: hidden;\n`;
    }

    // Layout strategy for children with gap and padding inference
    if (children.length > 0) {
      const { gap, direction } = inferGap(children);
      const padding = inferPadding(anchor, children);

      if (planNode) {
        if (planNode.strategy === "flex") {
          css += `  display: flex;\n`;
          css += `  flex-direction: ${direction};\n`;
          css += `  align-items: center;\n`;
        } else if (planNode.strategy === "grid") {
          css += `  display: grid;\n`;
        }
      } else if (children.length >= 2) {
        // Infer flex even without a plan node
        css += `  display: flex;\n`;
        css += `  flex-direction: ${direction};\n`;
        css += `  align-items: center;\n`;
      }

      if (gap > 0) {
        css += `  gap: ${gap}px;\n`;
      }

      // Add padding if meaningful (> 2px to avoid noise)
      if (padding.top > 2 || padding.right > 2 || padding.bottom > 2 || padding.left > 2) {
        css += `  padding: ${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px;\n`;
      }
    } else if (planNode) {
      if (planNode.strategy === "flex") {
        css += `  display: flex;\n`;
      } else if (planNode.strategy === "grid") {
        css += `  display: grid;\n`;
      }
    }

    css += `}\n\n`;
  }

  return css;
}

function generateHtmlNode(
  anchor: SemanticAnchor,
  allAnchors: SemanticAnchor[],
  nodes: LayoutNode[],
  textBlocks: TextBlock[],
  indent: number
): string {
  const pad = "  ".repeat(indent);
  const className = toClassName(anchor.name);
  const tag = inferHtmlTag(anchor.role);
  const children = allAnchors.filter(a => a.parentId === anchor.id);
  const containedText = textBlocks.filter(tb => scaffoldBoundsContain(anchor.bounds, tb.bounds));
  const dataAnchor = ` data-anchor="${escapeHtml(anchor.name)}"`;

  if (children.length === 0 && containedText.length === 0) {
    // Generate placeholders for known UI primitive roles
    if (anchor.role === "chart") {
      return `${pad}<${tag} class="${className}"${dataAnchor}>\n${pad}  <div class="chart-placeholder" style="width:100%;height:100%;background:linear-gradient(135deg,#e2e8f0,#cbd5e1);display:flex;align-items:center;justify-content:center;color:#64748b;font-size:14px;">Chart</div>\n${pad}</${tag}>\n`;
    }
    if (anchor.role === "avatar") {
      return `${pad}<${tag} class="${className}"${dataAnchor}>\n${pad}  <div class="avatar-placeholder" style="width:100%;height:100%;border-radius:50%;background:#94a3b8;"></div>\n${pad}</${tag}>\n`;
    }
    if (anchor.role === "icon") {
      return `${pad}<${tag} class="${className}"${dataAnchor}>\n${pad}  <svg viewBox="0 0 24 24" fill="currentColor" style="width:100%;height:100%;"><rect x="4" y="4" width="16" height="16" rx="2" opacity="0.3"/></svg>\n${pad}</${tag}>\n`;
    }

    // Check if this looks like a placeholder image or chart based on aspect ratio and area
    const area = anchor.bounds.width * anchor.bounds.height;
    const aspectRatio = anchor.bounds.width / Math.max(1, anchor.bounds.height);

    if (area > 40000 && aspectRatio > 1.5) {
      // Likely a chart or wide visual element
      let content = `${pad}<${tag} class="${className}"${dataAnchor}>\n`;
      content += `${pad}  <div class="placeholder-chart" style="width:100%;height:100%;background:#e0e0e0;display:flex;align-items:center;justify-content:center;color:#999;font-size:14px;">Chart Placeholder</div>\n`;
      content += `${pad}</${tag}>\n`;
      return content;
    }

    if (area > 10000 && aspectRatio >= 0.7 && aspectRatio <= 1.4) {
      // Roughly square, moderate area — likely an image
      const svgPlaceholder = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${anchor.bounds.width}' height='${anchor.bounds.height}'%3E%3Crect fill='%23ccc' width='100%25' height='100%25'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23999' font-size='14'%3EImage%3C/text%3E%3C/svg%3E`;
      let content = `${pad}<${tag} class="${className}"${dataAnchor}>\n`;
      content += `${pad}  <img src="${svgPlaceholder}" alt="placeholder" style="width:100%;height:100%;object-fit:cover;" />\n`;
      content += `${pad}</${tag}>\n`;
      return content;
    }

    return `${pad}<${tag} class="${className}"${dataAnchor}></${tag}>\n`;
  }

  let content = `${pad}<${tag} class="${className}"${dataAnchor}>\n`;

  if (children.length === 0) {
    for (const tb of containedText) {
      const fontSize = tb.typography?.fontSize ?? 0;
      if (fontSize >= 28) {
        content += `${pad}  <h1>${escapeHtml(tb.text)}</h1>\n`;
      } else if (fontSize >= 20) {
        content += `${pad}  <h2>${escapeHtml(tb.text)}</h2>\n`;
      } else {
        content += `${pad}  <p>${escapeHtml(tb.text)}</p>\n`;
      }
    }
  } else {
    for (const child of children) {
      content += generateHtmlNode(child, allAnchors, nodes, textBlocks, indent + 1);
    }
  }

  content += `${pad}</${tag}>\n`;
  return content;
}

function inferHtmlTag(role: string): string {
  switch (role) {
    case "header": return "header";
    case "footer": return "footer";
    case "navigation": case "sidebar": return "nav";
    case "main": return "main";
    case "banner": return "section";
    default: return "div";
  }
}

function toClassName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function scaffoldBoundsContain(outer: Bounds, inner: Bounds): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- Tailwind + React scaffold generation ---

/**
 * Generate a single React (.tsx) component with Tailwind CSS classes.
 * This is the preferred output format — modern frameworks produce
 * dramatically better results than raw HTML/CSS.
 */
export function generateTailwindReactScaffold(
  plan: ImplementationPlan,
  anchors: SemanticAnchor[],
  tokens: DesignToken[],
  nodes: LayoutNode[],
  textBlocks: TextBlock[],
  components: Array<{ id: string; memberIds: string[]; signature: any }>
): TailwindReactScaffoldOutput {
  const useFallback = shouldUseFallback(anchors, nodes);

  let bodyJsx: string;
  if (useFallback) {
    bodyJsx = generateTailwindFallbackJsx(nodes, textBlocks, tokens, 3);
  } else {
    const rootAnchors = anchors.filter(a => a.parentId === null);
    bodyJsx = rootAnchors
      .map(a => generateTailwindAnchorJsx(a, anchors, nodes, textBlocks, tokens, plan, 3))
      .join("\n");
  }

  const tsx = `import React from "react";

export default function Page() {
  return (
    <div className="${tailwindPageClasses(plan)}">
${bodyJsx}
    </div>
  );
}
`;

  return { tsx, filePath: "Page.tsx" };
}

function tailwindPageClasses(plan: ImplementationPlan): string {
  const classes = ["min-h-screen", "w-full"];
  if (plan.page.primaryStrategy === "flex") {
    classes.push("flex", "flex-col");
  } else if (plan.page.primaryStrategy === "grid") {
    classes.push("grid");
  } else {
    classes.push("relative");
  }
  return classes.join(" ");
}

function generateTailwindFallbackJsx(
  nodes: LayoutNode[],
  textBlocks: TextBlock[],
  tokens: DesignToken[],
  indent: number
): string {
  const groups = clusterNodesIntoGroups(nodes, 18);
  const placedText = new Set<string>();
  const pageWidth = Math.max(1, ...nodes.map(n => n.bounds.x + n.bounds.width));
  const lines: string[] = [];
  const pad = "  ".repeat(indent);

  for (const group of groups) {
    const tag = tailwindRoleToTag(group.role);
    // Build classes from the largest node in the group (representative styling)
    const primaryNode = group.nodes.reduce((best, n) =>
      n.bounds.width * n.bounds.height > best.bounds.width * best.bounds.height ? n : best,
      group.nodes[0]!
    );
    const classes = buildTailwindClasses(primaryNode, pageWidth, tokens);

    // Check if this group has horizontal children
    const hasHorizontalChildren = group.nodes.length > 1 &&
      group.nodes.some(n => n.bounds.x > group.bounds.x + 20);
    const layoutClasses = hasHorizontalChildren ? `${classes} flex flex-wrap gap-4` : classes;

    const containedText = textBlocks.filter(
      tb => !placedText.has(tb.id) && scaffoldBoundsContain(group.bounds, tb.bounds)
    );
    for (const tb of containedText) placedText.add(tb.id);
    containedText.sort((a, b) => a.bounds.y - b.bounds.y);

    if (containedText.length > 0) {
      lines.push(`${pad}<${tag} className="${layoutClasses}">`);
      for (const tb of containedText) {
        const fontSize = tb.typography?.fontSize ?? 0;
        const textTag = fontSize >= 28 ? "h1" : fontSize >= 20 ? "h2" : "p";
        const textClasses = tailwindTextClasses(fontSize, tb.typography?.fontWeight ?? undefined);
        lines.push(`${pad}  <${textTag} className="${textClasses}">${escapeJsx(tb.text)}</${textTag}>`);
      }
      lines.push(`${pad}</${tag}>`);
    } else {
      // Add placeholder content for empty semantic groups
      if (group.role === "header" || group.role === "footer" || (group.role === "main" && group.bounds.height > 200)) {
        const placeholderTag = group.role === "header" ? "h1" : group.role === "main" ? "h2" : "p";
        const placeholderText = group.role === "header" ? "Page Title" : group.role === "footer" ? "Footer content" : "Section Heading";
        const textClasses = tailwindTextClasses(group.role === "header" ? 28 : 16);
        lines.push(`${pad}<${tag} className="${layoutClasses}">`);
        lines.push(`${pad}  <${placeholderTag} className="${textClasses}">${placeholderText}</${placeholderTag}>`);
        lines.push(`${pad}</${tag}>`);
      } else {
        lines.push(`${pad}<${tag} className="${layoutClasses}" />`);
      }
    }
  }

  return lines.join("\n");
}

function generateTailwindAnchorJsx(
  anchor: SemanticAnchor,
  allAnchors: SemanticAnchor[],
  nodes: LayoutNode[],
  textBlocks: TextBlock[],
  tokens: DesignToken[],
  plan: ImplementationPlan,
  indent: number
): string {
  const pad = "  ".repeat(indent);
  const tag = tailwindRoleToTag(anchor.role);
  const node = nodes.find(n => n.id === anchor.nodeId);
  const children = allAnchors.filter(a => a.parentId === anchor.id);
  const containedText = textBlocks.filter(tb => scaffoldBoundsContain(anchor.bounds, tb.bounds));
  const planNode = plan.nodes.find(n => n.id === anchor.id);

  const classes = buildTailwindAnchorClasses(anchor, node, children, planNode, allAnchors, tokens);

  if (children.length === 0 && containedText.length === 0) {
    // Special role placeholders
    if (anchor.role === "chart") {
      return `${pad}<${tag} className="${classes}">\n${pad}  <div className="w-full h-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-slate-500 text-sm">Chart</div>\n${pad}</${tag}>`;
    }
    if (anchor.role === "avatar") {
      return `${pad}<${tag} className="${classes}">\n${pad}  <div className="w-full h-full rounded-full bg-slate-400" />\n${pad}</${tag}>`;
    }
    return `${pad}<${tag} className="${classes}" />`;
  }

  let content = `${pad}<${tag} className="${classes}">`;

  if (children.length > 0) {
    content += "\n";
    for (const child of children) {
      content += generateTailwindAnchorJsx(child, allAnchors, nodes, textBlocks, tokens, plan, indent + 1) + "\n";
    }
    content += `${pad}</${tag}>`;
  } else {
    content += "\n";
    for (const tb of containedText) {
      const fontSize = tb.typography?.fontSize ?? 0;
      const textTag = fontSize >= 28 ? "h1" : fontSize >= 20 ? "h2" : "p";
      const textClasses = tailwindTextClasses(fontSize, tb.typography?.fontWeight ?? undefined);
      content += `${pad}  <${textTag} className="${textClasses}">${escapeJsx(tb.text)}</${textTag}>\n`;
    }
    content += `${pad}</${tag}>`;
  }

  return content;
}

function buildTailwindClasses(node: LayoutNode, pageWidth: number, tokens: DesignToken[]): string {
  const classes: string[] = ["box-border"];
  const widthPct = Math.round((node.bounds.width / pageWidth) * 100);
  classes.push(widthPct >= 95 ? "w-full" : `w-[${widthPct}%]`);
  classes.push(`min-h-[${node.bounds.height}px]`);

  if (node.fill) {
    classes.push(cssColorToTailwind("bg", node.fill));
  }
  if (node.borderRadius && node.borderRadius > 0) {
    classes.push(cssRadiusToTailwind(node.borderRadius));
    classes.push("overflow-hidden");
  }
  if (node.shadow) {
    classes.push(cssShadowToTailwind(node.shadow));
  }
  if (node.gradient) {
    classes.push(...cssGradientToTailwind(node.gradient));
  }

  return classes.join(" ");
}

function buildTailwindAnchorClasses(
  anchor: SemanticAnchor,
  node: LayoutNode | undefined,
  children: SemanticAnchor[],
  planNode: ImplementationPlan["nodes"][number] | undefined,
  allAnchors: SemanticAnchor[],
  tokens: DesignToken[]
): string {
  const classes: string[] = [];

  // Width
  if (anchor.parentId === null) {
    const pageWidth = Math.max(1, ...allAnchors.filter(a => a.parentId === null).map(a => a.bounds.x + a.bounds.width));
    const widthPct = Math.round((anchor.bounds.width / pageWidth) * 100);
    classes.push(widthPct >= 95 ? "w-full" : `w-[${widthPct}%]`);
  } else {
    const parent = allAnchors.find(a => a.id === anchor.parentId);
    if (parent) {
      const widthPct = Math.round((anchor.bounds.width / Math.max(1, parent.bounds.width)) * 100);
      classes.push(widthPct >= 95 ? "w-full" : `w-[${widthPct}%]`);
    }
  }

  classes.push(`min-h-[${anchor.bounds.height}px]`);

  // Fill
  if (node?.fill) {
    classes.push(cssColorToTailwind("bg", node.fill));
  }

  // Border radius
  if (node?.borderRadius && node.borderRadius > 0) {
    classes.push(cssRadiusToTailwind(node.borderRadius));
    classes.push("overflow-hidden");
  }
  if (anchor.role === "avatar") {
    classes.push("rounded-full", "overflow-hidden");
  }
  if (anchor.role === "chart") {
    classes.push("overflow-hidden", "relative");
  }

  // Shadow
  if (node?.shadow) {
    classes.push(cssShadowToTailwind(node.shadow));
  }

  // Gradient
  if (node?.gradient) {
    classes.push(...cssGradientToTailwind(node.gradient));
  }

  // Layout for children
  if (children.length > 0) {
    const { gap, direction } = inferGap(children);
    const padding = inferPadding(anchor, children);

    if (planNode?.strategy === "grid") {
      classes.push("grid");
    } else {
      classes.push("flex");
      classes.push(direction === "row" ? "flex-row" : "flex-col");
      classes.push("items-center");
    }

    if (gap > 0) {
      classes.push(cssGapToTailwind(gap));
    }

    if (padding.top > 2 || padding.right > 2 || padding.bottom > 2 || padding.left > 2) {
      classes.push(...cssPaddingToTailwind(padding));
    }
  }

  return classes.join(" ");
}

// --- Tailwind utility mappers ---

function cssColorToTailwind(prefix: string, hex: string): string {
  // Use arbitrary value for exact color matching
  return `${prefix}-[${hex.toLowerCase()}]`;
}

function cssRadiusToTailwind(px: number): string {
  if (px <= 2) return "rounded-sm";
  if (px <= 4) return "rounded";
  if (px <= 6) return "rounded-md";
  if (px <= 8) return "rounded-lg";
  if (px <= 12) return "rounded-xl";
  if (px <= 16) return "rounded-2xl";
  if (px >= 9999) return "rounded-full";
  return `rounded-[${px}px]`;
}

function cssShadowToTailwind(shadow: { xOffset: number; yOffset: number; blurRadius: number; spread: number; color: string }): string {
  const { xOffset, yOffset, blurRadius, spread, color } = shadow;
  return `shadow-[${xOffset}px_${yOffset}px_${blurRadius}px_${spread}px_${color.replace(/ /g, "_")}]`;
}

function cssGradientToTailwind(gradient: { type: string; angle: number | null; stops: Array<{ color: string; position: number }> }): string[] {
  if (gradient.type === "linear" && gradient.stops.length >= 2) {
    const from = gradient.stops[0]!;
    const to = gradient.stops[gradient.stops.length - 1]!;
    return [
      "bg-gradient-to-br",
      `from-[${from.color.toLowerCase()}]`,
      `to-[${to.color.toLowerCase()}]`
    ];
  }
  return [`bg-[radial-gradient(${gradient.stops.map(s => `${s.color}_${Math.round(s.position * 100)}%`).join(",_")})]`];
}

function cssGapToTailwind(px: number): string {
  const scale: Record<number, string> = { 0: "0", 1: "px", 2: "0.5", 4: "1", 8: "2", 12: "3", 16: "4", 20: "5", 24: "6", 32: "8", 40: "10", 48: "12" };
  const nearest = Object.keys(scale).map(Number).reduce((prev, curr) =>
    Math.abs(curr - px) < Math.abs(prev - px) ? curr : prev
  );
  if (Math.abs(nearest - px) <= 2) {
    return `gap-${scale[nearest]}`;
  }
  return `gap-[${px}px]`;
}

function cssPaddingToTailwind(p: { top: number; right: number; bottom: number; left: number }): string[] {
  const classes: string[] = [];
  if (p.top > 2) classes.push(`pt-[${p.top}px]`);
  if (p.right > 2) classes.push(`pr-[${p.right}px]`);
  if (p.bottom > 2) classes.push(`pb-[${p.bottom}px]`);
  if (p.left > 2) classes.push(`pl-[${p.left}px]`);
  return classes;
}

function tailwindTextClasses(fontSize: number, fontWeight?: number): string {
  const classes: string[] = [];
  if (fontSize >= 36) classes.push("text-4xl");
  else if (fontSize >= 30) classes.push("text-3xl");
  else if (fontSize >= 24) classes.push("text-2xl");
  else if (fontSize >= 20) classes.push("text-xl");
  else if (fontSize >= 18) classes.push("text-lg");
  else if (fontSize >= 16) classes.push("text-base");
  else if (fontSize >= 14) classes.push("text-sm");
  else classes.push("text-xs");

  if (fontWeight && fontWeight >= 700) classes.push("font-bold");
  else if (fontWeight && fontWeight >= 600) classes.push("font-semibold");
  else if (fontWeight && fontWeight >= 500) classes.push("font-medium");

  return classes.join(" ");
}

function tailwindRoleToTag(role: string): string {
  switch (role) {
    case "header": return "header";
    case "footer": return "footer";
    case "navigation": case "sidebar": return "nav";
    case "main": return "main";
    default: return "div";
  }
}

function escapeJsx(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
}

/**
 * Convert a CSS property + value pair into a Tailwind class suggestion.
 * Used by suggest-fixes to emit Tailwind-native guidance.
 */
export function cssToTailwindClass(property: string, value: string): string {
  const v = value.trim();
  const px = Number.parseInt(v);

  switch (property) {
    case "background-color":
      return `bg-[${v}]`;
    case "width":
      return Number.isNaN(px) ? `w-[${v}]` : `w-[${px}px]`;
    case "height":
      return Number.isNaN(px) ? `h-[${v}]` : `h-[${px}px]`;
    case "min-height":
      return Number.isNaN(px) ? `min-h-[${v}]` : `min-h-[${px}px]`;
    case "padding":
      return Number.isNaN(px) ? `p-[${v}]` : `p-[${px}px]`;
    case "padding-top":
      return Number.isNaN(px) ? `pt-[${v}]` : `pt-[${px}px]`;
    case "padding-right":
      return Number.isNaN(px) ? `pr-[${v}]` : `pr-[${px}px]`;
    case "padding-bottom":
      return Number.isNaN(px) ? `pb-[${v}]` : `pb-[${px}px]`;
    case "padding-left":
      return Number.isNaN(px) ? `pl-[${v}]` : `pl-[${px}px]`;
    case "margin":
      return Number.isNaN(px) ? `m-[${v}]` : `m-[${px}px]`;
    case "gap":
      return cssGapToTailwind(Number.isNaN(px) ? 0 : px);
    case "border-radius":
      return cssRadiusToTailwind(Number.isNaN(px) ? 0 : px);
    case "font-size":
      return Number.isNaN(px) ? `text-[${v}]` : `text-[${px}px]`;
    case "font-weight": {
      const w = Number.parseInt(v);
      if (w >= 700) return "font-bold";
      if (w >= 600) return "font-semibold";
      if (w >= 500) return "font-medium";
      if (w >= 400) return "font-normal";
      return `font-[${v}]`;
    }
    case "font-family":
      return v.includes("serif") && !v.includes("sans") ? "font-serif" : "font-sans";
    case "box-shadow":
      return v === "none" ? "shadow-none" : `shadow-[${v.replace(/ /g, "_")}]`;
    case "left":
      return Number.isNaN(px) ? `left-[${v}]` : `left-[${px}px]`;
    case "top":
      return Number.isNaN(px) ? `top-[${v}]` : `top-[${px}px]`;
    default:
      return `[${property}:${v}]`;
  }
}

// --- React scaffold generation (CSS modules, legacy) ---

function buildComponentTree(
  anchors: SemanticAnchor[],
  components: Array<{ id: string; memberIds: string[]; signature: any }>,
  nodes: LayoutNode[]
): ReactComponent[] {
  const rootAnchors = anchors.filter(a => a.parentId === null);
  return rootAnchors.map(anchor => buildReactComponent(anchor, anchors, components, nodes));
}

function buildReactComponent(
  anchor: SemanticAnchor,
  allAnchors: SemanticAnchor[],
  components: Array<{ id: string; memberIds: string[]; signature: any }>,
  nodes: LayoutNode[]
): ReactComponent {
  const children = allAnchors.filter(a => a.parentId === anchor.id);
  const node = anchor.nodeId ? nodes.find(n => n.id === anchor.nodeId) : undefined;
  const cluster = node ? components.find(c => c.memberIds.includes(node.id)) : undefined;

  const props: Array<{ name: string; type: string; required: boolean }> = [];
  if (cluster && cluster.memberIds.length >= 2) {
    props.push({ name: "children", type: "React.ReactNode", required: false });
  }

  return {
    name: toPascalCase(anchor.name),
    props,
    children: children.map(c => buildReactComponent(c, allAnchors, components, nodes)),
    selectorHint: toClassName(anchor.name)
  };
}

function generateReactFiles(
  tree: ReactComponent[],
  anchors: SemanticAnchor[],
  tokens: DesignToken[],
  nodes: LayoutNode[],
  textBlocks: TextBlock[],
  _plan: ImplementationPlan
): ReactFileEntry[] {
  const files: ReactFileEntry[] = [];

  // Tokens CSS file
  files.push({
    path: "src/tokens.css",
    content: generateTokensCss(tokens)
  });

  // App.tsx
  const imports: string[] = [];
  const jsx: string[] = [];

  for (const comp of tree) {
    imports.push(`import { ${comp.name} } from "./components/${comp.name}";`);
    jsx.push(`        <${comp.name} />`);
    files.push(...generateComponentFiles(comp, anchors, nodes, textBlocks, tokens));
  }

  files.push({
    path: "src/App.tsx",
    content: `import "./tokens.css";\n${imports.join("\n")}\n\nexport function App() {\n  return (\n    <div className="page">\n${jsx.join("\n")}\n    </div>\n  );\n}\n`
  });

  return files;
}

function generateComponentFiles(
  comp: ReactComponent,
  anchors: SemanticAnchor[],
  nodes: LayoutNode[],
  textBlocks: TextBlock[],
  tokens: DesignToken[]
): ReactFileEntry[] {
  const files: ReactFileEntry[] = [];
  const anchor = anchors.find(a => toPascalCase(a.name) === comp.name);
  const node = anchor?.nodeId ? nodes.find(n => n.id === anchor.nodeId) : undefined;

  // Component CSS module
  let css = `.root {\n`;
  if (anchor) {
    css += `  width: ${anchor.bounds.width}px;\n`;
    css += `  height: ${anchor.bounds.height}px;\n`;
  }
  if (node?.fill) {
    css += `  background-color: ${node.fill};\n`;
  }
  if (node?.borderRadius && node.borderRadius > 0) {
    css += `  border-radius: ${node.borderRadius}px;\n`;
  }
  css += `}\n`;

  files.push({
    path: `src/components/${comp.name}.module.css`,
    content: css
  });

  // Component TSX
  let childJsx = "";
  let childImports = "";

  if (comp.children.length > 0) {
    for (const child of comp.children) {
      childImports += `import { ${child.name} } from "./${child.name}";\n`;
      childJsx += `      <${child.name} />\n`;
      files.push(...generateComponentFiles(child, anchors, nodes, textBlocks, tokens));
    }
  } else if (anchor) {
    const contained = textBlocks.filter(tb => scaffoldBoundsContain(anchor.bounds, tb.bounds));
    for (const tb of contained) {
      childJsx += `      <span>${escapeHtml(tb.text)}</span>\n`;
    }
  }

  const propsInterface = comp.props.length > 0
    ? `\ninterface ${comp.name}Props {\n${comp.props.map(p => `  ${p.name}${p.required ? "" : "?"}: ${p.type};`).join("\n")}\n}\n`
    : "";

  const propsParam = comp.props.length > 0 ? `props: ${comp.name}Props` : "";

  const tsx = `${childImports}import styles from "./${comp.name}.module.css";\n${propsInterface}\nexport function ${comp.name}(${propsParam}) {\n  return (\n    <div className={styles.root}>\n${childJsx}    </div>\n  );\n}\n`;

  files.push({
    path: `src/components/${comp.name}.tsx`,
    content: tsx
  });

  return files;
}

function generateTokensCss(tokens: DesignToken[]): string {
  if (tokens.length === 0) return ":root {}\n";
  const vars = tokens.map(t => `  ${t.name}: ${t.value};`).join("\n");
  return `:root {\n${vars}\n}\n`;
}

function toPascalCase(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}
