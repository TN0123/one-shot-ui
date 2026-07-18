import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { AcceptedFix, ConvergeReport, MissingStructure } from "./types.js";
import { collectElements } from "./inventory.js";
import { matchElements, findMissingStructure, type ReferenceData } from "./matching.js";
import { computeFidelity, detectTextOverlaps, assignTextBlocks, type FidelityInput } from "./fidelity.js";
import { overlapKey, freshOverlapCulprits, lostContentCulprits, containsBounds, type LostBlock } from "./gates.js";
import { contrastRatio, parseCssColor, type Rgb } from "./color.js";
import { visibleLeafText } from "./text-elements.js";
import { hiddenContentBlocks } from "./hidden-content.js";
import type { ElementInfo } from "./types.js";
import {
  candidatesFor,
  containerCandidates,
  groupCandidates,
  groupSelectorOf,
  refinementValues,
  FAMILY_ORDER,
  type CandidateContext,
} from "./candidates.js";
import { dominantColor } from "./sample.js";
import { bestOffset } from "./offset.js";
import { PNG } from "pngjs";
import {
  createObjective,
  preparePage,
  trialCandidate,
  StyleBank,
  type TrialContext,
} from "./trial.js";

export type { ReferenceData } from "./matching.js";
export {
  computeFidelity,
  detectTextOverlaps,
  type FidelityInput,
  type FidelityBreakdown,
  type FidelityOptions,
  type TextOverlap,
} from "./fidelity.js";
export { colorDelta, deltaE2000, rgbToLab, parseCssColor } from "./color.js";
export { hiddenContentBlocks, type HiddenBlock } from "./hidden-content.js";
export { leafTextElements, visibleLeafText } from "./text-elements.js";
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

    // CSS-px bounds → raw reference px for pixel sampling.
    const scale = opts.viewport.scale;
    const candidateCtx: CandidateContext = {
      sampleFill: (b) =>
        dominantColor(opts.referenceRgba, opts.width, opts.height, 4, {
          x: b.x * scale,
          y: b.y * scale,
          width: b.width * scale,
          height: b.height * scale,
        }),
    };

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
    // Text overlaps present in the model's raw output. The gate only reverts
    // overlaps converge *introduces*, never ones it inherited (those are the
    // model's to fix, not the optimizer's).
    let baselineOverlaps = new Set<string>();
    // Reference text/layout in fidelity's shape + the shared canvas opts, built
    // once and reused for the baseline content snapshot, the content gate, and
    // the final fidelity score.
    const refInput = refDataToInput(opts.refData);
    const fidOpts = { canvasWidth: opts.viewport.width, canvasHeight: opts.viewport.height };
    // Reference text blocks (by stable index) the model was already showing at
    // baseline — the selector that held each, its bounds, and whether it was
    // legible then. The content gate refuses to let the optimizer hide any of these.
    let baselineTextMatches = new Map<
      number,
      { selector: string; bounds: ElementInfo["bounds"]; legible: boolean }
    >();

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
        baselineOverlaps = overlapKeys(elements);
        const baseBySelector = new Map(elements.map((e) => [e.selector, e] as const));
        baselineTextMatches = new Map(
          assignTextBlocks(refInput, elementsToInput(elements), fidOpts).assignments
            .filter((a) => a.implLabel)
            .map((a) => {
              const el = baseBySelector.get(a.implLabel!);
              const c = el ? textContrast(el, elements) : null;
              return [
                a.refIndex,
                { selector: a.implLabel!, bounds: el?.bounds ?? a.implBlock.bounds, legible: c == null || c >= LEGIBLE_MIN },
              ] as const;
            }),
        );
      }
      if (opts.verboseTrials && passes === 1) {
        for (const m of matched) {
          if (m.region) {
            progress(
              `match: ${m.element.selector} -> ${m.region.id} iou=${m.iou.toFixed(2)} dxy=(${m.region.bounds.x - m.element.bounds.x},${m.region.bounds.y - m.element.bounds.y})`,
            );
          }
        }
      }

      // Trial one candidate (with greedy numeric line search); returns whether
      // it was accepted. Mutates the shared search state.
      const trialOne = async (cand: import("./types.js").Candidate): Promise<boolean | "budget"> => {
        const key = `${cand.selector}|${cand.property}|${cand.value}`;
        if (triedAndRejected.has(key)) return false;
        // Re-tuning an accepted property with a NEW value is allowed (later
        // passes see updated bboxes); re-trying the same value is not.
        if (rules.get(cand.selector)?.get(cand.property) === cand.value) return false;
        if (evals >= maxEvals || Date.now() - startedAt > budgetMs) {
          budgetHit = true;
          return "budget";
        }

        const res = await trialCandidate(ctx, currentPixels, cand.selector, cand.property, cand.value);
        evals++;
        if (!res.accepted) {
          triedAndRejected.add(key);
          rejectedCount++;
          if (opts.verboseTrials) {
            progress(`pass ${passes}: rejected ${cand.selector} { ${cand.property}: ${cand.value} } (${cand.source})`);
          }
          return false;
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
        return budgetHit ? "budget" : true;
      };

      // Translation-detector candidates: one screenshot per pass, then a direct
      // pixel search for each large container's best (dx, dy) against the
      // reference. Exact to the pixel and immune to extract-region quantization
      // noise, this is the detector for the "whole section ghosted by a few px"
      // failure that per-child matching cannot see reliably.
      const offsetCandidates: import("./types.js").Candidate[] = [];
      {
        const shotPng = PNG.sync.read(Buffer.from(await page.screenshot({ fullPage: false })));
        const containers = matched
          .filter((m) => m.element.area >= 40_000)
          .sort((a, b) => b.element.area - a.element.area)
          .slice(0, 12);
        for (const m of containers) {
          const b = m.element.bounds;
          const off = bestOffset(opts.referenceRgba, shotPng.data, opts.width, opts.height, {
            x: b.x * scale,
            y: b.y * scale,
            width: b.width * scale,
            height: b.height * scale,
          });
          if (!off || off.improvement < 0.02) continue;
          const dx = Math.round(off.dx / scale);
          const dy = Math.round(off.dy / scale);
          if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
          const s = m.element.styles;
          const pt = parsePxStyle(s.paddingTop);
          const pr = parsePxStyle(s.paddingRight);
          const pb = parsePxStyle(s.paddingBottom);
          const pl = parsePxStyle(s.paddingLeft);
          if (pt != null && pr != null && pb != null && pl != null && pt + dy >= 0 && pl + dx >= 0) {
            offsetCandidates.push({
              selector: m.element.selector,
              property: "padding",
              value: `${pt + dy}px ${pr}px ${pb}px ${pl + dx}px`,
              source: `geometry:pixel-offset(${dx},${dy})`,
            });
          }
          const mt = parsePxStyle(s.marginTop) ?? 0;
          const mr = parsePxStyle(s.marginRight) ?? 0;
          const mb = parsePxStyle(s.marginBottom) ?? 0;
          const ml = parsePxStyle(s.marginLeft) ?? 0;
          offsetCandidates.push({
            selector: m.element.selector,
            property: "margin",
            value: `${mt + dy}px ${mr}px ${mb}px ${ml + dx}px`,
            source: `geometry:pixel-offset-margin(${dx},${dy})`,
          });
        }
      }

      for (const family of FAMILY_ORDER) {
        if (family === "geometry") {
          for (const cand of offsetCandidates) {
            const outcome = await trialOne(cand);
            if (outcome === "budget") break outer;
          }
        }
        // Containers without a region of their own get geometry candidates
        // derived from their children's offsets (padding, gap) — one parent
        // fix instead of N per-child margins the greedy loop can't always
        // accept individually.
        const perElement = matched.map((m) => ({
          m,
          cands:
            family === "geometry"
              ? [...containerCandidates(m, matched), ...candidatesFor(m, family, candidateCtx)]
              : candidatesFor(m, family, candidateCtx),
        }));

        // Shared-rule candidates first: when several same-class elements agree
        // on a fix, one `td { … }` rule beats N nth-of-type patches — fewer
        // trials and a patch agents can fold into their stylesheet directly.
        const groups = groupCandidates(
          perElement.flatMap(({ m, cands }) => cands.map((candidate) => ({ element: m.element, candidate }))),
        );
        const groupFixed = new Set<string>();
        for (const cand of groups) {
          const outcome = await trialOne(cand);
          if (outcome === "budget") break outer;
          if (outcome) groupFixed.add(`${cand.selector}|${cand.property}`);
        }

        for (const { m, cands } of perElement) {
          const gs = groupSelectorOf(m.element);
          for (const cand of cands) {
            if (gs && groupFixed.has(`${gs}|${cand.property}`)) continue;
            const outcome = await trialOne(cand);
            if (outcome === "budget") break outer;
          }
        }
      }

      progress(`pass ${passes} done: ${acceptedThisPass} accepted, mismatch ${formatRatio(currentPixels / objective.totalPixels)}`);
      // The floor labels the verdict; it never stops the search. True
      // convergence is "a full pass in which nothing improves the pixels."
      if (acceptedThisPass === 0) break;
    }

    // Structural gates: after the pixel loop, undo box-moving fixes that "won"
    // pixels by making the build worse in ways pixel-diff can't see — text shoved
    // onto a neighbor (overlap) or collapsed/ejected out of the render (missing
    // content). Both surface in the live inventory: collectElements omits
    // hidden/off-screen/sub-16px² nodes, so lost content simply disappears.
    let finalElements = await collectElements(page, maxElements);
    const revert = (culprits: AcceptedFix[]): number => {
      for (const f of culprits) {
        rules.get(f.selector)?.delete(f.property);
        if (rules.get(f.selector)?.size === 0) rules.delete(f.selector);
        const idx = accepted.indexOf(f);
        if (idx >= 0) accepted.splice(idx, 1);
      }
      return culprits.length;
    };
    const reMeasureElements = async () => {
      await bank.setRules(rules);
      await page.waitForTimeout(60); // settle re-render before re-measuring, matches trialCandidate
      finalElements = await collectElements(page, maxElements);
    };

    // Gate 1 — overlap: revert fixes that shoved text onto a neighbor.
    let overlapsRepaired = 0;
    for (let round = 0; round < 3; round++) {
      const overlaps = detectTextOverlaps(overlapItems(finalElements));
      const culprits = freshOverlapCulprits(overlaps, baselineOverlaps, accepted);
      if (!culprits.length) break;
      overlapsRepaired += revert(culprits);
      await reMeasureElements();
    }

    // Gate 2 — content: revert fixes that stopped showing reference text the build
    // had at baseline — whether ejected/collapsed out of the render (a box fix) or
    // recolored into its background (a color fix: invisible on screen, still in the
    // DOM, so only a contrast check catches it). This is the failure pixel-diff
    // rewards most — dark text whitened onto a light page drops mismatch to zero.
    let contentRestored = 0;
    for (let round = 0; round < 3; round++) {
      const finalAssign = assignTextBlocks(refInput, elementsToInput(finalElements), fidOpts).assignments;
      const presentByRef = new Map(finalAssign.map((a) => [a.refIndex, a.implLabel] as const));
      const bySelector = new Map(finalElements.map((e) => [e.selector, e] as const));
      const lost: LostBlock[] = [];
      for (const [refIndex, base] of baselineTextMatches) {
        const label = presentByRef.get(refIndex);
        if (label == null) {
          lost.push({ selector: base.selector, bounds: base.bounds, reason: "gone" });
        } else if (base.legible) {
          const el = bySelector.get(label);
          const c = el ? textContrast(el, finalElements) : null;
          if (el && c != null && c < ILLEGIBLE_MAX) {
            lost.push({ selector: label, bounds: el.bounds, reason: "illegible" });
          }
        }
      }
      if (!lost.length) break;
      const culprits = lostContentCulprits(lost, accepted, (sel) => bySelector.get(sel)?.bounds);
      if (!culprits.length) break;
      contentRestored += revert(culprits);
      await reMeasureElements();
    }

    if (overlapsRepaired > 0 || contentRestored > 0) {
      currentPixels = await objective.measure();
      const parts: string[] = [];
      if (overlapsRepaired > 0) parts.push(`${overlapsRepaired} overlap-inducing`);
      if (contentRestored > 0) parts.push(`${contentRestored} content-dropping`);
      progress(`structural gate: reverted ${parts.join(" + ")} fix(es)`);
    }
    const residualTextOverlaps = detectTextOverlaps(overlapItems(finalElements)).length;

    const finalPixels = currentPixels;
    const finalRatio = finalPixels / objective.totalPixels;
    const verdict: ConvergeReport["verdict"] =
      finalRatio <= floorRatio ? "pixel-converged" : budgetHit ? "budget-exhausted" : "css-exhausted";

    const fidelity = computeFidelity(refInput, elementsToInput(finalElements), fidOpts);
    // Reference text the final build renders but clips out of view. CSS can't fix it
    // — un-clipping grows the box and worsens the pixels — so it is reported for the
    // agent to fix in markup, alongside missingStructure.
    const hiddenContent = hiddenContentBlocks(refInput, finalElements, fidOpts);

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
      overlapsRepaired,
      contentRestored,
      residualTextOverlaps,
      hiddenContent,
      fidelity,
    };
  } finally {
    await context.close();
    if (ownBrowser) await browser.close();
  }
}

