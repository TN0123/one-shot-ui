# Agent Integration

Phase 6 adds a benchmark surface and tighter compare contracts. These templates keep the CLI outputs easy for agents to consume.

## Core loop

1. `bun packages/cli/src/index.ts plan <reference.png> --json`
2. `bun packages/cli/src/index.ts tokens <reference.png> --json`
3. Implement the page shell.
4. `bun packages/cli/src/index.ts capture --file <index.html> --output <impl.png> --width <w> --height <h>`
5. `bun packages/cli/src/index.ts compare <reference.png> <impl.png> --json --top 12`
6. If a panel needs isolated work: `bun packages/cli/src/index.ts compare <reference.png> <impl.png> --json --region "<anchor>"`
7. If semantic coverage falls back, trust the scoped pixel mismatch first and avoid overfitting to missing semantic labels.

## Prompt template: planning

Use the `implementationPlan` as the scaffold source.

```text
Build the page shell from this plan.
Preserve the primary layout strategy, repeated patterns, and selector hints.
If typography confidence is weak, do not overfit exact fonts from the report; match hierarchy and spacing visually.
```

## Prompt template: compare

```text
Apply the highest-severity issues first.
Prefer fixes with selectors or explicit CSS properties.
If the report contains REGION_SEMANTIC_FALLBACK, treat the region result as scoped pixel guidance instead of reliable anchor-level structure.
```

## Prompt template: benchmark review

```text
Summarize benchmark regressions by:
- mismatch ratio change
- anchor coverage change
- ROI reliability change
- DOM selector issue ratio change

Call out any case that fell back to pixel-only ROI mode.
```
