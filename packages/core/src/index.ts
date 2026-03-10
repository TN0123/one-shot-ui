import { z } from "zod";

export const VERSION = "0.3.0";

export const boundsSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative()
});

export const imageMetaSchema = z.object({
  path: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  channels: z.number().int().positive(),
  trimmedBounds: boundsSchema.nullable()
});

export const shadowSpecSchema = z.object({
  xOffset: z.number(),
  yOffset: z.number(),
  blurRadius: z.number().nonnegative(),
  spread: z.number(),
  color: z.string().regex(/^rgba?\(/i),
  confidence: z.number().min(0).max(1)
});

export const gradientStopSchema = z.object({
  color: z.string().regex(/^#[0-9A-F]{6}$/i),
  position: z.number().min(0).max(1)
});

export const gradientSpecSchema = z.object({
  type: z.enum(["linear", "radial"]),
  angle: z.number().nullable(),
  stops: z.array(gradientStopSchema).min(2),
  confidence: z.number().min(0).max(1)
});

export const fontFamilyCandidateSchema = z.object({
  family: z.string(),
  confidence: z.number().min(0).max(1)
});

export const designTokenSchema = z.object({
  name: z.string(),
  type: z.enum(["color", "spacing", "radius", "fontSize", "fontWeight", "shadow"]),
  value: z.unknown(),
  usedBy: z.array(z.string()),
  count: z.number().int().positive()
});

export const colorSwatchSchema = z.object({
  hex: z.string().regex(/^#[0-9A-F]{6}$/i),
  rgb: z.object({
    r: z.number().int().min(0).max(255),
    g: z.number().int().min(0).max(255),
    b: z.number().int().min(0).max(255)
  }),
  population: z.number().int().nonnegative(),
  ratio: z.number().min(0).max(1)
});

export const textBlockSchema = z.object({
  id: z.string(),
  text: z.string(),
  confidence: z.number().min(0).max(1),
  bounds: boundsSchema,
  typography: z.object({
    fontSize: z.number().positive().nullable(),
    fontWeight: z.number().int().min(100).max(900).nullable(),
    lineHeight: z.number().positive().nullable(),
    letterSpacing: z.number().nullable(),
    fontFamilyCandidates: z.array(fontFamilyCandidateSchema).optional(),
    confidence: z.number().min(0).max(1)
  }).nullable()
});

export const layoutNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(["region", "text"]),
  bounds: boundsSchema,
  fill: z.string().regex(/^#[0-9A-F]{6}$/i).nullable(),
  gradient: gradientSpecSchema.nullable().optional(),
  borderRadius: z.number().nonnegative().nullable(),
  shadow: shadowSpecSchema.nullable().optional(),
  componentId: z.string().nullable(),
  confidence: z.number().min(0).max(1)
});

export const spacingMeasurementSchema = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
  axis: z.enum(["horizontal", "vertical"]),
  distance: z.number(),
  alignment: z.enum(["start", "center", "end", "overlap"])
});

export const componentClusterSchema = z.object({
  id: z.string(),
  memberIds: z.array(z.string()),
  signature: z.object({
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    fill: z.string().regex(/^#[0-9A-F]{6}$/i).nullable(),
    borderRadius: z.number().nonnegative().nullable()
  }),
  confidence: z.number().min(0).max(1)
});

// Phase 4: Semantic node labeling
export const semanticLabelSchema = z.object({
  nodeId: z.string(),
  label: z.string(),
  componentType: z.string(),
  confidence: z.number().min(0).max(1)
});

export const semanticAnchorSchema = z.object({
  id: z.string(),
  nodeId: z.string().nullable(),
  name: z.string(),
  role: z.string(),
  parentId: z.string().nullable(),
  bounds: boundsSchema,
  confidence: z.number().min(0).max(1)
});

// Phase 4: Layout strategy detection
export const layoutStrategySchema = z.object({
  type: z.enum(["grid", "flex", "absolute", "unknown"]),
  columns: z.array(z.number()).optional(),
  rows: z.array(z.number()).optional(),
  gaps: z.object({
    horizontal: z.number().nonnegative().nullable(),
    vertical: z.number().nonnegative().nullable()
  }).optional(),
  confidence: z.number().min(0).max(1)
});

// Phase 4: DOM element for DOM-level comparison
export const domElementSchema = z.object({
  selector: z.string(),
  tagName: z.string(),
  bounds: boundsSchema,
  computedStyle: z.record(z.string(), z.string()),
  children: z.array(z.lazy((): z.ZodType => domElementSchema)).optional()
});

export const implementationPlanNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  parentId: z.string().nullable(),
  strategy: z.enum(["grid", "flex", "absolute", "stack", "text", "unknown"]),
  selectorHint: z.string().nullable(),
  bounds: boundsSchema,
  confidence: z.number().min(0).max(1)
});

