import sharp from "sharp";

/**
 * Preprocess an image for better OCR results.
 *
 * - Detects dark backgrounds by sampling corner pixels
 * - Converts to grayscale
 * - Inverts dark-background images so text is dark-on-light
 * - Increases contrast
 * - Upscales small images (height < 300px) by 2x for better glyph recognition
 *
 * Returns the path to the preprocessed temp file and the scale factor applied
 * (callers must divide OCR bbox coords by this factor to map back to original image).
 */
export interface PreprocessResult {
  outputPath: string;
  scale: number;
}

export async function preprocessForOcr(imagePath: string): Promise<PreprocessResult> {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  // Sample corner pixels to detect dark background
  const cornerBuffer = await sharp(imagePath)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = cornerBuffer;
  const channels = info.channels;
  const isDark = detectDarkBackground(data, info.width, info.height, channels);

  // Build the processing pipeline
  let pipeline = sharp(imagePath).grayscale();

  if (isDark) {
    pipeline = pipeline.negate({ alpha: false });
  }

  // Increase contrast: linear(1.5, -(128 * 1.5 - 128)) = linear(1.5, -64)
  pipeline = pipeline.linear(1.5, -(128 * 1.5 - 128));

  // Upscale small images
  let scale = 1;
  if (height < 300) {
    scale = 2;
    pipeline = pipeline.resize({
      width: width * 2,
      height: height * 2,
      kernel: "lanczos3",
    });
  }

  const outputPath = imagePath.replace(/(\.\w+)$/, "-ocr-preprocessed$1");
  await pipeline.toFile(outputPath);
  return { outputPath, scale };
}

function detectDarkBackground(
  data: Buffer,
  width: number,
  height: number,
  channels: number
): boolean {
  // Sample the four corner pixels
  const corners = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
    { x: width - 1, y: height - 1 },
  ];

  let totalLuminance = 0;
  for (const corner of corners) {
    const offset = (corner.y * width + corner.x) * channels;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    // Standard luminance formula
    totalLuminance += 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const averageLuminance = totalLuminance / corners.length;
  return averageLuminance < 96;
}
