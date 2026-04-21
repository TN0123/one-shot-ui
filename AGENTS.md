# one-shot-ui

Deterministic UI extraction and comparison toolkit. Use this tool to see what is
wrong with a UI implementation compared to a reference screenshot.

## Installation

    npm install -g one-shot-ui
    npx playwright install chromium    # only needed for capture/run commands

## Core Workflow

1. **Extract** — Analyze a reference screenshot into structured layout data:
       one-shot-ui extract reference.png --json

2. **Build** — Use the extracted data (colors, spacing, typography, tokens) to
   build your implementation. The agent should write the UI code directly.

3. **Capture** — Screenshot your implementation:
       one-shot-ui capture --url http://localhost:3000 --output impl.png

4. **Compare** — Diff reference vs implementation:
       one-shot-ui compare reference.png impl.png --json --heatmap heatmap.png

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
| compare         | Pixel + structural diff                    | --json, --heatmap, --dom-diff      |
| tokens          | Extract design tokens                      | --json                             |
| plan            | Generate implementation strategy           | --json                             |
| capture         | Screenshot a URL, HTML, or .tsx file       | --url, --file, --output            |
| suggest-fixes   | Tailwind/CSS fix suggestions from diff     | --json, --top, --dom-diff, --framework |
| run             | Multi-pass refinement loop                 | --impl, --max-passes, --threshold  |
| serve           | Watch-mode DOM-aware query server          | --ref, --impl, --port              |
| benchmark       | Run benchmark suites                       | --json, --output                   |

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
- The `extract --overlay` flag adds bounding-box annotations useful for
  vision-model cross-referencing.
- The `run` command handles the full extract→capture→compare→fix loop
  automatically. Prefer it over manual orchestration when possible.
- `suggest-fixes --dom-diff <url>` gives the most accurate CSS fixes by
  comparing against the live DOM rather than just pixels.
- Design tokens from `tokens` can be fed directly into CSS variable definitions.
- Build the UI yourself using the extracted data — one-shot-ui is for analysis
  and comparison, not code generation.
