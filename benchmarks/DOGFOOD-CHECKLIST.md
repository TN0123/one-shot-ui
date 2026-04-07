# Dogfooding Checklist

Checklist for end-to-end agent workflow using the CLI.

## Per-Reference Checklist

1. [ ] `extract <ref.png> --json` succeeds without schema errors
2. [ ] `plan <ref.png> --json` produces a plan with ≥3 nodes
3. [ ] `tokens <ref.png> --json` produces ≥5 tokens
4. [ ] `capture --file ./impl.html --output ./capture.png` succeeds
5. [ ] `compare <ref.png> ./capture.png --json --heatmap ./heatmap.png` succeeds
6. [ ] Compare issues are actionable (at least 3 have suggestedFix)
7. [ ] `run <ref.png> --impl ./impl.html --max-passes 3` produces session.json
8. [ ] next-actions.json is produced for each pass
9. [ ] Convergence summary reports a meaningful trend

## Quality Checks

- [ ] No "invalid hex" or schema validation errors in any command output
- [ ] Compare top-edit-candidates suggest real CSS changes
- [ ] Repeated card patterns are detected when present
