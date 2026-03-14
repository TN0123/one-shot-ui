import type { FontFamilyCandidate, TextBlock } from "@one-shot-ui/core";
import { loadImage, samplePixel } from "@one-shot-ui/image-io";

export interface ExtractTextOptions {
  disableOcr?: boolean;
}

export async function extractText(imagePath: string, options?: ExtractTextOptions): Promise<TextBlock[]> {
  const disableOcr = options?.disableOcr ?? process.env.ONE_SHOT_UI_DISABLE_OCR === "1";
  if (disableOcr) {
    return [];
  }

  let worker: any = null;

  try {
    const { createWorker } = await import("tesseract.js");
    const image = await loadImage(imagePath);
    worker = await createWorker("eng");
    const result = await worker!.recognize(imagePath);

    const blocks = (result.data.blocks ?? [])
      .map((block: any, index: number) => {
        const text = String(block.text ?? "").trim();
        if (!text) {
          return null;
        }
        return {
          id: `text-${index + 1}`,
          text,
          confidence: Math.max(0, Math.min(1, Number(block.confidence ?? result.data.confidence ?? 0) / 100)),
          bounds: {
            x: Number(block.bbox?.x0 ?? 0),
            y: Number(block.bbox?.y0 ?? 0),
            width: Math.max(0, Number(block.bbox?.x1 ?? 0) - Number(block.bbox?.x0 ?? 0)),
            height: Math.max(0, Number(block.bbox?.y1 ?? 0) - Number(block.bbox?.y0 ?? 0))
          },
          typography: estimateTypography(image, {
            x: Number(block.bbox?.x0 ?? 0),
            y: Number(block.bbox?.y0 ?? 0),
            width: Math.max(0, Number(block.bbox?.x1 ?? 0) - Number(block.bbox?.x0 ?? 0)),
            height: Math.max(0, Number(block.bbox?.y1 ?? 0) - Number(block.bbox?.y0 ?? 0))
          })
        };
      })
      .filter((block: TextBlock | null): block is TextBlock => block !== null);

    await worker!.terminate();
    return blocks;
  } catch {
    if (worker) {
      await worker.terminate().catch(() => undefined);
    }
    return [];
  }
}

function estimateTypography(
  image: Awaited<ReturnType<typeof loadImage>>,
  bounds: { x: number; y: number; width: number; height: number }
) {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }

  const { capTop, baseline } = detectBaselineCapHeight(image, bounds);
  const measuredHeight = baseline - capTop;
  const fontSize = measuredHeight > 4
    ? Math.max(8, Math.round(measuredHeight * 0.72))
    : Math.max(8, Math.round(bounds.height * 0.58));
  const lineHeight = Math.round(bounds.height > fontSize * 2
    ? detectInternalLineHeight(image, bounds, fontSize)
    : fontSize * 1.35);
  const foregroundRatio = estimateForegroundRatio(image, bounds);
  const fontWeight = foregroundRatio > 0.34 ? 700 : foregroundRatio > 0.24 ? 600 : 400;
  const averageGlyphWidth = bounds.width / Math.max(1, Math.round(bounds.width / Math.max(fontSize * 0.48, 1)));
  const letterSpacing = Math.round((averageGlyphWidth - fontSize * 0.52) * 10) / 10;
  const textAlignment = detectTextAlignment(bounds);

  return {
    fontSize,
    fontWeight,
    lineHeight,
    letterSpacing,
    textAlignment,
    fontFamilyCandidates: rankFontFamilies(fontSize, fontWeight, letterSpacing, foregroundRatio),
    confidence: 0.35 + Math.min(0.4, foregroundRatio) + (measuredHeight > 4 ? 0.1 : 0)
  };
}

function estimateForegroundRatio(
  image: Awaited<ReturnType<typeof loadImage>>,
  bounds: { x: number; y: number; width: number; height: number }
): number {
  const sampleStepX = Math.max(1, Math.floor(bounds.width / 24));
  const sampleStepY = Math.max(1, Math.floor(bounds.height / 16));
  const background = averageCornerRgb(image, bounds);
  let foreground = 0;
  let total = 0;

  for (let y = bounds.y; y < bounds.y + bounds.height; y += sampleStepY) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += sampleStepX) {
      const [r, g, b, a] = samplePixel(image, x, y);
      if (a < 16) {
        continue;
      }
      total += 1;
      const distance = Math.abs(r - background.r) + Math.abs(g - background.g) + Math.abs(b - background.b);
      if (distance > 54) {
        foreground += 1;
      }
    }
  }

  return total === 0 ? 0 : foreground / total;
}

