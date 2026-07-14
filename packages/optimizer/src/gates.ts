// Structural gates: after the pixel loop, undo fixes that "won" pixels by making
// the build worse in ways pixel-diff can't see. Two failures, both caused by
// box-affecting fixes: text shoved onto its neighbor (overlap), and text
// collapsed/ejected out of the render entirely (missing content). Each gate is a
// pure decision — "given the baseline, the current state, and the accepted fixes,
// which fixes are the culprits?" — so it is unit-tested without a browser.

import type { Bounds } from "@one-shot-ui/core";
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

/** Color fixes recolor surfaces and text; only these can recolor text into its background. */
export function isColorFix(source: string): boolean {
  return source.startsWith("color");
}

/** Does `outer` enclose `inner` (with a small tolerance)? Geometric ancestry. */
export function containsBounds(outer: Bounds, inner: Bounds, tol = 2): boolean {
  return (
    outer.x <= inner.x + tol &&
    outer.y <= inner.y + tol &&
    outer.x + outer.width >= inner.x + inner.width - tol &&
    outer.y + outer.height >= inner.y + inner.height - tol
  );
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

/** A reference text block the build showed at baseline but no longer shows. */
export interface LostBlock {
  /** The impl element that held the content. */
  selector: string;
  bounds: Bounds;
  /** gone = dropped from the render (ejected/collapsed); illegible = recolored into its background. */
  reason: "gone" | "illegible";
}

/**
 * Accepted fixes that caused reference content to stop showing — the failures a
 * pixel diff rewards but a human never accepts. A GONE block was ejected or
 * collapsed by a box-moving fix (collectElements omits display:none / opacity:0 /
 * off-screen / sub-16px² nodes); an ILLEGIBLE block was recolored into its
 * background by a color fix (the DOM node survives, so a presence check misses it
 * — only contrast catches it).
 *
 * Attribution is GEOMETRIC: the culprit fix targets the lost element itself or an
 * element that encloses it (color inherits, container geometry cascades), which is
 * robust to however collectElements minified the selector. `boundsOf` resolves a
 * fix's selector to its current bounds.
 */
export function lostContentCulprits(
  lost: LostBlock[],
  accepted: AcceptedFix[],
  boundsOf: (selector: string) => Bounds | undefined,
): AcceptedFix[] {
  const out = new Set<AcceptedFix>();
  for (const block of lost) {
    const familyOk = block.reason === "illegible" ? isColorFix : isBoxAffecting;
    for (const f of accepted) {
      if (!familyOk(f.source)) continue;
      if (f.selector === block.selector) {
        out.add(f);
        continue;
      }
      const fb = boundsOf(f.selector);
      if (fb && containsBounds(fb, block.bounds)) out.add(f);
    }
  }
  return [...out];
}
