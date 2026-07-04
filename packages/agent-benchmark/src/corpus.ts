import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runCli, parseCliJson } from "@one-shot-ui/mcp/cli-runner";

export interface CorpusCase {
  id: string;
  htmlPath: string;
  refImagePath: string;
}

export interface GatedCase extends CorpusCase {
  cohort: "provable" | "unknown";
  selfMismatch: number;
  floor: number;
}

/** Pair every `{id}.html` with a sibling `{id}.png`, skipping unpaired files. */
export function loadCorpusDir(dir: string, limit?: number): CorpusCase[] {
  const cases: CorpusCase[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".html")) continue;
    const id = name.slice(0, -".html".length);
    const refImagePath = join(dir, `${id}.png`);
    if (!existsSync(refImagePath)) continue;
    cases.push({ id, htmlPath: join(dir, name), refImagePath });
    if (limit && cases.length >= limit) break;
  }
  return cases;
}

interface CompareSummary { summary: { mismatchRatio: number } }

/**
 * Re-render the ground-truth HTML through our capture pipeline and self-compare
 * against the dataset screenshot. Cases that reproduce cleanly (self-mismatch < tau)
 * have a (near-)provable achievable floor; the rest are "in-the-wild" (unknown floor).
 */
export async function floorGate(c: CorpusCase, workDir: string, tau = 0.03): Promise<GatedCase> {
  const selfCapture = join(workDir, `${c.id}.self.png`);
  await runCli([
    "capture",
    "--file", c.htmlPath,
    "--output", selfCapture,
    "--match-reference", c.refImagePath,
  ]);
  const cmp = parseCliJson(
    await runCli([
      "compare", c.refImagePath, selfCapture, "--json", "--no-ocr", "--auto-resize",
    ]),
    "compare",
  ) as CompareSummary;
  const selfMismatch = cmp.summary.mismatchRatio;
  const cohort = selfMismatch < tau ? "provable" : "unknown";
  const floor = Math.max(0, Math.min(100, 100 * (1 - selfMismatch)));
  return { ...c, cohort, selfMismatch, floor };
}
