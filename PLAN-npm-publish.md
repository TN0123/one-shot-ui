# Plan: npm Publishing + Agent Discoverability

## Overview

Publish `one-shot-ui` to npm so users can run it via `npx one-shot-ui <command>`.
Ship AGENTS.md and a Claude Code skill alongside it for agent integration.

The npm name `one-shot-ui` is available.

---

## Phase 1: Build & Bundle

### 1.1 — Bundle CLI with `bun build`

The monorepo has 11 internal packages that all resolve via TypeScript path aliases.
`bun build` can resolve all internal `@one-shot-ui/*` imports into a single output file
while keeping external deps (`sharp`, `commander`, etc.) as bare imports.

**Command:**
```bash
bun build packages/cli/src/index.ts \
  --target=node \
  --format=esm \
  --outfile=dist/cli.mjs \
  --external sharp \
  --external playwright \
  --external commander \
  --external tesseract.js \
  --external pixelmatch \
  --external pngjs \
  --external zod
```

> All external packages must be listed explicitly so they stay as `import` statements
> and get resolved from the user's `node_modules` at runtime.

### 1.2 — Add shebang

`bun build` does not add a shebang. Add a small post-build step:

```bash
echo '#!/usr/bin/env node' | cat - dist/cli.mjs > dist/cli.tmp && mv dist/cli.tmp dist/cli.mjs
chmod +x dist/cli.mjs
```

Or write a `scripts/build.ts` that does both the build and shebang insertion.

### 1.3 — Verify Node compatibility

The codebase uses zero `Bun.*` APIs — confirmed via grep. The shebang on line 1
of the current CLI is `#!/usr/bin/env bun` which gets replaced by the build output.

**Verification step:** After building, run:
```bash
node dist/cli.mjs --help
node dist/cli.mjs extract test-fixtures/sample.png --json
```

---

## Phase 2: Package Configuration

### 2.1 — Update root `package.json`

Changes needed:

```jsonc
{
  "name": "one-shot-ui",
  // REMOVE: "private": true
  // REMOVE: "workspaces": ["packages/*"]
  // REMOVE: "packageManager": "bun@1.3.2"
  "version": "0.4.0",           // match VERSION in core/src/index.ts
  "description": "Deterministic UI extraction, diffing, and scaffolding from screenshots",
  "type": "module",
  "bin": {
    "one-shot-ui": "./dist/cli.mjs"
  },
  "files": [
    "dist/",
    "AGENTS.md",
    "skill/"
  ],
  "engines": {
    "node": ">=18"
  },
  "keywords": [
    "ui", "screenshot", "extract", "diff", "scaffold",
    "design-to-code", "cli", "agent", "vision"
  ],
  "license": "MIT",             // or whatever license you choose
  "repository": {
    "type": "git",
    "url": "git+https://github.com/<your-username>/one-shot-ui.git"
  },
  "scripts": {
    "build": "bun scripts/build.ts",
    "prepublishOnly": "bun run build",
    // keep dev scripts for local development:
    "dev:extract": "bun packages/cli/src/index.ts extract",
    "dev:compare": "bun packages/cli/src/index.ts compare",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^14.0.1",
    "pixelmatch": "^7.1.0",
    "playwright": "^1.54.2",
    "pngjs": "^7.0.0",
    "sharp": "^0.34.3",
    "tesseract.js": "^6.0.1",
    "zod": "^4.1.5"
  },
  "devDependencies": {
    "@types/node": "^24.3.0",
    "typescript": "^5.9.2"
  }
}
```

> **Note:** `"workspaces"` and `"packageManager"` should remain in a separate
> section or be stripped at publish time. Two approaches:
>
> **Option A (simpler):** Keep them in package.json — npm ignores `workspaces`
> if there's a `files` field limiting what gets published. `packageManager` is harmless.
>
> **Option B (cleaner):** Use a `scripts/build.ts` that generates a clean
> `dist/package.json` and publish from `dist/`. This is more work but gives full
> control over what lands on npm.
>
> **Recommended: Option A** — simpler, fewer moving parts. The `"files"` field
> ensures only `dist/`, `AGENTS.md`, and `skill/` are published. The workspaces
> config is irrelevant to consumers since they never see the `packages/` directory.

### 2.2 — Handle Playwright browsers at runtime

Do NOT add a `postinstall` script — downloading ~200MB of Chromium on every
`npm install` is hostile to users who may only use non-browser commands
(`extract`, `compare`, `tokens`, etc.).

Instead, add a **runtime check** at the top of the `capture` and `run` commands:

