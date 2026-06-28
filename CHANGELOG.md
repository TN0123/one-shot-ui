# Changelog

## 0.11.0 — style transfer: extract a design language, verify a new UI conforms

Until now the tool answered one question: *does this build match this exact screen?*
This release adds a second: *does this new UI belong to the same design language as this
screenshot?* — for when an agent is copying a UI's **style/aesthetic** onto different
content, not reproducing it pixel-for-pixel.

The guiding constraint: the calling agent is already a vision model. So the tool does
**not** classify mood, name semantic color roles, or call any VLM — it stays the
deterministic, hallucination-free *eyes*, and leaves the judgment calls to the agent.

### `tokens` now extracts a reusable `styleSystem`

Alongside the flat token list, `tokens` returns a structured system: the palette split
into neutrals vs accents (by saturation), the base spacing unit (chance-corrected grid
detection), the type-size scale and its modular ratio, and named radius/elevation scales.
Color roles are left unassigned and font family stays a low-confidence guess — those are
the agent's call. `--emit shadcn` / `--emit tailwind` / `--emit json` print paste-ready
variables (shadcn output scaffolds the role tokens as a TODO for the agent to fill).

### `one-shot-ui style-check <ref.png> <new-ui>` (also the `style_check` MCP tool)

The style-transfer analog of `compare`/`converge`: it diffs two extracted design
*systems*, not pixels (there's no pixel oracle when the layout differs). The new UI is
measured from **real computed CSS** when you pass an http(s) URL or HTML file (exact), or
from a screenshot as a lossy fallback — the reference is always a screenshot.

It is built to be honest about the screenshot↔DOM asymmetry: a screenshot yields a sparse,
noisy view (misses small accents, under-detects radii, false-detects shadows on dark UIs),
so comparing it value-for-value against an exact DOM would cry wolf on a faithful build.
Instead:

- **palette / spacing / typography** compare dominant *character* and drive the pass/fail
  verdict (high confidence): a new dominant brand hue, an incompatible spacing rhythm
  (a 4px grid is a harmonic of 8px — fine; a 5px rhythm is not), or a different type ratio.
- **radius / elevation** are reported as **advisories** when the reference is a raster,
  since a screenshot can't reliably ground them — they inform without failing the build.

Verified against the bundled dashboard fixture: the HTML that generated the reference PNG
**conforms** (with radius/elevation advisories), while off-brand palette and off-grid
spacing builds **drift** on the high-confidence dimensions.

## 0.10.0 — `converge`: closed-loop pixel-verified CSS optimization

The step change. Every release since 0.6 made the tool's *estimates* better, and agent
builds still plateaued at ~2–5% mismatch — because estimating CSS from flat pixels is the
ceiling, and the "converged" verdict fired right where the last mile begins. Ground-truth
probe that drove this release: a build with 6 planted CSS bugs (padding, font-size, gap,
two colors, radius) scored 2.08% / `converged`, and `suggest-fixes` recovered **0/6** —
phantom 224px offsets, no selectors, no color or font fixes.

### `one-shot-ui converge <reference.png> --impl <html|url>` (also an MCP tool)

The unexploited asset: the tool already holds the implementation open in a Chromium it
controls, where it can *try* any CSS change and *measure* the true pixel result in
~150ms. `converge` automates that loop:

- **DOM inventory** with verified-unique selectors (`#id` / class chains / nth-of-type).
- **Mutual-best matching** of elements to reference regions (one-to-one by IoU, so a row
  container can never steal its child's region) + overlap-based OCR text attachment.
- **Candidates seeded from measurements, accepted only by pixels**: geometry from region
  deltas; container padding/gap inferred from children's uniform offsets (fix the cause,
  not N per-child margins); **exact surface colors pixel-sampled from the reference**
  under each element (bypasses quantized extract fills); font size/weight from OCR;
  radii from extract. Same-class elements that agree get one grouped rule
  (`td { padding-top: 14px }`) instead of 20 `nth-of-type` patches.
- **Greedy multi-pass search with strict acceptance**: a candidate is kept only if raw
  pixel mismatch (pixelmatch at threshold 0.02 — sensitive enough to see dark-theme color
  drift that 0.12 is blind to) drops by ≥8px; numeric values get a ±1/±2/±4 line search;
  rejections are retried in later passes (a position fix may only pay off after a color
  fix lands). The search stops only when a full pass accepts nothing.
- **Output an agent can trust blindly**: a verified `patch.css` (every declaration
  annotated with its measured pixel gain), a `missingStructure[]` list of reference
  regions no element covers (converge never invents elements — that's the agent's half),
  and an honest verdict: `pixel-converged`, `css-exhausted`, or `budget-exhausted`.

### Verified against ground truth

- Synthetic fixture, 6 planted bugs: **0.000% final mismatch — zero mismatched pixels** —
  with every planted value recovered exactly (`padding: 24px`, `gap: 16px`, `#1C1D26`,
  `#A78BFA`, `font-size: 28px`, `border-radius: 12px`), and **zero churn** on an
  already-perfect build (regression test, both in CI:
  `packages/optimizer/src/converge.integration.test.ts`).
- Real dashboard + the same 6 bugs `suggest-fixes` scored 0/6 on: **48.2% → 5.0%** raw
  mismatch (strict 0.02 objective), with the exact card-surface hex (`#1C1D26`) recovered
  by pixel sampling in one grouped rule (−486K px).
- A real agent build that the old verdict had blessed as "converged" (strict mismatch
  actually 28.7%): **28.7% → 8.9%** via 71 verified fixes — exact sidebar/panel surfaces,
  brand purple, all five status-pill and avatar colors, pill geometry — leaving only
  font-rendering AA, SVG chart internals, and structural gaps (reported in
  `missingStructure[]`), none of which CSS can fix. The patched build is visually
  indistinguishable from the reference at a glance.

### Guidance

`AGENTS.md` + the Claude Code skill now prescribe: extract → build structure → converge →
fold patch into source → build `missingStructure[]` → re-converge until `pixel-converged`.

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
