import type { LayoutNode, SemanticAnchor, DesignToken, ImplementationPlan, TextBlock, Bounds } from "./index.js";

export interface ScaffoldOptions {
  react?: boolean;
  tokens?: DesignToken[];
  textBlocks?: TextBlock[];
  mode?: "absolute" | "structured";
}

export type ScaffoldMode = "absolute" | "structured";

export interface ScaffoldOutput {
  html: string;
  css: string;
  react?: ReactScaffoldOutput;
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

/**
 * Generate a complete, renderable HTML/CSS skeleton from the implementation plan.
 * Includes positioned containers with extracted colors, spacing tokens, and border-radius.
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
  const rootAnchors = anchors.filter(a => a.parentId === null);

  let bodyContent = "";
  for (const anchor of rootAnchors) {
    bodyContent += generateHtmlNode(anchor, anchors, nodes, textBlocks, 2);
  }

  const css = generateCssFromPlan(plan, anchors, nodes, tokens, mode);
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
  const pageHeight = Math.max(1, ...anchors.filter(a => a.parentId === null).map(a => a.bounds.y + a.bounds.height));

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

// --- React scaffold generation ---

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
  plan: ImplementationPlan
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
