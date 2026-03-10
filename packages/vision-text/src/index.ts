import type { TextBlock } from "@one-shot-ui/core";
import { loadImage, samplePixel } from "@one-shot-ui/image-io";

export async function extractText(imagePath: string): Promise<TextBlock[]> {
  if (process.env.ONE_SHOT_UI_ENABLE_OCR !== "1") {
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

  const fontSize = Math.max(8, Math.round(bounds.height * 0.58));
  const lineHeight = Math.round(fontSize * 1.35);
  const foregroundRatio = estimateForegroundRatio(image, bounds);
  const fontWeight = foregroundRatio > 0.34 ? 700 : foregroundRatio > 0.24 ? 600 : 400;
  const averageGlyphWidth = bounds.width / Math.max(1, Math.round(bounds.width / Math.max(fontSize * 0.48, 1)));
  const letterSpacing = Math.round((averageGlyphWidth - fontSize * 0.52) * 10) / 10;

  return {
    fontSize,
    fontWeight,
    lineHeight,
    letterSpacing,
    confidence: 0.35 + Math.min(0.4, foregroundRatio)
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