function overlapItems(elements: ElementInfo[]): Array<{ text: string | null; bounds: ElementInfo["bounds"]; label: string }> {
  // Visible leaf runs only — a clipped/occluded run isn't on screen, so it can't
  // visually collide with anything.
  return visibleLeafText(elements).map((e) => ({ text: e.text, bounds: e.bounds, label: e.selector }));
}

function overlapKeys(elements: ElementInfo[]): Set<string> {
  return new Set(detectTextOverlaps(overlapItems(elements)).map((o) => overlapKey(o.a, o.b)));
}

// Text below ILLEGIBLE_MAX WCAG contrast against its background is effectively
// invisible; a block needs at least LEGIBLE_MIN to count as "was legible" at
// baseline. The gap is hysteresis so a block near the boundary can't flip-flop.
const LEGIBLE_MIN = 3.0;
const ILLEGIBLE_MAX = 2.0;
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/** Opaque background color of a computed-style string, or null if transparent/unset. */
function opaqueBg(c: string | undefined): Rgb | null {
  if (!c) return null;
  const s = c.trim().toLowerCase();
  if (s === "transparent") return null;
  const rgba = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgba) {
    const a = rgba[4] != null ? Number(rgba[4]) : 1;
    if (a < 0.5) return null; // see-through: not the surface behind the text
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]) };
  }
  return parseCssColor(c);
}

