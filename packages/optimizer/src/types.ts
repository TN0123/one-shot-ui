import type { Bounds } from "@one-shot-ui/core";

export interface ElementInfo {
  selector: string;
  tag: string;
  /** Class list (first few), used to group identical fixes into one CSS rule. */
  classes: string[];
  /** CSS px, viewport-relative. */
  bounds: Bounds;
  area: number;
  /** DOM depth — containers (smaller depth) are tried first within a pass. */
  depth: number;
  /** innerText trimmed, ≤120 chars. */
  text: string | null;
  /** Computed-style subset keyed by camelCase property. */
  styles: Record<string, string>;
  /**
   * How this element's text is hidden from view despite being in the DOM:
   * "clip" (cut off by an overflow box) or null/undefined when visible. Set by
   * collectElements in the browser.
   */
  hidden?: "clip" | null;
}

export interface MatchedRegion {
  id: string;
  bounds: Bounds;
  fill: string | null;
  borderRadius: number | null;
}

export interface MatchedTextBlock {
  text: string;
  bounds: Bounds;
  fontSize: number | null;
  fontWeight: number | null;
  color: string | null;
}

export interface MatchedElement {
  element: ElementInfo;
  region: MatchedRegion | null;
  textBlocks: MatchedTextBlock[];
  iou: number;
}

export interface Candidate {
  selector: string;
  property: string;
  value: string;
  /** e.g. "geometry:width", "color:fill", "typography:font-size" */
  source: string;
  /** Present → numeric line search around the accepted value applies. */
  numeric?: { base: number; unit: string };
}

export interface AcceptedFix {
  selector: string;
  property: string;
  value: string;
  source: string;
  gainPixels: number;
}

export interface MissingStructure {
  regionId: string;
  bounds: Bounds;
  note: string;
}

export interface ConvergeReport {
  initialMismatchRatio: number;
  finalMismatchRatio: number;
  initialMismatchPixels: number;
  finalMismatchPixels: number;
  evals: number;
  passes: number;
  accepted: AcceptedFix[];
  rejectedCount: number;
  missingStructure: MissingStructure[];
  verdict: "pixel-converged" | "css-exhausted" | "budget-exhausted";
  patchCss: string;
  /** Box-moving fixes reverted because they introduced text overlap (the legibility gate). */
  overlapsRepaired: number;
  /** Box-moving fixes reverted because they hid/ejected reference text (the content gate). */
  contentRestored: number;
  /** Text overlaps still present after repair (pre-existing in the impl, or unfixable via CSS). */
  residualTextOverlaps: number;
  /** Reference text the build renders but hides (clipped/occluded); CSS can't fix it — build must. */
  hiddenContent: import("./hidden-content.js").HiddenBlock[];
  /** Structural fidelity of the final build vs the reference (see fidelity.ts). */
  fidelity: import("./fidelity.js").FidelityBreakdown;
}