```typescript
import { execSync } from "node:child_process";

function ensureChromium(): void {
  try {
    // playwright's internal check
    execSync("npx playwright install --dry-run chromium", { stdio: "ignore" });
  } catch {
    console.error(
      "Chromium is not installed. Run:\n\n  npx playwright install chromium\n"
    );
    process.exit(1);
  }
}
```

This keeps install fast and only nags when browser features are actually used.

### 2.3 — Add `.npmignore` or rely on `files`

Using `"files"` in package.json is sufficient. Only `dist/`, `AGENTS.md`,
`skill/`, `package.json`, `README.md`, and `LICENSE` will be published.

Everything else (packages/, node_modules/, tsconfig.json, etc.) is excluded
automatically.

---

## Phase 3: Build Script

Create `scripts/build.ts`:

```typescript
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

// 2. Prepend shebang
const code = await readFile("dist/cli.mjs", "utf-8");
await writeFile("dist/cli.mjs", `#!/usr/bin/env node\n${code}`);
await chmod("dist/cli.mjs", 0o755);

console.log("Build complete: dist/cli.mjs");
```

---

## Phase 4: AGENTS.md

Create `AGENTS.md` in the repo root. This file is automatically read by Claude
Code, GitHub Copilot, Cursor, Codex, Gemini CLI, and 20+ other agent tools when
they work inside a project.

**Contents should cover:**

```markdown
# one-shot-ui

Deterministic UI extraction and comparison toolkit. Use this tool to go from a
reference screenshot to a pixel-accurate implementation.

## Installation

    npm install -g one-shot-ui
    npx playwright install chromium    # only needed for capture/run commands

## Core Workflow

1. **Extract** — Analyze a reference screenshot into structured layout data:
       one-shot-ui extract reference.png --json

2. **Scaffold** — Generate starter HTML/CSS (or React) from the extraction:
       one-shot-ui scaffold reference.png --output ./src --react

3. **Capture** — Screenshot your implementation:
       one-shot-ui capture --url http://localhost:3000 --output impl.png

4. **Compare** — Diff reference vs implementation:
       one-shot-ui compare reference.png impl.png --json --heatmap heatmap.png

5. **Suggest Fixes** — Get actionable CSS fix suggestions:
       one-shot-ui suggest-fixes reference.png impl.png --json

6. **Run** — Automated multi-pass refinement loop:
       one-shot-ui run reference.png --impl ./index.html --output ./passes

## Commands Reference

| Command         | Purpose                                    | Key Flags                          |
|-----------------|--------------------------------------------|------------------------------------|
| extract         | Analyze screenshot into layout/color/text  | --json, --no-ocr, --overlay, --fine|
| compare         | Pixel + structural diff                    | --json, --heatmap, --dom-diff      |
| scaffold        | Generate HTML/CSS or React from screenshot | --react, --output, --mode          |
| tokens          | Extract design tokens                      | --json                             |
| plan            | Generate implementation strategy           | --json                             |
| capture         | Screenshot a URL or HTML file              | --url, --file, --output            |
| suggest-fixes   | CSS fix suggestions from diff              | --json, --top, --dom-diff          |
| run             | Multi-pass refinement loop                 | --impl, --max-passes, --threshold  |
| benchmark       | Run benchmark suites                       | --json, --output                   |

## Output Format

All commands support `--json` for structured JSON output. Reports are validated
with Zod schemas and follow stable interfaces.

## Tips for Agents

- Always use `--json` to get structured output you can parse.
- The `extract --overlay` flag adds bounding-box annotations useful for
  vision-model cross-referencing.
- The `run` command handles the full extract→capture→compare→fix loop
  automatically. Prefer it over manual orchestration when possible.
- `suggest-fixes --dom-diff <url>` gives the most accurate CSS fixes by
  comparing against the live DOM rather than just pixels.
- Design tokens from `tokens` can be fed directly into CSS variable definitions.
```

> This file is also included in the npm package via the `"files"` field so it
> ships with the installed package too.

---

## Phase 5: Claude Code Skill (SKILL.md)

Create `skill/SKILL.md`. This can be installed into any agent's skill directory
to give it a `/one-shot-ui` slash command.

**Location in repo:** `skill/SKILL.md`
**Install target:** Users copy to `.claude/skills/one-shot-ui/SKILL.md` or use
`npx skills` (Vercel's skill installer).

**Contents should cover:**

```markdown
---
name: one-shot-ui
description: >
  Extract UI designs from screenshots, generate HTML/CSS scaffolds, and
  iteratively refine implementations to match a reference image pixel-perfectly.
---