/** The surface rendered behind an element's text: its own opaque background, else
 *  the nearest enclosing opaque surface, else the page default (white). */
function effectiveBg(el: ElementInfo, elements: ElementInfo[]): Rgb {
  const own = opaqueBg(el.styles.backgroundColor);
  if (own) return own;
  let best: { bg: Rgb; area: number } | null = null;
  for (const o of elements) {
    if (o === el || !containsBounds(o.bounds, el.bounds)) continue;
    const bg = opaqueBg(o.styles.backgroundColor);
    if (bg && (!best || o.area < best.area)) best = { bg, area: o.area };
  }
  return best ? best.bg : WHITE;
}

/** WCAG contrast of an element's text against its effective background, or null
 *  when the text color is unknown (can't judge — treated as legible upstream). */
function textContrast(el: ElementInfo, elements: ElementInfo[]): number | null {
  const fg = parseCssColor(el.styles.color);
  if (!fg) return null;
  return contrastRatio(fg, effectiveBg(el, elements));
}

function refDataToInput(ref: ReferenceData): FidelityInput {
  return {
    layout: ref.layout.map((l) => ({ bounds: l.bounds, fill: l.fill })),
    text: ref.text.map((t) => ({ text: t.text, bounds: t.bounds, color: t.color })),
  };
}

function elementsToInput(elements: ElementInfo[]): FidelityInput {
  return {
    layout: elements.map((e) => ({ bounds: e.bounds, fill: e.styles.backgroundColor ?? null })),
    // VISIBLE leaf text runs only — same granularity as the reference extract, and
    // clipped/occluded runs (in the DOM but off screen) don't count as present, so
    // recall reflects what a human actually reads.
    text: visibleLeafText(elements).map((e) => ({
      text: e.text!,
      bounds: e.bounds,
      color: e.styles.color ?? null,
      label: e.selector,
    })),
  };
}

function parsePxStyle(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^(-?\d*(?:\.\d+)?)px$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
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