function averageCornerRgb(
  image: Awaited<ReturnType<typeof loadImage>>,
  bounds: { x: number; y: number; width: number; height: number }
) {
  const corners = [
    samplePixel(image, bounds.x, bounds.y),
    samplePixel(image, bounds.x + bounds.width - 1, bounds.y),
    samplePixel(image, bounds.x, bounds.y + bounds.height - 1),
    samplePixel(image, bounds.x + bounds.width - 1, bounds.y + bounds.height - 1)
  ];

  return {
    r: Math.round(corners.reduce((sum, pixel) => sum + pixel[0], 0) / corners.length),
    g: Math.round(corners.reduce((sum, pixel) => sum + pixel[1], 0) / corners.length),
    b: Math.round(corners.reduce((sum, pixel) => sum + pixel[2], 0) / corners.length)
  };
}

function detectBaselineCapHeight(
  image: Awaited<ReturnType<typeof loadImage>>,
  bounds: { x: number; y: number; width: number; height: number }
): { capTop: number; baseline: number } {
  const background = averageCornerRgb(image, bounds);
  const threshold = 54;
  let capTop = bounds.height;
  let baseline = 0;
  const sampleStepX = Math.max(1, Math.floor(bounds.width / 32));

  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x += sampleStepX) {
      const [r, g, b, a] = samplePixel(image, bounds.x + x, bounds.y + y);
      if (a < 16) continue;
      const dist = Math.abs(r - background.r) + Math.abs(g - background.g) + Math.abs(b - background.b);
      if (dist > threshold) {
        if (y < capTop) capTop = y;
        if (y > baseline) baseline = y;
      }
    }
  }

  if (capTop >= baseline) {
    return { capTop: 0, baseline: bounds.height };
  }

  return { capTop, baseline };
}

function detectInternalLineHeight(
  image: Awaited<ReturnType<typeof loadImage>>,
  bounds: { x: number; y: number; width: number; height: number },
  fontSize: number
): number {
  const background = averageCornerRgb(image, bounds);
  const threshold = 54;
  const sampleX = bounds.x + Math.floor(bounds.width / 2);
  const rowActivity: boolean[] = [];

  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    let active = false;
    for (let dx = -2; dx <= 2; dx++) {
      const [r, g, b, a] = samplePixel(image, sampleX + dx, y);
      if (a < 16) continue;
      const dist = Math.abs(r - background.r) + Math.abs(g - background.g) + Math.abs(b - background.b);
      if (dist > threshold) { active = true; break; }
    }
    rowActivity.push(active);
  }

  // Find gaps between active regions (line gaps)
  const gaps: number[] = [];
  let inGap = false;
  let gapStart = 0;
  let lastActiveEnd = 0;

  for (let i = 0; i < rowActivity.length; i++) {
    if (rowActivity[i]) {
      if (inGap && i - gapStart >= 2) {
        gaps.push(i - lastActiveEnd);
      }
      inGap = false;
      lastActiveEnd = i;
    } else if (!inGap && i > 0 && rowActivity[i - 1]) {
      inGap = true;
      gapStart = i;
    }
  }

  if (gaps.length === 0) return Math.round(fontSize * 1.35);
  const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  return Math.round(fontSize + avgGap);
}

function detectTextAlignment(
  bounds: { x: number; y: number; width: number; height: number },
  parentBounds?: { x: number; y: number; width: number; height: number }
): "left" | "center" | "right" | "justify" | null {
  if (!parentBounds) return null;

  const leftMargin = bounds.x - parentBounds.x;
  const rightMargin = (parentBounds.x + parentBounds.width) - (bounds.x + bounds.width);
  const totalMargin = leftMargin + rightMargin;

  if (totalMargin < 4) return "justify";
  const ratio = leftMargin / Math.max(1, totalMargin);

  if (ratio < 0.2) return "left";
  if (ratio > 0.8) return "right";
  if (Math.abs(ratio - 0.5) < 0.15) return "center";
  return "left";
}

