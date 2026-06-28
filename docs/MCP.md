# one-shot-ui MCP server

`one-shot-ui` ships a [Model Context Protocol](https://modelcontextprotocol.io) server so any
MCP-capable agent — Claude Code, Cursor, Cline, Windsurf, VS Code — can call its deterministic
screenshot analysis directly as tools, no shell glue required.

It runs locally over stdio, makes no network calls, and needs no API keys. Each tool wraps the
same `one-shot-ui` CLI, so tool output is byte-for-byte identical to the command line.

## Tools

| Tool | What it does | Key inputs |
|------|--------------|------------|
| `compare` | Deterministic pixel + structural diff of a build against a reference. Returns mismatch ratio, width/height deltas, ranked issues, and an irreducible-mismatch floor. | `reference_path`, `implementation_path` |
| `converge` | Closed-loop CSS optimizer: trials fixes in a real browser, keeps only those that measurably reduce pixel mismatch, returns a verified patch. | `reference_path`, `impl_path` |
| `suggest_fixes` | Ranked, region-anchored fix observations (size, color, shadow, spacing) with values measured from the reference. | `reference_path`, `implementation_path` |
| `extract` | Structured design data from one screenshot: layout regions, colors, typography, spacing, suggested strategy. | `image_path` |
| `tokens` | Design tokens **+ a reusable `styleSystem`** (neutral/accent palette, base spacing unit, type scale, radius/elevation scales). `emit: shadcn\|tailwind` for paste-ready vars. | `image_path` |
| `plan` | Suggested implementation plan (layout strategy, CSS primitives, repeated patterns) from a screenshot. | `image_path` |
| `style_check` | Check whether a NEW UI conforms to the reference's design language (style transfer, not pixel match). New UI = URL / HTML (exact) or screenshot (lossy). | `reference_path`, `implementation` |

All tools are read-only. Most take image file paths (PNG/JPG); `converge` and `style_check`
also accept an http(s) URL or HTML file for the implementation. Paths are absolute or
relative to the directory the server was launched from.

Two things every calling agent should know:

- **Pass `dpr: 2` for Retina/Mac screenshots** on `extract`/`tokens`/`plan`. Without it a
  2x screenshot reports every measurement at double its CSS value (a 35px heading as 70px),
  which is the most common cause of fonts/spacing/sizing coming out wrong. When omitted,
  scale is auto-detected and the report carries a `scale` block (with a `scaleHint` when it
  looks Retina). When set, the compact report's sizes and bounds are CSS pixels.
- **`compare` returns `summary.verdict`** (`converged` / `not-converged` + reasons). Use it
  as the stop signal — the pixel `mismatchRatio` is background-dominated and reads as
  "almost done" even when most elements are missing.

If a path points at a macOS screenshot temp location that has already been moved to
`~/Desktop`, the tools return a clear message saying so — pass the saved path instead.

## Install

The server is part of the `one-shot-ui` npm package. The launch command is `one-shot-ui mcp`.

No global install needed (runs via `npx`):

```jsonc
{
  "command": "npx",
  "args": ["-y", "one-shot-ui", "mcp"]
}
```

Or, if you've installed globally (`npm install -g one-shot-ui`):

```jsonc
{
  "command": "one-shot-ui",
  "args": ["mcp"]
}
```

### Claude Code

```sh
claude mcp add one-shot-ui -- npx -y one-shot-ui mcp
```

Or add to `.mcp.json` at your project root:

```json
{
  "mcpServers": {
    "one-shot-ui": {
      "command": "npx",
      "args": ["-y", "one-shot-ui", "mcp"]
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "one-shot-ui": {
      "command": "npx",
      "args": ["-y", "one-shot-ui", "mcp"]
    }
  }
}
```

### Cline / Windsurf / VS Code

These read the same `mcpServers` shape. Add the `one-shot-ui` entry above to the client's MCP
config (Cline: `cline_mcp_settings.json`; Windsurf: `~/.codeium/windsurf/mcp_config.json`;
VS Code: `.vscode/mcp.json` under a `servers` key).

## Try it

Point your agent at a reference screenshot and a build screenshot and ask it to diff them:

> Use the one-shot-ui `compare` tool on `reference.png` and `build.png`, then list the
> highest-impact differences and tell me which it considers irreducible.

## Publishing to MCP registries

The server is registry-ready via `server.json` (repo root) and the `mcpName` field in
`package.json`.

- **[Glama](https://glama.ai/mcp/servers)** — auto-indexes open-source MCP servers from GitHub; no submission needed once the repo is public.
- **[Smithery](https://smithery.ai)** — `smithery mcp publish` or the web dashboard.
- **[mcp.so](https://mcp.so)** — community submission form.
- **[Official MCP registry](https://registry.modelcontextprotocol.io)** — publish with the `mcp-publisher` CLI:

  ```sh
  # one-time: authenticate via GitHub (validates the io.github.TN0123/* namespace)
  mcp-publisher login github
  # publish the npm package to npm first, then:
  mcp-publisher publish
  ```

  `mcp-publisher` validates `server.json` against the registry schema before publishing.
