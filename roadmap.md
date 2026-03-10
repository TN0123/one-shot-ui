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

Use each tool for what it is best at. LLMs and deterministic pipelines have complementary strengths, and the system should combine them rather than relying on either alone.

LLMs are strong at:

- identifying what is in a screenshot: panels, sidebars, buttons, inputs, text blocks
- inferring layout strategy: CSS grid columns, flex direction, nesting hierarchy
- planning implementation: choosing components, naming tokens, structuring code
- interpreting ambiguous cases and generating code changes from structured data

LLMs are weak at:

- exact spacing measurement
- precise color extraction
- reliable radius and shadow estimation
- pixel-level visual comparison

Deterministic analysis is strong at:

- measuring exact pixel distances, colors, radii, and shadows within known regions
- comparing two images and quantifying their differences
- generating repeatable, stable, versioned outputs

Deterministic analysis is weak at:

- recovering semantic structure from raw pixels (distinguishing a button from a card from a sidebar)
- inferring layout strategy (CSS grid vs flexbox vs absolute positioning)
- understanding what a UI element is, as opposed to where it is

Because of this, `one-shot-ui` should let the LLM identify structure first, then use deterministic analysis to measure precisely within that structure. The compare loop should combine pixel-level diffing with DOM-level structural comparison.

## Core Capabilities

The CLI should revolve around three core engines:

1. `extract`: turns a screenshot into a structured UI specification
2. `compare`: compares a reference screenshot and an implementation screenshot
3. `guide`: presents agent-friendly JSON, diagnostics, and suggested fixes

These capabilities should enable an iterative workflow:

1. User provides the target screenshot
2. Agent runs `extract` to get structured measurements and color data
3. Agent uses its own visual understanding of the screenshot plus the extract data to plan the implementation
4. Agent implements the UI in code
5. Agent runs `capture` to screenshot its implementation
6. Agent runs `compare` to get structured issues and a heatmap
7. Agent patches code based on the highest-priority issues
8. Loop continues until the implementation reaches a target quality threshold

The key insight from agent testing is that step 3 is where the agent's visual reasoning matters most. The tool should provide precise measurements to support that reasoning, not try to replace it.

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
- `packages/dom-diff`
  - Playwright-based DOM extraction from implementation, structural comparison against extract output
- `packages/semantic-label`
  - optional LLM-assisted labeling of extracted regions with semantic names and component types
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
- LLM integrations should be optional but first-class: clearly separated behind adapter interfaces, never required for the core pipeline to run, but treated as valuable when available

A useful rule of thumb:

- geometry, spacing, color, radius, shadow, and diff logic should be deterministic
- structural identification (what is this element?), layout strategy inference (grid vs flex), semantic naming, and implementation planning should use model assistance when available
- the tool should degrade gracefully: without an LLM, it still provides measurements and pixel diffs; with an LLM, it also provides semantic structure and implementation plans

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

Agent testing across three phases revealed that the boundary between "what models should do" and "what deterministic analysis should do" was drawn too conservatively. The original assumption was that deterministic pixel analysis could recover semantic UI structure. In practice, flood-fill region detection cannot distinguish a button from a card from a sidebar. The model boundary should be redrawn.

Models should be the primary source of truth for:

- identifying what is in the screenshot: panels, sidebars, headers, buttons, inputs, icons, text blocks
- inferring layout strategy: "this is a 4-column CSS grid with columns 64px 322px 1fr 446px"
- naming components semantically: "region-8" should become "calendar-day-header-tuesday"
- planning the implementation approach: which CSS patterns, which component structure
- generating fix instructions from structured diff data

Models should not be the primary source of truth for:

- exact spacing measurements (use deterministic pixel measurement)
- precise color values (use region-based pixel sampling)
- border radii and shadow parameters (use pixel-level estimation)
- visual similarity scoring (use pixelmatch and perceptual hashing)
- pixel-level comparison (use bitmap diffing)

The ideal pipeline is: model identifies structure, deterministic tools measure within that structure, model generates code from the measurements.

## MVP Roadmap

Build the project in phases.

### Phase 1 (complete)

- CLI scaffold
- image loading and preprocessing
- dominant color extraction
- layout box detection
- OCR text extraction
- Playwright screenshot capture
- pixel diff and heatmap generation
- JSON output contracts

### Phase 2 (complete)

- spacing measurement
- border radius extraction
- font size and weight heuristics
- component clustering
- actionable diff reports

### Phase 3 (complete)

- shadow and gradient detection
- font family ranking
- design token generation
- `tokens` and `suggest-fixes` CLI commands
- CSS-specific fix guidance in compare output

### Phase 4: Semantic Understanding and Compare Quality

