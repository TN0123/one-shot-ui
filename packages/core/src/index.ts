import { z } from "zod";

export const VERSION = "0.4.0";

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
    textAlignment: z.enum(["left", "center", "right", "justify"]).nullable().optional(),
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

export const hierarchicalNodeSchema: z.ZodType<any> = z.object({
  id: z.string(),
  kind: z.enum(["region", "text"]),
  bounds: boundsSchema,
  fill: z.string().regex(/^#[0-9A-F]{6}$/i).nullable(),
  gradient: gradientSpecSchema.nullable().optional(),
  borderRadius: z.number().nonnegative().nullable(),
  shadow: shadowSpecSchema.nullable().optional(),
  componentId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  children: z.lazy(() => z.array(hierarchicalNodeSchema)),
  parentId: z.string().nullable(),
  depth: z.number().int().nonnegative()
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
  hierarchy: z.array(hierarchicalNodeSchema).optional(),
  annotations: z.array(z.object({
    nodeId: z.string(),
    label: z.string(),
    bounds: boundsSchema,
    measurements: z.object({
      exactX: z.number(),
      exactY: z.number(),
      exactWidth: z.number(),
      exactHeight: z.number(),
      fill: z.string().nullable(),
      borderRadius: z.number().nullable(),
      fontSize: z.number().nullable(),
      fontWeight: z.number().nullable(),
      lineHeight: z.number().nullable(),
      letterSpacing: z.number().nullable()
    }),
    spacingToNeighbors: z.array(z.object({
      targetId: z.string(),
      targetLabel: z.string(),
      axis: z.enum(["horizontal", "vertical"]),
      distance: z.number()
    }))
  })).optional(),
  diagnostics: z.object({
    background: z.string().regex(/^#[0-9A-F]{6}$/i),
    activePixelRatio: z.number().min(0).max(1)
  })
});

export const compareIssueSchema = z.object({
  code: z.enum([
    "DIMENSION_MISMATCH",
    "PIXEL_DIFFERENCE",
    "REGION_SEMANTIC_FALLBACK",
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
  implementation: z.unknown().optional(),
  issueBounds: boundsSchema.optional(),
  visualWeight: z.number().min(0).max(1).optional()
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
    heightDelta: z.number().int(),
    focus: z.object({
      requestedRegion: z.string().nullable(),
      bounds: boundsSchema.nullable(),
      semanticCoverage: z.number().min(0).max(1),
      realAnchorCount: z.number().int().nonnegative(),
      syntheticAnchorCount: z.number().int().nonnegative(),
      fallbackToPixelOnly: z.boolean()
    }).optional()
  }),
  issues: z.array(compareIssueSchema),
  artifacts: z.object({
    heatmapPath: z.string().nullable(),
    regionHeatmaps: z.array(z.object({
      region: z.string(),
      heatmapPath: z.string(),
      bounds: boundsSchema,
      mismatchRatio: z.number().min(0).max(1)
    })).optional()
  })
});

export const benchmarkCaseRegionSchema = z.object({
  name: z.string(),
  maxMismatchRatio: z.number().min(0).max(1).optional()
});

export const benchmarkCaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  referencePath: z.string(),
  implementationPath: z.string().optional(),
  domDiffPath: z.string().optional(),
  notes: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  regions: z.array(benchmarkCaseRegionSchema).optional()
});

export const benchmarkManifestSchema = z.object({
  version: z.string(),
  cases: z.array(benchmarkCaseSchema).min(1)
});

export const benchmarkRegionResultSchema = z.object({
  name: z.string(),
  mismatchRatio: z.number().min(0).max(1).nullable(),
  issueCount: z.number().int().nonnegative(),
  semanticCoverage: z.number().min(0).max(1),
  fallbackToPixelOnly: z.boolean(),
  withinRegionIssueRatio: z.number().min(0).max(1).nullable(),
  passed: z.boolean().nullable()
});

