# Phase 6 Agent Feedback

Date: March 10, 2026

## What I implemented

- Added a Phase 6 `benchmark` CLI command.
- Added benchmark schemas and report output for mismatch ratio, planning usefulness, typography reliability, anchor coverage, ROI reliability, and DOM selector issue ratio.
- Added a standing benchmark manifest at `benchmarks/phase6-manifest.json` with the Phase 5 dashboard fixture.
- Added ROI compare hardening so `compare --region` now falls back to scoped pixel-only output when semantic coverage inside the requested panel is too thin.
- Added Phase 6 docs for benchmark usage and agent integration templates.

## How I tested the CLI

I rebuilt a new implementation from scratch in:

- `testing/out/index.html`
- `testing/out/styles.css`

I used the CLI to guide the rebuild from `testing/out/reference.png`.

Commands used:

```bash
bun packages/cli/src/index.ts plan testing/out/reference.png --no-ocr
bun packages/cli/src/index.ts tokens testing/out/reference.png --no-ocr
bun packages/cli/src/index.ts extract testing/out/reference.png --no-ocr --json
bun packages/cli/src/index.ts capture --file testing/out/index.html --output testing/out/phase6-agent-build.png --width 3420 --height 1908
bun packages/cli/src/index.ts compare testing/out/reference.png testing/out/phase6-agent-build.png --no-ocr --top 12
bun packages/cli/src/index.ts compare testing/out/reference.png testing/out/phase6-agent-build.png --no-ocr --region "summary panel" --top 8
bun packages/cli/src/index.ts suggest-fixes testing/out/reference.png testing/out/phase6-agent-build.png --no-ocr --top 10
bun packages/cli/src/index.ts compare testing/out/reference.png testing/out/phase6-agent-build.png --no-ocr --json --dom-diff testing/out/index.html
bun packages/cli/src/index.ts benchmark benchmarks/phase6-manifest.json --json
```

`capture` and DOM-aware benchmark/compare required Playwright escalation again.

## Measured results

### Fresh rebuild in `testing/out`

- Full-page mismatch ratio: `1.81%`
- Region compare on `summary panel`: `2.19%`

### Phase 6 benchmark manifest

- Comparable cases: `1`
- Average mismatch ratio: `1.55%`
- Average planning usefulness: `70%`
- Average anchor coverage: `0%`
- Average ROI reliability: `41.67%`
- Average DOM selector issue ratio: `0%`

## Response to Phase 5 feedback

### 1. Add a benchmark case for the dashboard screenshot

Implemented.

- The standing benchmark case now exists in `benchmarks/phase6-manifest.json`.
- The new `benchmark` command reports anchor coverage, ROI fallback behavior, and DOM usefulness explicitly.

### 2. Make region compare fall back to pixel-only scoped output when semantic coverage is thin

Implemented and verified.

- `compare --region "summary panel"` now returns a `REGION_SEMANTIC_FALLBACK` issue instead of pretending the semantic issue list is trustworthy.
- On this fixture, the new fallback surfaced: semantic coverage was `0.0%` with `0` real anchors in the region.

### 3. Strengthen DOM matching so DOM-aware compare prefers selectors/components

Not solved yet.

- DOM-aware compare on the fresh `testing/out` rebuild still produced no useful `DOM_*` issues.
- The Phase 6 benchmark also scored DOM selector issue ratio at `0%`.
- This confirms the Phase 5 concern instead of resolving it.

### 4. Improve reference-side panel detection so major sections are discovered from the image

Not solved yet, but now measured explicitly.

- Anchor coverage on the standing benchmark is still `0%` real anchors and `100%` synthetic shell anchors.
- This is useful progress in Phase 6 because the weakness is now visible in benchmark output, but the extraction quality itself did not materially improve.

## What worked well in practice

- `plan` remains useful for first-pass shell reconstruction. It was enough to scaffold the left rail, task list, calendar board, and summary panel quickly.
- `tokens` gave a workable dark palette immediately.
- The new ROI fallback behavior is materially better than Phase 5 behavior because it avoids misleading panel-local semantic fixes when the anchor set is weak.
- The benchmark output is concise and usable. It gives a release-level signal instead of forcing manual interpretation of one-off compare runs.

## Current gaps

- The extractor is still not finding real panel anchors on this reference. Benchmarking exposes the problem, but does not fix it.
- DOM-aware compare still fails to justify itself as the default explanation layer.
- Typography is still effectively absent on this reference when OCR is disabled, and the benchmark correctly records that as `0`.
- The fresh rebuild loop is usable, but the compare output still overweights tiny detected regions and misses the page-scale shell in a way an implementer actually thinks about.

## Recommendation for the next phase

The highest-value next step is still reference understanding, not more output surface area.

- Improve real panel detection so benchmark anchor coverage can move off zero.
- Use the new benchmark suite to gate ROI and DOM changes instead of shipping them by intuition.
- Treat DOM compare as experimental until selector-bearing issues start showing up consistently on the standing fixture.
