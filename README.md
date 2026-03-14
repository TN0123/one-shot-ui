# one-shot-ui

`one-shot-ui` is a Bun-based CLI and TypeScript workspace for deterministic UI extraction, screenshot comparison, scaffold generation, and agent-oriented iteration loops.

The core idea is simple:

> let code extract structure and measurements first, then let an agent reason on top of that output

Instead of asking a model to guess layout directly from raw pixels, the project turns screenshots into typed JSON, semantic anchors, implementation hints, and compare artifacts that are easier to automate against.

## Current State

As of March 2026, the Phase 6 surface is implemented and usable end-to-end for local experimentation.

What exists today:

- screenshot extraction with colors, layout regions, spacing, component clusters, hierarchy, and diagnostics
- OCR-backed text extraction plus typography heuristics
- semantic anchors and implementation planning output
- optional semantic labeling and overlay annotations for vision-assisted agent workflows
- screenshot capture with Playwright
- screenshot compare with heatmaps, grouped structural issues, and top edit candidates
- region-scoped compare with semantic-coverage fallback to pixel-only guidance
- DOM-aware comparison against a local file or live URL
- scaffold generation to HTML/CSS, plus optional React component output
- multi-pass `run` orchestration that writes session and next-action artifacts
- benchmark manifests and benchmark scoring for regression tracking

Current work is less about adding brand new commands and more about improving fidelity and reliability:

- scaffold output still needs better first-pass resemblance on real screenshots
- compare output is useful, but still being tuned toward higher-leverage edit guidance
- extraction and schema handling are being hardened through dogfooding on real references
- benchmark coverage is still lightweight and intended for trend tracking, not ground truth

## CLI Surface

The CLI currently exposes:

```sh
bun packages/cli/src/index.ts extract <imagePath> [--json] [--label] [--overlay] [--fine]
bun packages/cli/src/index.ts plan <imagePath> [--json]
bun packages/cli/src/index.ts tokens <imagePath> [--json]
bun packages/cli/src/index.ts scaffold <imagePath> [--output <dir>] [--react] [--mode structured|absolute]
bun packages/cli/src/index.ts capture --file <htmlPath> --output <pngPath>
bun packages/cli/src/index.ts compare <referencePath> <implementationPath> [--json] [--heatmap <path>] [--region <anchor>] [--crop x,y,width,height] [--dom-diff <url-or-file>]
bun packages/cli/src/index.ts suggest-fixes <referencePath> <implementationPath> [--json] [--region <anchor>] [--dom-diff <url-or-file>]
bun packages/cli/src/index.ts run <referencePath> --impl <html-or-url> [--output <dir>] [--max-passes <n>]
bun packages/cli/src/index.ts benchmark <manifestPath> [--json] [--output <path>]
```

Root scripts are available for the most common commands:

```sh
bun run extract
bun run compare
bun run capture
bun run benchmark
```

## Getting Started

Requirements:

- Bun
- an environment supported by `sharp`
- Playwright Chromium for screenshot capture and DOM extraction

Install dependencies:

```sh
bun install
```

Install the browser used by `capture` and DOM diff:

```sh
bun run install:browsers
```

Typecheck the workspace:

```sh
bun run typecheck
```

Show CLI help:

```sh
bun packages/cli/src/index.ts --help
```

## Typical Workflows

### Extract and plan from a screenshot

```sh
bun packages/cli/src/index.ts extract ./reference.png --json
bun packages/cli/src/index.ts plan ./reference.png --json
bun packages/cli/src/index.ts tokens ./reference.png --json
```

### Generate a first scaffold

```sh
bun packages/cli/src/index.ts scaffold ./reference.png --output ./scaffold
bun packages/cli/src/index.ts scaffold ./reference.png --output ./scaffold-react --react
```

### Capture and compare an implementation

```sh
bun packages/cli/src/index.ts capture --file ./scaffold/index.html --output ./impl.png
bun packages/cli/src/index.ts compare ./reference.png ./impl.png --json --heatmap ./heatmap.png
```

### Focus on one section

```sh
bun packages/cli/src/index.ts compare ./reference.png ./impl.png --json --region "main-content"
```

### Get edit guidance

```sh
bun packages/cli/src/index.ts suggest-fixes ./reference.png ./impl.png --json
```

### Run the orchestration loop

```sh
bun packages/cli/src/index.ts run ./reference.png --impl ./scaffold/index.html --output ./one-shot-run
```

### Run benchmarks

```sh
bun packages/cli/src/index.ts benchmark ./benchmarks/phase6-manifest.json --json
```

Note: benchmark manifests are in-repo, but many fixture images and local reconstruction files used during dogfooding live in ignored local `testing/` directories.

## Important Notes

- OCR is enabled by default unless disabled with `--no-ocr` or `ONE_SHOT_UI_DISABLE_OCR=1`.
- Layout detection is still heuristic and region-oriented, not a full semantic DOM reconstruction.
- Typography, spacing, radius, shadow, and gradient outputs are deterministic estimates, not model-based vision outputs.
- `extract --label` uses heuristic semantic labels unless you provide a custom labeling adapter.
- `extract --overlay` adds structured measurement annotations intended to complement an LLM's own vision.
- `compare --region` can explicitly fall back to scoped pixel guidance when semantic coverage is too thin.
- `run` produces artifacts for downstream editing agents, but it does not directly edit the implementation itself.

## Repository Layout

```text
benchmarks/          benchmark manifests and checklist docs
docs/                workflow notes for agents and benchmarking
packages/
  browser-capture/   Playwright screenshot capture
  cli/               command-line entrypoint
  core/              shared schemas, plans, tokens, overlays, scaffold generation
  diff-engine/       compare engine, heatmaps, issue generation
  dom-diff/          DOM extraction and DOM-vs-reference comparison
  image-io/          image loading and preprocessing
  semantic-label/    heuristic or adapter-backed semantic labels
  vision-components/ repeated-pattern clustering
  vision-layout/     layout detection and spacing measurement
  vision-style/      colors, gradients, shadows, radius heuristics
  vision-text/       OCR and typography heuristics
```

## Project Docs

- `docs/agent-integration.md`: suggested agent loop and prompt templates
- `docs/benchmarking.md`: benchmark command and current scoring dimensions
- `benchmarks/DOGFOOD-CHECKLIST.md`: end-to-end workflow checklist
- `cli-improvement-plan.md`: current reliability and fidelity workstreams

## License

MIT
