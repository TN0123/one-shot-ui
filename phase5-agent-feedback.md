# Phase 5 Agent Feedback

Date: March 10, 2026

## What I tested

I rebuilt `testing/impl/index.html` and `testing/impl/styles.css` from scratch, then used the local CLI loop against `testing/out/reference.png`.

Commands used:

```bash
bun packages/cli/src/index.ts plan testing/out/reference.png --no-ocr
bun packages/cli/src/index.ts extract testing/out/reference.png --no-ocr
bun packages/cli/src/index.ts capture --file testing/impl/index.html --output testing/out/impl-phase5.png --width 3420 --height 1908
bun packages/cli/src/index.ts compare testing/out/reference.png testing/out/impl-phase5.png --no-ocr --top 12
bun packages/cli/src/index.ts compare testing/out/reference.png testing/out/impl-phase5.png --no-ocr --region "summary panel" --top 8
bun packages/cli/src/index.ts suggest-fixes testing/out/reference.png testing/out/impl-phase5.png --no-ocr --top 12
bun packages/cli/src/index.ts compare testing/out/reference.png testing/out/impl-phase5.png --no-ocr --json --dom-diff testing/impl/index.html
```

`capture` and DOM-aware `compare` needed sandbox escalation because Playwright Chromium could not launch inside the sandbox.

## What worked

- The new `plan` command is useful. It gave a fast page-shell read: grid shell, grid calendar columns, flex toolbars, repeated icon buttons.
- Compare and suggest-fixes now read better than raw `region-N` output in the happy path. Relative fixes like "move it left by 72px" are more usable than absolute coordinates.
- Semantic anchors now exist as first-class data, and `--region` accepts names like `summary panel`.
- The rebuilt implementation captured successfully through the CLI and produced a low mismatch screenshot on first pass.

## Measured results

- Full-page compare mismatch ratio: `1.55%`
- Region compare on `summary panel`: `1.38%`

## Gaps I hit during the test

- The reference extractor still only detects a narrow subset of the page as concrete layout nodes on this screenshot. Without the synthetic shell anchors I added, the anchor set collapsed almost entirely to the rail.
- Region-of-interest compare is only partially successful right now. The region name resolves, but the underlying node set inside that region is still weak, so the issue list can still drift toward unrelated anchors.
- DOM-first compare is not yet clearly beating the pixel/layout diff on this test. The JSON output did not surface meaningful `DOM_*` issues for the rebuilt fixture, so the DOM path still needs stronger matching and/or selector prioritization.
- Synthetic shell anchors make Phase 5 usable on sparse extracts, but they are heuristic. They stabilize naming; they do not fix the underlying extraction quality problem.
- Typography remains weak on this reference image with OCR disabled. The warning surfaced correctly, but this is still a blocker for truly implementation-oriented first-pass guidance on text-heavy screenshots.

## Recommended follow-up

- Improve reference-side panel detection so major sections are discovered from the image rather than synthesized.
- Make region compare fall back to pixel-only scoped output when semantic node coverage inside the selected region is thin.
- Strengthen DOM matching so `compare --dom-diff` prefers selectors/components over raw image regions whenever the DOM exists.
- Add a benchmark case for this dashboard screenshot so anchor coverage, ROI compare quality, and DOM issue usefulness can be scored explicitly.
