# one-shot-ui

Deterministic UI extraction and comparison toolkit. Use this tool to see what is
wrong with a UI implementation compared to a reference screenshot.

## Installation

    npm install -g one-shot-ui
    npx playwright install chromium    # only needed for capture/run commands

## Core Workflow

1. **Extract** — Analyze a reference screenshot into structured layout data:
       one-shot-ui extract reference.png --json
   For Retina/Mac screenshots, add `--dpr 2` so font sizes and bounds are reported in
   CSS pixels (a 2x capture otherwise doubles every measurement). When omitted, scale is
   auto-detected; check the report's `scale`/`units` and re-run with `--dpr 2` if it hints
   the image is Retina.

2. **Build** — Use the extracted data (colors, spacing, typography, tokens) to
   build your implementation. The agent should write the UI code directly.
   Build to the `rulers` block (band heights, column edges + widths, gutter widths — all
   CSS px) to get sizing/spacing right the first time. Don't hand-draw icons/glyphs as SVG
   or CSS — use an icon library (the codebase's existing set, else `lucide`; `@primer/octicons`
   for GitHub-style UIs). Hand-drawn glyphs are the most common residual diff.

3. **Capture** — Screenshot your implementation at the reference's exact scale:
       one-shot-ui capture --file ./index.html --match-reference reference.png --output impl.png
   `--match-reference` matches viewport AND device scale (a 2x Retina reference is captured
   at CSS dims @ 2x), so pixels line up without resize/crop. Add `--reference-dpr 2` if the
   reference is Retina and the capture reports low DPR confidence.

4. **Compare** — Diff reference vs implementation:
       one-shot-ui compare reference.png impl.png --json --heatmap heatmap.png
   Use `summary.verdict` (`converged` / `not-converged` + reasons) as your stop signal —
   not the pixel `mismatchRatio`, which is background-dominated and reads as "almost done"
   even when most elements are missing. Keep iterating until the verdict is `converged`.
   The report's `spacing[]` array gives deterministic, directly-CSS-able sizing/spacing
   deltas (`BAND_HEIGHT_DELTA`, `EDGE_X_DELTA`, `GUTTER_DELTA`) with concrete fixes — apply
   these first; they're the highest-trust path to closing the last-mile spacing gap.
   `compare … --spacing` prints just this list.

5. **Suggest Fixes** — Get actionable CSS fix suggestions:
       one-shot-ui suggest-fixes reference.png impl.png --json

6. **Run** — Automated multi-pass refinement loop:
       one-shot-ui run reference.png --impl ./index.html --output ./passes

7. **Serve** *(recommended)* — Watch-mode HTTP server with live DOM-aware queries:
       one-shot-ui serve --ref reference.png --impl ./index.html --port 7777
   Returns real CSS diffs anchored to selectors that exist in your HTML, and
   lets you test candidate fixes via `POST /apply-temp` before committing them.
   This is the fastest path to convergence for an agent.

## Commands Reference

| Command         | Purpose                                    | Key Flags                          |
|-----------------|--------------------------------------------|----------------------------------  |
| extract         | Analyze screenshot into layout/color/text  | --json, --no-ocr, --overlay, --fine|
| compare         | Pixel + structural diff + spacing deltas   | --json, --heatmap, --spacing, --dom-diff |
| tokens          | Extract design tokens                      | --json                             |
| plan            | Generate implementation strategy           | --json                             |
| capture         | Screenshot a URL, HTML, or .tsx file       | --url, --file, --output, --match-reference, --reference-dpr |
| suggest-fixes   | Tailwind/CSS fix suggestions from diff     | --json, --top, --dom-diff, --framework |
| run             | Multi-pass refinement loop                 | --impl, --max-passes, --threshold  |
| serve           | Watch-mode DOM-aware query server          | --ref, --impl, --port              |
| mcp             | Run as an MCP server (stdio) for agents    | —                                  |
| benchmark       | Run benchmark suites                       | --json, --output                   |

If your client speaks MCP, you can skip the CLI entirely: `one-shot-ui mcp` exposes
`compare`, `suggest_fixes`, `extract`, `tokens`, and `plan` as tools (stdio, local, no API
keys). See `docs/MCP.md`.

### `serve` endpoints (HTTP, default port 7777)

- `GET /reference` — colors, text, regions, semantic anchors from the reference
- `GET /status` — current mismatch ratio + top mismatched regions
- `GET /element?selector=<css>` — your live computed styles vs. the reference region at the same bounds, plus a `diffs[]` array with valid CSS suggestions
- `POST /apply-temp` `{selector, css}` — trial a CSS change, return `{globalDelta, scopedDelta, verdict}` without persisting
- `POST /reload` — manual reload (not usually needed; the file watcher auto-reloads ~120ms after save)

## Output Format

All commands support `--json` for structured JSON output. Reports are validated
with Zod schemas and follow stable interfaces.

## Tips for Agents

- Always use `--json` to get structured output you can parse.
- **Pass `--dpr 2` for Retina/Mac screenshots** (CLI) or `dpr: 2` (MCP). This is the
  single biggest accuracy win — without it, a 2x screenshot's 35px heading and 8px gaps
  are reported as 70px and 16px, throwing off fonts, spacing, and sizing together.
- **Close sizing/spacing with `rulers` (extract) and `spacing[]` (compare).** These are
  deterministic pixel-projection measurements — band/bar heights, content-column edges and
  widths, gutter widths — reported in CSS px with concrete fixes ("Reduce its height/padding
  by 11px"). Build to the reference rulers; apply the compare spacing deltas first. This is
  the fix for the "off by ~16px, shifted right" last mile — no more hand-rolling pixel scripts.
- **Don't hand-draw icons.** Inline-SVG/CSS glyphs rarely pixel-match and dominate the residual
  diff. Use an icon library: the codebase's existing set, else `lucide`; `@primer/octicons`
  for GitHub-style UIs. Match by name, size to the reference (usually 16–20px).
- **Stop on the verdict, not the percentage.** `compare`/`suggest-fixes` report
  `summary.verdict`; a low `mismatchRatio` with `status: "not-converged"` means you are
  missing structure/content, not done. Iterate until `converged`.
- **macOS screenshots:** if a path under `…/TemporaryItems/NSIRD_screencaptureui_*/` or a
  just-dragged `Screenshot ….png` is reported missing, macOS has moved it to `~/Desktop` —
  use the saved path or copy it into the project first.
- **Typography:** font size, weight, and monospace-vs-proportional are measured; serif-vs-
  sans and the exact typeface in `fontFamilyCandidates` are best guesses — confirm visually.
- The `extract --overlay` flag adds bounding-box annotations useful for
  vision-model cross-referencing.
- The `run` command handles the full extract→capture→compare→fix loop
  automatically. Prefer it over manual orchestration when possible.
- `suggest-fixes --dom-diff <url>` gives the most accurate CSS fixes by
  comparing against the live DOM rather than just pixels.
- Design tokens from `tokens` can be fed directly into CSS variable definitions.
- Build the UI yourself using the extracted data — one-shot-ui is for analysis
  and comparison, not code generation.
