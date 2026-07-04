import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, parseCliJson } from "@one-shot-ui/mcp/cli-runner";
import { scoreCompareReport, type CaseScore, type CompareLike } from "./score.js";
import { applyPatchCss } from "./html.js";
import type { Agent } from "./agents/types.js";
import type { GatedCase } from "./corpus.js";

export interface TierRun {
  tier: 0 | 1 | 2;
  visualScore: number;
  mismatchRatio: number;
  scorecard: CaseScore["scorecard"];
  htmlPath: string;
  capturePath: string;
}

export function selectTiers(tiers: number[]): number[] {
  return [...new Set(tiers)].filter((t) => t === 0 || t === 1 || t === 2).sort((a, b) => a - b);
}

/** Write HTML, capture it at the reference viewport, compare, and score. */
export async function captureAndScore(
  html: string,
  gated: GatedCase,
  workDir: string,
  label: string,
  ocr: boolean,
): Promise<{ score: CaseScore; htmlPath: string; capturePath: string }> {
  const htmlPath = join(workDir, `${gated.id}.${label}.html`);
  const capturePath = join(workDir, `${gated.id}.${label}.png`);
  writeFileSync(htmlPath, html);
  // Renders agent-produced (untrusted) HTML in headless Chromium; acceptable here since
  // this is a dev-only benchmark of the user's own models against a benign corpus.
  await runCli([
    "capture", "--file", htmlPath, "--output", capturePath, "--match-reference", gated.refImagePath,
  ]);
  const compareArgs = ["compare", gated.refImagePath, capturePath, "--json", "--auto-resize"];
  if (!ocr) compareArgs.push("--no-ocr");
  const report = parseCliJson(await runCli(compareArgs), "compare") as CompareLike;
  return { score: scoreCompareReport(report), htmlPath, capturePath };
}

export async function runTiers(
  agent: Agent,
  gated: GatedCase,
  workDir: string,
  opts: { k: number; tiers: number[]; ocr: boolean },
): Promise<TierRun[]> {
  const wanted = selectTiers(opts.tiers);
  const runs: TierRun[] = [];
  if (!wanted.length) return runs;

  // Tier 0 — cold generation. Always produced: it's the baseline and seeds tiers 1 and 2.
  const html0 = await agent.generate(gated.refImagePath);
  const t0 = await captureAndScore(html0, gated, workDir, "t0", opts.ocr);
  if (wanted.includes(0)) {
    runs.push({ tier: 0, ...t0.score, htmlPath: t0.htmlPath, capturePath: t0.capturePath });
  }

  // Track the best HTML so far (used to seed tier 1 and 2).
  let bestHtml = html0;
  let best = t0;

  // Tier 1 — K rounds of tool-fed revision.
  if (wanted.includes(1) || wanted.includes(2)) {
    try {
      for (let round = 0; round < opts.k; round++) {
        const suggestArgs = ["suggest-fixes", gated.refImagePath, best.capturePath, "--json"];
        if (!opts.ocr) suggestArgs.push("--no-ocr");
        const suggestResult = await runCli(suggestArgs);
        if (suggestResult.code !== 0) {
          console.error(`suggest-fixes failed for ${gated.id} (round ${round}): exit code ${suggestResult.code}`);
          break;
        }
        const feedbackJson = suggestResult.stdout;
        const revised = await agent.revise({
          refImagePath: gated.refImagePath,
          currentImagePath: best.capturePath,
          feedbackJson,
          currentHtml: bestHtml,
        });
        const scored = await captureAndScore(revised, gated, workDir, `t1r${round}`, opts.ocr);
        if (scored.score.visualScore >= best.score.visualScore) {
          best = scored;
          bestHtml = revised;
        }
      }
    } catch (err) {
      console.error(`Tier-1 round failed for ${gated.id}: ${(err as Error).message}`);
    }
    if (wanted.includes(1)) {
      runs.push({ tier: 1, ...best.score, htmlPath: best.htmlPath, capturePath: best.capturePath });
    }
  }

  // Tier 2 — deterministic converge on the best tier-1 HTML, scored with the same scorer.
  if (wanted.includes(2)) {
    try {
      const patchPath = join(workDir, `${gated.id}.patch.css`);
      const conv = parseCliJson(
        await runCli(
          ["converge", gated.refImagePath, "--impl", best.htmlPath, "--out", patchPath, "--json"],
          { timeoutMs: 320_000 }, // converge's default budget is 300s; clear the 180s mcp runCli default
        ),
        "converge",
      ) as { patchCss: string };
      const t2Html = applyPatchCss(bestHtml, conv.patchCss);
      const t2 = await captureAndScore(t2Html, gated, workDir, "t2", opts.ocr);
      runs.push({ tier: 2, ...t2.score, htmlPath: t2.htmlPath, capturePath: t2.capturePath });
    } catch (err) {
      console.error(`Tier-2 converge failed for ${gated.id}: ${(err as Error).message}`);
    }
  }

  return runs;
}
