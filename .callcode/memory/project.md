# CallCode Project Memory

Last updated: 2026-03-13T21:34:46.664Z

## Project Digest

Project: /Users/tanaynaik/Desktop/one-shot-ui
TypeScript | Monorepo | bun
Workspaces: packages/browser-capture, packages/vision-layout, packages/core, packages/vision-style, packages/cli, packages/vision-text, packages/semantic-label, packages/vision-components, packages/dom-diff, packages/diff-engine, packages/image-io
Git: main

Structure:
  benchmarks/
    phase6-manifest.json
  docs/
    agent-integration.md
    benchmarking.md
  initial-build/
    phase1-agent-feedback.md
    phase1.md
    phase2-agent-feedback.md
    phase3-agent-feedback.md
    phase4-agent-feedback.md
    phase5-agent-feedback.md
    phase6-agent-feedback.md
    roadmap.md
  packages/
    browser-capture/
    cli/
    core/
    diff-engine/
    dom-diff/
    image-io/
    semantic-label/
    vision-components/
    vision-layout/
    vision-style/
    vision-text/
  .gitignore
  eng.traineddata
  LICENSE
  package.json
  README.md
  ROADMAP.md
  tsconfig.json

All project files:
  .gitignore
  LICENSE
  README.md
  ROADMAP.md
  benchmarks/phase6-manifest.json
  docs/agent-integration.md
  docs/benchmarking.md
  eng.traineddata
  initial-build/phase1-agent-feedback.md
  initial-build/phase1.md
  initial-bu...

## Recent Learnings

- Initialized by CallCode.

<!-- callcode-memory:agent-1:1773429975133 -->
- 2026-03-13T19:26:15.133Z repo-summary (`agent-1`) completed with status=`ready`
  task: Summarize the state of the repository
  output: ## Repository state summary **one-shot-ui** is a CLI for AI agents to analyze screenshots, compare implementations to references, and reduce visual mismatch when recreating UIs. It extracts deterministic, machine-readable UI data instead of relying on raw pixels. ### Current status - **Phase:** Roadmap through Phase 6 is implemented. - **Build:** `bun run typecheck` passes. - **Git:** On `main`; one untracked item: `.callcode/`. ### Implemented features | Area | Capabilities |

<!-- callcode-memory:agent-2:1773429982414 -->
- 2026-03-13T19:26:22.414Z Oliver (`agent-2`) completed with status=`ready`
  task: Summarize the current state of the repository for the user. Inspect the monorepo structure, implemented packages and CLI surface, docs/roadmap status, and note any obvious gaps or risks. Do not modify files. Provide a concise but useful ...
  output: --- ## one-shot-ui repository summary ### Overview **one-shot-ui** is a TypeScript monorepo CLI for AI agents to analyze screenshots, compare implementations to references, and reduce visual mismatch. It focuses on deterministic, machine-readable UI data instead of raw pixel analysis. **Version:** 0.4.0 **Stack:** Bun workspaces, TypeScript, Zod, Sharp, Playwright, Tesseract.js, Pixelmatch ### Monorepo structure | Package | Role |

<!-- callcode-memory:agent-3:1773430115276 -->
- 2026-03-13T19:28:35.276Z Michael (`agent-3`) completed with status=`ready`
  task: Read the repository docs and code surfaces to answer two things for the user: (1) summarize the current state of the repo, and (2) based on README, ROADMAP.md, and initial-build roadmap notes, identify which roadmap improvement looks eas...
  output: Checking the compare engine and CLI to see how issues are emitted and what infrastructure already exists: Here's the summary and recommendation: --- ## 1. Current state **one-shot-ui** is a TypeScript monorepo CLI (v0.4.0) that turns screenshots into structured UI data for AI agents and compares implementations to references. Implemented through Phase 6: - **Commands:** `extract`, `compare`, `capture`, `plan`, `tokens`, `suggest-fixes`, `benchmark` - **Packages:** 11 workspaces (core, image-io, vision-layout, vision-style, vision-text, vision-components, diff-engine, browser-capture, semant...

<!-- callcode-memory:agent-1:1773437686664 -->
- 2026-03-13T21:34:46.664Z Katherine (`agent-1`) completed with status=`ready`
  task: Read README.md, ROADMAP.md, initial-build/roadmap.md, and the relevant package entrypoints (especially packages/cli/src/index.ts, packages/diff-engine/src/index.ts, packages/core/src/index.ts, and packages/semantic-label/src/index.ts). D...
  output: Let me read the key files to understand the current state of the repo and make a recommendation.Now I have a thorough understanding of the codebase. Let me synthesize my recommendation. Key observations: 1. The repo is through Phase 6 - benchmark suite and production hardening 2. The ROADMAP.md lists 8 planned improvements 3. The most critical gap identified in the initial-build roadmap (the detailed one) is the "concrete code scaffold generation" - the plan command outputs abstract guidance but no actual code 4. The `semantic-label` package has a clean adapter interface ready for LLM integ...
