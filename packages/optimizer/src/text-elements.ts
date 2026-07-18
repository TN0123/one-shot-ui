// Pure helpers for reducing a live DOM element list to the real, *visible* text
// runs — the granularity the reference extract reports (tight per-run boxes).
// Kept browser-free so the fidelity/content logic that consumes them is unit-tested.

import type { ElementInfo } from "./types.js";

const strictlyContains = (o: ElementInfo["bounds"], i: ElementInfo["bounds"]): boolean =>
  o.x <= i.x && o.y <= i.y && o.x + o.width >= i.x + i.width && o.y + o.height >= i.y + i.height &&
  o.width * o.height > i.width * i.height;

/**
 * Only LEAF text elements are real text runs. A container's innerText bubbles up
 * from its children, so a card reads as one big "text" box covering all its lines
 * — a phantom that both false-flags overlaps AND mismatches the reference, whose
 * extract reports tight per-run boxes. Dropping any text element that strictly
 * contains another leaves the actual lines, matching the reference's granularity.
 */
export function leafTextElements(elements: ElementInfo[]): ElementInfo[] {
  const textEls = elements.filter((e) => e.text);
  return textEls.filter((e) => !textEls.some((o) => o !== e && strictlyContains(e.bounds, o.bounds)));
}

/**
 * Leaf text runs the user can actually SEE — clipped or occluded runs are in the
 * DOM but not on screen, so they must not count as present content (that is the
 * failure pixel-diff rewards). `hidden` is set by collectElements in the browser.
 */
export function visibleLeafText(elements: ElementInfo[]): ElementInfo[] {
  return leafTextElements(elements).filter((e) => !e.hidden);
}