export const benchmarkCaseResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  referencePath: z.string(),
  implementationPath: z.string().nullable(),
  pixelMismatchRatio: z.number().min(0).max(1).nullable(),
  compareIssueCount: z.number().int().nonnegative(),
  anchorCoverage: z.object({
    realCount: z.number().int().nonnegative(),
    syntheticCount: z.number().int().nonnegative(),
    realAreaRatio: z.number().min(0).max(1),
    realShare: z.number().min(0).max(1)
  }),
  planningUsefulness: z.object({
    score: z.number().min(0).max(1),
    nodeCount: z.number().int().nonnegative(),
    cssPrimitiveCount: z.number().int().nonnegative(),
    repeatedPatternCount: z.number().int().nonnegative(),
    typographyConfidence: z.number().min(0).max(1)
  }),
  typographyReliability: z.number().min(0).max(1),
  domDiffUsefulness: z.object({
    selectorIssueRatio: z.number().min(0).max(1).nullable(),
    issueCount: z.number().int().nonnegative().nullable()
  }),
  regions: z.array(benchmarkRegionResultSchema)
});

export const benchmarkSuiteReportSchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  manifestPath: z.string(),
  summary: z.object({
    caseCount: z.number().int().positive(),
    comparableCaseCount: z.number().int().nonnegative(),
    averageMismatchRatio: z.number().min(0).max(1).nullable(),
    averagePlanningUsefulness: z.number().min(0).max(1),
    averageTypographyReliability: z.number().min(0).max(1),
    averageAnchorCoverage: z.number().min(0).max(1),
    averageRoiReliability: z.number().min(0).max(1).nullable(),
    averageDomSelectorIssueRatio: z.number().min(0).max(1).nullable()
  }),
  cases: z.array(benchmarkCaseResultSchema)
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
export type HierarchicalNode = z.infer<typeof hierarchicalNodeSchema>;
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
export type BenchmarkCaseRegion = z.infer<typeof benchmarkCaseRegionSchema>;
export type BenchmarkCase = z.infer<typeof benchmarkCaseSchema>;
export type BenchmarkManifest = z.infer<typeof benchmarkManifestSchema>;
export type BenchmarkRegionResult = z.infer<typeof benchmarkRegionResultSchema>;
export type BenchmarkCaseResult = z.infer<typeof benchmarkCaseResultSchema>;
export type BenchmarkSuiteReport = z.infer<typeof benchmarkSuiteReportSchema>;
export type OverlayAnnotation = {
  nodeId: string;
  label: string;
  bounds: Bounds;
  measurements: {
    exactX: number;
    exactY: number;
    exactWidth: number;
    exactHeight: number;
    fill: string | null;
    borderRadius: number | null;
    fontSize: number | null;
    fontWeight: number | null;
    lineHeight: number | null;
    letterSpacing: number | null;
  };
  spacingToNeighbors: Array<{
    targetId: string;
    targetLabel: string;
    axis: "horizontal" | "vertical";
    distance: number;
  }>;
};

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
  const usedNames = new Set<string>();

  // Use detected large panels when coverage is sufficient, otherwise supplement
  // with a minimal synthetic shell (header + body) instead of assuming a specific layout
  const panelSeed: Array<LayoutNode | { bounds: Bounds }> = largePanels.length >= 2 || contentCoverage > 0.35
    ? largePanels
    : [...largePanels, ...buildSyntheticShell(pageWidth, pageHeight)];

  panelSeed.forEach((node) => {
    const { name, role } = classifyPanel(node.bounds, pageWidth, pageHeight, usedNames);
    const anchor: SemanticAnchor = {
      id: `anchor-${anchors.length + 1}`,
      nodeId: isLayoutNode(node) ? node.id : null,
      name,
      role,
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
      const name = inferChildAnchorName(parentAnchor.name, node, parentAnchor.bounds, index, siblings.length, textBlocks, usedNames);
      anchors.push({
        id: `anchor-${anchors.length + 1}`,
        nodeId: node.id,
        name,
        role: inferChildRole(node, parentAnchor.bounds, index, siblings.length),
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

function classifyPanel(
  bounds: Bounds,
  pageWidth: number,
  pageHeight: number,
  usedNames: Set<string>
): { name: string; role: string } {
  const relX = bounds.x / Math.max(1, pageWidth);
  const relY = bounds.y / Math.max(1, pageHeight);
  const relW = bounds.width / Math.max(1, pageWidth);
  const relH = bounds.height / Math.max(1, pageHeight);
  const relRight = relX + relW;
  const relBottom = relY + relH;

  let name: string;
  let role: string;

  if (relW > 0.6 && relH < 0.18 && relY < 0.05) {
    // Wide, short, pinned to top → header
    name = "header"; role = "header";
  } else if (relW > 0.6 && relH < 0.18 && relBottom > 0.88) {
    // Wide, short, pinned to bottom → footer
    name = "footer"; role = "footer";
  } else if (relW < 0.1 && relH > 0.4 && relX < 0.05) {
    // Very narrow, tall, left edge → icon nav rail
    name = "nav-rail"; role = "navigation";
  } else if (relW < 0.28 && relH > 0.4 && relX < 0.12) {
    // Moderate narrow, tall, left side → sidebar
    name = "left-sidebar"; role = "sidebar";
  } else if (relW < 0.28 && relH > 0.4 && relRight > 0.88) {
    // Moderate narrow, tall, right side → sidebar
    name = "right-sidebar"; role = "sidebar";
  } else if (relW > 0.4 && relH > 0.5) {
    // Large central area → main content
    name = "main-content"; role = "main";
  } else if (relW > 0.4 && relH < 0.25) {
    // Wide but short strip → banner/bar
    name = "banner"; role = "banner";
  } else {
    // Generic section
    name = "section"; role = "section";
  }

  // Deduplicate names
  if (usedNames.has(name)) {
    let counter = 2;
    while (usedNames.has(`${name}-${counter}`)) counter++;
    name = `${name}-${counter}`;
  }
  usedNames.add(name);

  return { name, role };
}

function buildSyntheticShell(pageWidth: number, pageHeight: number): Array<{ bounds: Bounds }> {
  // Minimal generic fallback: a header strip + main body area
  const headerHeight = Math.round(pageHeight * 0.08);
  return [
    { bounds: { x: 0, y: 0, width: pageWidth, height: headerHeight } },
    { bounds: { x: 0, y: headerHeight, width: pageWidth, height: pageHeight - headerHeight } }
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
  parentBounds: Bounds,
  index: number,
  siblingCount: number,
  textBlocks: TextBlock[],
  usedNames: Set<string>
): string {
  const nearbyText = textBlocks.find((block) => overlaps(block.bounds, node.bounds));
  const relY = (node.bounds.y - parentBounds.y) / Math.max(1, parentBounds.height);
  const relW = node.bounds.width / Math.max(1, parentBounds.width);

  let name: string;

  if (relY < 0.1 && relW > 0.6) {
    // Top-spanning child → header of this parent
    name = `${parentName} header`;
  } else if (relY > 0.88 && relW > 0.6) {
    // Bottom-spanning child → footer of this parent
    name = `${parentName} footer`;
  } else if (nearbyText?.text && nearbyText.text.trim().length > 1) {
    // Use nearby text content as a natural label
    name = normalizeAnchorLabel(`${parentName} ${nearbyText.text}`);
  } else {
    name = `${parentName} item ${index + 1}`;
  }

  // Deduplicate
  if (usedNames.has(name)) {
    let counter = 2;
    while (usedNames.has(`${name} ${counter}`)) counter++;
    name = `${name} ${counter}`;
  }
  usedNames.add(name);

  return name;
}

function inferChildRole(
  node: LayoutNode,
  parentBounds: Bounds,
  index: number,
  siblingCount: number
): string {
  const relY = (node.bounds.y - parentBounds.y) / Math.max(1, parentBounds.height);
  const relW = node.bounds.width / Math.max(1, parentBounds.width);
  const relH = node.bounds.height / Math.max(1, parentBounds.height);
  const aspectRatio = node.bounds.width / Math.max(1, node.bounds.height);

  // Top-spanning element → header or toolbar
  if (relY < 0.1 && relW > 0.6) return "header";
  // Bottom-spanning element → footer
  if (relY > 0.88 && relW > 0.6) return "footer";
  // Small and roughly square → icon or thumbnail
  if (relW < 0.15 && relH < 0.1 && aspectRatio > 0.5 && aspectRatio < 2) return "icon";
  // Wide and short → row
  if (aspectRatio > 3 && relW > 0.5) return "row";
  // Tall and narrow → column
  if (aspectRatio < 0.3 && relH > 0.4) return "column";

  return "item";
}

function inferNodeStrategy(anchor: SemanticAnchor, layoutStrategy?: LayoutStrategy): ImplementationPlanNode["strategy"] {
  if (anchor.role === "column" || anchor.role === "row") {
    return "grid";
  }
  if (anchor.role === "header" || anchor.role === "footer" || anchor.role === "navigation" || anchor.role === "icon") {
    return "flex";
  }
  if (anchor.role === "main" || anchor.role === "section") {
    return layoutStrategy?.type === "grid" ? "grid" : layoutStrategy?.type === "flex" ? "flex" : "stack";
  }
  if (layoutStrategy?.type === "grid" || layoutStrategy?.type === "flex" || layoutStrategy?.type === "absolute") {
    return layoutStrategy.type;
  }
  return "unknown";
}

function inferRepeatedPatterns(anchors: SemanticAnchor[]): string[] {
  const results: string[] = [];
  const roleCounts = new Map<string, number>();
  for (const anchor of anchors) {
    roleCounts.set(anchor.role, (roleCounts.get(anchor.role) ?? 0) + 1);
  }
  for (const [role, count] of roleCounts) {
    if (count >= 3) {
      results.push(`repeated ${role} elements (${count} instances) with shared styling`);
    }
  }
  return results;
}

function inferCssPrimitives(layoutStrategy: LayoutStrategy | undefined, anchors: SemanticAnchor[]): string[] {
  const primitives = new Set<string>();
  primitives.add("CSS custom properties for colors, borders, and spacing");
  if (layoutStrategy?.type === "grid" || anchors.some((anchor) => anchor.role === "column")) {
    primitives.add("CSS grid for multi-column layout sections");
  }
  if (layoutStrategy?.type === "flex" || anchors.some((anchor) => anchor.role === "header" || anchor.role === "footer" || anchor.role === "navigation" || anchor.role === "icon")) {
    primitives.add("Flexbox for horizontal alignment in headers, navs, and toolbars");
  }
  if (anchors.some((anchor) => anchor.role === "sidebar")) {
    primitives.add("Fixed-width sidebar with fluid main content area");
  }
  if (anchors.some((anchor) => anchor.role === "row")) {
    primitives.add("Stacked flex rows for list or card layouts");
  }
  return [...primitives];
}

function buildPageNotes(layoutStrategy: LayoutStrategy | undefined, anchors: SemanticAnchor[]): string[] {
  const strategy = layoutStrategy?.type ?? "mixed";
  const notes = [
    `Use ${strategy} layout as the primary page strategy.`,
    "Treat the largest anchors as stable page sections; preserve their proportions across iterations."
  ];
  const topLevelCount = anchors.filter((a) => a.parentId === null).length;
  if (topLevelCount >= 3) {
    notes.push(`Page has ${topLevelCount} top-level sections; maintain their relative sizing and ordering.`);
  }
  const hasSidebar = anchors.some((a) => a.role === "sidebar" || a.role === "navigation");
  if (hasSidebar) {
    notes.push("Sidebar/nav should have a fixed width; main content should fill remaining space.");
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
