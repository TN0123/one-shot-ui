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
- Text blocks with content, font size, weight, color, and `monospace`
- Design tokens (spacing scale, color palette, radius scale)
- Component clusters (repeated visual patterns)
- Implementation plan (suggested CSS strategy: grid/flex/absolute)

**Pass `--dpr` for Retina/Mac screenshots.** A 2x screenshot reports every pixel at
double its CSS value (a 35px heading measures 70px), which throws off fonts, spacing
and sizing. If you know the screenshot is from a Retina/Mac display, pass `--dpr 2` so
sizes and bounds come back in CSS pixels. Otherwise check the report's `scale` block:
`units: "css-px"` means values are normalized; a `scale.scaleHint` means it might be
Retina and you should re-run with `--dpr 2`. Build to the reported CSS pixels.

### Step 2: Build the UI
Use the extracted data to write the implementation directly. Set exact:
- Colors (hex values from extraction)
- Spacing (px values from spacing measurements)
- Typography (font sizes, weights from text blocks)
- Border radii, shadows, gradients (from style extraction)

**Build to the `rulers` block — this is the single biggest lever for sizing/spacing.**
`extract` reports deterministic pixel-projection "rulers" so you don't have to eyeball or
hand-measure geometry:
- `rulers.bands` — background-zone heights down the page (e.g. a top header/nav bar's exact
  height in CSS px, with its background hex). Set those container heights/paddings exactly.
- `rulers.columns` — content column left edges and widths (sidebar width, main column,
  card columns). Drive your container widths / grid tracks from these.
- `rulers.gutters` — the exact gaps between columns. Use them for `column-gap`, margins, padding.
These are CSS px (DPR already applied). Matching them up front avoids the slow "off by ~16px,
shifted right" iteration loop.

**Icons: do not hand-draw glyphs.** Reproducing icons as inline SVG paths or CSS shapes
almost never pixel-matches and is the most common residual diff. Instead use an icon library:
- Match the icon set the user's codebase already uses if there is one.
- Otherwise default to **lucide** (`lucide-react`, or the framework-appropriate package).
- For a GitHub-style UI specifically, GitHub uses **Octicons** (`@primer/octicons`).
Pick the closest-matching icon by name and size it to the reference (commonly 16–20px).

### Step 3: Compare
Capture your build at the reference's exact scale, then diff:
```
one-shot-ui capture --file ./index.html --match-reference reference.png --output impl.png
one-shot-ui compare reference.png impl.png --json --heatmap heatmap.png
```
`--match-reference` now matches BOTH the viewport and the device scale: a 2x Retina reference
is captured at CSS dimensions @ 2x so the pixel sizes line up and no resize/crop is needed.
If the reference is a Retina/Mac screenshot and auto-detection isn't confident, pass
`--reference-dpr 2` (the capture prints its detected DPR + a hint when unsure).

**For sizing/spacing, read `spacing[]` (or run `compare --spacing`).** Every `compare`
reports a `spacing[]` array of deterministic, directly-CSS-able deltas — `BAND_HEIGHT_DELTA`
(a bar/section is N px too tall/short), `EDGE_X_DELTA` (a column's left edge is N px off),
`GUTTER_DELTA` (a gap is N px too wide/narrow) — each with a concrete fix like
"Reduce its height/padding by 11px." These are the highest-trust fixes; apply them first.
`one-shot-ui compare reference.png impl.png --spacing` prints just this list.

Read the heatmap to see where differences are. The JSON report includes:
- `summary.verdict` — `{ status: "converged" | "not-converged", reasons[], completeness }`.
  **This is your stop signal, not the pixel %.** Keep iterating while
  `status` is `not-converged`. The pixel `mismatchRatio` is dominated by background and
  reads as "almost done" even when most elements are missing — do not trust it alone.
- `mismatchRatio` — overall pixel difference (0.0 = perfect match)
- `issues[]` — categorized problems (COLOR_MISMATCH, SPACING_MISMATCH, etc.)
- `topEditCandidates[]` — ranked list of what to fix first

The `--summary` flag prints one line that leads with `VERDICT: CONVERGED / NOT CONVERGED`
and the reasons (e.g. missing structural coverage, low hierarchy, a region holding most
of the mismatch). Address the reasons, re-compare, and only stop once it reports
CONVERGED.

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

- **macOS screenshot paths.** If the user takes a screenshot and drags the floating
  thumbnail in, the path may point at a temporary location (e.g.
  `…/TemporaryItems/NSIRD_screencaptureui_*/Screenshot ….png`) that macOS moves to
  `~/Desktop` once the thumbnail dismisses. If a command reports the file is a moved
  macOS screenshot, ask the user for the saved path (usually `~/Desktop/Screenshot ….png`)
  or have them save it into the project first.
- **Reference scale.** Pass `--dpr 2` for Retina/Mac screenshots (see Step 1). Sizes and
  bounds in the compact report are then CSS pixels — build to those directly.
- **Typography.** `extract` measures font size, weight, and monospace-vs-proportional
  from pixels reliably; serif-vs-sans and the exact typeface are best-guess candidates
  (`fontFamilyCandidates`) — confirm the typeface against the screenshot. See
  `typographyNote` in the report.
- Chromium must be installed: `npx playwright install chromium`
- Use `--no-ocr` to skip OCR if text extraction isn't needed (faster)
- Use `--fine` for UIs with small details (icons, small buttons)
- Use `--overlay` when you plan to view the reference image yourself — it adds
  labeled bounding boxes for cross-referencing
