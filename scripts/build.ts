import { $ } from "bun";
import { readFile, writeFile, chmod } from "node:fs/promises";

// 1. Bundle
await $`bun build packages/cli/src/index.ts \
  --target=node \
  --format=esm \
  --outfile=dist/cli.mjs \
  --external sharp \
  --external playwright \
  --external commander \
  --external tesseract.js \
  --external pixelmatch \
  --external pngjs \
  --external zod`;

// 2. Strip any existing shebang and prepend Node shebang
let code = await readFile("dist/cli.mjs", "utf-8");
code = code.replace(/^#!.*\n/, "");
await writeFile("dist/cli.mjs", `#!/usr/bin/env node\n${code}`);
await chmod("dist/cli.mjs", 0o755);

console.log("Build complete: dist/cli.mjs");
