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

### Phase 4 (complete)

Phase 4 is a pivot point. Phases 1 through 3 built the deterministic measurement foundation. Phase 4 validated that the capture-compare-heatmap loop is the strongest part of the product, but it also showed that semantic understanding and implementation-aware guidance are still the main gaps.

The clearest takeaways from the Phase 4 build are:

- the compare loop is already useful in real agent workflows
- DOM-aware output does not yet beat the visual compare loop in practice
- issue phrasing is still too tied to anonymous regions instead of page structure
- fix suggestions still need to move from coordinates to CSS/layout language
- first-pass screenshot understanding is still not strong enough to drive implementation planning

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

### Phase 5: Semantic Iteration Loop

Phase 5 should lean into what Phase 4 proved: the product is most valuable once an implementation exists. The goal is not just a tighter loop, but a loop that speaks in implementation terms and can guide an agent with minimal interpretation overhead.

Phase 5 feedback sharpened that direction. Agent testing on a rebuilt dashboard fixture showed that the loop is now usable in the happy path, but it also exposed a clearer priority order:

- the new `plan` command is already useful for fast page-shell understanding
- semantic anchors improve issue naming and make region selection usable
- relative fix phrasing is more actionable than absolute coordinates
- sparse reference extraction is still the main bottleneck underneath the new semantics
- DOM-aware compare still has not clearly surpassed the pixel/layout loop on real fixtures

In other words, Phase 5 improved the interface to the loop more than the underlying reference understanding. The roadmap should treat that as a reprioritization signal, not just a progress note.

#### Semantic issue naming and page anchors

- replace `region-N` issue references with semantic names tied to page structure
- issue output should reference UI areas such as "left rail", "task list", "calendar Tuesday column", or "summary composer"
- add stable semantic anchors so the same part of the page is referred to consistently across iterations
- include relationship context in issues: parent panel, sibling group, row, column, or component role
- keep synthetic shell anchors as a fallback for sparse extracts, but treat them as a temporary stabilization layer rather than a substitute for real reference-side panel detection
- prioritize better image-derived section and panel detection so major page regions are discovered from the screenshot itself

#### DOM-first compare output

- when an implementation DOM is available, use DOM-aware comparison as an explanation layer that must earn its default status through benchmarked actionability
- match DOM elements to semantic reference nodes and only promote DOM-led issues when selector and component matching are strong enough to beat raw region output
- express issues in CSS/layout terms: size, alignment, gap, distribution, hierarchy, and typography
- strengthen selector prioritization and DOM-to-reference matching before expanding more DOM-specific surface area in the CLI
- keep the pixel/layout diff as the reliability baseline until DOM-aware output consistently produces more useful issues on benchmark fixtures

#### Relative fix suggestions

Replace absolute pixel coordinates in suggested fixes with relative CSS adjustments.

- "increase gap between these siblings by 8px" instead of "move to (224, 480)"
- "reduce the selected task row height" instead of "set height to 54px"
- "narrow the highlighted weekday column" instead of "set width to 168px"
- when DOM-level comparison is available, reference actual selectors, components, and CSS properties
- preserve relative phrasing even when the issue originates from a pixel/layout diff so the guidance remains implementation-oriented

#### Implementation planning report

- add a planning step before code generation that outputs an implementation-oriented page structure
- produce a panel/component tree, inferred layout strategy, likely CSS primitives, and important repeated patterns
- summarize which areas are likely grid, flex, layered, scrollable, or text-heavy
- make the planning report a first-class input to agent code generation rather than a side effect of extraction
- treat fast page-shell understanding as the primary success criterion for `plan`; the first job is to help an agent scaffold the page correctly, not to emit exhaustive detail

#### Typography and OCR robustness

- improve OCR preprocessing and text grouping so typography survives real screenshots
- extract text hierarchy, line-height, alignment, and likely emphasis patterns with confidence scores
- surface when typography data is weak so agents know when they must rely more on visual judgment
- prioritize text-heavy screenshots in validation, since typography weakness blocks first-pass planning
- treat weak typography extraction as a planning blocker, not just a polish gap, because it limits implementation-oriented first-pass guidance

#### Region-of-interest comparison

Allow comparing specific regions rather than full screenshots.

- `one-shot-ui compare ref.png impl.png --region "left-sidebar"` to focus on a specific panel
- `one-shot-ui compare ref.png impl.png --crop "0,0,400,1000"` to focus on a pixel region
- allow region names to come from semantic anchors, not just coordinates
- reduce noise from unrelated parts of the UI during focused iteration
- when semantic node coverage inside the selected region is thin, fall back to pixel-only scoped output instead of pretending the semantic issue list is trustworthy

### Phase 6: Benchmark Suite and Production Hardening

#### Benchmark suite

Build a benchmark set of real-world screenshots and score:

- pixel similarity (mismatch ratio)
- structural accuracy (how many semantic elements were correctly identified)
- measurement precision (spacing error, color delta, radius error, font size error)
- compare quality (signal-to-noise ratio of issues, false positive rate)
- convergence speed (how many iterations to reach target quality)
- semantic issue quality (does the issue phrasing match how an implementer thinks about the page?)
- DOM diff usefulness (does DOM-aware output produce more directly actionable fixes than region output?)
- planning usefulness (can an agent form a better first-pass implementation plan from the report?)
- typography reliability (does text extraction hold up on dense, real-world screenshots?)
- anchor coverage (how much of the page is covered by real extracted anchors versus synthetic fallback anchors?)
- ROI compare reliability (when region compare is used, how often do the returned issues stay inside the intended panel and remain actionable?)

Track regressions across releases.

#### Real-world screenshot corpus

