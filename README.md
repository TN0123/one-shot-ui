# one-shot-ui

`one-shot-ui` is an open source CLI for AI agents to analyze screenshots, compare implementations against references, and iteratively reduce visual mismatch when recreating UIs.

The project is built around a simple principle:

> large language models should not do first-pass measurement from raw pixels

Instead, `one-shot-ui` aims to extract deterministic, machine-readable UI data first, then let an agent reason on top of that data.

## Status

The repo is currently in Phase 2 of the roadmap.

Phase 2 now includes:

- CLI scaffold
- image loading and preprocessing
- dominant color extraction
- coarse layout box detection
- spacing measurement between neighboring regions
- border radius estimation for detected regions
- OCR-driven font size and weight heuristics when OCR is enabled
- simple component clustering for repeated visual patterns
- Playwright screenshot capture
- pixel diff and heatmap generation
- actionable compare issues for position, size, spacing, color, radius, and text heuristics
- typed JSON contracts

Roadmap details are in roadmap.md.

## Goals

The long-term goal is to help agents answer questions like:

- what exact colors are present in a screenshot?
- what layout regions and reusable components exist?
- how does an implementation differ from the reference?
- what exact fixes should be made to reduce the mismatch?

## Current CLI

The current CLI exposes three commands:

```sh
bun packages/cli/src/index.ts extract <imagePath> --json
bun packages/cli/src/index.ts compare <referencePath> <implementationPath> --json --heatmap <path>
bun packages/cli/src/index.ts capture --file <htmlPath> --output <pngPath>
```

## Getting started

Requirements:

- Bun
- macOS, Linux, or another environment supported by `sharp` and Playwright

Install dependencies:

```sh
bun install
```

Install the Playwright Chromium binary used by `capture`:

```sh
bun run install:browsers
```

Typecheck the workspace:

```sh
bun run typecheck
```

## Example workflow

1. Capture or save a reference screenshot.
2. Run `extract` on the reference image.
3. Build the implementation in HTML/CSS or your target framework.
4. Run `capture` on the implementation.
5. Run `compare` between the reference and implementation.
6. Use the heatmap and JSON report to make fixes.
7. Repeat until the mismatch is low enough.

## Repository layout

```text
packages/
  browser-capture/  Playwright-based screenshot capture
  cli/              command-line entrypoint
  core/             shared schemas and contracts
  diff-engine/      image compare and heatmap generation
  image-io/         image loading and preprocessing helpers
  vision-components/ repeated-pattern clustering
  vision-layout/    coarse layout box detection
  vision-style/     dominant color extraction
  vision-text/      OCR adapter
testing/            static testing fixture and outputs
```

## Notes on the current phase

- OCR is currently opt-in via `ONE_SHOT_UI_ENABLE_OCR=1`.
- Layout detection is still intentionally coarse and region-oriented rather than a full semantic tree.
- Border radius, spacing, typography, and component outputs are deterministic heuristics, not model-backed vision.
- `compare` now produces actionable machine-readable issues, but richer shadow, gradient, and font-family analysis remain Phase 3 work.

See phase1.md for the build plan and phase1-agent-feedback.md for implementation feedback from using the Phase 1 CLI in practice.

## License

This project is licensed under the MIT License.