You have access to the `one-shot-ui` CLI tool. Use it to implement UIs from
reference screenshots with high fidelity.

## When to Use

- The user provides a screenshot or mockup and asks you to build it
- The user wants to compare their implementation against a design
- The user wants to iteratively refine a UI to match a reference

## Workflow

### Step 1: Extract the design
Run `one-shot-ui extract <reference.png> --json --overlay` to get:
- Layout nodes with positions, sizes, colors, gradients, shadows, border radii
- Text blocks with content, font size, weight, color
- Design tokens (spacing scale, color palette, radius scale)
- Component clusters (repeated visual patterns)
- Implementation plan (suggested CSS strategy: grid/flex/absolute)

### Step 2: Scaffold starter code
Run `one-shot-ui scaffold <reference.png> --react --output ./src` to generate
starter HTML/CSS or React components based on the extraction.

### Step 3: Implement and refine
Edit the scaffold to match the design. Use the extracted data to set exact:
- Colors (hex values from extraction)
- Spacing (px values from spacing measurements)
- Typography (font sizes, weights from text blocks)
- Border radii, shadows, gradients (from style extraction)

### Step 4: Compare
Run `one-shot-ui capture --url http://localhost:3000 --output impl.png` then
`one-shot-ui compare <reference.png> impl.png --json --heatmap heatmap.png`.

Read the heatmap to see where differences are. The JSON report includes:
- `mismatchRatio` — overall pixel difference (0.0 = perfect match)
- `issues[]` — categorized problems (COLOR_MISMATCH, SPACING_MISMATCH, etc.)
- `topEditCandidates[]` — ranked list of what to fix first

### Step 5: Fix issues
Run `one-shot-ui suggest-fixes <reference.png> impl.png --json` to get specific
CSS property changes. Apply them and re-compare.

### Automated Loop
For hands-off refinement, use:
`one-shot-ui run <reference.png> --impl ./index.html --output ./passes --max-passes 5 --threshold 0.02`

This runs the extract→capture→compare→fix loop automatically, writing artifacts
for each pass.

## Output Parsing

All commands support `--json`. Always use it. Key schemas:

- **ExtractReport**: `{ image, colors, nodes[], textBlocks[], spacing, components, layoutStrategy, tokens, plan }`
- **CompareReport**: `{ mismatchRatio, pixelDiffCount, issues[], topEditCandidates[], heatmapPath }`

## Important Notes

- Chromium must be installed: `npx playwright install chromium`
- Use `--no-ocr` to skip OCR if text extraction isn't needed (faster)
- Use `--fine` for UIs with small details (icons, small buttons)
- Use `--overlay` when you plan to view the reference image yourself — it adds
  labeled bounding boxes for cross-referencing
```

### Installation instructions for users

Add to your README:

```markdown
## Agent Integration

### Claude Code / Cursor / Codex
Copy the skill file into your project:
    mkdir -p .claude/skills/one-shot-ui
    cp node_modules/one-shot-ui/skill/SKILL.md .claude/skills/one-shot-ui/SKILL.md

Or install globally:
    mkdir -p ~/.claude/skills/one-shot-ui
    cp node_modules/one-shot-ui/skill/SKILL.md ~/.claude/skills/one-shot-ui/SKILL.md

Then use `/one-shot-ui` in your agent conversation.
```

---

## Phase 6: Publish Checklist

1. [ ] Create `scripts/build.ts`
2. [ ] Update `package.json` (bin, files, version, description, remove private)
3. [ ] Add runtime Playwright check in CLI for capture/run commands
4. [ ] Run `bun run build` and verify `dist/cli.mjs` works with `node`
5. [ ] Test `npx . extract <some-image> --json` locally
6. [ ] Write `AGENTS.md`
7. [ ] Write `skill/SKILL.md`
8. [ ] Add LICENSE file
9. [ ] Verify published contents: `npm pack --dry-run`
10. [ ] Publish: `npm publish`
11. [ ] Test: `npx one-shot-ui --help` from a clean directory

---

## File Changes Summary

| File                    | Action  | Purpose                              |
|-------------------------|---------|--------------------------------------|
| `package.json`          | Modify  | Add bin, files, version, remove private |
| `scripts/build.ts`      | Create  | Bundle CLI + add shebang             |
| `AGENTS.md`             | Create  | Agent discoverability (broad support)|
| `skill/SKILL.md`        | Create  | Claude Code skill definition         |
| `packages/cli/src/index.ts` | Modify | Add runtime Playwright check     |
| `.npmignore` or `files` | Via pkg | Control published contents           |
