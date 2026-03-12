# one-shot-ui Roadmap

## Completed

- **Generic semantic analysis** — Replaced hardcoded dashboard-specific heuristics (left rail, task list, calendar board, summary panel) with position/proportion-based classification that works for any layout (header, sidebar, main-content, footer, nav-rail, etc.).

## Planned Improvements

### 1. Hierarchical layout detection

The current flood-fill at 8px grid resolution produces a flat list of regions. Real UIs are deeply nested — a product card contains an image, title, price, rating, and button. Without hierarchy, agents can't reason about components.

- Detect nested bounding boxes, not just a flat list
- Build a tree structure: page → sections → cards → elements
- Lower the minimum region size to catch fine details (thin dividers, badges, small icons)
- Use containment relationships to establish parent-child nesting automatically

### 2. Concrete code scaffold generation

The plan command outputs abstract guidance ("CSS grid for the page layout") but no actual code. Agents perform much better when given a starting skeleton.

- Generate an HTML/CSS skeleton from the implementation plan with positioned containers
- Include extracted colors, spacing tokens, and border-radius values inline
- Provide a React component tree option (`--react`) that outputs a component hierarchy with props and layout styles
- The scaffold should be a valid, renderable starting point — not just pseudocode

### 3. React / component-level output

Everything is currently oriented toward flat HTML/CSS. For React output, the tool needs component awareness.

- Identify component boundaries from repeated patterns and visual clustering
- Suggest a component tree with names derived from semantic anchors
- Output props interfaces based on varying content within repeated components
- Generate a file structure suggestion (which components go in which files)

### 4. Leverage the agent's own vision model

Instead of trying to extract everything deterministically from pixels (which is fundamentally limited), structure outputs as annotations that augment what the agent already sees in the screenshot.

- The agent's LLM vision understands UI semantics better than flood-fill — lean into that
- Focus CLI output on precise measurements (exact pixel positions, colors, spacing values) that vision models are bad at
- Provide a structured overlay/annotation format the agent can cross-reference with the screenshot
- Consider an optional LLM-assisted extraction mode that uses a vision model for semantic understanding and the deterministic pipeline for precise measurements

### 5. Multi-pass orchestration mode

For pixel-perfect results, a single plan-build-compare cycle isn't enough. Progressive refinement is needed.

- Add a `run` command that manages the full loop: plan → scaffold → capture → compare → fix → capture → compare
- Automatic region drill-down: after the first pass fixes major layout issues, zoom into each section for fine-grained comparison
- Configurable convergence threshold (e.g., stop when mismatch ratio < 2%)
- Output a session log so agents can track what was tried and what worked

### 6. Improved compare granularity

Issue reports reference node IDs but don't show the agent exactly where the problem is visually.

- Crop the heatmap into per-region diffs and include them in the issue report
- Add bounding box coordinates and dimensions to every issue so agents know the exact area
- Support side-by-side cropped comparison (reference region vs implementation region)
- Weight issues by visual area — a 2px color mismatch on a 500px banner matters more than on a 10px divider

### 7. Image and asset awareness

The tool detects colored rectangles but has no concept of images, icons, or SVGs. For real-world pages, assets are a huge part of visual fidelity.

- Detect image regions (areas with high pixel variance that aren't text)
- Distinguish between decorative images, product photos, icons, and logos
- Suggest placeholder strategies (solid color, gradient, or placeholder image service)
- Extract icon shapes for SVG approximation where possible

### 8. Better typography extraction

Font size is estimated as `blockHeight * 0.58`, weight is a threshold on foreground ratio, and family is ranked against a 20-font database. This is too rough for pixel-perfect work.

- Improve font size estimation using baseline and cap-height detection
- Expand the font database beyond 20 web fonts
- Detect line-height from spacing between text blocks in the same container
- Detect text alignment (left, center, right, justify) from block positioning within parent
- Consider using a small ML model for font classification instead of heuristic metrics
