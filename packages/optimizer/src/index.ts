import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { AcceptedFix, ConvergeReport, MissingStructure } from "./types.js";
import { collectElements } from "./inventory.js";
import { matchElements, findMissingStructure, type ReferenceData } from "./matching.js";
import { candidatesFor, containerCandidates, refinementValues, FAMILY_ORDER } from "./candidates.js";
import {
  createObjective,
  preparePage,
  trialCandidate,
  StyleBank,
  type TrialContext,
} from "./trial.js";

export type { ReferenceData } from "./matching.js";
export type {
  ConvergeReport,
  AcceptedFix,
  MissingStructure,
  ElementInfo,
  MatchedElement,
  Candidate,
} from "./types.js";

export interface ConvergeOptions {
  referencePath: string;
  /** Implementation: local file path or http(s) URL. */
  implPath: string;
  /** Decoded reference pixels (RGBA, raw size). */
  referenceRgba: Uint8ClampedArray;
  /** Raw reference pixel dimensions. */
  width: number;
  height: number;
  /** CSS viewport + device scale (from resolveMatchReferenceViewport). */
  viewport: { width: number; height: number; scale: number };
  /** Reference regions + text in CSS px (from the extract report). */
  refData: ReferenceData;
  maxEvals?: number;
  budgetSeconds?: number;
  maxElements?: number;
  /** Mismatch ratio at or below which the build is pixel-converged. */
  floorRatio?: number;
  maxPasses?: number;
  /** pixelmatch sensitivity for the objective (default OBJECTIVE_THRESHOLD). */
  pixelThreshold?: number;
  /** Also report rejected trials through onProgress (debugging). */
  verboseTrials?: boolean;
  onProgress?: (message: string) => void;
  /** Reuse an existing browser (tests, serve). Launched/closed internally when omitted. */
  browser?: Browser;
}

