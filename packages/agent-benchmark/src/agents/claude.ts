import { resolve } from "node:path";
import { extractHtml } from "../html.js";
import { GENERATE_PROMPT, revisePrompt, type Agent, type ReviseContext } from "./types.js";

/** Copy of env with ANTHROPIC_API_KEY removed → `claude` falls back to subscription OAuth. */
export function subscriptionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env };
  delete copy.ANTHROPIC_API_KEY;
  return copy;
}

export function buildClaudeArgs(model: string, prompt: string): string[] {
  return ["-p", prompt, "--model", model, "--allowedTools", "Read"];
}

async function runClaude(model: string, prompt: string, timeoutMs = 300_000): Promise<string> {
  const proc = Bun.spawn(["claude", ...buildClaudeArgs(model, prompt)], {
    env: subscriptionEnv(process.env),
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs, // Bun kills the child after this many ms
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`claude -p exited ${code}: ${stderr.slice(0, 300)}`);
  return extractHtml(stdout);
}

export function createClaudeAgent(opts: { model: string }): Agent {
  const { model } = opts;
  return {
    id: model,
    generate(refImagePath: string) {
      const prompt = `Read the image at ${resolve(refImagePath)}.\n\n${GENERATE_PROMPT}`;
      return runClaude(model, prompt);
    },
    revise(ctx: ReviseContext) {
      const prompt =
        `Read the reference image at ${resolve(ctx.refImagePath)} and your current render at ${resolve(ctx.currentImagePath)}.\n\n` +
        revisePrompt(ctx.feedbackJson) +
        `\n\nCurrent HTML:\n${ctx.currentHtml}`;
      return runClaude(model, prompt);
    },
  };
}
