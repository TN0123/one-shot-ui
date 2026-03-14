# Dogfooding Checklist

Checklist for end-to-end agent workflow using the CLI.

## Per-Reference Checklist

1. [ ] `extract <ref.png> --json` succeeds without schema errors
2. [ ] `plan <ref.png> --json` produces a plan with ≥3 nodes
3. [ ] `tokens <ref.png> --json` produces ≥5 tokens
4. [ ] `scaffold <ref.png> --output ./scaffold` generates valid HTML
5. [ ] `capture --file ./scaffold/index.html --output ./capture.png` succeeds
6. [ ] `compare <ref.png> ./capture.png --json --heatmap ./heatmap.png` succeeds
7. [ ] Compare issues are actionable (at least 3 have suggestedFix)
8. [ ] `run <ref.png> --impl ./scaffold/index.html --max-passes 3` produces session.json
9. [ ] next-actions.json is produced for each pass
10. [ ] Convergence summary reports a meaningful trend

## Quality Checks

- [ ] No "invalid hex" or schema validation errors in any command output
- [ ] Scaffold visually resembles reference at a rough level
- [ ] Compare top-edit-candidates suggest real CSS changes
- [ ] Repeated card patterns are detected when present
- [ ] Chart/icon placeholders appear in scaffold when appropriate
