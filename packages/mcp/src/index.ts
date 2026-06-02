import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { runCli, parseCliJson } from "./cli-runner.js";
import { TOOLS, REQUIRED_FILE_ARGS } from "./tools.js";

// Replaced at build time via --define; falls back for `bun src/index.ts`.
const VERSION = process.env.npm_package_version ?? "0.0.0-dev";

async function main(): Promise<void> {
  const server = new McpServer({ name: "one-shot-ui", version: VERSION });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        // Every tool is a read-only local analysis over files the agent already has.
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        // Validate file inputs up front for a clean, agent-friendly error.
        for (const key of REQUIRED_FILE_ARGS) {
          const value = args[key];
          if (typeof value === "string" && !existsSync(value)) {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: `File not found for "${key}": ${value}. Pass an absolute path to an existing image.`,
                },
              ],
            };
          }
        }

        try {
          const { command, cliArgs } = tool.build(args);
          const result = await runCli(cliArgs);
          const json = parseCliJson(result, command);
          return { content: [{ type: "text" as const, text: JSON.stringify(json, null, 2) }] };
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `one-shot-ui ${tool.name} failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for the JSON-RPC stream; status goes to stderr.
  process.stderr.write(`one-shot-ui MCP server v${VERSION} ready (stdio)\n`);
}

main().catch((err) => {
  process.stderr.write(
    `one-shot-ui MCP server failed to start: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
  );
  process.exit(1);
});
