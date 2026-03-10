# one-shot-ui Roadmap

## Vision

`one-shot-ui` is an open source CLI tool for AI agents to copy a UI from a screenshot as accurately as possible. The goal is not to rely on vague visual prompting alone, but to turn screenshots into deterministic, machine-readable design data that agents can use to implement pixel-perfect interfaces.

The CLI should help agents answer questions like:

- What exact colors are present in the image?
- Which fonts and typography settings are likely used?
- What are the border radii, shadows, padding, and spacing values?
- What reusable components appear in the screenshot?
- How does an implementation screenshot differ from the target screenshot?
- What exact fixes should be made to reduce the visual mismatch?

The core idea is to build a deterministic UI-analysis and diff engine that produces structured outputs for AI agents.

## Product Principle

Large language models should not do first-pass measurement from raw pixels.

LLMs are useful for:

- planning implementation
- choosing semantic components
- interpreting ambiguous cases
- generating code changes from structured data

LLMs are weak at:

- exact spacing measurement
- precise color extraction
- reliable radius and shadow estimation
- pixel-level visual comparison

Because of that, `one-shot-ui` should extract hard measurements first and let the agent reason on top of those measurements.

## Core Capabilities

The CLI should revolve around three core engines:

1. `extract`: turns a screenshot into a structured UI specification
2. `compare`: compares a reference screenshot and an implementation screenshot
3. `guide`: presents agent-friendly JSON, diagnostics, and suggested fixes

These capabilities should enable an iterative workflow:

1. User provides the target screenshot
2. Agent runs `extract`
3. Agent implements the UI
4. Agent captures a screenshot of its implementation
5. Agent runs `compare`
6. CLI returns exact visual mismatches
7. Agent patches code
8. Loop continues until the implementation reaches a target quality threshold

## Recommended Tech Direction

Use TypeScript and keep the architecture strongly modular. The system should be a monorepo with strict package boundaries and shared typed contracts.

Recommended stack:

- `pnpm` workspaces
- `typescript`
- `zod` for schemas
- `sharp` for image preprocessing
- `playwright` for screenshot capture
- `pixelmatch` or `odiff` for bitmap diffs
- `commander` or `cac` for CLI ergonomics
- `onnxruntime-node` later if local CV models are introduced

Start TypeScript-native. Only introduce Python or external services later if there is a clear need for stronger computer vision or OCR performance.

## Proposed Monorepo Structure

The repository should be organized into focused packages:

- `packages/core`
  - shared types, schemas, geometry helpers, color helpers
- `packages/image-io`
  - image loading, cropping, scaling, normalization
- `packages/vision-layout`
  - region detection, box extraction, grouping, tree construction
- `packages/vision-style`
  - colors, borders, shadows, gradients, blur detection
- `packages/vision-text`
  - OCR, line box measurement, font inference
- `packages/vision-components`
  - repeated pattern detection and component inference
- `packages/diff-engine`
  - screenshot comparison, perceptual scoring, issue generation
- `packages/agent-api`
  - stable JSON outputs, prompt helpers, tool contracts
- `packages/browser-capture`
  - Playwright-based capture of local implementations
- `packages/cli`
  - `extract`, `compare`, `inspect`, `tokens`, `components`, `suggest-fixes`
- `packages/bench`
  - evaluation datasets, scoring, regressions, benchmarks

## Design Rules For Modularity

The codebase should stay modular by following these rules:

- Keep the CLI thin
- Keep analysis engines pure and stateless where possible
- Pass data through typed intermediate representations
- Isolate image processing from semantic inference
- Isolate deterministic logic from model-based logic
- Treat LLM integrations as optional adapters, not core infrastructure

A useful rule of thumb:

- geometry, layout, spacing, color, and diff logic should be deterministic
- semantics, naming, ambiguity resolution, and implementation guidance can use model assistance

## Agent-First CLI Design

The CLI should be designed for automation, not only for humans.

Suggested commands:

- `one-shot-ui extract reference.png --json`
- `one-shot-ui compare reference.png implementation.png --json`
- `one-shot-ui inspect reference.png --node button-3`
- `one-shot-ui tokens reference.png`
- `one-shot-ui components reference.png`
- `one-shot-ui suggest-fixes reference.png implementation.png`

Outputs should be:

- versioned
- stable
- strongly typed
- JSON-first
- explicit about confidence and ambiguity

## Example Output Shape

The extraction output should resemble a structured design spec:

```json
{
  "nodes": [
    {
      "id": "button-3",
      "type": "button",
      "bounds": { "x": 120, "y": 440, "width": 168, "height": 48 },
      "fill": "#111827",
      "borderRadius": 12,
      "text": {
        "content": "Continue",
        "fontFamilyCandidates": ["Inter", "SF Pro Display"],
        "fontSize": 16,
        "fontWeight": 600,
        "lineHeight": 24
      },
      "padding": { "top": 12, "right": 20, "bottom": 12, "left": 20 },
      "confidence": 0.84
    }
  ]
}
```

This kind of output is more useful to an agent than a vague natural language summary.

## Core Internal Types

The shared `core` package should define the main data structures:

- `ImageAsset`
- `Bounds`
- `Color`
- `Shadow`
- `TypographySpec`
- `StyleSpec`
- `LayoutNode`
- `ComponentSpec`
- `TokenCandidate`
- `CompareIssue`
- `AnalysisReport`

All public outputs should validate through `zod`.

## Screenshot Extraction Pipeline

The screenshot analysis should be staged.

### 1. Normalize

Before analysis:

- detect image scale and likely device pixel ratio
- remove transparent or empty margins
- normalize color space
- detect whether browser chrome or external framing is present
- isolate the actual artboard or app canvas when possible

### 2. Layout Segmentation

Recover a visual tree using:

- edge detection
- connected components
- flood fill over similar regions
- contour detection
- whitespace gap analysis
- alignment clustering
- repetition detection

The output should represent hierarchy:

- page
- sections
- panels
- cards
- rows and columns
- controls
- text nodes
- icons and images

This is one of the most important parts of the system. If the layout tree is wrong, everything downstream becomes less reliable.

### 3. Style Extraction

For each node, extract:

- solid fills
- gradients
- border widths and colors
- corner radii
- shadows
- opacity
- blur and glass effects
- inner spacing inferred from contents

The system should preserve both:

- exact observed values
- normalized token candidates after clustering

That allows agents to use either raw measurements or reusable design tokens.

### 4. Typography Extraction

Typography should include:

- OCR for text content
- text block bounds
- estimated font size
- estimated line height
- estimated font weight
- approximated letter spacing
- ranked font family candidates

Font family detection will always be probabilistic from pixels alone, so the system should return candidates plus confidence rather than pretending certainty.

Example:

- `Inter: 0.62`
- `SF Pro Text: 0.21`
- `Helvetica Neue: 0.08`

### 5. Component Inference

The system should detect likely UI primitives such as:

- button
- input
- avatar
- nav item
- tab
- card
- badge
- list row
- modal
- sidebar

The CLI should expose both raw visual nodes and semantic component guesses.

Raw nodes preserve precision. Semantic components make implementation easier for the agent.

## Features Needed For Pixel-Perfect Reproduction

To significantly outperform today’s generic screenshot-to-code workflows, the tool should support the following.

### Exact Spacing Measurement

Measure:

- inter-element gaps
- container padding
- baseline alignment
- center alignment
- grid rhythm

Agents often get spacing wrong because they infer semantics rather than reading geometry. This tool should output concrete distances.

### Radius And Stroke Estimation

Rounded corners and borders should be extracted as precisely as possible:

- estimate radius from corner curvature
- detect uniform versus asymmetric radii
- separate border from shadow
- distinguish hairline borders from standard 1px strokes

### Robust Color Extraction

Avoid naive single-pixel sampling. Use:

- region-based sampling
- median color estimation
- palette clustering
- edge-aware fill estimation
- antialias compensation

The output should include:

- raw sampled colors
- normalized token candidates
- confidence scores

### Shadow Decomposition