export const implementationPlanSchema = z.object({
  page: z.object({
    primaryStrategy: z.string(),
    notes: z.array(z.string())
  }),
  nodes: z.array(implementationPlanNodeSchema),
  repeatedPatterns: z.array(z.string()),
  cssPrimitives: z.array(z.string()),
  typography: z.object({
    confidence: z.number().min(0).max(1),
    weak: z.boolean(),
    notes: z.array(z.string())
  })
});

export const extractReportSchema = z.object({
  version: z.string(),
  image: imageMetaSchema,
  colors: z.array(colorSwatchSchema),
  layout: z.array(layoutNodeSchema),
  text: z.array(textBlockSchema),
  spacing: z.array(spacingMeasurementSchema),
  components: z.array(componentClusterSchema),
  tokens: z.array(designTokenSchema).optional(),
  semanticLabels: z.array(semanticLabelSchema).optional(),
  semanticAnchors: z.array(semanticAnchorSchema).optional(),
  implementationPlan: implementationPlanSchema.optional(),
  layoutStrategy: layoutStrategySchema.optional(),
  diagnostics: z.object({
    background: z.string().regex(/^#[0-9A-F]{6}$/i),
    activePixelRatio: z.number().min(0).max(1)
  })
});

export const compareIssueSchema = z.object({
  code: z.enum([
    "DIMENSION_MISMATCH",
    "PIXEL_DIFFERENCE",
    "POSITION_MISMATCH",
    "SIZE_MISMATCH",
    "SPACING_MISMATCH",
    "BORDER_RADIUS_MISMATCH",
    "FONT_SIZE_MISMATCH",
    "FONT_WEIGHT_MISMATCH",
    "FONT_FAMILY_MISMATCH",
    "COLOR_MISMATCH",
    "SHADOW_MISMATCH",
    "GRADIENT_MISMATCH",
    "MISSING_NODE",
    "EXTRA_NODE",
    "LAYOUT_COUNT_MISMATCH",
    "TEXT_COUNT_MISMATCH",
    "DOM_POSITION_MISMATCH",
    "DOM_SIZE_MISMATCH",
    "DOM_STYLE_MISMATCH"
  ]),
  nodeId: z.string().optional(),
  anchorId: z.string().optional(),
  anchorName: z.string().optional(),
  contextPath: z.string().optional(),
  severity: z.enum(["low", "medium", "high"]),
  message: z.string(),
  suggestedFix: z.string().optional(),
  cssProperty: z.string().optional(),
  cssSelector: z.string().optional(),
  reference: z.unknown().optional(),
  implementation: z.unknown().optional()
});

export const compareOptionsSchema = z.object({
  heatmapPath: z.string().optional(),
  top: z.number().int().positive().default(20),
  confidenceThreshold: z.number().min(0).max(1).default(0.3),
  enableDomDiff: z.boolean().default(false),
  implementationUrl: z.string().optional()
});

export const compareReportSchema = z.object({
  version: z.string(),
  referenceImage: imageMetaSchema,
  implementationImage: imageMetaSchema,
  summary: z.object({
    mismatchPixels: z.number().int().nonnegative(),
    mismatchRatio: z.number().min(0).max(1),
    matchedLayoutNodes: z.number().int().nonnegative(),
    widthDelta: z.number().int(),
    heightDelta: z.number().int()
  }),
  issues: z.array(compareIssueSchema),
  artifacts: z.object({
    heatmapPath: z.string().nullable()
  })
});

export const captureOptionsSchema = z.object({
  url: z.string().url().optional(),
  filePath: z.string().optional(),
  outputPath: z.string(),
  width: z.number().int().positive().default(1440),
  height: z.number().int().positive().default(1024),
  deviceScaleFactor: z.number().positive().default(1)
}).refine((value) => Boolean(value.url || value.filePath), {
  message: "Either url or filePath is required"
});

export const captureResultSchema = z.object({
  version: z.string(),
  outputPath: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

export type Bounds = z.infer<typeof boundsSchema>;
export type ImageMeta = z.infer<typeof imageMetaSchema>;
export type ShadowSpec = z.infer<typeof shadowSpecSchema>;
export type GradientStop = z.infer<typeof gradientStopSchema>;
export type GradientSpec = z.infer<typeof gradientSpecSchema>;
export type FontFamilyCandidate = z.infer<typeof fontFamilyCandidateSchema>;
export type DesignToken = z.infer<typeof designTokenSchema>;
export type ColorSwatch = z.infer<typeof colorSwatchSchema>;
export type TextBlock = z.infer<typeof textBlockSchema>;
export type LayoutNode = z.infer<typeof layoutNodeSchema>;
export type SpacingMeasurement = z.infer<typeof spacingMeasurementSchema>;
export type ComponentCluster = z.infer<typeof componentClusterSchema>;
export type SemanticLabel = z.infer<typeof semanticLabelSchema>;
export type SemanticAnchor = z.infer<typeof semanticAnchorSchema>;
export type LayoutStrategy = z.infer<typeof layoutStrategySchema>;
export type DomElement = z.infer<typeof domElementSchema>;
export type ImplementationPlanNode = z.infer<typeof implementationPlanNodeSchema>;
export type ImplementationPlan = z.infer<typeof implementationPlanSchema>;
export type ExtractReport = z.infer<typeof extractReportSchema>;
export type CompareIssue = z.infer<typeof compareIssueSchema>;
export type CompareOptions = z.infer<typeof compareOptionsSchema>;
export type CompareReport = z.infer<typeof compareReportSchema>;
export type CaptureOptions = z.infer<typeof captureOptionsSchema>;
export type CaptureResult = z.infer<typeof captureResultSchema>;

export function buildSemanticAnchors(
  nodes: LayoutNode[],
  textBlocks: TextBlock[] = [],
  page?: { width: number; height: number }
): SemanticAnchor[] {
  if (nodes.length === 0) {
    return [];
  }

  const detectedWidth = Math.max(...nodes.map((node) => node.bounds.x + node.bounds.width));
  const detectedHeight = Math.max(...nodes.map((node) => node.bounds.y + node.bounds.height));
  const pageWidth = page?.width ?? detectedWidth;
  const pageHeight = page?.height ?? detectedHeight;
  const sorted = [...nodes].sort((left, right) => {
    if (left.bounds.x === right.bounds.x) {
      return left.bounds.y - right.bounds.y;
    }
    return left.bounds.x - right.bounds.x;
  });
  const largePanels = sorted.filter((node) => node.bounds.height >= pageHeight * 0.45 && node.bounds.width >= pageWidth * 0.08);
  const contentCoverage = (detectedWidth * detectedHeight) / Math.max(1, pageWidth * pageHeight);

  const anchors: SemanticAnchor[] = [];
  const panelAnchors = new Map<string, SemanticAnchor>();

  if (page) {
    const shellNames = ["left rail", "task list", "calendar board", "summary panel"] as const;
    buildSyntheticShellPanels(pageWidth, pageHeight).forEach((panel, index) => {
      anchors.push({
        id: `anchor-${anchors.length + 1}`,
        nodeId: null,
        name: shellNames[index]!,
        role: "panel",
        parentId: null,
        bounds: panel.bounds,
        confidence: 0.45
      });
    });
  }

  const panelSeed: Array<LayoutNode | { bounds: Bounds }> = largePanels.length >= 3 || contentCoverage > 0.45
    ? largePanels
    : buildSyntheticShellPanels(pageWidth, pageHeight);

  panelSeed.forEach((node, index) => {
    const name = inferPanelName(node as LayoutNode, pageWidth, index, panelSeed.length);
    if (anchors.some((anchor) => anchor.name === name && anchor.nodeId === null)) {
      return;
    }
    const anchor: SemanticAnchor = {
      id: `anchor-${anchors.length + 1}`,
      nodeId: isLayoutNode(node) ? node.id : null,
      name,
      role: "panel",
      parentId: null,
      bounds: node.bounds,
      confidence: isLayoutNode(node) ? 0.72 : 0.42
    };
    anchors.push(anchor);
    if (isLayoutNode(node)) {
      panelAnchors.set(node.id, anchor);
    }
  });

  const nodesByParent = new Map<string, LayoutNode[]>();
  for (const node of nodes) {
    const parent = findBestParentPanel(node, largePanels);
    if (!parent) {
      continue;
    }
    if (!nodesByParent.has(parent.id)) {
      nodesByParent.set(parent.id, []);
    }
    nodesByParent.get(parent.id)!.push(node);
  }

  for (const [parentId, members] of nodesByParent) {
    const parentAnchor = panelAnchors.get(parentId);
    if (!parentAnchor) {
      continue;
    }
    const siblings = members
      .filter((node) => node.id !== parentId)
      .sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);

    siblings.forEach((node, index) => {
      const name = inferChildAnchorName(parentAnchor.name, node, index, siblings.length, textBlocks);
      anchors.push({
        id: `anchor-${anchors.length + 1}`,
        nodeId: node.id,
        name,
        role: inferChildRole(parentAnchor.name, node, index, siblings.length),
        parentId: parentAnchor.id,
        bounds: node.bounds,
        confidence: 0.52
      });
    });
  }

  return anchors;
}

export function buildImplementationPlan(input: {
  layout: LayoutNode[];
  text: TextBlock[];
  layoutStrategy?: LayoutStrategy;
  semanticAnchors?: SemanticAnchor[];
}): ImplementationPlan {
  const anchors = input.semanticAnchors ?? buildSemanticAnchors(input.layout, input.text);
  const nodes = anchors.map((anchor) => ({
    id: anchor.id,
    name: anchor.name,
    role: anchor.role,
    parentId: anchor.parentId,
    strategy: inferNodeStrategy(anchor, input.layoutStrategy),
    selectorHint: toSelectorHint(anchor.name),
    bounds: anchor.bounds,
    confidence: anchor.confidence
  }));

  const repeatedPatterns = inferRepeatedPatterns(anchors);
  const cssPrimitives = inferCssPrimitives(input.layoutStrategy, anchors);
  const typographyConfidence = input.text.length === 0
    ? 0
    : Math.round((input.text.reduce((sum, block) => sum + (block.typography?.confidence ?? 0), 0) / input.text.length) * 100) / 100;
  const typographyWeak = typographyConfidence < 0.5 || input.text.length < 3;

  return {
    page: {
      primaryStrategy: input.layoutStrategy?.type ?? "unknown",
      notes: buildPageNotes(input.layoutStrategy, anchors)
    },
    nodes,
    repeatedPatterns,
    cssPrimitives,
    typography: {
      confidence: typographyConfidence,
      weak: typographyWeak,
      notes: typographyWeak
        ? ["Typography extraction is weak; validate font family, line height, and text alignment manually."]
        : ["Typography extraction is strong enough to use for first-pass sizing."]
    }
  };
}

function inferPanelName(node: LayoutNode, pageWidth: number, index: number, panelCount: number): string {
  const relX = node.bounds.x / Math.max(1, pageWidth);
  if (panelCount >= 4) {
    if (index === 0 || relX < 0.08) return "left rail";
    if (index === 1 || relX < 0.32) return "task list";
    if (index === panelCount - 1 || relX > 0.72) return "summary panel";
    return "calendar board";
  }
  if (relX < 0.1) return "left rail";
  if (relX < 0.38) return "left panel";
  if (relX > 0.72) return "right panel";
  return "main content";
}

function buildSyntheticShellPanels(pageWidth: number, pageHeight: number): Array<{ bounds: Bounds }> {
  return [
    { bounds: { x: 0, y: 0, width: Math.round(pageWidth * 0.06), height: pageHeight } },
    { bounds: { x: Math.round(pageWidth * 0.06), y: 0, width: Math.round(pageWidth * 0.20), height: pageHeight } },
    { bounds: { x: Math.round(pageWidth * 0.26), y: 0, width: Math.round(pageWidth * 0.50), height: pageHeight } },
    { bounds: { x: Math.round(pageWidth * 0.76), y: 0, width: pageWidth - Math.round(pageWidth * 0.76), height: pageHeight } }
  ];
}

function isLayoutNode(value: LayoutNode | { bounds: Bounds }): value is LayoutNode {
  return "id" in value;
}

function findBestParentPanel(node: LayoutNode, panels: LayoutNode[]): LayoutNode | null {
  let best: { node: LayoutNode; area: number } | null = null;
  for (const panel of panels) {
    if (panel.id === node.id) {
      continue;
    }
    if (!contains(panel.bounds, node.bounds)) {
      continue;
    }
    const area = panel.bounds.width * panel.bounds.height;
    if (!best || area < best.area) {
      best = { node: panel, area };
    }
  }
  return best?.node ?? null;
}

function inferChildAnchorName(
  parentName: string,
  node: LayoutNode,
  index: number,
  siblingCount: number,
  textBlocks: TextBlock[]
): string {
  const nearbyText = textBlocks.find((block) => overlaps(block.bounds, node.bounds));
  if (parentName === "left rail") {
    return index === 0 ? "left rail brand" : index >= siblingCount - 2 ? `left rail utility ${index - siblingCount + 3}` : `left rail icon ${index}`;
  }
  if (parentName === "task list") {
    if (node.bounds.y < 220) return "task list header";
    if (nearbyText?.text) return normalizeAnchorLabel(nearbyText.text);
    return `task row ${index}`;
  }
  if (parentName === "calendar board") {
    if (node.bounds.y < 220) return "calendar toolbar";
    return `calendar column ${index + 1}`;
  }
  if (parentName === "summary panel") {
    if (node.bounds.y < 180) return "summary toolbar";
    if (nearbyText?.text) return normalizeAnchorLabel(nearbyText.text);
    return index === 0 ? "summary composer" : `summary section ${index}`;
  }
  return `${parentName} item ${index + 1}`;
}

function inferChildRole(parentName: string, node: LayoutNode, index: number, siblingCount: number): string {
  if (parentName === "left rail") return index === 0 ? "brand" : index >= siblingCount - 2 ? "utility" : "icon";
  if (parentName === "task list") return node.bounds.y < 220 ? "header" : "row";
  if (parentName === "calendar board") return node.bounds.y < 220 ? "toolbar" : "column";
  if (parentName === "summary panel") return index === 0 ? "toolbar" : index === 1 ? "composer" : "section";
  return "section";
}

function inferNodeStrategy(anchor: SemanticAnchor, layoutStrategy?: LayoutStrategy): ImplementationPlanNode["strategy"] {
  if (anchor.role === "column" || anchor.role === "row") {
    return "grid";
  }
  if (anchor.role === "toolbar" || anchor.role === "icon") {
    return "flex";
  }
  if (anchor.role === "composer") {
    return "stack";
  }
  if (layoutStrategy?.type === "grid" || layoutStrategy?.type === "flex" || layoutStrategy?.type === "absolute") {
    return layoutStrategy.type;
  }
  return "unknown";
}

function inferRepeatedPatterns(anchors: SemanticAnchor[]): string[] {
  const results: string[] = [];
  const iconCount = anchors.filter((anchor) => anchor.role === "icon").length;
  const rowCount = anchors.filter((anchor) => anchor.role === "row").length;
  const columnCount = anchors.filter((anchor) => anchor.role === "column").length;
  if (iconCount >= 3) results.push("repeated icon buttons in the left rail");
  if (rowCount >= 3) results.push("stacked task rows with shared spacing and selection styling");
  if (columnCount >= 3) results.push("repeated calendar day columns with shared grid lines");
  return results;
}

function inferCssPrimitives(layoutStrategy: LayoutStrategy | undefined, anchors: SemanticAnchor[]): string[] {
  const primitives = new Set<string>();
  primitives.add("CSS custom properties for colors, borders, and spacing");
  if (layoutStrategy?.type === "grid" || anchors.some((anchor) => anchor.role === "column")) {
    primitives.add("CSS grid for the page shell and calendar columns");
  }
  if (layoutStrategy?.type === "flex" || anchors.some((anchor) => anchor.role === "toolbar" || anchor.role === "icon")) {
    primitives.add("Flex rows for toolbars and compact controls");
  }
  if (anchors.some((anchor) => anchor.role === "composer")) {
    primitives.add("Layered card styling for the composer area");
  }
  return [...primitives];
}

function buildPageNotes(layoutStrategy: LayoutStrategy | undefined, anchors: SemanticAnchor[]): string[] {
  const notes = [
    `Use ${layoutStrategy?.type ?? "mixed"} layout as the primary page shell strategy.`,
    "Treat the largest anchors as stable page panels so compare output stays consistent across iterations."
  ];
  if (anchors.some((anchor) => anchor.name === "calendar board")) {
    notes.push("The calendar board should keep equal-width day columns and a reserved hour gutter.");
  }
  return notes;
}

function toSelectorHint(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeAnchorLabel(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40);
}

function contains(outer: Bounds, inner: Bounds): boolean {
  return inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
}
