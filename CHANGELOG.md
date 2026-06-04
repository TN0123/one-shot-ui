# Changelog

## 0.9.0 — Sizing/spacing & icons round

Closes the "last mile" that left agent clones ~95% right: exact sizing/spacing and icons.
Driven by a real session where an agent converged a GitHub-profile clone to ~5.7% but had to
**abandon the tool and write its own pixel-projection scripts** to recover the geometry
(top-bar height, column edges, grid stride) the tool didn't surface.

### Deterministic projection "rulers" (the big one)
- `extract` now reports a `rulers` block: background-zone **band heights** (e.g. the exact
  top-bar/nav height + its background hex), content **columns** (left edges + widths), and
  **gutters** (gaps between columns) — all in CSS px. Build to these instead of eyeballing
  geometry or hand-rolling projection scripts.
- `compare` now returns a `spacing[]` array of high-trust, directly-CSS-able deltas —
  `BAND_HEIGHT_DELTA`, `EDGE_X_DELTA`, `GUTTER_DELTA` — each with a concrete fix
  ("Reduce its height/padding by 11px"). `compare --spacing` prints just this list, and the
  `--summary` line surfaces the largest delta. These replace the fuzzy "node N offset by Npx".

### `--match-reference` now handles DPR (bug fix)
- `capture --match-reference` used to set the viewport to the reference's **raw** pixel size
  while leaving the device scale at 1, so a 2× Retina reference rendered everything
  double-size and forced re-capture + cropping. It now captures at CSS dimensions @ the
  reference's DPR, so the pixel sizes line up and `compare` needs no resize. New
  `--reference-dpr <n>` overrides auto-detection; the capture reports its detected DPR and
  hints when it's a guess.

### Icons
- Guidance across the skill + `AGENTS.md`: don't hand-draw glyphs (the most common residual
  diff) — use an icon library (the codebase's set, else `lucide`; `@primer/octicons` for
  GitHub-style UIs). A tested icon-region detector (`detectIconCandidates`) ships as an
  internal primitive; a single-image icon list is intentionally **not** surfaced because
  pixel-only detection either floods with text glyphs or hides real icons.

### Capture height-overflow guard
- `capture --match-reference` matches the viewport WIDTH; a full-page capture grows to fit
  content. It now warns loudly when the captured height differs from the reference height
  (a taller/shorter build silently offsets every pixel diff below the overflow).

### Verified by an agent-as-user test
- An agent rebuilt the GitHub-profile reference using only these features: the `rulers`
  mapped directly to its sidebar/main/year columns and gutters (no hand-rolled pixel
  scripts), the Octicons guidance made every icon pixel-match, and `--match-reference`
  produced a correctly-scaled capture first try.

### Known follow-ups (surfaced by the agent test, mostly pre-existing)
- `compare`'s `POSITION_MISMATCH`/`SIZE_MISMATCH` issues still anchor to OCR text (e.g.
  "main-content oo, mon a a") and can emit implausibly large phantom deltas on dynamic
  regions (contribution graphs, avatars) while flagged actionable. The new `spacing[]`
  channel is the high-trust path; these older per-node deltas should be down-ranked or
  marked non-actionable on photographic content (the same logic already applied to COLOR).
- `spacing[]` covers page-level bands/columns/gutters, not yet per-component spacing, so it
  can empty out while finer geometry remains.
- `gridStructure` (flat raw-pixel arrays) remains low-signal next to `rulers`.

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
