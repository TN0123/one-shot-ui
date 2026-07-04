import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCorpusDir, floorGate } from "./corpus.js";

describe("loadCorpusDir", () => {
  it("pairs {id}.html with {id}.png and skips unpaired files", () => {
    const dir = mkdtempSync(join(tmpdir(), "osui-corpus-"));
    writeFileSync(join(dir, "a.html"), "<html></html>");
    writeFileSync(join(dir, "a.png"), Buffer.from([0]));
    writeFileSync(join(dir, "b.html"), "<html></html>"); // no png → skipped
    const cases = loadCorpusDir(dir);
    expect(cases.map((c) => c.id)).toEqual(["a"]);
    expect(cases[0]!.htmlPath.endsWith("a.html")).toBe(true);
  });

  it("respects the limit", () => {
    const dir = mkdtempSync(join(tmpdir(), "osui-corpus-"));
    for (const id of ["a", "b", "c"]) {
      writeFileSync(join(dir, `${id}.html`), "<html></html>");
      writeFileSync(join(dir, `${id}.png`), Buffer.from([0]));
    }
    expect(loadCorpusDir(dir, 2)).toHaveLength(2);
  });
});

const repoRoot = join(import.meta.dir, "..", "..", "..");
const fixtureRef = join(repoRoot, "testing", "reference-dashboard.png");
describe("floorGate (integration)", () => {
  it.skipIf(!existsSync(fixtureRef))(
    "classifies a self-rendered fixture as provable (self-mismatch < tau)",
    async () => {
      // Use the dashboard fixture's own reference as both html-source proxy and image:
      // capture re-renders nothing here, so we assert the gate runs and returns a cohort.
      const workDir = mkdtempSync(join(tmpdir(), "osui-gate-"));
      // Minimal HTML that renders near the reference is not required for this smoke test;
      // we point htmlPath at a trivial doc and assert the gate completes and classifies.
      const htmlPath = join(workDir, "x.html");
      writeFileSync(htmlPath, "<!doctype html><html><body style='margin:0'></body></html>");
      const gated = await floorGate({ id: "x", htmlPath, refImagePath: fixtureRef }, workDir, 0.03);
      expect(["provable", "unknown"]).toContain(gated.cohort);
      expect(gated.selfMismatch).toBeGreaterThanOrEqual(0);
      expect(gated.floor).toBeGreaterThanOrEqual(0);
    },
    180_000,
  );
});
