import { describe, it, expect } from "bun:test";
import { subscriptionEnv, buildClaudeArgs } from "./claude.js";

describe("subscriptionEnv", () => {
  it("deletes ANTHROPIC_API_KEY so the CLI uses subscription auth", () => {
    const env = subscriptionEnv({ ANTHROPIC_API_KEY: "sk-ant-xxx", PATH: "/usr/bin" } as any);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });
});

describe("buildClaudeArgs", () => {
  it("passes -p, the prompt, the model, and Read tool", () => {
    const args = buildClaudeArgs("claude-opus-4-8", "do it");
    expect(args).toEqual(["-p", "do it", "--model", "claude-opus-4-8", "--allowedTools", "Read"]);
  });
});
