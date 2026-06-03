# Changelog

## 0.8.0 — Agent accuracy round

Fixes the most common ways an agent's clone drifts from the reference, all driven by
what an agent (the actual consumer of this tool) needs to act correctly.

### Scale / DPR normalization (the big one)
- `extract`/`tokens`/`plan` now accept `--dpr <n>` (CLI) / `dpr` (MCP). A 2× Retina/Mac
  screenshot used to report every measurement at double its CSS value (a 35px heading as
  70px), throwing off fonts, spacing and sizing together. Pass `--dpr 2` (or rely on
  conservative auto-detection) to get font sizes and bounds in **CSS pixels**.
- The `extract` compact report gains a `scale` block (`dpr`, `source`, `confidence`,
  `reason`, optional `scaleHint`), `units`, and `image.cssWidth/cssHeight`. Auto-detection
  is honest about confidence and never silently halves on a weak guess — it hints instead.

### Honest convergence verdict
- `compare` reports `summary.verdict` (`converged` / `not-converged`, with `reasons[]` and a
  `completeness` block) and the `--summary` line now **leads with the verdict**. This stops
  a background-dominated low `mismatchRatio` (e.g. 3.5% with most elements missing) from
  reading as "done."

### Richer, honest typography
- Deterministic monospace-vs-proportional detection from glyph-advance uniformity, surfaced
  as `typography.monospace` and used to rank `fontFamilyCandidates`.
- A `typographyNote` makes clear what is measured (size, weight, monospace) vs guessed
  (serif/sans, exact typeface), so font candidates aren't trusted blindly.

### macOS screenshot temp paths
- `extract`/`compare`/`tokens`/`plan`/`suggest-fixes` (CLI) and all MCP tools now detect a
  macOS screenshot floating-thumbnail temp path (`…/TemporaryItems/NSIRD_screencaptureui_*/`)
  that macOS has already moved to `~/Desktop`, and return a clear teaching message instead
  of a raw `sharp` stack trace.

### Known follow-ups
- Serif-vs-sans glyph classification and OCR-missed display-text region measurement are
  deferred (need font rendering in CI to verify to a trustworthy standard).
