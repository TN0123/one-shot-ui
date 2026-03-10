import type { TextBlock } from "@one-shot-ui/core";

export async function extractText(imagePath: string): Promise<TextBlock[]> {
  if (process.env.ONE_SHOT_UI_ENABLE_OCR !== "1") {
    return [];
  }

  let worker: any = null;

  try {
    const { createWorker } = await import("tesseract.js");
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
          }
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