// Font family heuristic database: common web fonts with their metric characteristics.
// Each entry maps a font to the typical glyph-width-to-fontSize ratio and weight range
// where it is most commonly used.
const FONT_DATABASE: Array<{
  family: string;
  category: "sans-serif" | "serif" | "monospace" | "display";
  widthRatio: number; // average glyph width / fontSize
  commonWeights: number[];
  commonSizes: [number, number]; // [min, max] typical range
}> = [
  { family: "Inter", category: "sans-serif", widthRatio: 0.52, commonWeights: [400, 500, 600, 700], commonSizes: [12, 48] },
  { family: "SF Pro Display", category: "sans-serif", widthRatio: 0.51, commonWeights: [400, 500, 600, 700], commonSizes: [16, 72] },
  { family: "SF Pro Text", category: "sans-serif", widthRatio: 0.50, commonWeights: [400, 500, 600], commonSizes: [10, 20] },
  { family: "Helvetica Neue", category: "sans-serif", widthRatio: 0.52, commonWeights: [400, 500, 700], commonSizes: [10, 48] },
  { family: "Arial", category: "sans-serif", widthRatio: 0.53, commonWeights: [400, 700], commonSizes: [10, 48] },
  { family: "Roboto", category: "sans-serif", widthRatio: 0.51, commonWeights: [400, 500, 700], commonSizes: [12, 48] },
  { family: "Open Sans", category: "sans-serif", widthRatio: 0.53, commonWeights: [400, 600, 700], commonSizes: [12, 36] },
  { family: "Lato", category: "sans-serif", widthRatio: 0.51, commonWeights: [400, 700], commonSizes: [12, 36] },
  { family: "Poppins", category: "sans-serif", widthRatio: 0.54, commonWeights: [400, 500, 600, 700], commonSizes: [12, 48] },
  { family: "Montserrat", category: "sans-serif", widthRatio: 0.53, commonWeights: [400, 500, 600, 700], commonSizes: [12, 48] },
  { family: "Source Sans Pro", category: "sans-serif", widthRatio: 0.49, commonWeights: [400, 600, 700], commonSizes: [12, 36] },
  { family: "Nunito Sans", category: "sans-serif", widthRatio: 0.52, commonWeights: [400, 600, 700], commonSizes: [12, 36] },
  { family: "DM Sans", category: "sans-serif", widthRatio: 0.51, commonWeights: [400, 500, 700], commonSizes: [12, 48] },
  { family: "Geist", category: "sans-serif", widthRatio: 0.50, commonWeights: [400, 500, 600, 700], commonSizes: [12, 48] },
  { family: "Georgia", category: "serif", widthRatio: 0.55, commonWeights: [400, 700], commonSizes: [14, 36] },
  { family: "Merriweather", category: "serif", widthRatio: 0.56, commonWeights: [400, 700], commonSizes: [14, 36] },
  { family: "Playfair Display", category: "display", widthRatio: 0.50, commonWeights: [400, 700], commonSizes: [20, 72] },
  { family: "Fira Code", category: "monospace", widthRatio: 0.60, commonWeights: [400, 500, 700], commonSizes: [12, 18] },
  { family: "JetBrains Mono", category: "monospace", widthRatio: 0.60, commonWeights: [400, 500, 700], commonSizes: [12, 18] },
  { family: "SF Mono", category: "monospace", widthRatio: 0.60, commonWeights: [400, 500, 700], commonSizes: [11, 16] },
  { family: "Plus Jakarta Sans", category: "sans-serif", widthRatio: 0.52, commonWeights: [400, 500, 600, 700], commonSizes: [12, 48] },
  { family: "Manrope", category: "sans-serif", widthRatio: 0.53, commonWeights: [400, 500, 600, 700, 800], commonSizes: [12, 48] },
  { family: "Outfit", category: "sans-serif", widthRatio: 0.50, commonWeights: [400, 500, 600, 700], commonSizes: [12, 48] },
  { family: "Space Grotesk", category: "sans-serif", widthRatio: 0.51, commonWeights: [400, 500, 600, 700], commonSizes: [12, 48] },
  { family: "IBM Plex Sans", category: "sans-serif", widthRatio: 0.52, commonWeights: [400, 500, 600, 700], commonSizes: [12, 36] },
  { family: "Work Sans", category: "sans-serif", widthRatio: 0.50, commonWeights: [400, 500, 600, 700], commonSizes: [12, 48] },
  { family: "Figtree", category: "sans-serif", widthRatio: 0.51, commonWeights: [400, 500, 600, 700], commonSizes: [12, 48] },
  { family: "Satoshi", category: "sans-serif", widthRatio: 0.51, commonWeights: [400, 500, 700], commonSizes: [12, 48] },
  { family: "General Sans", category: "sans-serif", widthRatio: 0.52, commonWeights: [400, 500, 600, 700], commonSizes: [12, 48] },
  { family: "Sora", category: "sans-serif", widthRatio: 0.52, commonWeights: [400, 500, 600, 700], commonSizes: [12, 48] },
  { family: "Lexend", category: "sans-serif", widthRatio: 0.50, commonWeights: [400, 500, 600, 700], commonSizes: [12, 36] },
  { family: "Urbanist", category: "sans-serif", widthRatio: 0.49, commonWeights: [400, 500, 600, 700], commonSizes: [12, 48] },
  { family: "Red Hat Display", category: "sans-serif", widthRatio: 0.52, commonWeights: [400, 500, 700], commonSizes: [14, 72] },
  { family: "Cabin", category: "sans-serif", widthRatio: 0.51, commonWeights: [400, 500, 600, 700], commonSizes: [12, 36] },
  { family: "Barlow", category: "sans-serif", widthRatio: 0.49, commonWeights: [400, 500, 600, 700], commonSizes: [12, 48] },
  { family: "Rubik", category: "sans-serif", widthRatio: 0.52, commonWeights: [400, 500, 600, 700], commonSizes: [12, 36] },
  { family: "Karla", category: "sans-serif", widthRatio: 0.50, commonWeights: [400, 500, 700], commonSizes: [12, 36] },
  { family: "Noto Sans", category: "sans-serif", widthRatio: 0.53, commonWeights: [400, 500, 700], commonSizes: [12, 36] },
  { family: "Libre Franklin", category: "sans-serif", widthRatio: 0.50, commonWeights: [400, 500, 600, 700], commonSizes: [12, 36] },
  { family: "Raleway", category: "sans-serif", widthRatio: 0.49, commonWeights: [400, 500, 600, 700], commonSizes: [12, 48] },
  { family: "PT Sans", category: "sans-serif", widthRatio: 0.51, commonWeights: [400, 700], commonSizes: [12, 36] },
  { family: "IBM Plex Mono", category: "monospace", widthRatio: 0.60, commonWeights: [400, 500, 700], commonSizes: [12, 18] },
  { family: "Source Code Pro", category: "monospace", widthRatio: 0.60, commonWeights: [400, 500, 700], commonSizes: [12, 18] },
  { family: "Lora", category: "serif", widthRatio: 0.53, commonWeights: [400, 500, 600, 700], commonSizes: [14, 48] },
  { family: "Libre Baskerville", category: "serif", widthRatio: 0.54, commonWeights: [400, 700], commonSizes: [14, 36] },
  { family: "Fraunces", category: "serif", widthRatio: 0.50, commonWeights: [400, 500, 700], commonSizes: [16, 72] }
];

