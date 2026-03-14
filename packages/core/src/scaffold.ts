import type { LayoutNode, SemanticAnchor, DesignToken, ImplementationPlan, TextBlock, Bounds } from "./index.js";

export interface ScaffoldOptions {
  react?: boolean;
  tokens?: DesignToken[];
  textBlocks?: TextBlock[];
}

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
  textBlocks: TextBlock[]
): ScaffoldOutput {
  const cssVars = generateCssVariables(tokens);
  const rootAnchors = anchors.filter(a => a.parentId === null);

  let bodyContent = "";
  for (const anchor of rootAnchors) {
    bodyContent += generateHtmlNode(anchor, anchors, nodes, textBlocks, 2);
  }

  const css = generateCssFromPlan(plan, anchors, nodes, tokens);
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

function generateCssFromPlan(
  plan: ImplementationPlan,
  anchors: SemanticAnchor[],
  nodes: LayoutNode[],
  tokens: DesignToken[]
): string {
  let css = "";

  // Page container
  css += `.page {\n`;
  css += `  position: relative;\n`;
  css += `  width: 100%;\n`;
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

    css += `.${selector} {\n`;

    // Position and size
    if (anchor.parentId === null) {
      if (plan.page.primaryStrategy !== "grid" && plan.page.primaryStrategy !== "flex") {
        css += `  position: absolute;\n`;
        css += `  left: ${anchor.bounds.x}px;\n`;
        css += `  top: ${anchor.bounds.y}px;\n`;
      }
    }
    css += `  width: ${anchor.bounds.width}px;\n`;
    css += `  height: ${anchor.bounds.height}px;\n`;

    // Fill color
    if (node?.fill) {
      const colorToken = tokens.find(t => t.type === "color" && String(t.value).toUpperCase() === node.fill?.toUpperCase());
      css += `  background-color: ${colorToken ? `var(${colorToken.name})` : node.fill};\n`;
    }

    // Border radius
    if (node?.borderRadius && node.borderRadius > 0) {
      const radiusToken = tokens.find(t => t.type === "radius" && t.value === `${node.borderRadius}px`);
      css += `  border-radius: ${radiusToken ? `var(${radiusToken.name})` : `${node.borderRadius}px`};\n`;
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

    // Layout strategy for children
    if (planNode) {
      if (planNode.strategy === "flex") {
        css += `  display: flex;\n`;
        const children = anchors.filter(a => a.parentId === anchor.id);
        if (children.length >= 2) {
          const yRange = Math.max(...children.map(c => c.bounds.y)) - Math.min(...children.map(c => c.bounds.y));
          const xRange = Math.max(...children.map(c => c.bounds.x)) - Math.min(...children.map(c => c.bounds.x));
          css += `  flex-direction: ${xRange > yRange ? "row" : "column"};\n`;
          css += `  align-items: center;\n`;
        }
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

  if (children.length === 0 && containedText.length === 0) {
    return `${pad}<${tag} class="${className}"></${tag}>\n`;
  }

  let content = `${pad}<${tag} class="${className}">\n`;

  if (children.length === 0) {
    for (const tb of containedText) {
      content += `${pad}  <span>${escapeHtml(tb.text)}</span>\n`;
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