Phase 4 is a pivot point. Phases 1 through 3 built the deterministic measurement foundation. Phase 4 bridges the gap between raw pixel analysis and semantic UI understanding.

#### Compare engine noise reduction

The compare engine currently generates too many false positives. In agent testing, a typical compare produced 69 EXTRA_NODE issues alongside 13 real problems. The signal-to-noise ratio must improve.

- filter out EXTRA_NODE issues where the extra region is small and fully contained within a matched node (sub-element artifact)
- merge nearby small regions into their parent containers before comparison
- suppress issues below a configurable confidence threshold
- cap the issue list at a configurable maximum (default 20), sorted by severity and visual impact
- add a `--top N` flag to compare and suggest-fixes to control output volume

#### DOM-level comparison

Since implementations are HTML/CSS and the tool already uses Playwright, the compare engine should extract the actual DOM structure of the implementation and compare it against the reference extraction.

- use Playwright to query the implementation's computed styles, bounding boxes, and DOM tree
- compare DOM element positions and sizes against the reference extract's layout nodes
- generate issues in terms of CSS properties: "this element's margin-top is 16px but should be 24px" rather than "this pixel region is offset by 8px"
- output suggested fixes as CSS property changes, not absolute coordinates

#### Default-on OCR

Typography data is too important to be opt-in. OCR should be enabled by default.

- enable OCR by default and add `--no-ocr` flag to disable it
- improve OCR performance with image preprocessing: contrast enhancement, scaling to optimal DPI
- ensure font family ranking, font size tokens, and font weight tokens are populated in default runs

#### Semantic node labeling (optional LLM step)

Add an optional `--label` flag to the extract command that uses an LLM to label detected regions with semantic names and component types.

- send the screenshot and the detected layout nodes to an LLM
- receive back labels like "left-sidebar", "calendar-header", "task-list-item-3"
- attach labels to the extract output so that compare issues reference meaningful names
- keep this step optional: without an LLM key, the tool falls back to region-N identifiers
- define a typed `SemanticLabel` schema: `{ nodeId, label, componentType, confidence }`

#### Layout strategy detection

Add heuristics (and optionally LLM assistance) to infer the CSS layout strategy used in the reference.

- detect grid patterns: evenly spaced columns or rows, repeated column widths
- detect flex patterns: single-axis arrangement with consistent gaps
- detect sidebar patterns: narrow fixed-width column adjacent to a fluid column
- output a `layoutStrategy` field in the extract report: `{ type: "grid" | "flex" | "absolute", columns?, rows?, gaps? }`

### Phase 5: Tighter Iteration Loop

Phase 5 focuses on making the capture-compare-fix loop as tight and automated as possible.

#### Automated iterative fix loop

- add a `one-shot-ui loop` command that runs capture, compare, and outputs fixes in a single step
- support a `--threshold` flag: keep iterating (with agent intervention) until mismatch ratio drops below the target
- support a `--max-iterations` flag to prevent infinite loops
- output a summary of convergence across iterations: mismatch ratio at each step, issues fixed, issues remaining

#### Relative fix suggestions

Replace absolute pixel coordinates in suggested fixes with relative CSS adjustments.

- "increase gap between these siblings by 8px" instead of "move to (224, 480)"
- "set this element's width to match its sibling" instead of "set width to 168px"
- when DOM-level comparison is available, reference actual CSS properties and selectors

#### Region-of-interest comparison

Allow comparing specific regions rather than full screenshots.

- `one-shot-ui compare ref.png impl.png --region "left-sidebar"` to focus on a specific panel
- `one-shot-ui compare ref.png impl.png --crop "0,0,400,1000"` to focus on a pixel region
- reduces noise from unrelated parts of the UI during focused iteration

#### Multi-screenshot support

- compare multiple screenshots in a single run for responsive variants
- support interactive state screenshots: hover, focus, active, disabled
- aggregate issues across variants into a single report

### Phase 6: Benchmark Suite and Production Hardening

#### Benchmark suite

Build a benchmark set of real-world screenshots and score:

- pixel similarity (mismatch ratio)
- structural accuracy (how many semantic elements were correctly identified)
- measurement precision (spacing error, color delta, radius error, font size error)
- compare quality (signal-to-noise ratio of issues, false positive rate)
- convergence speed (how many iterations to reach target quality)

Track regressions across releases.

#### Real-world screenshot corpus

- collect 20 to 50 diverse screenshots: dashboards, landing pages, forms, settings panels, mobile UIs
- include light and dark themes
- include dense and sparse layouts
- include text-heavy and graphic-heavy UIs

#### Agent integration model

Define how `one-shot-ui` integrates with agent tools like Claude Code, Cursor, and Codex.

