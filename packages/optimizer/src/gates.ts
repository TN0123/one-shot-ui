// Structural gates: after the pixel loop, undo fixes that "won" pixels by making
// the build worse in ways pixel-diff can't see. Two failures, both caused by
// box-affecting fixes: text shoved onto its neighbor (overlap), and text
// collapsed/ejected out of the render entirely (missing content). Each gate is a
// pure decision — "given the baseline, the current state, and the accepted fixes,
// which fixes are the culprits?" — so it is unit-tested without a browser.

import type { AcceptedFix } from "./types.js";
import type { TextOverlap } from "./fidelity.js";

/**
 * Fixes in these families move/resize element boxes, so they are the only ones
 * that can push text onto a neighbor or collapse/eject it. Color and other
 * non-geometric fixes never change what content is where, so they are never
 * reverted by a structural gate.
 */
export function isBoxAffecting(source: string): boolean {
  return source.startsWith("geometry") || source.startsWith("typography");
}

/** Order-independent key for a pair of selectors. */
export const overlapKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * A box-affecting fix is a culprit for element `sel` when it targets that element
 * or one of its ancestors. Selectors are built as `a > b > c`, so an ancestor is
 * a prefix — a fix on the container that collapsed/moved its text child counts.
 */
function affects(fix: AcceptedFix, sel: string): boolean {
  return isBoxAffecting(fix.source) && (sel === fix.selector || sel.startsWith(fix.selector + " >"));
}

/**
 * Accepted box-affecting fixes that introduced a text overlap NOT present in the
 * model's raw output. Pixel-diff is blind to overlap, so the optimizer will shove
 * an element onto its neighbor to shave a few pixels; these are the fixes that did
 * it. Overlaps the model already shipped are its problem, not the optimizer's.
 */
export function freshOverlapCulprits(
  overlaps: TextOverlap[],
  baselineOverlapKeys: Set<string>,
  accepted: AcceptedFix[],
): AcceptedFix[] {
  const touched = new Set<string>();
  for (const o of overlaps) {
    if (baselineOverlapKeys.has(overlapKey(o.a, o.b))) continue;
    touched.add(o.a);
    touched.add(o.b);
  }
  return accepted.filter((f) => [...touched].some((sel) => affects(f, sel)));
}

/**
 * Accepted box-affecting fixes that DROPPED a reference text block the build was
 * showing at baseline. collectElements omits display:none / opacity:0 / off-screen
 * / sub-16px² nodes, so a fix that collapses or ejects text makes it vanish — and
 * pixel-diff rewards that (fewer pixels left to mismatch). `baselineMatches` maps
 * each baseline-present reference block (by its stable index) to the impl selector
 * that held it; `presentRefKeys` is the set of reference blocks still present now.
 *
 * Limitation: attributes loss to a fix on the vanished element or an ancestor of
 * it. A fix on a *sibling* that pushed this element off-screen is not caught here
 * (rare in practice, and still surfaced in the fidelity report's contentRecall).
 */
export function missingContentCulprits(
  baselineMatches: Map<number, string>,
  presentRefKeys: Set<number>,
  accepted: AcceptedFix[],
): AcceptedFix[] {
  const lostSelectors = new Set<string>();
  for (const [refIndex, sel] of baselineMatches) {
    if (!presentRefKeys.has(refIndex)) lostSelectors.add(sel);
  }
  return accepted.filter((f) => [...lostSelectors].some((sel) => affects(f, sel)));
}
