import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { runCli, parseCliJson, resolveCliEntry } from "./cli-runner.js";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const fixtures = join(repoRoot, "testing");
const refPath = join(fixtures, "reference-dashboard.png");
const implPass1 = join(fixtures, "eval-fresh-v2", "impl-pass1.png");

describe("parseCliJson", () => {
  it("throws with stderr detail on non-zero exit", () => {
    expect(() => parseCliJson({ stdout: "", stderr: "boom", code: 1 }, "compare")).toThrow(/boom/);
  });

  it("parses valid JSON stdout", () => {
    const out = parseCliJson({ stdout: '{"ok":true}', stderr: "", code: 0 }, "compare");
    expect(out).toEqual({ ok: true });
  });

  it("throws a clear error when stdout is not JSON", () => {
    expect(() => parseCliJson({ stdout: "not json", stderr: "", code: 0 }, "extract")).toThrow(
      /did not return valid JSON/
    );
  });
});

describe("resolveCliEntry", () => {
  it("finds a runnable CLI entry", () => {
    const { cmd, prefixArgs } = resolveCliEntry();
    expect(typeof cmd).toBe("string");
    expect(prefixArgs.length).toBeGreaterThan(0);
    expect(existsSync(prefixArgs[0]!)).toBe(true);
  });
});

// End-to-end against the committed fixtures: proves the MCP wrapper produces the
// same deterministic numbers as the CLI. heightDelta is geometric (image dims),
// so it is a stable, OCR-independent assertion: impl-pass1 is 1280x1039 vs the
// 1280x1006 reference => 33.
describe("runCli (integration, real fixtures)", () => {
  const haveFixtures = existsSync(refPath) && existsSync(implPass1);

  it.skipIf(!haveFixtures)(
    "compare returns a deterministic structural diff",
    async () => {
      const result = await runCli([
        "compare",
        refPath,
        implPass1,
        "--json",
        "--no-ocr",
      ]);
      const report = parseCliJson(result, "compare") as { summary: Record<string, unknown> };
      expect(report.summary).toBeDefined();
      expect(report.summary.heightDelta).toBe(33);
      expect(typeof report.summary.mismatchRatio).toBe("number");
    },
    120_000
  );
});