Shadows are a major source of visual mismatch. Estimate:

- x offset
- y offset
- blur radius
- spread
- rgba color

Even approximate shadow extraction can substantially improve fidelity.

### Font Heuristics

Use a hybrid approach:

- OCR for content
- image-based font ranking
- a shortlist of known web fonts
- fallback CSS stack suggestions

Instead of claiming certainty, return ranked candidates and confidence.

### Repetition Detection

Detect repeated visual patterns so the agent can infer reusable components. For example, multiple cards or buttons should collapse into a shared component family when appropriate.

## Compare Engine

The compare engine should go beyond simple pixel diffs and return actionable diagnostics.

It should detect issues such as:

- missing elements
- extra elements
- x or y position mismatches
- width or height mismatches
- padding mismatches
- radius mismatches
- color mismatches
- font size and weight mismatches
- shadow mismatches
- alignment problems

The compare system should operate at three layers.

### 1. Pixel Diff

Used for final visual scoring:

- `pixelmatch`
- perceptual image scoring
- diff heatmaps

### 2. Structural Diff

Match extracted nodes between reference and implementation and compare:

- bounds
- spacing
- hierarchy
- alignment groups

### 3. Style Diff

For matched nodes, compare:

- fills
- borders
- radii
- typography metrics
- shadows
- opacity

This layered diff output is what makes the tool useful for agents, because it tells them exactly what to fix.

## Example Compare Issue

The compare output should be machine-readable and directly actionable:

```json
{
  "code": "BORDER_RADIUS_MISMATCH",
  "nodeId": "card-2",
  "reference": 16,
  "implementation": 12,
  "suggestedFix": "Increase border-radius to 16px",
  "severity": "medium"
}
```

This is far more useful for automation than a generic prose description.

## Where Models Should Help

Models can be useful for:

- naming inferred components
- ranking font families
- generating implementation guidance
- suggesting framework-appropriate component structures
- producing fix instructions from diff data

Models should not be the primary source of truth for:

- spacing
- colors
- box geometry
- border radii
- pixel differences

## MVP Roadmap

Build the project in phases.

### Phase 1

- CLI scaffold
- image loading and preprocessing
- dominant color extraction
- layout box detection
- OCR text extraction
- Playwright screenshot capture
- pixel diff and heatmap generation
- JSON output contracts

### Phase 2

- spacing measurement
- border radius extraction
- font size and weight heuristics
- component clustering
- actionable diff reports

### Phase 3

- shadow and gradient detection
- font family ranking
- design token generation
- richer implementation guidance tuned for agents

### Phase 4

- benchmark suite over real screenshots
- automated iterative fix loop
- multi-screenshot support for responsive variants and interactive states

## Benchmarking Strategy

Success should be measured, not assumed.

Build a benchmark set of screenshots and score:

- pixel similarity
- spacing error distribution
- color delta
- font size error
- radius error
- component match accuracy

Without a benchmark suite, it will be difficult to know whether the tool is actually improving agent output.

## Recommended End-To-End Workflow

The most useful user and agent workflow likely looks like this:

1. User provides a target screenshot
2. Agent runs `one-shot-ui extract`
3. Agent implements the UI in code
4. Agent captures a screenshot of the implementation
5. Agent runs `one-shot-ui compare`
6. CLI returns structured issues and suggested fixes
7. Agent updates the implementation
8. Agent repeats until the implementation reaches a target match score

## Product Framing

The strongest product framing is:

> `one-shot-ui` is a deterministic vision and diff toolkit for AI agents building pixel-perfect frontends from screenshots.

This framing emphasizes the real moat:

- reliable structured extraction
- deterministic measurements
- repeatable diffing
- feedback loops for iterative refinement

It is stronger than positioning the project as just another screenshot-to-code tool.

## Suggested Next Design Steps

After this roadmap, the next useful artifacts to define would be:

1. the monorepo folder structure and package APIs
2. the JSON schemas for `extract` and `compare`
3. the MVP execution plan for the first two weeks
4. the agent integration model for tools like Cursor and Claude Code