function rankFontFamilies(
  fontSize: number,
  fontWeight: number,
  letterSpacing: number,
  foregroundRatio: number
): FontFamilyCandidate[] {
  const observedWidthRatio = 0.52 + letterSpacing * 0.01;

  const scored = FONT_DATABASE.map((font) => {
    let score = 0;

    // Width ratio match (most differentiating signal from pixels)
    const widthDelta = Math.abs(font.widthRatio - observedWidthRatio);
    score += Math.max(0, 1 - widthDelta * 10) * 0.35;

    // Weight match
    const hasWeight = font.commonWeights.includes(fontWeight);
    const closestWeight = font.commonWeights.reduce(
      (best, w) => (Math.abs(w - fontWeight) < Math.abs(best - fontWeight) ? w : best),
      font.commonWeights[0]!
    );
    score += (hasWeight ? 1 : Math.max(0, 1 - Math.abs(closestWeight - fontWeight) / 300)) * 0.2;

    // Size range match
    const inRange = fontSize >= font.commonSizes[0] && fontSize <= font.commonSizes[1];
    score += (inRange ? 1 : 0.3) * 0.15;

    // Category prior: sans-serif is the most common in UI
    if (font.category === "sans-serif") score += 0.15;
    else if (font.category === "monospace" && foregroundRatio > 0.3) score += 0.1;
    else if (font.category === "serif") score += 0.05;
    else score += 0.08;

    // Popularity prior (top fonts get a small boost)
    const popularFonts = ["Inter", "SF Pro Display", "Roboto", "Helvetica Neue", "Geist"];
    if (popularFonts.includes(font.family)) score += 0.1;

    return { family: font.family, confidence: Math.round(Math.min(0.95, score) * 100) / 100 };
  });

  return scored
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}