export async function converge(opts: ConvergeOptions): Promise<ConvergeReport> {
  const maxEvals = opts.maxEvals ?? 2000;
  const budgetMs = (opts.budgetSeconds ?? 300) * 1000;
  const maxElements = opts.maxElements ?? 200;
  const floorRatio = opts.floorRatio ?? 0.002;
  const maxPasses = opts.maxPasses ?? 8;
  const progress = opts.onProgress ?? (() => {});

  const ownBrowser = !opts.browser;
  const browser = opts.browser ?? (await launchChromium());
  const context = await browser.newContext({
    viewport: { width: opts.viewport.width, height: opts.viewport.height },
    deviceScaleFactor: opts.viewport.scale,
  });
  const page: Page = await context.newPage();

  try {
    const implUrl = opts.implPath.startsWith("http")
      ? opts.implPath
      : pathToFileURL(resolve(opts.implPath)).href;
    await page.goto(implUrl, { waitUntil: "networkidle", timeout: 30_000 });
    await preparePage(page);

    const objective = createObjective(
      page,
      opts.referenceRgba,
      opts.width,
      opts.height,
      opts.pixelThreshold,
    );
    const bank = new StyleBank(page);
    const rules = new Map<string, Map<string, string>>();
    const ctx: TrialContext = { page, bank, rules, objective };

    const startedAt = Date.now();
    const initialPixels = await objective.measure();
    let currentPixels = initialPixels;
    let evals = 1;
    let passes = 0;
    let rejectedCount = 0;
    const accepted: AcceptedFix[] = [];
    // Rejection is contextual (a position fix may only pay off after a color fix
    // elsewhere lands), so this cache is cleared at the start of every pass — it
    // only prevents re-trying identical candidates within one pass.
    let triedAndRejected = new Set<string>();
    let budgetHit = false;
    let missingStructure: MissingStructure[] = [];

    progress(
      `initial mismatch ${formatRatio(initialPixels / objective.totalPixels)} (${initialPixels} px)`,
    );

    outer: while (passes < maxPasses) {
      passes++;
      let acceptedThisPass = 0;
      triedAndRejected = new Set<string>();

      const elements = await collectElements(page, maxElements);
      const matched = matchElements(elements, opts.refData);
      if (passes === 1) {
        missingStructure = findMissingStructure(elements, opts.refData);
      }

      for (const family of FAMILY_ORDER) {
        for (const m of matched) {
          // Containers without a region of their own get geometry candidates
          // derived from their children's offsets (padding, gap) — one parent
          // fix instead of N per-child margins the greedy loop can't always
          // accept individually.
          const cands =
            family === "geometry" && !m.region
              ? containerCandidates(m, matched)
              : candidatesFor(m, family);
          for (const cand of cands) {
            const key = `${cand.selector}|${cand.property}|${cand.value}`;
            if (triedAndRejected.has(key)) continue;
            // Re-tuning an accepted property with a NEW value is allowed (later
            // passes see updated bboxes); re-trying the same value is not.
            if (rules.get(cand.selector)?.get(cand.property) === cand.value) continue;
            if (evals >= maxEvals || Date.now() - startedAt > budgetMs) {
              budgetHit = true;
              break outer;
            }

            const res = await trialCandidate(ctx, currentPixels, cand.selector, cand.property, cand.value);
            evals++;
            if (!res.accepted) {
              triedAndRejected.add(key);
              rejectedCount++;
              if (opts.verboseTrials) {
                progress(`pass ${passes}: rejected ${cand.selector} { ${cand.property}: ${cand.value} } (${cand.source})`);
              }
              continue;
            }

            let bestPixels = res.pixels;
            let bestValue = cand.value;

            // Greedy numeric line search around the accepted value.
            if (cand.numeric) {
              for (const refined of refinementValues(cand.numeric.base, cand.numeric.unit)) {
                if (evals >= maxEvals || Date.now() - startedAt > budgetMs) {
                  budgetHit = true;
                  break;
                }
                const r = await trialCandidate(ctx, bestPixels, cand.selector, cand.property, refined);
                evals++;
                if (r.accepted) {
                  bestPixels = r.pixels;
                  bestValue = refined;
                }
              }
            }

            accepted.push({
              selector: cand.selector,
              property: cand.property,
              value: bestValue,
              source: cand.source,
              gainPixels: currentPixels - bestPixels,
            });
            currentPixels = bestPixels;
            acceptedThisPass++;
            progress(
              `pass ${passes}: ${cand.selector} { ${cand.property}: ${bestValue} } → ${formatRatio(currentPixels / objective.totalPixels)}`,
            );
            if (budgetHit) break outer;
          }
        }
      }

      progress(`pass ${passes} done: ${acceptedThisPass} accepted, mismatch ${formatRatio(currentPixels / objective.totalPixels)}`);
      // The floor labels the verdict; it never stops the search. True
      // convergence is "a full pass in which nothing improves the pixels."
      if (acceptedThisPass === 0) break;
    }

    const finalPixels = currentPixels;
    const finalRatio = finalPixels / objective.totalPixels;
    const verdict: ConvergeReport["verdict"] =
      finalRatio <= floorRatio ? "pixel-converged" : budgetHit ? "budget-exhausted" : "css-exhausted";

    return {
      initialMismatchRatio: initialPixels / objective.totalPixels,
      finalMismatchRatio: finalRatio,
      initialMismatchPixels: initialPixels,
      finalMismatchPixels: finalPixels,
      evals,
      passes,
      accepted,
      rejectedCount,
      missingStructure,
      verdict,
      patchCss: buildPatchCss(accepted),
    };
  } finally {
    await context.close();
    if (ownBrowser) await browser.close();
  }
}

function buildPatchCss(accepted: AcceptedFix[]): string {
  if (!accepted.length) return "";
  const bySelector = new Map<string, AcceptedFix[]>();
  for (const fix of accepted) {
    const list = bySelector.get(fix.selector) ?? [];
    list.push(fix);
    bySelector.set(fix.selector, list);
  }
  const lines: string[] = [
    "/* one-shot-ui converge — every declaration below is pixel-verified against the reference.",
    "   Fold these values into your source styles (you can then drop this file). */",
    "",
  ];
  for (const [selector, fixes] of bySelector) {
    lines.push(`${selector} {`);
    for (const fix of fixes) {
      lines.push(`  ${fix.property}: ${fix.value}; /* ${fix.source}, -${fix.gainPixels} px mismatch */`);
    }
    lines.push("}");
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function formatRatio(r: number): string {
  return `${(r * 100).toFixed(2)}%`;
}

async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Executable doesn't exist")) {
      throw new Error(
        "Playwright Chromium is not installed. Run `npx playwright install chromium` and retry.",
      );
    }
    throw err;
  }
}
