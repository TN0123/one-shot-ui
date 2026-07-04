import { readFileSync } from "node:fs";
import { extractHtml } from "../html.js";
import { GENERATE_PROMPT, revisePrompt, type Agent, type ReviseContext } from "./types.js";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

function dataUrl(imagePath: string): string {
  const b64 = readFileSync(imagePath).toString("base64");
  return `data:image/png;base64,${b64}`;
}

function imagePart(imagePath: string) {
  return { type: "image_url", image_url: { url: dataUrl(imagePath) } };
}

async function chat(apiKey: string, model: string, content: unknown[]): Promise<string> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI request failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content ?? "";
  return extractHtml(text);
}

export function createOpenAIAgent(opts: { model?: string; apiKey?: string } = {}): Agent {
  const model = opts.model ?? "gpt-5.4-mini";
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set (required for GPT agent rows).");
  return {
    id: model,
    generate(refImagePath: string) {
      return chat(apiKey, model, [{ type: "text", text: GENERATE_PROMPT }, imagePart(refImagePath)]);
    },
    revise(ctx: ReviseContext) {
      return chat(apiKey, model, [
        { type: "text", text: revisePrompt(ctx.feedbackJson) },
        imagePart(ctx.refImagePath),
        imagePart(ctx.currentImagePath),
        { type: "text", text: `Current HTML:\n${ctx.currentHtml}` },
      ]);
    },
  };
}
