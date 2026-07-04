import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadCorpusDir, floorGate, type GatedCase } from "./corpus.js";
import { runTiers } from "./tiers.js";
import { liftByAgent, statsByAgentTier, type TierResult } from "./aggregate.js";
import { renderLeaderboard } from "./render.js";
import { createOpenAIAgent } from "./agents/openai.js";
import { createClaudeAgent } from "./agents/claude.js";
import type { Agent } from "./agents/types.js";

function buildAgents(spec: string): Agent[] {
  return spec.split(",").map((raw) => {
    const id = raw.trim();
    if (id.startsWith("gpt")) return createOpenAIAgent({ model: id });
    if (id.startsWith("claude")) return createClaudeAgent({ model: id });
    throw new Error(`Unknown agent id "${id}" (expected gpt* or claude*).`);
  });
}

const program = new Command();
program
  .name("agent-benchmark")
  .description("Benchmark how well coding agents replicate a UI from a screenshot, scored by one-shot-ui.");

program
  .command("run")
  .requiredOption("--corpus-dir <dir>", "Directory of Design2Code {id}.html + {id}.png pairs")
  .option("--out <dir>", "Output directory", "./agent-benchmark-out")
  .option("--agents <ids>", "Comma-separated agent ids", "claude-opus-4-8,claude-sonnet-5,gpt-5.4-mini")
  .option("--limit <n>", "Max corpus cases", (v) => parseInt(v, 10), 30)
  .option("--tiers <list>", "Comma-separated tiers to run", "0,1,2")
  .option("--k <n>", "Tier-1 revision rounds", (v) => parseInt(v, 10), 2)
  .option("--tau <ratio>", "Floor-gate self-mismatch threshold", (v) => parseFloat(v), 0.03)
  .option("--no-ocr", "Disable OCR in compare scoring (faster, drops typography counts)")
  .action(async (opts) => {
    const outDir = resolve(opts.out);
    const workDir = join(outDir, "work");
    mkdirSync(workDir, { recursive: true });
    const tiers = String(opts.tiers).split(",").map((t: string) => parseInt(t, 10));
    const agents = buildAgents(opts.agents);

    const cases = loadCorpusDir(resolve(opts.corpusDir), opts.limit);
    console.error(`Loaded ${cases.length} cases. Running floor gate…`);
    const gated: GatedCase[] = [];
    for (const c of cases) {
      const g = await floorGate(c, workDir, opts.tau);
      console.error(`  ${c.id}: ${g.cohort} (self-mismatch ${(g.selfMismatch * 100).toFixed(1)}%)`);
      gated.push(g);
    }

    // Writes leaderboard.json + leaderboard.html from the results accumulated so far.
    // Called after each case (and again at the end) so a mid-run kill loses at most one case.
    const writeOutputs = () => {
      const leaderboardJson = {
        generatedNote: `Design2Code (${resolve(opts.corpusDir)})`,
        cohortCounts: {
          provable: gated.filter((g) => g.cohort === "provable").length,
          unknown: gated.filter((g) => g.cohort === "unknown").length,
        },
        results,
        stats: statsByAgentTier(results, "provable"), // per agent+tier mean/median (spec §5)
        lift: liftByAgent(results, "provable"),
      };
      writeFileSync(join(outDir, "leaderboard.json"), JSON.stringify(leaderboardJson, null, 2));
      writeFileSync(
        join(outDir, "leaderboard.html"),
        renderLeaderboard(leaderboardJson.lift, {
          caseCount: leaderboardJson.cohortCounts.provable,
          generatedNote: leaderboardJson.generatedNote,
        }),
      );
    };

    const results: TierResult[] = [];
    for (const g of gated) {
      for (const agent of agents) {
        console.error(`Case ${g.id} × ${agent.id}…`);
        try {
          const runs = await runTiers(agent, g, workDir, { k: opts.k, tiers, ocr: opts.ocr !== false });
          for (const r of runs) {
            results.push({
              agentId: agent.id, tier: r.tier, caseId: g.id, cohort: g.cohort,
              visualScore: r.visualScore, floor: g.floor,
              scorecard: r.scorecard, htmlPath: r.htmlPath, capturePath: r.capturePath,
            });
          }
        } catch (err) {
          console.error(`  FAILED ${g.id} × ${agent.id}: ${(err as Error).message}`);
        }
      }
      writeOutputs();
    }

    writeOutputs();
    console.error(`Wrote ${join(outDir, "leaderboard.json")} and leaderboard.html`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
