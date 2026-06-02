import { $ } from "bun";
import { readFile, writeFile, chmod } from "node:fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf-8"));
// Build the define token in JS (JSON.stringify yields a quoted JS string literal)
// and interpolate it as a single argument — embedding the quotes directly in the
// `$` template mangles them and silently skips the replacement.
const versionDefine = `process.env.npm_package_version=${JSON.stringify(pkg.version)}`;

async function finalizeBin(outfile: string): Promise<void> {
  // Strip any existing shebang and prepend the Node shebang, then make executable.
  let code = await readFile(outfile, "utf-8");
  code = code.replace(/^#!.*\n/, "");
  await writeFile(outfile, `#!/usr/bin/env node\n${code}`);
  await chmod(outfile, 0o755);
}

// 1. CLI bundle (heavy native deps stay external and resolve from node_modules).
await $`bun build packages/cli/src/index.ts \
  --target=node \
  --format=esm \
  --outfile=dist/cli.mjs \
  --define ${versionDefine} \
  --external sharp \
  --external playwright \
  --external commander \
  --external tesseract.js \
  --external pixelmatch \
  --external pngjs \
  --external zod`;
await finalizeBin("dist/cli.mjs");

// 2. MCP server bundle. It only orchestrates the SDK + spawns the CLI subprocess,
//    so the SDK and zod stay external (installed as runtime deps), like the CLI.
await $`bun build packages/mcp/src/index.ts \
  --target=node \
  --format=esm \
  --outfile=dist/mcp.mjs \
  --define ${versionDefine} \
  --external @modelcontextprotocol/sdk \
  --external zod`;
await finalizeBin("dist/mcp.mjs");

console.log("Build complete: dist/cli.mjs, dist/mcp.mjs");
