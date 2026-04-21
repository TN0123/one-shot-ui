---
name: one-shot-ui
description: >
  Extract UI designs from screenshots and iteratively refine implementations
  to match a reference image pixel-perfectly using comparison and fix suggestions.
---

You have access to the `one-shot-ui` CLI tool. Use it to analyze reference
screenshots and compare your implementations against them.

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

### Step 2: Build the UI
Use the extracted data to write the implementation directly. Set exact:
- Colors (hex values from extraction)
- Spacing (px values from spacing measurements)
- Typography (font sizes, weights from text blocks)
- Border radii, shadows, gradients (from style extraction)

### Step 3: Compare
Run `one-shot-ui capture --url http://localhost:3000 --output impl.png` then
`one-shot-ui compare <reference.png> impl.png --json --heatmap heatmap.png`.

Read the heatmap to see where differences are. The JSON report includes:
- `mismatchRatio` — overall pixel difference (0.0 = perfect match)
- `issues[]` — categorized problems (COLOR_MISMATCH, SPACING_MISMATCH, etc.)
- `topEditCandidates[]` — ranked list of what to fix first

### Step 4: Fix issues
Run `one-shot-ui suggest-fixes <reference.png> impl.png --json` to get specific
Tailwind/CSS fix suggestions. Apply them and re-compare.

### Automated Loop
For hands-off refinement, use:
`one-shot-ui run <reference.png> --impl ./index.html --output ./passes --max-passes 5 --threshold 0.02`

This runs the extract→capture→compare→fix loop automatically, writing artifacts
for each pass.

### Watch-Mode Server (recommended for iterative work)

Start a local DOM-aware server that watches your HTML file:
`one-shot-ui serve --ref <reference.png> --impl ./index.html --port 7777`

Query endpoints over HTTP while you edit:

- `GET /reference` — the reference brief (colors, text with bounds, regions).
- `GET /element?selector=<css>` — pass any CSS selector for an element in YOUR
  HTML; returns `myComputed` (real rendered styles), `reference` (the matched
  reference region at the same bounds), and `diffs[]` (concrete CSS suggestions
  that reference YOUR selector, not fabricated names).
- `POST /apply-temp` `{"selector": "...", "css": "..."}` — trials a candidate
  CSS change, scores before/after, returns signed `globalDelta`/`scopedDelta`
  and a `verdict`. Use this to pick winning fixes before writing them to disk.
- `GET /status` — current overall mismatchRatio + top-mismatched regions.

Save your HTML file; the server auto-reloads the page in ~120ms. Every edit
yields a measurable mismatch delta — this is the fastest path to convergence.

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
