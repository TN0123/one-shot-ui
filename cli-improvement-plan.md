# CLI Improvement Plan

This plan is based on a full dogfooding pass on March 14, 2026 using the `one-shot-ui` CLI against a public dashboard screenshot and rebuilding the result in `testing/online-scaffold`.

## Goals

- Make the default screenshot-to-implementation workflow reliable on real-world reference images.
- Improve the quality of scaffold output so it is meaningfully closer to a usable first draft.
- Make compare results easier for agents to turn into concrete edits.
- Reduce friction in the iterative capture and compare loop.

## Current Pain Points

1. Extraction can fail on valid screenshots due to schema-invalid color output.
2. Scaffold output is too coarse and loses the actual composition of the reference.
3. Compare output over-focuses on low-level missing regions instead of actionable implementation fixes.
4. The orchestration loop does not apply changes, so the end-to-end story is incomplete.
5. Charts, avatars, icons, and decorative panels are not represented strongly enough in planning/scaffolding.

## Workstreams

## 1. Stabilize Color and Schema Handling

### Problem

Quantized or sampled colors can exceed expected channel bounds and produce invalid hex strings, which breaks `extract`, `plan`, `tokens`, and `scaffold` on otherwise valid inputs.

### Actions

- Clamp all RGB channel values at shared color conversion boundaries.
- Add schema-focused tests for bright, near-white, and high-contrast screenshots.
- Add a defensive normalization pass before final report validation.
- Emit a warning when a value had to be normalized instead of failing hard where possible.

### Success Criteria

- `extract`, `plan`, `tokens`, and `scaffold` succeed on bright screenshots without manual fixes.
- No invalid color strings appear in report JSON.

## 2. Improve Scaffold Fidelity

### Problem

Current scaffold output captures palette fragments and some regions, but it does not preserve layout structure well enough to serve as a usable first implementation.

### Actions

- Preserve absolute or relative placement from detected bounds instead of outputting generic stacked boxes.
- Group detected nodes into higher-level sections such as sidebar, hero/chart panel, metrics row, and CTA panel.
- Use semantic anchors to generate nested sections instead of flat item lists.
- Emit placeholder text/content blocks when text structure is known.
- Generate stronger CSS for rounded panels, shadows, repeated cards, and chart containers.
- Add an option such as `scaffold --mode absolute|structured` to support both precise and semantic output.

### Success Criteria

- Scaffold output visually resembles the reference at a glance before manual editing.
- A human or agent can refine the scaffold instead of replacing it.

## 3. Make Compare More Actionable

### Problem

Compare reports identify mismatch, but too many issues are low-level region misses rather than edit-ready implementation guidance.

### Actions

- Add issue grouping so related regional misses collapse into one higher-level fix.
- Prioritize section-level findings over tiny child-node findings by default.
- Include clearer CSS/layout suggestions such as padding, gap, size, color, and radius deltas.
- Add a “top edit candidates” block to compare output with the smallest useful set of next changes.
- Allow compare output to reference scaffold selectors or DOM selectors directly when available.

### Success Criteria

- The first screenful of compare output suggests a small number of high-leverage changes.
- Agents can act on compare output without manually reinterpreting many low-level nodes.

## 4. Strengthen Planning for Real UI Primitives

### Problem

The system recognizes regions, but it still under-models charts, avatars, icons, and decorative/image-like surfaces that are common in dashboard screenshots.

### Actions

- Improve primitive classification for charts, profile images, icon buttons, stat cards, and decorative CTA tiles.
- Detect repeated card families and carry that into scaffold generation.
- Add chart-specific planning hints for line paths, markers, labels, and overlays.
- Add asset strategies for “draw as CSS”, “use placeholder image”, and “treat as decorative background”.

### Success Criteria

- Plans and scaffolds capture charts and repeated metric cards as first-class structures.
- Less manual interpretation is needed for common dashboard layouts.

## 5. Close the Loop in `run`

### Problem

`run` currently orchestrates capture and compare, but it does not produce or apply implementation edits, so the loop is incomplete.

### Actions

- Define a machine-readable patch/suggestion format that downstream agents can consume directly.
- Add an adapter layer so `run` can hand off compare suggestions to an external editing agent.
- Write per-pass “next actions” artifacts alongside heatmaps and reports.
- Add convergence summaries that explain whether progress is real or stalled.

### Success Criteria

- `run` produces artifacts that another agent can use directly for editing.
- Multi-pass sessions become meaningfully more automated.

## 6. Improve Dogfooding and Regression Coverage

### Problem

The CLI needs stronger coverage from real screenshots and real reconstruction attempts, not only synthetic or narrow fixtures.

### Actions

- Add a small benchmark set of public UI screenshots with varied brightness and layout styles.
- Save scaffold output, refined implementation, capture, and compare report for each benchmark case.
- Track not only mismatch ratio, but also scaffold usability and issue quality.
- Add one dogfooding checklist for agents using the tool end-to-end.

### Success Criteria

- Regressions in extract/scaffold/compare quality are caught earlier.
- The benchmark set reflects real usage rather than idealized cases.

## Suggested Delivery Order

1. Stabilize color and schema handling.
2. Improve scaffold fidelity enough to make the first draft usable.
3. Make compare output more actionable and selector-aware.
4. Strengthen primitive detection for charts/cards/assets.
5. Extend `run` with machine-readable next-edit artifacts.
6. Expand benchmarks and dogfooding coverage.

## Immediate Next Tasks

- Add tests around color normalization and invalid hex prevention.
- Run `scaffold` on three real screenshots and document where structure is lost.
- Design a new compare response shape for grouped, section-level edit suggestions.
- Prototype a higher-fidelity scaffold mode using detected bounds plus semantic anchors.
