# one-shot-ui

Deterministic UI extraction, diffing, and scaffolding from screenshots.

Turn a reference screenshot into structured JSON — layout regions, colors, typography, spacing, components, design tokens — then compare implementations against the reference and get actionable fix suggestions.

## Installation

```sh
npm install -g one-shot-ui
```

For commands that need a browser (`capture`, `run`):

```sh
npx playwright install chromium
```

## Commands

| Command | Purpose | Key Flags |
|---------|---------|-----------|
| `extract` | Analyze screenshot into layout, color, and text data | `--json`, `--no-ocr`, `--overlay`, `--fine` |
| `compare` | Pixel + structural diff between two screenshots | `--json`, `--heatmap`, `--dom-diff` |
| `scaffold` | Generate HTML/CSS or React from a screenshot | `--react`, `--output`, `--mode` |
| `tokens` | Extract design tokens (colors, spacing, radii) | `--json` |
| `plan` | Generate an implementation strategy | `--json` |
| `capture` | Screenshot a URL or local HTML file | `--url`, `--file`, `--output` |
| `suggest-fixes` | CSS fix suggestions from a diff | `--json`, `--top`, `--dom-diff` |
| `run` | Multi-pass extract→capture→compare→fix loop | `--impl`, `--max-passes`, `--threshold` |
| `benchmark` | Run benchmark suites | `--json`, `--output` |

## Quick Start

```sh
# Extract structured data from a screenshot
one-shot-ui extract reference.png --json

# Generate a starter scaffold
one-shot-ui scaffold reference.png --output ./src --react

# Capture your implementation
one-shot-ui capture --url http://localhost:3000 --output impl.png

# Compare against the reference
one-shot-ui compare reference.png impl.png --json --heatmap heatmap.png

# Get CSS fix suggestions
one-shot-ui suggest-fixes reference.png impl.png --json

# Or run the full automated loop
one-shot-ui run reference.png --impl ./index.html --max-passes 5 --threshold 0.02
```

All commands support `--json` for structured output.

## Agent Integration

`one-shot-ui` ships with an `AGENTS.md` for automatic discovery by Claude Code, Cursor, Codex, and other agent tools, plus a `skill/SKILL.md` for Claude Code skill installation:

```sh
mkdir -p .claude/skills/one-shot-ui
cp node_modules/one-shot-ui/skill/SKILL.md .claude/skills/one-shot-ui/SKILL.md
```

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
bun run install:browsers   # Playwright Chromium
bun run typecheck
```

Dev scripts run directly from source:

```sh
bun run dev:extract -- ./reference.png --json
bun run dev:compare -- ./reference.png ./impl.png --json
```

Build for npm:

```sh
bun run build
```

## License

MIT
