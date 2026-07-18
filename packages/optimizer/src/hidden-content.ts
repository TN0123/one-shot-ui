// Reference text the build renders into the DOM but does NOT show — cut off by an
// overflow box (fixed height/width + overflow:hidden). It is legible and present as
// far as a DOM/contrast check can tell, so pixel-diff and the recolor gate both miss
// it; only measuring what is actually visible (collectElements sets `hidden`) surfaces
// it. converge cannot fix it with CSS (un-clipping grows the box and worsens the
// pixels), so it is REPORTED for the agent to fix in markup, like missingStructure.

import type { ElementInfo } from "./types.js";
import { assignTextBlocks, type FidelityInput, type FidelityOptions } from "./fidelity.js";
import { leafTextElements } from "./text-elements.js";

export interface HiddenBlock {
  /** The reference text that isn't visibly shown. */
  refText: string;
  /** Why it isn't visible. */
  mechanism: "clip";
  /** The impl element that holds (but hides) it. */
  selector: string;
}

const textInput = (els: ElementInfo[]): FidelityInput => ({
  layout: [],
  text: els.map((e) => ({ text: e.text!, bounds: e.bounds, color: e.styles.color ?? null, label: e.selector })),
});

/**
 * Reference text blocks whose only DOM match is a hidden (clipped/occluded)
 * element. A block that is ALSO matched by a visible element is on screen
 * somewhere, so it is not reported.
 */
export function hiddenContentBlocks(
  ref: FidelityInput,
  elements: ElementInfo[],
  opts: FidelityOptions,
): HiddenBlock[] {
  const leaves = leafTextElements(elements);
  const hidden = leaves.filter((e) => e.hidden);
  if (!hidden.length) return [];
  const visible = leaves.filter((e) => !e.hidden);

  const shownRef = new Set(
    assignTextBlocks(ref, textInput(visible), opts).assignments.map((a) => a.refIndex),
  );
  const bySelector = new Map(hidden.map((e) => [e.selector, e] as const));

  const out: HiddenBlock[] = [];
  for (const a of assignTextBlocks(ref, textInput(hidden), opts).assignments) {
    if (shownRef.has(a.refIndex) || a.implLabel == null) continue;
    const el = bySelector.get(a.implLabel);
    if (!el?.hidden) continue;
    out.push({ refText: a.refBlock.text, mechanism: el.hidden, selector: a.implLabel });
  }
  return out;
}
