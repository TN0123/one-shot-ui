# Phase 1 Plan

## Goal

Build a usable MVP of `one-shot-ui` that can:

- load and normalize screenshots
- extract dominant colors
- detect rough layout boxes
- extract OCR text
- capture implementation screenshots in a browser
- compare two screenshots with pixel diffs and heatmaps
- return stable JSON validated by shared schemas

## Deliverables

### 1. Monorepo foundation

- create a TypeScript workspace with package boundaries
- add shared TypeScript config and workspace scripts
- keep the CLI thin and push logic into libraries

### 2. Shared contracts

- define versioned `extract`, `compare`, and `capture` schemas in `packages/core`
- expose reusable types for bounds, colors, text blocks, layout nodes, and compare issues

### 3. Image loading and preprocessing

- add image loading from file paths
- normalize metadata, dimensions, and raw pixel access
- include a preprocessing pass for trim bounds and summary stats

### 4. Extraction engine

- implement dominant color extraction with palette clustering
- implement coarse layout box detection using deterministic pixel grouping
- implement OCR text extraction through a local OCR adapter, with graceful offline fallback
- assemble a single `extract` pipeline that emits structured JSON

### 5. Compare engine

- diff two screenshots at pixel level
- generate a heatmap image
- return summary metrics and machine-readable issues

### 6. Browser capture

- capture screenshots from a local URL or static file with Playwright
- support viewport sizing and output path control
- document Chromium installation as a required local setup step

### 7. CLI surface

- add `extract`, `compare`, and `capture` commands
- support `--json` output for agent workflows
- return explicit errors and deterministic output shape

## Build Order

1. Write shared schemas and workspace scaffolding.
2. Implement image loading helpers and preprocessing.
3. Implement extraction modules for colors, layout, and OCR.
4. Implement compare and heatmap generation.
5. Implement Playwright-based capture.
6. Wire everything into the CLI.
7. Verify typechecking and command wiring.

## Scope Boundaries

Phase 1 intentionally keeps several capabilities shallow:

- layout detection is coarse and box-oriented, not a full semantic tree
- OCR is best-effort and confidence-based
- compare output focuses on pixel metrics and basic issue summaries
- spacing, radius, typography heuristics, and component inference remain Phase 2 work

## Exit Criteria

Phase 1 is complete when the repo contains:

- a working workspace layout
- a documented CLI entrypoint
- typed JSON contracts for extract and compare
- implemented extraction, compare, and capture modules
- a first-pass runnable command flow for `extract`, `compare`, and `capture`
