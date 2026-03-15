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
|-----------------|--------------------------------------------|----------------------------------  |
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