- collect 20 to 50 diverse screenshots: dashboards, landing pages, forms, settings panels, mobile UIs
- include light and dark themes
- include dense and sparse layouts
- include text-heavy and graphic-heavy UIs
- include the Phase 5 dashboard fixture as a standing benchmark case so anchor coverage, region compare quality, and DOM issue usefulness can be measured explicitly over time

#### Agent integration model

Define how `one-shot-ui` integrates with agent tools like Claude Code, Cursor, and Codex.

- MCP tool definitions for extract, compare, capture, and suggest-fixes
- prompt templates that structure the extract output for optimal agent consumption
- prompt templates for the planning report and semantic issue schema
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

The most useful workflow, informed by five phases of agent testing:

1. User provides a target screenshot
2. Agent runs `one-shot-ui extract --label` to get measurements and semantic labels
3. Agent runs the planning step to get an implementation-oriented page structure
4. Agent runs `one-shot-ui tokens` to get the design token palette
5. Agent uses its own visual understanding of the screenshot, combined with the planning output and tokens, to plan the implementation
6. Agent implements the UI in code
7. Agent runs `one-shot-ui capture` to screenshot its implementation
8. Agent runs `one-shot-ui compare` to get a focused list of high-priority semantic issues with relative CSS/layout fix suggestions
9. Agent applies fixes, prioritizing high-severity issues
10. Agent repeats steps 7 through 9 until the mismatch ratio drops below the target threshold

The critical insight is that the planning step should support the agent's visual reasoning before code exists, while the compare loop should dominate once code exists. The tool should support both stages, but the compare loop is already the strongest feature and should remain the center of gravity.

## Product Framing

The strongest product framing is:

> `one-shot-ui` is an implementation-aware comparison and planning toolkit that helps AI agents build pixel-perfect frontends from screenshots through tight, structured feedback loops.

This framing emphasizes the real moat:

- precise deterministic measurements that complement the agent's visual reasoning
- a fast capture-compare-fix loop with actionable, low-noise, implementation-oriented issue reports
- structured outputs that help agents form better first-pass implementation plans
- semantic labels and DOM-aware explanations that bridge pixels and meaning

The tool is not a replacement for the agent's visual understanding. It is a precision instrument that makes the agent's visual understanding actionable.

## Suggested Next Design Steps

The monorepo structure, JSON schemas, and CLI commands are implemented through Phase 5. The next useful artifacts to define would be:

1. the reference anchor coverage benchmark: how to score real extracted panel coverage versus synthetic fallback anchors on representative screenshots
2. the ROI compare fallback contract: when `--region` should produce semantic issues, when it should degrade to scoped pixel output, and how confidence should be surfaced
3. the DOM-diff package API: what Playwright queries to run, what computed style properties to extract, how to match DOM elements to semantic reference nodes, and what threshold is required before DOM-led output becomes default
4. the planning report schema: panel tree, layout strategy, repeated structures, typography summary, and implementation hints tuned for page-shell reconstruction
5. the typography confidence pipeline: OCR preprocessing, text grouping, hierarchy extraction, and confidence scoring
6. the benchmark corpus and scoring model: which 20 to 50 screenshots to collect, how to score planning usefulness, ROI compare quality, anchor coverage, and DOM diff usefulness, and how to track regressions

## Lessons Learned From Phases 1 Through 5

These lessons, drawn from five rounds of agent testing, should inform all future development:

1. **The compare loop is the most valuable feature.** Agents consistently rated capture-compare-heatmap as the most useful workflow. Invest in making it faster, less noisy, and more actionable.

2. **Extract data supplements the agent's visual reasoning; it does not replace it.** Agents built UIs primarily from looking at the screenshot, not from the extract report. The extract data was most useful for precise color values and spacing measurements, not for understanding what the UI contains.

3. **Fewer, better issues beat comprehensive but noisy issue lists.** A compare report with 10 high-confidence, actionable issues is more useful than one with 100 issues where 70 are false positives. Prioritize precision over recall in issue generation.

4. **Absolute pixel coordinates are not actionable for CSS.** Agents work with flexbox, grid, padding, and margin. Fixes should be expressed in relative CSS terms, not absolute pixel positions.

5. **Semantic labels transform usability.** "Region-8" is meaningless. "Calendar day header for Tuesday" is immediately actionable. Even approximate semantic labeling dramatically improves the agent experience.

6. **OCR should be on by default.** Typography data is too important to be opt-in. Every agent that tested the tool noted the absence of text data as a significant limitation.

7. **Deterministic pixel analysis cannot recover semantic structure.** Flood-fill region detection, edge detection, and connected components cannot distinguish a button from a card from a sidebar. This is a hard ceiling of the current approach, not a tuning problem. Semantic understanding requires either LLM assistance or a fundamentally different CV approach.

8. **DOM-aware iteration must earn its complexity.** DOM diff is promising, but if it does not produce clearly more actionable fixes than the heatmap-driven compare loop, agents will ignore it.

9. **Implementation planning is a separate product need from iteration.** Agents can iterate toward a screenshot today, but they still need better first-pass page structure before they can build efficiently.

10. **Typography is part of structure, not just styling.** Weak text extraction does not only hurt polish. It also damages hierarchy detection, spacing judgment, and first-pass implementation planning.

11. **Synthetic anchors are a bridge, not the destination.** They make naming and region selection usable on sparse extracts, but they do not solve the underlying problem of weak screenshot-derived structure.

12. **Region compare needs confidence-aware fallback behavior.** A named region is only helpful if the node coverage inside it is credible. When semantic coverage is thin, scoped pixel output is more honest and often more useful.

13. **The planning step should optimize for shell reconstruction first.** Agents get disproportionate value from quickly understanding the main panels, grid columns, toolbars, and repeated primitives before they start coding.
