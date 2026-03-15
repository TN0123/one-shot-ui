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
