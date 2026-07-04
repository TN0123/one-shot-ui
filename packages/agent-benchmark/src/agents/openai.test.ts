import { describe, it, expect, afterEach } from "bun:test";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenAIAgent } from "./openai.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function tmpPng(): string {
  const dir = mkdtempSync(join(tmpdir(), "osui-bench-"));
  const p = join(dir, "ref.png");
  writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // 4 bytes is enough to base64
  return p;
}

describe("createOpenAIAgent.generate", () => {
  it("posts the model + image and extracts the HTML from the reply", async () => {
    let captured: any = null;
    globalThis.fetch = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: "```html\n<html><body>ok</body></html>\n```" } }],
      }), { status: 200 });
    }) as typeof fetch;

    const agent = createOpenAIAgent({ model: "gpt-5.4-mini", apiKey: "sk-test" });
    const html = await agent.generate(tmpPng());

    expect(html).toBe("<html><body>ok</body></html>");
    expect(captured.model).toBe("gpt-5.4-mini");
    const parts = captured.messages[0].content;
    expect(parts.some((p: any) => p.type === "image_url" && p.image_url.url.startsWith("data:image/png;base64,"))).toBe(true);
  });

  it("throws a clear error on a non-200 response", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 401 })) as typeof fetch;
    const agent = createOpenAIAgent({ model: "gpt-5.4-mini", apiKey: "bad" });
    await expect(agent.generate(tmpPng())).rejects.toThrow(/OpenAI/);
  });
});
