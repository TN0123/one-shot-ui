# Benchmarking

First benchmark command:

```sh
bun packages/cli/src/index.ts benchmark benchmarks/phase6-manifest.json --json
```

The current report scores:

- full-page mismatch ratio when an implementation is present
- anchor coverage split into real vs synthetic anchors
- planning usefulness from implementation-plan density
- typography reliability from plan confidence
- ROI reliability from whether region issues stay inside the requested panel
- DOM diff usefulness from how many DOM issues include a usable selector

The standing fixture is `phase5-dashboard`, using `testing/out/reference.png` and `testing/out/impl-phase5.png`.
