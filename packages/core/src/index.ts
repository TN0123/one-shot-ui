import { z } from "zod";

export const VERSION = "0.2.0";

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

export const extractReportSchema = z.object({
  version: z.string(),
  image: imageMetaSchema,
  colors: z.array(colorSwatchSchema),
  layout: z.array(layoutNodeSchema),
  text: z.array(textBlockSchema),
  spacing: z.array(spacingMeasurementSchema),
  components: z.array(componentClusterSchema),
  tokens: z.array(designTokenSchema).optional(),
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
    "TEXT_COUNT_MISMATCH"
  ]),
  nodeId: z.string().optional(),
  severity: z.enum(["low", "medium", "high"]),
  message: z.string(),
  suggestedFix: z.string().optional(),
  reference: z.unknown().optional(),
  implementation: z.unknown().optional()
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
export type ExtractReport = z.infer<typeof extractReportSchema>;
export type CompareIssue = z.infer<typeof compareIssueSchema>;
export type CompareReport = z.infer<typeof compareReportSchema>;
export type CaptureOptions = z.infer<typeof captureOptionsSchema>;
export type CaptureResult = z.infer<typeof captureResultSchema>;