- MCP tool definitions for extract, compare, capture, and suggest-fixes
- prompt templates that structure the extract output for optimal agent consumption
- example agent workflows with step-by-step tool calls

## Benchmarking Strategy

Success should be measured, not assumed. The benchmark suite (Phase 6) should score along two axes:

### Extraction quality

- structural accuracy: how many real UI elements were detected and correctly bounded
- measurement precision: spacing error distribution, color delta, radius error, font size error
- semantic labeling accuracy (when LLM labeling is enabled): are labels correct?
- false positive rate: how many detected regions are noise?

### Compare and iteration quality

- signal-to-noise ratio of compare issues: real problems vs false positives
- convergence speed: how many capture-compare-fix iterations to reach a target mismatch ratio
- fix actionability: can an agent directly apply the suggested fix and see improvement?

Without a benchmark suite, it will be difficult to know whether the tool is actually improving agent output.

## Recommended End-To-End Workflow

The most useful workflow, informed by three phases of agent testing:

1. User provides a target screenshot
2. Agent runs `one-shot-ui extract --label` to get measurements and semantic labels
3. Agent runs `one-shot-ui tokens` to get the design token palette
4. Agent uses its own visual understanding of the screenshot, combined with the extract data and tokens, to plan the implementation (layout strategy, component structure, CSS approach)
5. Agent implements the UI in code
6. Agent runs `one-shot-ui capture` to screenshot its implementation
7. Agent runs `one-shot-ui compare` to get a focused list of high-priority issues with CSS fix suggestions
8. Agent applies fixes, prioritizing high-severity issues
9. Agent repeats steps 6 through 8 until the mismatch ratio drops below the target threshold

The critical insight is that step 4 is where the agent's visual reasoning adds the most value. The tool should support that reasoning with precise data, not try to replace it. The compare loop (steps 6 through 9) is the tool's strongest feature and should be as tight and low-noise as possible.

## Product Framing

The strongest product framing is:

> `one-shot-ui` is a measurement and comparison toolkit that helps AI agents build pixel-perfect frontends from screenshots through tight, structured feedback loops.

This framing emphasizes the real moat:

- precise deterministic measurements that complement the agent's visual reasoning
- a fast capture-compare-fix loop with actionable, low-noise issue reports
- structured outputs that give agents exact values instead of vague descriptions
- optional LLM-assisted semantic labeling that bridges pixels and meaning

The tool is not a replacement for the agent's visual understanding. It is a precision instrument that makes the agent's visual understanding actionable.

## Suggested Next Design Steps

The monorepo structure, JSON schemas, and CLI commands are implemented through Phase 3. The next useful artifacts to define would be:

1. the DOM-diff package API: what Playwright queries to run, what computed style properties to extract, how to match DOM elements to extract report nodes
2. the semantic labeling adapter interface: how to send screenshot and layout data to an LLM, what schema the labels should follow, how to handle the no-LLM fallback
3. the compare noise reduction strategy: specific heuristics for filtering EXTRA_NODE false positives, merging sub-element regions, and capping issue output
4. the benchmark corpus: which 20 to 50 screenshots to collect, how to score extraction and comparison quality, how to track regressions
5. the agent integration model: MCP tool definitions, prompt templates, and example workflows for Claude Code, Cursor, and Codex

## Lessons Learned From Phases 1 Through 3

These lessons, drawn from three rounds of agent testing, should inform all future development:

1. **The compare loop is the most valuable feature.** Agents consistently rated capture-compare-heatmap as the most useful workflow. Invest in making it faster, less noisy, and more actionable.

2. **Extract data supplements the agent's visual reasoning; it does not replace it.** Agents built UIs primarily from looking at the screenshot, not from the extract report. The extract data was most useful for precise color values and spacing measurements, not for understanding what the UI contains.

3. **Fewer, better issues beat comprehensive but noisy issue lists.** A compare report with 10 high-confidence, actionable issues is more useful than one with 100 issues where 70 are false positives. Prioritize precision over recall in issue generation.

4. **Absolute pixel coordinates are not actionable for CSS.** Agents work with flexbox, grid, padding, and margin. Fixes should be expressed in relative CSS terms, not absolute pixel positions.

5. **Semantic labels transform usability.** "Region-8" is meaningless. "Calendar day header for Tuesday" is immediately actionable. Even approximate semantic labeling dramatically improves the agent experience.

6. **OCR should be on by default.** Typography data is too important to be opt-in. Every agent that tested the tool noted the absence of text data as a significant limitation.

7. **Deterministic pixel analysis cannot recover semantic structure.** Flood-fill region detection, edge detection, and connected components cannot distinguish a button from a card from a sidebar. This is a hard ceiling of the current approach, not a tuning problem. Semantic understanding requires either LLM assistance or a fundamentally different CV approach.
